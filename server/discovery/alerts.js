// In-app alerts only: no email, push or browser notification is sent from here.
// Rules create pending notifications (deduplicated by user/rule/canonical job/
// event). Immediate rules deliver after rechecking the job against the rule,
// then applying pause, quiet hours and the daily volume cap. Daily and weekly
// rules leave their notifications pending for the digest builder (digests.js).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../security.js";
import {
  filterSchema,
  loadContext,
  evaluateJob,
  prefilter,
  selectJobs,
} from "./feed.js";
import { CHUNK, loadCatalogFor, jobsByIds } from "./catalog.js";
import { digestWindowWarning } from "./digest-rules.js";
const iso = (ms) => new Date(ms).toISOString();
const hhmm = z.union([
  z.literal(""),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
]);
export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    filters: filterSchema,
    minFit: z.number().int().min(0).max(100).default(0),
    includeUnknownEligibility: z.boolean().default(false),
    watchlistOnly: z.boolean().default(false),
    paused: z.boolean().default(false),
    quietStart: hhmm.default(""),
    quietEnd: hhmm.default(""),
    dailyCap: z.number().int().min(1).max(50).default(10),
    // immediate: each match alerts on its own. daily/weekly: matches are
    // batched per user into one digest (see digests.js).
    cadence: z.enum(["immediate", "daily", "weekly"]).default("immediate"),
    // History is never replayed unless the user explicitly asks, and then only
    // for the last seven days (and still bounded by the daily cap).
    backfill: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !!v.quietStart === !!v.quietEnd, {
    message: "Set both quiet hours or neither",
  });
const MAX_RULES = 20;
const ruleView = (r) => ({
  id: r.id,
  name: r.name,
  filters: JSON.parse(r.filters),
  minFit: r.min_fit,
  includeUnknownEligibility: !!r.include_unknown_eligibility,
  watchlistOnly: !!r.watchlist_only,
  paused: !!r.paused,
  quietStart: r.quiet_start,
  quietEnd: r.quiet_end,
  dailyCap: r.daily_cap,
  cadence: r.cadence || "immediate",
  warnings: digestWindowWarning(JSON.parse(r.filters), r.cadence),
  since: r.since,
  updatedAt: r.updated_at,
});
export async function listRules(store, userId) {
  return (
    await store.db
      .prepare(
        "SELECT * FROM discovery_alert_rules WHERE user_id=? ORDER BY created_at,id",
      )
      .all(userId)
  ).map(ruleView);
}
function columns(v) {
  return [
    v.name,
    JSON.stringify(v.filters),
    v.minFit,
    v.includeUnknownEligibility ? 1 : 0,
    v.watchlistOnly ? 1 : 0,
    v.paused ? 1 : 0,
    v.quietStart,
    v.quietEnd,
    v.dailyCap,
    v.cadence,
  ];
}
export async function createRule(store, userId, input, now = Date.now()) {
  const v = ruleSchema.parse(input);
  return store.atomic(async () => {
    const count = await store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM discovery_alert_rules WHERE user_id=?",
      )
      .get(userId);
    if (Number(count.n) >= MAX_RULES)
      throw new HttpError(413, `Limit of ${MAX_RULES} alert rules reached`);
    const id = randomUUID();
    await store.db
      .prepare(
        "INSERT INTO discovery_alert_rules(id,user_id,name,filters,min_fit,include_unknown_eligibility,watchlist_only,paused,quiet_start,quiet_end,daily_cap,cadence,since,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        userId,
        ...columns(v),
        iso(v.backfill ? now - 7 * 864e5 : now),
        iso(now),
        iso(now),
      );
    return ruleView(
      await store.db
        .prepare("SELECT * FROM discovery_alert_rules WHERE id=? AND user_id=?")
        .get(id, userId),
    );
  });
}
const MATCH_FIELDS = (r) =>
  JSON.stringify([
    r.filters,
    r.min_fit,
    r.include_unknown_eligibility,
    r.watchlist_only,
    r.cadence || "immediate",
  ]);
/**
 * Pause, or any edit that changes what the rule matches or how it is batched,
 * cancels deliveries that were queued under the old settings. Quiet hours,
 * caps and digest time apply at send time, so changing them keeps the queue.
 */
export async function updateRule(store, userId, id, input, now = Date.now()) {
  const v = ruleSchema.parse(input);
  return store.atomic(async () => {
    const old = await store.db
      .prepare("SELECT * FROM discovery_alert_rules WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!old) throw new HttpError(404, "Alert rule not found");
    const changed =
      MATCH_FIELDS(old) !==
      MATCH_FIELDS({
        filters: JSON.stringify(v.filters),
        min_fit: v.minFit,
        include_unknown_eligibility: v.includeUnknownEligibility ? 1 : 0,
        watchlist_only: v.watchlistOnly ? 1 : 0,
        cadence: v.cadence,
      });
    await store.db
      .prepare(
        "UPDATE discovery_alert_rules SET name=?,filters=?,min_fit=?,include_unknown_eligibility=?,watchlist_only=?,paused=?,quiet_start=?,quiet_end=?,daily_cap=?,cadence=?,since=?,updated_at=? WHERE id=? AND user_id=?",
      )
      .run(
        ...columns(v),
        // Edited criteria never replay history under the new meaning.
        changed ? iso(now) : old.since,
        iso(now),
        id,
        userId,
      );
    if (changed || (v.paused && !old.paused))
      await cancelPending(
        store,
        userId,
        id,
        v.paused && !old.paused ? "paused" : "rule_changed",
      );
  });
}
export async function cancelPending(store, userId, ruleId, reason) {
  await store.db
    .prepare(
      "UPDATE discovery_notifications SET status='suppressed',suppress_reason=? WHERE user_id=? AND rule_id=? AND status='pending'",
    )
    .run(reason, userId, ruleId);
}
export async function deleteRule(store, userId, id) {
  await store.db
    .prepare("DELETE FROM discovery_alert_rules WHERE id=? AND user_id=?")
    .run(id, userId);
}
export function localParts(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
const toMinutes = (text) =>
  Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
export function inQuietHours(rule, ms, timeZone) {
  if (!rule.quiet_start || !rule.quiet_end) return false;
  const start = toMinutes(rule.quiet_start),
    end = toMinutes(rule.quiet_end);
  if (start === end) return false;
  const { minutes } = localParts(ms, timeZone);
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}
export function ruleFilters(rule) {
  const stored = JSON.parse(rule.filters);
  return filterSchema.parse({
    ...stored,
    minFit: Math.max(stored.minFit || 0, rule.min_fit),
    // Does-not-meet is never alerted; unknown eligibility is opt-in.
    eligibility: rule.include_unknown_eligibility
      ? ["meets", "needs_verification"]
      : ["meets"],
  });
}
export function check(ctx, catalog, job, rule, now) {
  const evaluated = evaluateJob(
    ctx,
    catalog,
    job,
    ruleFilters(rule),
    now,
    "posted",
  );
  if (!evaluated) return "job_missing";
  const j = evaluated.view;
  if (j.status !== "listed") return "job_not_listed";
  if (j.dismissed) return "dismissed";
  if (j.applied) return "already_applied";
  if (rule.watchlist_only && !j.watched) return "not_watched";
  if (evaluated.reasons.length)
    return "no_longer_matches:" + evaluated.reasons.join(",");
  return "";
}
const QUEUE_PAGES = 4; // At most CHUNK*QUEUE_PAGES candidate jobs per rule per run.
/** Stage 1: queue pending notifications for new matches. */
export async function queueAlerts(store, { userId, now = Date.now() } = {}) {
  const rules = userId
    ? await store.db
        .prepare(
          "SELECT * FROM discovery_alert_rules WHERE user_id=? AND paused=0",
        )
        .all(userId)
    : await store.db
        .prepare("SELECT * FROM discovery_alert_rules WHERE paused=0")
        .all();
  if (!rules.length) return { queued: 0 };
  const contexts = new Map();
  let queued = 0;
  for (const rule of rules) {
    if (!contexts.has(rule.user_id))
      contexts.set(rule.user_id, await loadContext(store, rule.user_id));
    const ctx = contexts.get(rule.user_id);
    const filters = ruleFilters(rule);
    const base = prefilter({
      userId: rule.user_id,
      filters,
      now,
      basis: "posted",
      watched: !!rule.watchlist_only,
    });
    // Only jobs discovered or reopened since the rule began can ever qualify.
    base.where.push(
      "(j.first_discovered_at>=? OR (j.reopened_at IS NOT NULL AND j.reopened_at>=?))",
    );
    base.params.push(rule.since, rule.since);
    let after = null;
    for (let page = 0; page < QUEUE_PAGES; page++) {
      const where = [...base.where],
        params = [...base.params];
      if (after) {
        where.push(
          "(j.first_discovered_at<? OR (j.first_discovered_at=? AND j.id>?))",
        );
        params.push(after[0], after[0], after[1]);
      }
      const jobs = await selectJobs(store, {
        where,
        params,
        order: "j.first_discovered_at DESC,j.id ASC",
        limit: CHUNK,
      });
      if (!jobs.length) break;
      const catalog = await loadCatalogFor(store, jobs);
      for (const job of jobs) {
        const event =
          job.reopened_at &&
          job.reopened_at >= rule.since &&
          job.reopened_at > job.first_discovered_at
            ? "reopened"
            : job.first_discovered_at >= rule.since
              ? "new_job"
              : null;
        if (!event || check(ctx, catalog, job, rule, now)) continue;
        const result = await store.db
          .prepare(
            "INSERT INTO discovery_notifications(id,user_id,rule_id,job_id,event,status,payload,created_at,deliver_after) VALUES(?,?,?,?,?,'pending',?,?,?) ON CONFLICT DO NOTHING",
          )
          .run(
            randomUUID(),
            rule.user_id,
            rule.id,
            job.id,
            event,
            JSON.stringify({
              title: job.title,
              company: catalog.companies.get(job.company_id)?.name || "",
            }),
            iso(now),
            iso(now),
          );
        queued += result.changes;
      }
      if (jobs.length < CHUNK) break;
      const last = jobs[jobs.length - 1];
      after = [last.first_discovered_at, last.id];
    }
  }
  return { queued };
}
/** Delivered notifications for a rule on the user's local calendar day. */
export async function deliveredToday(store, userId, ruleId, now, timeZone) {
  const today = localParts(now, timeZone).day;
  // A local day spans at most 25 hours of UTC; bound the read accordingly.
  const rows = await store.db
    .prepare(
      "SELECT delivered_at FROM discovery_notifications WHERE user_id=? AND rule_id=? AND status='delivered' AND delivered_at>=?",
    )
    .all(userId, ruleId, iso(now - 27 * 3600e3));
  return rows.filter(
    (d) => localParts(Date.parse(d.delivered_at), timeZone).day === today,
  ).length;
}
export async function userTimeZone(store, userId) {
  const user = await store.db
    .prepare("SELECT timezone FROM users WHERE id=?")
    .get(userId);
  const zone = user?.timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}
/** Stage 2: recheck, then deliver in app. Never sends anything externally. */
export async function deliverAlerts(
  store,
  { userId, now = Date.now(), limit = 500 } = {},
) {
  // Digest rules keep their notifications pending for the digest builder.
  const immediate =
    "rule_id IN (SELECT id FROM discovery_alert_rules WHERE cadence='immediate')";
  const pending = userId
    ? await store.db
        .prepare(
          `SELECT * FROM discovery_notifications WHERE user_id=? AND status='pending' AND deliver_after<=? AND ${immediate} ORDER BY created_at,id LIMIT ?`,
        )
        .all(userId, iso(now), limit)
    : await store.db
        .prepare(
          `SELECT * FROM discovery_notifications WHERE status='pending' AND deliver_after<=? AND ${immediate} ORDER BY created_at,id LIMIT ?`,
        )
        .all(iso(now), limit);
  if (!pending.length) return { delivered: 0, suppressed: 0, deferred: 0 };
  const jobs = new Map(
    (
      await jobsByIds(
        store,
        pending.map((n) => n.job_id),
      )
    ).map((j) => [j.id, j]),
  );
  const catalog = await loadCatalogFor(store, [...jobs.values()]);
  const contexts = new Map(),
    zones = new Map();
  const out = { delivered: 0, suppressed: 0, deferred: 0 };
  for (const note of pending) {
    const rule = await store.db
      .prepare("SELECT * FROM discovery_alert_rules WHERE id=? AND user_id=?")
      .get(note.rule_id, note.user_id);
    if (!rule) continue;
    if (rule.paused) {
      out.deferred++;
      continue;
    }
    if (!contexts.has(note.user_id)) {
      contexts.set(note.user_id, await loadContext(store, note.user_id));
      zones.set(note.user_id, await userTimeZone(store, note.user_id));
    }
    const timeZone = zones.get(note.user_id);
    const job = jobs.get(note.job_id);
    const reason = job
      ? check(contexts.get(note.user_id), catalog, job, rule, now)
      : "job_missing";
    const settle = async (status, why = "") =>
      store.db
        .prepare(
          "UPDATE discovery_notifications SET status=?,suppress_reason=?,delivered_at=? WHERE id=? AND user_id=? AND status='pending'",
        )
        .run(
          status,
          why,
          status === "delivered" ? iso(now) : null,
          note.id,
          note.user_id,
        );
    if (reason) {
      await settle("suppressed", reason);
      out.suppressed++;
      continue;
    }
    if (inQuietHours(rule, now, timeZone)) {
      // Hold until quiet hours end (checked in 15-minute steps, at most a day).
      let at = now;
      for (let i = 0; i < 96 && inQuietHours(rule, at, timeZone); i++)
        at += 15 * 60000;
      await store.db
        .prepare(
          "UPDATE discovery_notifications SET deliver_after=? WHERE id=? AND user_id=?",
        )
        .run(iso(at), note.id, note.user_id);
      out.deferred++;
      continue;
    }
    if (
      (await deliveredToday(store, note.user_id, rule.id, now, timeZone)) >=
      rule.daily_cap
    ) {
      await settle("suppressed", "volume_cap");
      out.suppressed++;
      continue;
    }
    await settle("delivered");
    out.delivered++;
  }
  return out;
}
export async function processAlerts(store, options = {}) {
  const queued = await queueAlerts(store, options);
  return { ...queued, ...(await deliverAlerts(store, options)) };
}
export async function listNotifications(store, userId, { limit = 50 } = {}) {
  const rows = await store.db
    .prepare(
      "SELECT n.*,r.name AS rule_name FROM discovery_notifications n JOIN discovery_alert_rules r ON r.id=n.rule_id AND r.user_id=n.user_id WHERE n.user_id=? AND n.status='delivered' AND n.digest_id='' ORDER BY n.delivered_at DESC,n.id LIMIT ?",
    )
    .all(userId, limit);
  const unread = await store.db
    .prepare(
      "SELECT COUNT(*) AS n FROM discovery_notifications WHERE user_id=? AND status='delivered' AND digest_id='' AND read_at IS NULL",
    )
    .get(userId);
  return {
    unread: Number(unread.n),
    notifications: rows.map((n) => ({
      id: n.id,
      jobId: n.job_id,
      event: n.event,
      ruleName: n.rule_name,
      deliveredAt: n.delivered_at,
      read: !!n.read_at,
      ...JSON.parse(n.payload),
    })),
  };
}
export async function markRead(store, userId, id) {
  const stamp = iso(Date.now());
  if (id)
    await store.db
      .prepare(
        "UPDATE discovery_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=? AND status='delivered'",
      )
      .run(stamp, id, userId);
  else
    await store.db
      .prepare(
        "UPDATE discovery_notifications SET read_at=? WHERE user_id=? AND status='delivered' AND read_at IS NULL",
      )
      .run(stamp, userId);
}
