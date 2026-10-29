import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../helpers/store.js";
import { openDatabase } from "../../server/database.js";

test("simultaneous edits commit once and nested failures roll back all writes", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await store.db
    .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
    .run("owner", "owner@example.com", "unused", "Owner", "UTC", "[]");
  const record = await store.save("owner", "note", { text: "original" });
  const results = await Promise.allSettled([
    store.save("owner", "note", { text: "first" }, record.id, record.version),
    store.save("owner", "note", { text: "second" }, record.id, record.version),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.status,
    409,
  );
  await assert.rejects(
    store.atomic(async () => {
      await store.save("owner", "note", { text: "rolled back" });
      await store.atomic(async () => {
        throw new Error("abort");
      });
    }),
    /abort/,
  );
  assert.equal((await store.list("owner", "note")).length, 1);
  assert.equal((await store.get("owner", record.id)).version, 2);
});

test("transaction-pooler schema settings are local to a pinned transaction", async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [], fields: [] };
    },
    release: () => calls.push("release"),
  };
  const pool = { on() {}, connect: async () => client, end: async () => {} };
  const db = openDatabase("postgresql://localhost/test", { pool });
  await db.prepare("SELECT id FROM users").all();
  assert.deepEqual(calls, [
    "BEGIN",
    "SET LOCAL search_path TO offerly, pg_catalog; SET LOCAL statement_timeout = '15s'; SET LOCAL idle_in_transaction_session_timeout = '20s'",
    "SELECT id FROM users",
    "COMMIT",
    "release",
  ]);
  calls.length = 0;
  await db.atomic(async () => {
    await db.prepare("SELECT id FROM users").all();
  });
  assert.deepEqual(calls, [
    "BEGIN ISOLATION LEVEL SERIALIZABLE",
    "SET LOCAL search_path TO offerly, pg_catalog; SET LOCAL statement_timeout = '15s'; SET LOCAL idle_in_transaction_session_timeout = '20s'",
    "SELECT id FROM users",
    "COMMIT",
    "release",
  ]);
});
