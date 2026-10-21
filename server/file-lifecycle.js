import { HttpError } from "./security.js";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 100;
const PENDING_TTL = 10 * 60 * 1000;

// Reserve before external I/O. Reservations deliberately survive account deletion
// and count toward quota until physical object deletion has succeeded.
export async function reserveFileObject(
  store,
  { key, userId, fileId, size, now = Date.now() },
) {
  if (
    typeof key !== "string" ||
    !key.length ||
    key.length > 512 ||
    typeof userId !== "string" ||
    !userId.length ||
    typeof fileId !== "string" ||
    !fileId.length ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 20 * 1024 * 1024 ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw new HttpError(400, "Invalid document reservation");
  await store.atomic(async () => {
    const { db } = store;
    if (!(await db.prepare("SELECT id FROM users WHERE id=?").get(userId)))
      throw new HttpError(401, "Sign in again");
    const reserved = await db
      .prepare(
        "SELECT COALESCE(sum(byte_size),0) bytes,count(*) n FROM file_objects WHERE user_id=?",
      )
      .get(userId);
    const legacy = await db
      .prepare(
        "SELECT COALESCE(sum(length(body)),0) bytes,count(*) n FROM files WHERE user_id=? AND storage_key IS NULL",
      )
      .get(userId);
    if (
      Number(reserved.bytes) + Number(legacy.bytes) + size > MAX_BYTES ||
      Number(reserved.n) + Number(legacy.n) >= MAX_FILES
    )
      throw new HttpError(
        413,
        "Document storage limit reached (100 MB / 100 files)",
      );
    await db
      .prepare(
        "INSERT INTO file_objects(storage_key,user_id,file_id,byte_size,expires_at,state) VALUES(?,?,?,?,?,'pending')",
      )
      .run(key, userId, fileId, size, now + PENDING_TTL);
  });
}

// Call inside the same transaction that inserts the file's metadata. An expired
// reservation cannot be revived after cleanup has claimed its object.
export async function attachFileObject(store, key) {
  const result = await store.db
    .prepare(
      "UPDATE file_objects SET state='attached',expires_at=0 WHERE storage_key=? AND state='pending' AND expires_at>?",
    )
    .run(key, Date.now());
  if (!result.changes)
    throw new HttpError(409, "Document upload expired. Try again.");
}

export async function abandonFileObject(store, key) {
  const result = await store.db
    .prepare(
      "UPDATE file_objects SET state='deleting',expires_at=0 WHERE storage_key=? AND state='pending'",
    )
    .run(key);
  return !!result.changes;
}

// Caller includes this in the account deletion transaction. No foreign key on
// file_objects: cascading the user must never erase the deletion work itself.
export async function queueAccountFileDeletion(store, userId) {
  await store.db
    .prepare(
      "UPDATE file_objects SET state='deleting',expires_at=CASE WHEN state='pending' THEN expires_at ELSE 0 END WHERE user_id=?",
    )
    .run(userId);
}

export async function processFileCleanup(
  store,
  storage,
  { deadline = Infinity, now = Date.now() } = {},
) {
  const result = { processed: 0, deleted: 0, failed: 0 };
  const rows = await store.db
    .prepare(
      "SELECT storage_key FROM file_objects WHERE state IN ('pending','deleting') AND expires_at<=? ORDER BY expires_at,storage_key LIMIT 20",
    )
    .all(now);
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    result.processed++;
    let claimed = false;
    try {
      claimed = await store.atomic(async () => {
        const claim = await store.db
          .prepare(
            "UPDATE file_objects SET state='deleting',expires_at=0 WHERE storage_key=? AND state IN ('pending','deleting') AND expires_at<=?",
          )
          .run(row.storage_key, now);
        return !!claim.changes;
      });
      if (!claimed) continue;
      await storage.delete(row.storage_key);
      const removed = await store.db
        .prepare(
          "DELETE FROM file_objects WHERE storage_key=? AND state='deleting'",
        )
        .run(row.storage_key);
      result.deleted += Number(!!removed.changes);
    } catch {
      // Preserve the durable row for a later tick; never log names or contents.
      result.failed++;
      if (claimed) {
        try {
          await store.db
            .prepare(
              "UPDATE file_objects SET expires_at=? WHERE storage_key=? AND state='deleting'",
            )
            .run(now + 60000, row.storage_key);
        } catch {
          // Database outages still leave the original durable deletion row.
        }
      }
    }
  }
  return result;
}
