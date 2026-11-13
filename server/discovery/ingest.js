// Collection into the shared catalog. Network work happens first; the catalog
// is mutated in one transaction only after the response validated. A failed or
// suspicious fetch updates source health and marks listings "could not
// verify" - it never closes or delists anything.
import { randomUUID } from "node:crypto";
import { ConnectorError, fetchBoard, createRateLimiter } from "./connectors.js";
import {
  contentHash,
  groupKey,
  normRequisition,
  normText,
} from "./normalize.js";
const BACKOFF_BASE_MS = 15 * 60 * 1000;
const SUCCESS_INTERVAL_MS = 6 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
export function collectionEnabled(env = process.env) {
  return env.DISCOVERY_COLLECTION_ENABLED === "true";
}
/** Newest content snapshots kept per listing (older ones are pruned). */
export const DEFAULT_SNAPSHOT_KEEP = 20;
export function snapshotKeep(env = process.env) {
  const n = Number(env.DISCOVERY_SNAPSHOT_KEEP);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : DEFAULT_SNAPSHOT_KEEP;
}
/** Keeps the newest `keep` snapshots of one listing. Works on SQLite and PostgreSQL. */
export async function pruneListingSnapshots(store, listingId, keep) {
  const r = await store.db
    .prepare(
      "DELETE FROM discovery_snapshots WHERE listing_id=? AND id NOT IN (SELECT id FROM discovery_snapshots WHERE listing_id=? ORDER BY captured_at DESC,id DESC LIMIT ?)",
    )
    .run(listingId, listingId, keep);
  return r.changes || 0;
}
/** Bounded sweep for listings over the cap (e.g. after lowering it). */
export async function pruneSnapshots(
  store,
  { keep = snapshotKeep(), batch = 50 } = {},
) {
  const rows = await store.db
    .prepare(
      "SELECT listing_id FROM discovery_snapshots GROUP BY listing_id HAVING COUNT(*)>? ORDER BY listing_id LIMIT ?",
    )
    .all(keep, batch);
  let pruned = 0;
  for (const { listing_id: id } of rows)
    pruned += await pruneListingSnapshots(store, id, keep);
  return { listings: rows.length, pruned };
}
async function record(
  store,
  source,
  startedAt,
  finishedAt,
  outcome,
  count,
  code,
) {
  await store.db
    .prepare(
      "INSERT INTO discovery_runs(id,source_id,started_at,finished_at,outcome,listing_count,error_code) VALUES(?,?,?,?,?,?,?)",
    )
    .run(randomUUID(), source.id, startedAt, finishedAt, outcome, count, code);
}
async function recordFailure(store, source, error, now, outcome) {
  const failures = source.consecutive_failures + 1;
  const backoff = Math.max(
    error.retryAfterMs || 0,
    Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), 24 * 3600 * 1000),
  );
  await store.atomic(async () => {
    await store.db
      .prepare(
        "UPDATE discovery_sources SET health=?,consecutive_failures=?,last_error_code=?,last_attempt_at=?,next_fetch_at=? WHERE id=?",
      )
      .run(
        failures >= 3 ? "failing" : "degraded",
        failures,
        error.code,
        iso(now),
        iso(now + backoff),
        source.id,
      );
    // Status stays 'listed': an outage is not evidence a role closed.
    await store.db
      .prepare(
        "UPDATE discovery_listings SET verification='could_not_verify' WHERE source_id=? AND status='listed'",
      )
      .run(source.id);
    await record(store, source, iso(now), iso(now), outcome, 0, error.code);
  });
}
async function refreshJobStatus(store, jobId, now, reopenedBy) {
  const job = await store.db
    .prepare("SELECT status FROM discovery_jobs WHERE id=?")
    .get(jobId);
  const open = await store.db
    .prepare(
      "SELECT COUNT(*) AS n FROM discovery_listings WHERE job_id=? AND status='listed'",
    )
    .get(jobId);
  const status = Number(open.n) > 0 ? "listed" : "not_listed";
  if (status === job.status) return;
  if (status === "listed" && reopenedBy)
    await store.db
      .prepare(
        "UPDATE discovery_jobs SET status='listed',reopened_at=?,reopened_count=reopened_count+1,last_changed_at=? WHERE id=?",
      )
      .run(now, now, jobId);
  else
    await store.db
      .prepare(
        "UPDATE discovery_jobs SET status=?,last_changed_at=? WHERE id=?",
      )
      .run(status, now, jobId);
}
/**
 * Same-opening matching. A shared requisition is decisive. Different
 * requisitions are never merged, whatever the title. Otherwise match on
 * company+title+location across different sources only, and only when exactly
 * one candidate exists (two postings in one source stay distinct).
 */
async function findJob(store, companyId, sourceId, listing) {
  const jobs = await store.db
    .prepare("SELECT * FROM discovery_jobs WHERE company_id=?")
    .all(companyId);
  const req = normRequisition(listing.requisition);
  if (req) {
    const byReq = jobs.find((j) => normRequisition(j.requisition) === req);
    if (byReq) return byReq;
  }
  const title = normText(listing.title),
    location = normText(listing.location);
  const candidates = [];
  for (const job of jobs) {
    if (normText(job.title) !== title || normText(job.location) !== location)
      continue;
    const jobReq = normRequisition(job.requisition);
    if (req && jobReq && req !== jobReq) continue;
    const sameSource = await store.db
      .prepare(
        "SELECT 1 AS x FROM discovery_listings WHERE job_id=? AND source_id=?",
      )
      .get(job.id, sourceId);
    if (!sameSource) candidates.push(job);
  }
  return candidates.length === 1 ? candidates[0] : null;
}
const snapshotFields = (l) =>
  JSON.stringify({
    title: l.title,
    location: l.location,
    requisition: l.requisition,
    url: l.url,
    description: l.description,
    workArrangement: l.workArrangement,
    employmentType: l.employmentType,
    postedAt: l.postedAt,
    compensation: l.compensation,
  });
async function applyListings(store, source, listings, now, keep) {
  const stamp = iso(now);
  const touched = new Set();
  const reopened = new Set();
  const seen = new Set(listings.map((l) => l.externalId));
  for (const listing of listings) {
    const hash = contentHash(listing);
    const c = listing.compensation;
    const existing = await store.db
      .prepare(
        "SELECT * FROM discovery_listings WHERE source_id=? AND external_id=?",
      )
      .get(source.id, listing.externalId);
    if (existing) {
      touched.add(existing.job_id);
      const wasClosed = existing.status === "not_listed";
      if (wasClosed) reopened.add(existing.job_id);
      await store.db
        .prepare(
          "UPDATE discovery_listings SET status='listed',verification='verified',last_seen_at=?,last_checked_at=? WHERE id=?",
        )
        .run(stamp, stamp, existing.id);
      await store.db
        .prepare("UPDATE discovery_jobs SET last_checked_at=? WHERE id=?")
        .run(stamp, existing.job_id);
      if (existing.content_hash === hash) continue;
      await store.db
        .prepare(
          "UPDATE discovery_listings SET url=?,requisition=?,title=?,location=?,content_hash=? WHERE id=?",
        )
        .run(
          listing.url,
          listing.requisition,
          listing.title,
          listing.location,
          hash,
          existing.id,
        );
      await store.db
        .prepare(
          "INSERT INTO discovery_snapshots(id,listing_id,captured_at,content_hash,fields) VALUES(?,?,?,?,?)",
        )
        .run(randomUUID(), existing.id, stamp, hash, snapshotFields(listing));
      await pruneListingSnapshots(store, existing.id, keep);
      // A content update never resets employer_posted_at or first_discovered_at.
      await store.db
        .prepare(
          "UPDATE discovery_jobs SET title=?,location=?,description=?,work_arrangement=?,employment_type=?,comp_min=?,comp_max=?,comp_currency=?,comp_period=?,comp_basis=?,requisition=CASE WHEN requisition='' THEN ? ELSE requisition END,content_hash=?,last_changed_at=? WHERE id=?",
        )
        .run(
          listing.title,
          listing.location,
          listing.description,
          listing.workArrangement,
          listing.employmentType,
          c.min,
          c.max,
          c.currency,
          c.period,
          c.basis,
          listing.requisition,
          hash,
          stamp,
          existing.job_id,
        );
      continue;
    }
    let job = await findJob(store, source.company_id, source.id, listing);
    if (!job) {
      const id = randomUUID();
      await store.db
        .prepare(
          "INSERT INTO discovery_jobs(id,company_id,title,location,requisition,group_key,description,work_arrangement,employment_type,comp_min,comp_max,comp_currency,comp_period,comp_basis,employer_posted_at,posted_precision,posted_timezone,first_discovered_at,last_checked_at,last_changed_at,status,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'listed',?)",
        )
        .run(
          id,
          source.company_id,
          listing.title,
          listing.location,
          listing.requisition,
          groupKey(source.company_id, listing),
          listing.description,
          listing.workArrangement,
          listing.employmentType,
          c.min,
          c.max,
          c.currency,
          c.period,
          c.basis,
          listing.postedAt,
          listing.postedPrecision,
          listing.postedTimezone,
          stamp,
          stamp,
          stamp,
          hash,
        );
      job = { id, status: "listed" };
    } else {
      if (job.status === "not_listed") reopened.add(job.id);
      // Attaching another source never rewrites original discovery history;
      // it only fills fields the catalog did not yet know.
      await store.db
        .prepare(
          "UPDATE discovery_jobs SET last_checked_at=?,requisition=CASE WHEN requisition='' THEN ? ELSE requisition END,employer_posted_at=CASE WHEN employer_posted_at IS NULL THEN ? ELSE employer_posted_at END,posted_precision=CASE WHEN employer_posted_at IS NULL THEN ? ELSE posted_precision END,posted_timezone=CASE WHEN employer_posted_at IS NULL THEN ? ELSE posted_timezone END WHERE id=?",
        )
        .run(
          stamp,
          listing.requisition,
          listing.postedAt,
          listing.postedPrecision,
          listing.postedTimezone,
          job.id,
        );
    }
    touched.add(job.id);
    const listingId = randomUUID();
    await store.db
      .prepare(
        "INSERT INTO discovery_listings(id,job_id,source_id,external_id,url,requisition,title,location,status,verification,first_seen_at,last_seen_at,last_checked_at,content_hash) VALUES(?,?,?,?,?,?,?,?,'listed','verified',?,?,?,?)",
      )
      .run(
        listingId,
        job.id,
        source.id,
        listing.externalId,
        listing.url,
        listing.requisition,
        listing.title,
        listing.location,
        stamp,
        stamp,
        stamp,
        hash,
      );
    await store.db
      .prepare(
        "INSERT INTO discovery_snapshots(id,listing_id,captured_at,content_hash,fields) VALUES(?,?,?,?,?)",
      )
      .run(randomUUID(), listingId, stamp, hash, snapshotFields(listing));
    await pruneListingSnapshots(store, listingId, keep);
  }
  // Only after a validated, complete response may a missing listing be
  // recorded as "no longer listed by this source".
  const current = await store.db
    .prepare(
      "SELECT id,job_id,external_id FROM discovery_listings WHERE source_id=? AND status='listed'",
    )
    .all(source.id);
  for (const row of current) {
    if (seen.has(row.external_id)) continue;
    await store.db
      .prepare(
        "UPDATE discovery_listings SET status='not_listed',last_checked_at=? WHERE id=?",
      )
      .run(stamp, row.id);
    touched.add(row.job_id);
  }
  for (const jobId of touched)
    await refreshJobStatus(store, jobId, stamp, reopened.has(jobId));
}
/**
 * Collect one source. Never touches the network unless the operator enabled
 * collection globally, enabled the source, and recorded permission for it.
 */
export async function ingestSource(store, sourceId, options = {}) {
  const {
    fetcher,
    limiter = createRateLimiter(),
    now = Date.now(),
    force = false,
    acceptDrop = false,
    env = process.env,
  } = options;
  const source = await store.db
    .prepare("SELECT * FROM discovery_sources WHERE id=?")
    .get(sourceId);
  if (!source) return { outcome: "skipped", reason: "not_found" };
  if (!collectionEnabled(env))
    return { outcome: "skipped", reason: "collection_disabled" };
  if (!source.enabled || source.permission_status !== "confirmed")
    return { outcome: "skipped", reason: "source_not_approved" };
  if (!force && source.next_fetch_at && Date.parse(source.next_fetch_at) > now)
    return { outcome: "skipped", reason: "not_due" };
  let result;
  try {
    result = await fetchBoard(source, { fetcher, limiter });
  } catch (error) {
    const known =
      error instanceof ConnectorError
        ? error
        : new ConnectorError("fetch_failed");
    const outcome = [
      "invalid_shape",
      "invalid_json",
      "mostly_invalid",
    ].includes(known.code)
      ? "rejected"
      : "failed";
    await recordFailure(store, source, known, now, outcome);
    return { outcome, reason: known.code };
  }
  const drop =
    source.listed_count > 0 &&
    (result.listings.length === 0 ||
      (source.listed_count >= 5 &&
        result.listings.length < source.listed_count * 0.5));
  if (drop && !acceptDrop) {
    await recordFailure(
      store,
      source,
      new ConnectorError("suspicious_drop"),
      now,
      "rejected",
    );
    return { outcome: "rejected", reason: "suspicious_drop" };
  }
  await store.atomic(async () => {
    await applyListings(store, source, result.listings, now, snapshotKeep(env));
    await store.db
      .prepare(
        "UPDATE discovery_sources SET health='healthy',consecutive_failures=0,last_error_code='',last_success_at=?,last_attempt_at=?,next_fetch_at=?,listed_count=? WHERE id=?",
      )
      .run(
        iso(now),
        iso(now),
        iso(now + SUCCESS_INTERVAL_MS),
        result.listings.length,
        source.id,
      );
    await record(
      store,
      source,
      iso(now),
      iso(now),
      "success",
      result.listings.length,
      "",
    );
  });
  return {
    outcome: "success",
    listings: result.listings.length,
    skippedInvalid: result.invalid,
  };
}
/**
 * Run approved sources that are due, oldest first. Sequential to respect
 * providers, and bounded by `limit` sources and an optional `deadline` (epoch
 * ms). A failing source backs off on its own (see recordFailure) and never
 * blocks the others.
 */
export async function ingestDue(store, options = {}) {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 25;
  const sources = await store.db
    .prepare(
      "SELECT id FROM discovery_sources WHERE enabled=1 AND permission_status='confirmed' AND (next_fetch_at IS NULL OR next_fetch_at<=?) ORDER BY COALESCE(next_fetch_at,''),id LIMIT ?",
    )
    .all(iso(now), limit);
  const results = [];
  for (const { id } of sources) {
    if (options.deadline && Date.now() >= options.deadline) break;
    results.push({
      id,
      ...(await ingestSource(store, id, { ...options, now })),
    });
  }
  return results;
}
