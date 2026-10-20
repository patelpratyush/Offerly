import { DatabaseSync, backup } from "node:sqlite";
import {
  chmodSync,
  lstatSync,
  linkSync,
  mkdtempSync,
  openSync,
  closeSync,
  fsyncSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function verify(db) {
  const result = db.prepare("PRAGMA integrity_check").all();
  if (result.length !== 1 || result[0].integrity_check !== "ok")
    throw new Error("Database integrity check failed");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Database relationship check failed");
  // Fail on unrelated or outdated databases without creating/migrating tables.
  for (const sql of [
    "SELECT id,email,password FROM users LIMIT 0",
    "SELECT token,user_id,last_seen FROM sessions LIMIT 0",
    "SELECT id,user_id,kind,data,version FROM records LIMIT 0",
    "SELECT id,user_id,after_data FROM events LIMIT 0",
    "SELECT id,user_id,body,scanned_at FROM files LIMIT 0",
    "SELECT id,user_id,rows FROM import_batches LIMIT 0",
  ])
    db.prepare(sql).all();
}

// Parent directories must be controlled by the operator. Never overwrite a
// destination, including symlinks; publish only a fully verified standalone DB.
export async function snapshotDatabase(
  source,
  destination,
  { restore = false } = {},
) {
  const input = resolve(source),
    output = resolve(destination);
  if (input === output) throw new Error("Source and destination must differ");
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    if (lstatSync(output + suffix, { throwIfNoEntry: false }))
      throw new Error("Destination must be a new database path");
  let db, temp;
  try {
    db = new DatabaseSync(input, { readOnly: true });
    temp = mkdtempSync(join(dirname(output), ".offerly-snapshot-"));
    chmodSync(temp, 0o700);
    const staged = join(temp, "snapshot.sqlite");
    const fd = openSync(staged, "wx", 0o600);
    closeSync(fd);
    await backup(db, staged);
    db.close();
    db = undefined;
    const copy = new DatabaseSync(staged);
    try {
      copy.exec(
        "PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;",
      );
      verify(copy);
      // A restore must never reactivate session credentials from an old backup.
      if (restore) copy.exec("DELETE FROM sessions");
      copy.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
      verify(copy);
    } finally {
      copy.close();
    }
    const ready = openSync(staged, "r");
    try {
      fsyncSync(ready);
    } finally {
      closeSync(ready);
    }
    linkSync(staged, output); // Atomic, exclusive publication; EEXIST cannot overwrite.
    const directory = openSync(dirname(output), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (db) db.close();
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.umask(0o077);
  const [mode, source, destination, ...extra] = process.argv.slice(2);
  if (
    !["backup", "restore"].includes(mode) ||
    !source ||
    !destination ||
    extra.length
  ) {
    console.error(
      "Usage: node server/backup.js <backup|restore> <source.sqlite> <new-destination.sqlite>",
    );
    process.exitCode = 1;
  } else {
    try {
      await snapshotDatabase(source, destination, {
        restore: mode === "restore",
      });
      console.log(
        `${mode === "restore" ? "Restore" : "Backup"} verified and saved. ${mode === "restore" ? "All restored sessions revoked." : "Protect this file as sensitive account data."}`,
      );
    } catch {
      console.error(
        "Database operation failed. Check source integrity, permissions, free space, and that destination is new. No existing database was overwritten.",
      );
      process.exitCode = 1;
    }
  }
}
