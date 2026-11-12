// In-app alert digests (daily or weekly). One digest per user, cadence and
// scheduled period, so a user never receives two for the same slot. Everything
// is rechecked at send time against the user's current rules, profile,
// dismissals and applications: jobs that aged out of a recency window, closed,
// were dismissed or applied to are left out and counted, never relabelled as
// fresh. Nothing is sent outside Offerly; the digest is a stored in-app record.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../security.js";
import { loadContext, evaluateJob } from "./feed.js";
import { loadCatalogFor, jobsByIds } from "./catalog.js";
import {
  check,
  ruleFilters,
  inQuietHours,
  deliveredToday,
  userTimeZone,
} from "./alerts.js";
import { latestSlot } from "./digest-rules.js";
const iso = (ms) => new Date(ms).toISOString();
const DIGEST_CADENCES = ["daily", "weekly"];
const MAX_PENDING = 2000;
export const settingsSchema = z
  .object({
    hour: z.number().int().min(0).max(23),
    weekday: z.number().int().min(0).max(6),
  })
  .strict();
export async function getDigestSettings(store, userId) {
  const row = await store.db
    .prepare(
      "SELECT hour,weekday FROM discovery_digest_settings WHERE user_id=?",
    )
    .get(userId);
  return { hour: row?.hour ?? 8, weekday: row?.weekday ?? 1 };
}
export async function saveDigestSettings(
  store,
  userId,
  input,
  now = Date.now(),
) {
  const v = settingsSchema.parse(input);
  await store.db
    .prepare(
      "INSERT INTO discovery_digest_settings(user_id,hour,weekday,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET hour=excluded.hour,weekday=excluded.weekday,updated_at=excluded.updated_at",
    )
    .run(userId, v.hour, v.weekday, iso(now));
  return v;
}
const REASON_TEXT = {
  aged_out: "aged out of the recency window",
  job_not_listed: "is no longer listed",
  job_missing: "is no longer in the catalog",
  dismissed: "was dismissed",
  already_applied: "was already applied to",
  not_watched: "is no longer on your watchlist",
  no_longer_matches: "no longer matches the rule",
  volume_cap: "was held back by the daily volume cap",
};
function bucket(reason) {
  if (reason.startsWith("no_longer_matches:"))
    return reason.includes("window") ? "aged_out" : "no_longer_matches";
  return reason;
}
const day = (text) => (text || "").slice(0, 10);
/** Plain-language account of why a rule matched a job, from the rule itself. */
export function explainMatch(rule, filters, view, event) {
  const why = [];
  why.push(
    event === "reopened"
      ? `Reopened ${day(view.freshness.reopenedAt)}`.trim()
      : `First found by Offerly ${day(view.freshness.firstDiscoveredAt)}`,
  );
  if (filters.window)
    why.push(
      filters.window === "custom"
        ? `Posted within ${filters.from || "any start"} to ${filters.to || "any end"}`
        : `Posted within the last ${filters.window}`,
    );
  if (filters.q) why.push(`Title or company contains "${filters.q}"`);
  if (filters.location) why.push(`Location contains "${filters.location}"`);
  if (filters.seniority.length)
    why.push(`Seniority: ${filters.seniority.join(", ")}`);
  if (filters.arrangements.length)
    why.push(`Work arrangement: ${filters.arrangements.join(", ")}`);
  if (filters.salaryMin !== null)
    why.push(`Stated pay at least ${filters.salaryMin}`);
  if (filters.platforms.length)
    why.push(`Source: ${filters.platforms.join(", ")}`);
  if (filters.sizes.length)
    why.push(`Company size: ${filters.sizes.join(", ")}`);
  why.push(
    view.eligibility.status === "meets"
      ? "Eligibility: meets requirements"
      : "Eligibility: needs verification",
  );
  if (filters.minFit)
    why.push(`Fit ${view.fit?.score ?? "unknown"} (minimum ${filters.minFit})`);
  if (rule.watchlist_only) why.push("Company is on your watchlist");
  return why;
}
function summary(items, excluded, cadence) {
  const parts = Object.entries(excluded.byReason).map(
    ([k, n]) => `${n} ${REASON_TEXT[k] || k}`,
  );
  const left = parts.length
    ? `Left out because they changed since they matched: ${parts.join("; ")}.`
    : "";
  if (!items.length)
    return `No current matches for your ${cadence} digest. ${
      excluded.total
        ? `${excluded.total} job${excluded.total === 1 ? "" : "s"} matched earlier but ${excluded.total === 1 ? "is" : "are"} not current now, so nothing is shown as new. ${left}`
        : ""
    }`.trim();
  return `${items.length} current match${items.length === 1 ? "" : "es"}. ${left}`.trim();
}
async function buildOne(store, userId, cadence, settings, timeZone, now) {
  const slot = latestSlot(now, timeZone, cadence, settings);
  if (!slot) return { skipped: "no_slot" };
  const done = await store.db
    .prepare(
      "SELECT id FROM discovery_digests WHERE user_id=? AND cadence=? AND period_key=?",
    )
    .get(userId, cadence, slot.key);
  if (done) return { skipped: "already_sent" };
  const rules = await store.db
    .prepare(
      "SELECT * FROM discovery_alert_rules WHERE user_id=? AND cadence=? AND paused=0 ORDER BY created_at,id",
    )
    .all(userId, cadence);
  if (!rules.length) return { skipped: "no_rules" };
  const byId = new Map(rules.map((r) => [r.id, r]));
  const marks = rules.map(() => "?").join(",");
  const notes = await store.db
    .prepare(
      `SELECT * FROM discovery_notifications WHERE user_id=? AND status='pending' AND rule_id IN (${marks}) ORDER BY created_at,id LIMIT ?`,
    )
    .all(userId, ...rules.map((r) => r.id), MAX_PENDING);
  if (!notes.length) return { skipped: "nothing_pending" };
  // Rules inside their quiet hours keep their notifications for a later digest.
  const active = notes.filter(
    (n) => !inQuietHours(byId.get(n.rule_id), now, timeZone),
  );
  if (!active.length) return { skipped: "quiet_hours" };
  const jobs = new Map(
    (
      await jobsByIds(
        store,
        active.map((n) => n.job_id),
      )
    ).map((j) => [j.id, j]),
  );
  // A digest covers what happened up to its scheduled time. Later matches wait
  // for the next one, so creating a rule never triggers an off-schedule digest.
  const slotText = iso(slot.at);
  const due = active.filter((n) => {
    const job = jobs.get(n.job_id);
    if (!job) return true; // Missing jobs are settled (and counted) below.
    const at =
      n.event === "reopened" ? job.reopened_at : job.first_discovered_at;
    return !at || at <= slotText;
  });
  if (!due.length) return { skipped: "not_yet_due" };
  const ctx = await loadContext(store, userId);
  const catalog = await loadCatalogFor(store, [...jobs.values()]);
  const included = []; // { note, rule, view }
  const dropped = []; // { note, reason }
  const taken = new Map();
  for (const note of due) {
    const rule = byId.get(note.rule_id);
    const job = jobs.get(note.job_id);
    const reason = job ? check(ctx, catalog, job, rule, now) : "job_missing";
    if (reason) {
      dropped.push({ note, reason: bucket(reason), raw: reason });
      continue;
    }
    if (!taken.has(rule.id))
      taken.set(
        rule.id,
        await deliveredToday(store, userId, rule.id, now, timeZone),
      );
    if (taken.get(rule.id) >= rule.daily_cap) {
      dropped.push({ note, reason: "volume_cap", raw: "volume_cap" });
      continue;
    }
    taken.set(rule.id, taken.get(rule.id) + 1);
    const evaluated = evaluateJob(
      ctx,
      catalog,
      job,
      ruleFilters(rule),
      now,
      "posted",
    );
    included.push({ note, rule, view: evaluated.view });
  }
  const digestId = randomUUID();
  const stamp = iso(now);
  const outcome = await store
    .atomic(async () => {
      // Guarded updates: a rule paused or edited since we read the queue has
      // already cancelled its notes, and those must not appear in the digest.
      const kept = [];
      for (const entry of included) {
        const r = await store.db
          .prepare(
            "UPDATE discovery_notifications SET status='delivered',delivered_at=?,digest_id=? WHERE id=? AND user_id=? AND status='pending'",
          )
          .run(stamp, digestId, entry.note.id, userId);
        if (r.changes) kept.push(entry);
      }
      const byReason = {};
      let total = 0;
      for (const d of dropped) {
        const r = await store.db
          .prepare(
            "UPDATE discovery_notifications SET status='suppressed',suppress_reason=?,digest_id=? WHERE id=? AND user_id=? AND status='pending'",
          )
          .run(d.raw, digestId, d.note.id, userId);
        if (r.changes) {
          byReason[d.reason] = (byReason[d.reason] || 0) + 1;
          total++;
        }
      }
      if (!kept.length && !total) return null;
      // One entry per job, listing every rule that matched it.
      const items = new Map();
      for (const { note, rule, view } of kept) {
        const why = explainMatch(rule, ruleFilters(rule), view, note.event);
        if (!items.has(view.id))
          items.set(view.id, {
            jobId: view.id,
            title: view.title,
            company: view.company.name,
            location: view.location,
            event: note.event,
            postedLabel: view.freshness.postedLabel,
            firstDiscoveredAt: view.freshness.firstDiscoveredAt,
            verification: view.verification,
            rules: [],
          });
        const item = items.get(view.id);
        if (note.event === "reopened") item.event = "reopened";
        item.rules.push({ id: rule.id, name: rule.name, why });
      }
      const list = [...items.values()].sort((a, b) =>
        a.firstDiscoveredAt < b.firstDiscoveredAt ? 1 : -1,
      );
      const excluded = { total, byReason };
      const payload = {
        cadence,
        periodKey: slot.key,
        scheduledFor: iso(slot.at),
        generatedAt: stamp,
        items: list,
        excluded,
        message: summary(list, excluded, cadence),
      };
      const inserted = await store.db
        .prepare(
          "INSERT INTO discovery_digests(id,user_id,cadence,period_key,payload,item_count,created_at,delivered_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(
          digestId,
          userId,
          cadence,
          slot.key,
          JSON.stringify(payload),
          list.length,
          stamp,
          stamp,
        );
      if (!inserted.changes) throw new HttpError(409, "digest_exists");
      return { items: list.length, excluded: total };
    })
    .catch((e) => {
      if (e instanceof HttpError && e.message === "digest_exists") return null;
      throw e;
    });
  return outcome ? { built: true, ...outcome } : { skipped: "superseded" };
}
export async function processDigests(
  store,
  { userId, now = Date.now(), limit = 25 } = {},
) {
  const users = userId
    ? [userId]
    : (
        await store.db
          .prepare(
            "SELECT DISTINCT user_id FROM discovery_alert_rules WHERE cadence<>'immediate' AND paused=0 ORDER BY user_id LIMIT ?",
          )
          .all(limit)
      ).map((r) => r.user_id);
  const out = { digests: 0, items: 0, excluded: 0 };
  for (const id of users) {
    const settings = await getDigestSettings(store, id);
    const timeZone = await userTimeZone(store, id);
    for (const cadence of DIGEST_CADENCES) {
      const r = await buildOne(store, id, cadence, settings, timeZone, now);
      if (r.built) {
        out.digests++;
        out.items += r.items;
        out.excluded += r.excluded;
      }
    }
  }
  return out;
}
export async function listDigests(store, userId, { limit = 20 } = {}) {
  const rows = await store.db
    .prepare(
      "SELECT * FROM discovery_digests WHERE user_id=? ORDER BY delivered_at DESC,id LIMIT ?",
    )
    .all(userId, limit);
  const unread = await store.db
    .prepare(
      "SELECT COUNT(*) AS n FROM discovery_digests WHERE user_id=? AND read_at IS NULL",
    )
    .get(userId);
  return {
    unread: Number(unread.n),
    digests: rows.map((d) => ({
      id: d.id,
      deliveredAt: d.delivered_at,
      read: !!d.read_at,
      ...JSON.parse(d.payload),
    })),
  };
}
export async function markDigestRead(store, userId, id) {
  const stamp = iso(Date.now());
  if (id)
    await store.db
      .prepare(
        "UPDATE discovery_digests SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?",
      )
      .run(stamp, id, userId);
  else
    await store.db
      .prepare(
        "UPDATE discovery_digests SET read_at=? WHERE user_id=? AND read_at IS NULL",
      )
      .run(stamp, userId);
}
