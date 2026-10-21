import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "../server/store.js";
import { snapshotDatabase } from "../server/backup.js";
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "offerly-backup-test-"));
  const source = join(dir, "live.sqlite");
  const store = await createStore(source);
  await store.db
    .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
    .run("owner", "backup@example.test", "hash", "Backup", "UTC", "[]");
  await store.db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
    .run("session-digest", "owner", Date.now() + 10000, Date.now());
  await store.save("owner", "applications", { company: "Snapshot test" });
  await store.db
    .prepare("INSERT INTO files VALUES(?,?,?,?,?,?,?,?)")
    .run(
      "file",
      "owner",
      "resume.pdf",
      "application/pdf",
      "hash",
      Buffer.from("private-file"),
      new Date().toISOString(),
      null,
    );
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, source, store };
}
test("online WAL backup restores records and bytes, revokes sessions, leaves source intact", async (t) => {
  const { dir, source, store } = await fixture(t);
  await store.db.exec("PRAGMA wal_autocheckpoint=0");
  const saved = join(dir, "backup.sqlite"),
    restored = join(dir, "restored.sqlite");
  await snapshotDatabase(source, saved);
  await store.save("owner", "applications", { company: "After snapshot" });
  await snapshotDatabase(saved, restored, { restore: true });
  const db = new DatabaseSync(restored, { readOnly: true });
  try {
    assert.equal(
      (await db.prepare("SELECT count(*) n FROM records").get()).n,
      1,
    );
    assert.equal(
      (await db.prepare("SELECT count(*) n FROM sessions").get()).n,
      0,
    );
    assert.equal(
      Buffer.from(
        (await db.prepare("SELECT body FROM files").get()).body,
      ).toString(),
      "private-file",
    );
    assert.equal(
      (await store.db.prepare("SELECT count(*) n FROM sessions").get()).n,
      1,
    );
    assert.equal((await store.list("owner", "applications")).length, 2);
    assert.equal(statSync(saved).mode & 0o777, 0o600);
    assert.equal(statSync(restored).mode & 0o777, 0o600);
    assert.equal(existsSync(restored + "-wal"), false);
  } finally {
    db.close();
  }
});
test("snapshot refuses overwrite, same path, symlinks and destination WAL", async (t) => {
  const { dir, source } = await fixture(t);
  const output = join(dir, "existing.sqlite");
  writeFileSync(output, "preserve");
  await assert.rejects(snapshotDatabase(source, output));
  assert.equal(readFileSync(output, "utf8"), "preserve");
  await assert.rejects(snapshotDatabase(source, source));
  const link = join(dir, "link.sqlite");
  symlinkSync(output, link);
  await assert.rejects(snapshotDatabase(source, link));
  const dangling = join(dir, "dangling.sqlite");
  symlinkSync(join(dir, "absent"), dangling);
  await assert.rejects(snapshotDatabase(source, dangling));
  const sidecar = join(dir, "sidecar.sqlite");
  writeFileSync(sidecar + "-wal", "preserve");
  await assert.rejects(snapshotDatabase(source, sidecar));
  assert.equal(existsSync(sidecar), false);
});
test("invalid or missing sources never publish a snapshot or create a source", async (t) => {
  const { dir } = await fixture(t);
  const missing = join(dir, "missing.sqlite"),
    output = join(dir, "output.sqlite");
  await assert.rejects(snapshotDatabase(missing, output));
  assert.equal(existsSync(missing), false);
  const invalid = join(dir, "invalid.sqlite");
  writeFileSync(invalid, "not a database");
  await assert.rejects(snapshotDatabase(invalid, output));
  const unrelated = join(dir, "unrelated.sqlite");
  new DatabaseSync(unrelated).close();
  await assert.rejects(snapshotDatabase(unrelated, output));
  assert.equal(existsSync(output), false);
});
