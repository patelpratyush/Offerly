// In-app alerts only: no email, push or browser notification is sent from here.
// Rules create pending notifications (deduplicated by user/rule/canonical job/
// event); delivery rechecks the job against the rule, then applies pause,
// quiet hours and the daily volume cap.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../security.js";
import { filterSchema, loadContext, evaluateJob, loadCatalog } from "./feed.js";
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
        "INSERT INTO discovery_alert_rules(id,user_id,name,filters,min_fit,include_unknown_eligibility,watchlist_only,paused,quiet_start,quiet_end,daily_cap,since,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
export async function updateRule(store, userId, id, input, now = Date.now()) {
  const v = ruleSchema.parse(input);
  const result = await store.db
    .prepare(
      "UPDATE discovery_alert_rules SET name=?,filters=?,min_fit=?,include_unknown_eligibility=?,watchlist_only=?,paused=?,quiet_start=?,quiet_end=?,daily_cap=?,updated_at=? WHERE id=? AND user_id=?",
    )
    .run(...columns(v), iso(now), id, userId);
  if (!result.changes) throw new HttpError(404, "Alert rule not found");
}
export async function deleteRule(store, userId, id) {
  await store.db
    .prepare("DELETE FROM discovery_alert_rules WHERE id=? AND user_id=?")
    .run(id, userId);
}
function localParts(ms, timeZone) {
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
function ruleFilters(rule) {
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
function check(ctx, catalog, job, rule, now) {
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
const catalogSnapshot = (store) => loadCatalog(store);
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
  const catalog = await catalogSnapshot(store);
  const contexts = new Map();
  let queued = 0;
  for (const rule of rules) {
    if (!contexts.has(rule.user_id))
      contexts.set(rule.user_id, await loadContext(store, rule.user_id));
    const ctx = contexts.get(rule.user_id);
    for (const job of catalog.jobs) {
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
  }
  return { queued };
}
/** Stage 2: recheck, then deliver in app. Never sends anything externally. */
export async function deliverAlerts(store, { userId, now = Date.now() } = {}) {
  const pending = userId
    ? await store.db
        .prepare(
          "SELECT * FROM discovery_notifications WHERE user_id=? AND status='pending' AND deliver_after<=? ORDER BY created_at,id",
        )
        .all(userId, iso(now))
    : await store.db
        .prepare(
          "SELECT * FROM discovery_notifications WHERE status='pending' AND deliver_after<=? ORDER BY created_at,id",
        )
        .all(iso(now));
  if (!pending.length) return { delivered: 0, suppressed: 0, deferred: 0 };
  const catalog = await catalogSnapshot(store);
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
      const user = await store.db
        .prepare("SELECT timezone FROM users WHERE id=?")
        .get(note.user_id);
      zones.set(note.user_id, user?.timezone || "UTC");
    }
    const timeZone = zones.get(note.user_id);
    const job = catalog.jobs.find((j) => j.id === note.job_id);
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
    const today = localParts(now, timeZone).day;
    const delivered = await store.db
      .prepare(
        "SELECT delivered_at FROM discovery_notifications WHERE user_id=? AND rule_id=? AND status='delivered'",
      )
      .all(note.user_id, rule.id);
    if (
      delivered.filter(
        (d) => localParts(Date.parse(d.delivered_at), timeZone).day === today,
      ).length >= rule.daily_cap
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
      "SELECT n.*,r.name AS rule_name FROM discovery_notifications n JOIN discovery_alert_rules r ON r.id=n.rule_id AND r.user_id=n.user_id WHERE n.user_id=? AND n.status='delivered' ORDER BY n.delivered_at DESC,n.id LIMIT ?",
    )
    .all(userId, limit);
  const unread = await store.db
    .prepare(
      "SELECT COUNT(*) AS n FROM discovery_notifications WHERE user_id=? AND status='delivered' AND read_at IS NULL",
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
