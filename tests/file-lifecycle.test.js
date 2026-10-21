import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "./helpers/store.js";
import {
  reserveFileObject,
  attachFileObject,
  abandonFileObject,
  queueAccountFileDeletion,
  processFileCleanup,
} from "../server/file-lifecycle.js";

async function setup(t) {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const userId = randomUUID();
  await store.db
    .prepare(
      "INSERT INTO users(id,email,password,name,timezone,stages) VALUES(?,?,?,?,?,?)",
    )
    .run(userId, `${userId}@example.test`, "test-hash", "Test", "UTC", "[]");
  const reserve = (extra = {}) =>
    reserveFileObject(store, {
      key: randomUUID(),
      userId,
      fileId: randomUUID(),
      size: 100,
      ...extra,
    });
  return { store, userId, reserve };
}

test("file attachment shares metadata rollback and attached objects never enter cleanup", async (t) => {
  const { store, reserve } = await setup(t);
  const scanner = await store.db
    .prepare(
      "SELECT previous_snapshot_id,retire_after FROM scanner_state WHERE id=1",
    )
    .get();
  assert.equal(scanner.previous_snapshot_id, "");
  assert.equal(scanner.retire_after, 0);
  const key = randomUUID();
  await reserve({ key });
  await assert.rejects(
    store.atomic(async () => {
      await attachFileObject(store, key);
      throw new Error("metadata insert failed");
    }),
    /metadata insert failed/,
  );
  const row = await store.db
    .prepare("SELECT state FROM file_objects WHERE storage_key=?")
    .get(key);
  assert.equal(row.state, "pending");
  await store.atomic(() => attachFileObject(store, key));
  assert.equal(await abandonFileObject(store, key), false);
  let deletions = 0;
  assert.deepEqual(
    await processFileCleanup(
      store,
      {
        delete: async () => {
          deletions++;
        },
      },
      { now: Date.now() + 999999 },
    ),
    {
      processed: 0,
      deleted: 0,
      failed: 0,
    },
  );
  assert.equal(deletions, 0);
});

test("abandoned and expired objects retry failed physical deletion without losing durable work", async (t) => {
  const { store, reserve } = await setup(t);
  const abandoned = randomUUID(),
    expired = randomUUID();
  await reserve({ key: abandoned });
  assert.equal(await abandonFileObject(store, abandoned), true);
  await reserve({ key: expired, now: Date.now() - 600001 });
  await assert.rejects(
    attachFileObject(store, expired),
    (error) => error.status === 409,
  );
  const failed = await processFileCleanup(store, {
    delete: async () => {
      throw new Error("storage down");
    },
  });
  assert.deepEqual(failed, { processed: 2, deleted: 0, failed: 2 });
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM file_objects").get()).n,
    2,
  );
  const deleted = [];
  assert.deepEqual(
    await processFileCleanup(
      store,
      {
        delete: async (key) => deleted.push(key),
      },
      { now: Date.now() + 61000 },
    ),
    {
      processed: 2,
      deleted: 2,
      failed: 0,
    },
  );
  assert.deepEqual(deleted.sort(), [abandoned, expired].sort());
});

test("cleanup backoff lets later objects progress past a full failed batch", async (t) => {
  const { store, reserve } = await setup(t);
  const now = Date.now();
  for (let index = 0; index < 21; index++)
    await reserve({
      key: `cleanup-${String(index).padStart(2, "0")}`,
      now: now - 600000,
    });
  const failed = await processFileCleanup(
    store,
    {
      delete: async () => {
        throw new Error("provider failed");
      },
    },
    { now },
  );
  assert.deepEqual(failed, { processed: 20, deleted: 0, failed: 20 });
  const deleted = [];
  assert.deepEqual(
    await processFileCleanup(
      store,
      { delete: async (key) => deleted.push(key) },
      { now },
    ),
    {
      processed: 1,
      deleted: 1,
      failed: 0,
    },
  );
  assert.deepEqual(deleted, ["cleanup-20"]);
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM file_objects").get()).n,
    20,
  );
});

test("account deletion retains pending upload grace period and cleanup rows survive cascading metadata", async (t) => {
  const { store, userId, reserve } = await setup(t);
  const pending = randomUUID(),
    attached = randomUUID(),
    now = Date.now();
  await reserve({ key: pending, now });
  await reserve({ key: attached, now });
  await attachFileObject(store, attached);
  await store.atomic(async () => {
    await queueAccountFileDeletion(store, userId);
    await store.db.prepare("DELETE FROM users WHERE id=?").run(userId);
  });
  const deleted = [];
  const storage = { delete: async (key) => deleted.push(key) };
  assert.equal((await processFileCleanup(store, storage, { now })).deleted, 1);
  assert.deepEqual(deleted, [attached]);
  assert.equal(
    (await processFileCleanup(store, storage, { now: now + 600000 })).deleted,
    1,
  );
  assert.deepEqual(deleted, [attached, pending]);
  await assert.rejects(reserve(), (error) => error.status === 401);
});

test("reservation quotas include pending bytes and legacy bodies without counting hosted metadata twice", async (t) => {
  const { store, userId, reserve } = await setup(t);
  const size = 20 * 1024 * 1024;
  for (let index = 0; index < 4; index++) {
    const key = randomUUID(),
      fileId = randomUUID();
    await reserve({ key, fileId, size });
    await attachFileObject(store, key);
    await store.db
      .prepare(
        "INSERT INTO files(id,user_id,name,mime,hash,body,created_at,storage_key,byte_size) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        fileId,
        userId,
        "resume.pdf",
        "application/pdf",
        "hash",
        Buffer.alloc(0),
        new Date().toISOString(),
        key,
        size,
      );
  }
  // 80 MB hosted + 20 MB legacy reaches the exact account limit.
  await store.db
    .prepare(
      "INSERT INTO files(id,user_id,name,mime,hash,body,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      userId,
      "legacy.pdf",
      "application/pdf",
      "hash",
      Buffer.alloc(size),
      new Date().toISOString(),
    );
  await assert.rejects(reserve({ size: 1 }), (error) => error.status === 413);
  await store.db
    .prepare("DELETE FROM files WHERE user_id=? AND storage_key IS NULL")
    .run(userId);
  await reserve({ size });
  await assert.rejects(reserve({ size: 1 }), (error) => error.status === 413);
});

test("concurrent reservations cannot exceed file count and cleanup respects its deadline", async (t) => {
  const { store, userId, reserve } = await setup(t);
  await store.atomic(async () => {
    for (let index = 0; index < 99; index++)
      await store.db
        .prepare(
          "INSERT INTO file_objects(storage_key,user_id,file_id,byte_size,expires_at,state) VALUES(?,?,?,?,?,'pending')",
        )
        .run(randomUUID(), userId, randomUUID(), 1, 0);
  });
  const attempts = await Promise.allSettled([reserve(), reserve()]);
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
  );
  assert.equal(
    (
      await store.db
        .prepare("SELECT count(*) n FROM file_objects WHERE user_id=?")
        .get(userId)
    ).n,
    100,
  );
  assert.deepEqual(
    await processFileCleanup(
      store,
      { delete: async () => assert.fail("deadline elapsed") },
      { deadline: 0 },
    ),
    {
      processed: 0,
      deleted: 0,
      failed: 0,
    },
  );
  assert.equal(
    (
      await store.db
        .prepare("SELECT count(*) n FROM file_objects WHERE user_id=?")
        .get(userId)
    ).n,
    100,
  );
});
