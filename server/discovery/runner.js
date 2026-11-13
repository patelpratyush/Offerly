// Scheduled discovery work, wired into server/scheduler.js and server/worker.js.
// Everything here is OFF unless an operator sets an environment flag:
//   DISCOVERY_COLLECTION_ENABLED=true   collect approved employer boards
//   DISCOVERY_ALERTS_ENABLED=true       queue and deliver alerts and digests
// Collection additionally needs per-source recorded permission (ingest.js).
// Batches are bounded, each source backs off independently after failures, and
// tests inject fetchers: no code path here opens a connection on its own
// unless collection is explicitly enabled and no fetcher was injected.
import {
  collectionEnabled,
  ingestDue,
  pruneSnapshots,
  snapshotKeep,
} from "./ingest.js";
import { createHttpFetcher, createRateLimiter } from "./connectors.js";
import { processAlerts } from "./alerts.js";
import { processDigests } from "./digests.js";
const iso = (ms) => new Date(ms).toISOString();
export function alertProcessingEnabled(env = process.env) {
  return env.DISCOVERY_ALERTS_ENABLED === "true";
}
const CURSOR_KEY = "alert_user_cursor";
async function getCursor(store) {
  return (
    (
      await store.db
        .prepare("SELECT value FROM discovery_state WHERE key=?")
        .get(CURSOR_KEY)
    )?.value || ""
  );
}
async function setCursor(store, value, now) {
  await store.db
    .prepare(
      "INSERT INTO discovery_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    )
    .run(CURSOR_KEY, value, iso(now));
}
/**
 * Process alerts and digests for at most `maxUsers` users per call, resuming
 * after the persisted cursor so every user is reached over successive ticks.
 * One user's failure never stops the others and never logs user data.
 */
export async function processAlertBatch(
  store,
  { now = Date.now(), maxUsers = 25, deadline = 0 } = {},
) {
  const cursor = await getCursor(store);
  const fetchUsers = (after) =>
    store.db
      .prepare(
        "SELECT DISTINCT user_id FROM discovery_alert_rules WHERE paused=0 AND user_id>? ORDER BY user_id LIMIT ?",
      )
      .all(after, maxUsers);
  let users = await fetchUsers(cursor);
  if (!users.length && cursor) users = await fetchUsers("");
  const out = { users: 0, queued: 0, delivered: 0, digests: 0, failed: 0 };
  let last = "";
  for (const { user_id: userId } of users) {
    if (deadline && Date.now() >= deadline) break;
    last = userId;
    try {
      const alerts = await processAlerts(store, { userId, now });
      const digests = await processDigests(store, { userId, now });
      out.users++;
      out.queued += alerts.queued;
      out.delivered += alerts.delivered;
      out.digests += digests.digests;
    } catch {
      out.failed++;
    }
  }
  const finished = users.length < maxUsers && last === users.at(-1)?.user_id;
  await setCursor(store, finished ? "" : last, now);
  return out;
}
/**
 * One bounded tick of discovery work. Returns {skipped:true} when both flags
 * are off, so the scheduler and worker can call it unconditionally.
 */
export async function processDiscovery(
  store,
  {
    now = Date.now(),
    deadline = 0,
    env = process.env,
    fetcher,
    limiter,
    maxSources = 5,
    maxUsers = 25,
  } = {},
) {
  const collect = collectionEnabled(env);
  const alerts = alertProcessingEnabled(env);
  if (!collect && !alerts)
    return { skipped: true, reason: "discovery_disabled" };
  const out = {};
  if (collect) {
    const results = await ingestDue(store, {
      now,
      env,
      deadline,
      limit: maxSources,
      fetcher: fetcher || createHttpFetcher(),
      limiter: limiter || createRateLimiter({ minIntervalMs: 2000 }),
    });
    out.collection = {
      sources: results.length,
      succeeded: results.filter((r) => r.outcome === "success").length,
      failed: results.filter((r) => ["failed", "rejected"].includes(r.outcome))
        .length,
    };
    out.snapshots = await pruneSnapshots(store, { keep: snapshotKeep(env) });
  }
  if (alerts)
    out.alerts = await processAlertBatch(store, { now, maxUsers, deadline });
  return out;
}
