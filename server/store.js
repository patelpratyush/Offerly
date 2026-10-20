import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { HttpError } from "./security.js";
export const stages = [
  "Saved",
  "Preparing",
  "Submitted",
  "Under review",
  "Assessment",
  "Interviewing",
  "Offer",
  "Rejected",
  "Withdrawn",
];
export function createStore(path) {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,timezone TEXT NOT NULL,stages TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS records_owner ON records(user_id,kind);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,record_id TEXT NOT NULL,at TEXT NOT NULL,before_data TEXT,after_data TEXT NOT NULL,actor TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_owner ON events(user_id,record_id,at);
    CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,rows TEXT NOT NULL,expires INTEGER NOT NULL,result TEXT,decisions TEXT);
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,hash TEXT NOT NULL,body BLOB NOT NULL,created_at TEXT NOT NULL);
  `);
  if (
    !db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .some((c) => c.name === "last_seen")
  ) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0",
    );
    db.exec("DELETE FROM sessions"); // Old sessions lack an inactivity timestamp; require sign-in.
  }
  if (
    !db
      .prepare("PRAGMA table_info(files)")
      .all()
      .some((c) => c.name === "scanned_at")
  )
    db.exec("ALTER TABLE files ADD COLUMN scanned_at TEXT");
  if (path !== ":memory:")
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
  const list = (user, kind) =>
    db
      .prepare("SELECT * FROM records WHERE user_id=? AND kind=?")
      .all(user, kind)
      .map((r) => ({ ...JSON.parse(r.data), id: r.id, version: r.version }));
  const get = (user, id) =>
    typeof id !== "string"
      ? undefined
      : db
          .prepare("SELECT * FROM records WHERE id=? AND user_id=?")
          .get(id, user);
  let transactionId = 0;
  const atomic = (fn) => {
    const name = `operation_${++transactionId}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (e) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw e;
    }
  };
  const save = (user, kind, data, id, version, actor = "manual") =>
    atomic(() => {
      const old = id ? get(user, id) : undefined;
      if (id && (!old || old.kind !== kind))
        throw Object.assign(new HttpError(404, "Record not found"), {
          status: 404,
        });
      if (old && old.version !== version)
        throw Object.assign(
          new HttpError(
            409,
            "Changed in another window. Refresh before saving.",
          ),
          { status: 409 },
        );
      const recordedAt = new Date().toISOString();
      if (kind === "document" && !old) {
        const root = data.documentId;
        const versions = root
          ? db
              .prepare(
                "SELECT count(*) n, max(COALESCE(json_extract(data,'$.versionNumber'),1)) latest FROM records WHERE user_id=? AND kind='document' AND (id=? OR json_extract(data,'$.documentId')=?)",
              )
              .get(user, root, root)
          : { n: 0, latest: 0 };
        data = {
          ...data,
          createdAt: recordedAt,
          versionNumber: Math.max(versions.n, versions.latest || 0) + 1,
        };
      }
      const serialized = JSON.stringify(data);
      if (Buffer.byteLength(serialized) > 256 * 1024)
        throw new HttpError(413, "Record exceeds the 256 KB limit");
      const count = db
        .prepare("SELECT count(*) n FROM records WHERE user_id=?")
        .get(user).n;
      if (!old && count >= 10000)
        throw new HttpError(413, "Workspace record limit reached");
      const history = db
        .prepare(
          "SELECT count(*) n,COALESCE(sum(COALESCE(length(CAST(before_data AS BLOB)),0)+length(CAST(after_data AS BLOB))),0) bytes FROM events WHERE user_id=?",
        )
        .get(user);
      if (
        history.n >= 50000 ||
        history.bytes +
          Buffer.byteLength(serialized) +
          (old ? Buffer.byteLength(old.data) : 0) >
          32 * 1024 * 1024
      )
        throw new HttpError(
          413,
          "Workspace history limit reached. Export your data before continuing.",
        );
      const key = id || randomUUID();
      db.prepare(
        "INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version",
      ).run(key, user, kind, JSON.stringify(data), (old?.version || 0) + 1);
      db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?)").run(
        randomUUID(),
        user,
        key,
        new Date().toISOString(),
        old?.data || null,
        JSON.stringify(data),
        actor,
      );

      if (kind === "application") {
        const before = old ? JSON.parse(old.data) : null;
        const changed = [
          "description",
          "descriptionCapturedDate",
          "descriptionSourceUrl",
        ].some((field) => (before?.[field] || "") !== (data[field] || ""));
        if (changed) {
          // Preserve legacy text before the first edit; never invent its capture date.
          if (
            before?.description &&
            !db
              .prepare(
                "SELECT id FROM records WHERE user_id=? AND kind='listing_snapshot' AND json_extract(data,'$.applicationId')=? LIMIT 1",
              )
              .get(user, key)
          ) {
            save(
              user,
              "listing_snapshot",
              {
                applicationId: key,
                title: "Earlier listing text",
                description: before.description,
                capturedDate: before.descriptionCapturedDate || "",
                sourceUrl: before.descriptionSourceUrl || "",
                recordedAt,
                legacy: true,
              },
              undefined,
              undefined,
              actor,
            );
          }
          if (data.description)
            save(
              user,
              "listing_snapshot",
              {
                applicationId: key,
                title: "Listing capture",
                description: data.description,
                capturedDate: data.descriptionCapturedDate || "",
                sourceUrl: data.descriptionSourceUrl || "",
                recordedAt,
                legacy: false,
              },
              undefined,
              undefined,
              actor,
            );
        }
      }
      return { ...data, id: key, version: (old?.version || 0) + 1 };
    });
  return { db, list, get, save, atomic };
}
