import { z } from "zod";
import { createHash } from "node:crypto";
import { HttpError } from "./security.js";
import { createDisabledEmailProvider } from "./notification-provider.js";
import { addDays, localDateOf, zonedToUtc } from "./zoned-time.js";
// TASK 02 P1: user-configurable reminder rules and delivery state. Reminders
// are derived from user-confirmed records only. Nothing here changes stages,
// sends application content, or contacts an employer. Email is delivered only
// through an injected provider (disabled by default) after an explicit opt-in.
export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5 * 60000, 30 * 60000, 2 * 3600000];
const TIMED_GRACE = 3600000,
  DATE_GRACE = 12 * 3600000,
  HORIZON_DAYS = 60,
  MAX_DELIVERIES = 1000;
export const defaultRules = () =>
  [
    { id: "interview_24h", value: 1440 },
    { id: "interview_1h", value: 60 },
    { id: "assessment_48h", value: 2880 },
    { id: "assessment_24h", value: 1440 },
    { id: "followup_7d", value: 7 },
  ].map((r) => ({ ...r, enabled: true, inApp: true, email: false }));
const bounds = {
  interview: [5, 10080],
  assessment: [60, 20160],
  followup: [1, 60],
};
const ruleSchema = z
  .object({
    id: z.enum([
      "interview_24h",
      "interview_1h",
      "assessment_48h",
      "assessment_24h",
      "followup_7d",
    ]),
    enabled: z.boolean(),
    value: z.number().int(),
    inApp: z.boolean(),
    email: z.boolean(),
  })
  .strict();
export const settingsSchema = z
  .object({
    version: z.number().int().positive().optional(),
    emailOptIn: z.boolean(),
    rules: z.array(ruleSchema).length(5),
  })
  .strict();
const kindOf = (id) => id.split("_")[0];
export async function loadSettings(store, userId) {
  const [row] = await store.list(userId, "reminder_settings");
  const defaults = defaultRules();
  if (!row)
    return { version: 0, emailOptIn: false, emailOptInAt: "", rules: defaults };
  return {
    version: row.version,
    emailOptIn: !!row.emailOptIn,
    emailOptInAt: row.emailOptInAt || "",
    rules: defaults.map((d) => ({
      ...d,
      ...(row.rules || []).find((r) => r.id === d.id),
    })),
  };
}
const closed = (a) =>
  !a ||
  a.archived ||
  ["Rejected", "Withdrawn"].includes(a.stage) ||
  ["Accepted", "Declined"].includes(a.offerOutcome);
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
// Pure description of a source occurrence; null means no reminder applies.
function describe(kind, item, app, hasReply) {
  if (closed(app)) return null;
  if (kind === "round") {
    if (!["Scheduled", "Rescheduled"].includes(item.status) || !item.date)
      return null;
    return {
      signature: hash([item.status, item.date, item.time || "", item.timezone]),
      date: item.date,
      time: item.time || "",
      timezone: item.timezone,
      label: `Interview: ${item.title}`,
    };
  }
  if (kind === "assessment") {
    if (["Completed", "Canceled"].includes(item.status) || !item.due)
      return null;
    return {
      signature: hash([item.status, item.due]),
      date: item.due,
      time: "",
      label: `Assessment due: ${item.title}`,
    };
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(app.appliedDate || "") ||
    !["Submitted", "Under review"].includes(app.stage) ||
    app.owner === "You" ||
    hasReply
  )
    return null;
  return {
    signature: hash([app.stage, app.owner, app.appliedDate]),
    date: app.appliedDate,
    time: "",
    label: "Follow up on your application",
  };
}
function fireTime(rule, d, tz) {
  if (rule.kind === "followup") {
    const day = addDays(d.date, rule.value);
    return {
      at: zonedToUtc(day, "09:00", tz) ?? zonedToUtc(day, "10:00", tz),
      precision: "date",
      when: day,
    };
  }
  if (d.time) {
    const start = zonedToUtc(d.date, d.time, d.timezone);
    if (start === null) return null; // ambiguous or nonexistent: needs review
    return {
      at: start - rule.value * 60000,
      precision: "time",
      when: new Date(start).toISOString(),
      start,
    };
  }
  // Date-only deadlines stay date-only: whole days before, no invented time.
  const days = Math.floor(rule.value / 1440);
  if (days < 1) return null;
  const day = addDays(d.date, -days);
  return {
    at: zonedToUtc(day, "09:00", tz) ?? zonedToUtc(day, "10:00", tz),
    precision: "date",
    when: d.date,
  };
}
async function userTimezone(store, userId) {
  return (
    await store.db.prepare("SELECT timezone FROM users WHERE id=?").get(userId)
  )?.timezone;
}
/** Create missing pending deliveries and cancel ones no longer wanted. */
export async function planDeliveries(store, userId, now = new Date()) {
  const nowMs = now.getTime(),
    tz = await userTimezone(store, userId);
  if (!tz) return { created: 0, canceled: 0 };
  const settings = await loadSettings(store, userId);
  const apps = new Map(
    (await store.list(userId, "application")).map((a) => [a.id, a]),
  );
  const rounds = await store.list(userId, "round"),
    assessments = await store.list(userId, "assessment");
  const replied = new Set(
    [...rounds, ...assessments].map((i) => i.applicationId),
  );
  const horizon = nowMs + HORIZON_DAYS * 86400000;
  const wanted = new Map();
  for (const rule of settings.rules.filter((r) => r.enabled)) {
    const kind = kindOf(rule.id);
    const sources =
      kind === "interview"
        ? rounds.map((i) => ["round", i, apps.get(i.applicationId)])
        : kind === "assessment"
          ? assessments.map((i) => ["assessment", i, apps.get(i.applicationId)])
          : [...apps.values()].map((a) => ["application", a, a]);
    for (const [sourceKind, item, app] of sources) {
      const d = describe(sourceKind, item, app, replied.has(app?.id));
      if (!d) continue;
      const fire = fireTime({ ...rule, kind }, d, tz);
      if (!fire?.at) continue;
      const today = localDateOf(nowMs, tz);
      if (
        kind !== "followup" &&
        (fire.precision === "time" ? fire.start <= nowMs : d.date < today)
      )
        continue;
      if (
        fire.at <
        nowMs - (fire.precision === "time" ? TIMED_GRACE : DATE_GRACE)
      )
        continue;
      if (fire.at > horizon) continue;
      for (const channel of ["in_app", "email"]) {
        if (
          channel === "in_app"
            ? !rule.inApp
            : !(rule.email && settings.emailOptIn)
        )
          continue;
        const key = `${rule.id}:${item.id}:${d.signature}:${channel}`;
        wanted.set(key, {
          dedupeKey: key,
          ruleId: rule.id,
          channel,
          sourceKind,
          sourceId: item.id,
          applicationId: app.id,
          sourceSignature: d.signature,
          title: `${d.label} (${app.title} at ${app.company})`,
          when: fire.when,
          precision: fire.precision,
          fireAt: new Date(fire.at).toISOString(),
        });
      }
    }
  }
  const existing = await store.list(userId, "reminder_delivery");
  const known = new Set(existing.map((e) => e.dedupeKey));
  let created = 0,
    canceled = 0;
  for (const e of existing)
    if (e.state === "pending" && !wanted.has(e.dedupeKey)) {
      await setState(store, userId, e, "canceled", {
        reason: "Source changed, rule disabled, or channel no longer enabled",
      });
      canceled++;
    }
  let total = existing.length;
  for (const w of wanted.values()) {
    if (known.has(w.dedupeKey)) continue; // idempotent: never duplicate
    if (total >= MAX_DELIVERIES) break;
    await store.save(
      userId,
      "reminder_delivery",
      {
        ...w,
        state: "pending",
        attempts: 0,
        nextAttemptAt: "",
        reason: "",
        sentAt: "",
        createdAt: now.toISOString(),
      },
      undefined,
      undefined,
      "reminder_delivery_planned",
    );
    total++;
    created++;
  }
  return { created, canceled };
}
async function setState(store, userId, delivery, state, patch = {}, now) {
  const { id, version, ...data } = delivery;
  try {
    await store.save(
      userId,
      "reminder_delivery",
      { ...data, ...patch, state },
      id,
      version,
      "reminder_delivery_" + state,
    );
    return true;
  } catch (e) {
    if (e.status === 409) return false; // another worker advanced it
    throw e;
  }
}
/** Called when a source record changes: cancel pending deliveries now. */
export async function cancelStaleDeliveries(store, userId, recordId) {
  const rows = await store.db
    .prepare(
      "SELECT * FROM records WHERE user_id=? AND kind='reminder_delivery' AND json_extract(data,'$.state')='pending' AND (json_extract(data,'$.sourceId')=? OR json_extract(data,'$.applicationId')=?) LIMIT 501",
    )
    .all(userId, recordId, recordId);
  for (const row of rows.slice(0, 500)) {
    const d = { ...JSON.parse(row.data), id: row.id, version: row.version };
    const current = await currentSignature(store, userId, d);
    if (current !== d.sourceSignature)
      await setState(store, userId, d, "canceled", {
        reason: "Source rescheduled, canceled, completed, or closed",
      });
  }
}
async function currentSignature(store, userId, d) {
  const srcRow = await store.get(userId, d.sourceId);
  const appRow = await store.get(userId, d.applicationId);
  if (!srcRow || srcRow.kind !== d.sourceKind || appRow?.kind !== "application")
    return null;
  const app = JSON.parse(appRow.data);
  let replied = false;
  if (d.sourceKind === "application")
    replied =
      (
        await store.db
          .prepare(
            "SELECT count(*) n FROM records WHERE user_id=? AND kind IN ('round','assessment') AND json_extract(data,'$.applicationId')=?",
          )
          .get(userId, d.applicationId)
      ).n > 0;
  return (
    describe(d.sourceKind, JSON.parse(srcRow.data), app, replied)?.signature ??
    null
  );
}
const backoff = (attempts) =>
  BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS.at(-1);
/** Dispatch due deliveries. Rechecks account, opt-in, rule and source first. */
export async function dispatchDeliveries(
  store,
  {
    now = new Date(),
    userId,
    provider = createDisabledEmailProvider(),
    deadline = Infinity,
    limit = 200,
  } = {},
) {
  const nowIso = new Date(now).toISOString();
  const rows = await store.db
    .prepare(
      `SELECT * FROM records WHERE kind='reminder_delivery' AND json_extract(data,'$.state')='pending'
       AND json_extract(data,'$.fireAt')<=? AND (json_extract(data,'$.nextAttemptAt')='' OR json_extract(data,'$.nextAttemptAt')<=?)
       ${userId ? "AND user_id=?" : ""} ORDER BY json_extract(data,'$.fireAt') LIMIT ?`,
    )
    .all(...[nowIso, nowIso, ...(userId ? [userId] : []), limit]);
  const result = {
    processed: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
    canceled: 0,
    retry: 0,
  };
  const settingsCache = new Map();
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    let d = { ...JSON.parse(row.data), id: row.id, version: row.version };
    const uid = row.user_id;
    const account = await store.db
      .prepare("SELECT id,email FROM users WHERE id=?")
      .get(uid);
    if (!account) continue; // deleted accounts cascade; never dispatch
    result.processed++;
    if (!settingsCache.has(uid))
      settingsCache.set(uid, await loadSettings(store, uid));
    const settings = settingsCache.get(uid);
    const rule = settings.rules.find((r) => r.id === d.ruleId);
    const optedIn =
      rule?.enabled &&
      (d.channel === "in_app" ? rule.inApp : rule.email && settings.emailOptIn);
    if (!optedIn) {
      if (
        await setState(store, uid, d, "suppressed", {
          reason: "Rule or channel is disabled, or email opt-in was withdrawn",
        })
      )
        result.suppressed++;
      continue;
    }
    if ((await currentSignature(store, uid, d)) !== d.sourceSignature) {
      if (
        await setState(store, uid, d, "canceled", {
          reason: "Source rescheduled, canceled, completed, or closed",
        })
      )
        result.canceled++;
      continue;
    }
    if (d.channel === "in_app") {
      if (await setState(store, uid, d, "sent", { sentAt: nowIso }))
        result.sent++;
      continue;
    }
    if (!provider.enabled) {
      if (
        await setState(store, uid, d, "suppressed", {
          reason: "Email delivery is not enabled for this deployment",
        })
      )
        result.suppressed++;
      continue;
    }
    // Record the attempt before the provider call so a crash cannot loop at once.
    const attempts = d.attempts + 1;
    const claimed = await store
      .save(
        uid,
        "reminder_delivery",
        (({ id, version, ...rest }) => ({
          ...rest,
          attempts,
          nextAttemptAt: new Date(
            new Date(now).getTime() + backoff(attempts),
          ).toISOString(),
        }))(d),
        d.id,
        d.version,
        "reminder_delivery_attempt",
      )
      .catch((e) => {
        if (e.status === 409) return null;
        throw e;
      });
    if (!claimed) continue;
    d = claimed;
    try {
      await provider.send({
        to: account.email,
        subject: "Offerly reminder: " + d.title.slice(0, 150),
        text: `${d.title}\n${d.precision === "date" ? "Date: " : "Time (UTC): "}${d.when}\n\nYou chose to receive this reminder in Offerly settings.`,
        idempotencyKey: d.dedupeKey,
      });
      await setState(store, uid, d, "sent", { sentAt: nowIso, reason: "" });
      result.sent++;
    } catch (error) {
      const final = error?.permanent === true || attempts >= MAX_ATTEMPTS;
      await setState(store, uid, d, final ? "failed" : "pending", {
        reason: final
          ? "Delivery failed after the allowed attempts"
          : "Delivery attempt failed; will retry",
      });
      result[final ? "failed" : "retry"]++;
    }
  }
  return result;
}
// Worker: plan only for users who saved reminder settings (explicit choice);
// everyone else is planned when they open the app. Bounded batch per tick.
const cursors = new WeakMap();
export async function processDeliveries(store, options = {}) {
  const { now = new Date(), userId, deadline = Infinity } = options;
  let users;
  if (userId) users = [userId];
  else {
    const after = cursors.get(store) || "";
    const rows = await store.db
      .prepare(
        "SELECT DISTINCT user_id FROM records WHERE kind='reminder_settings' AND user_id>? ORDER BY user_id LIMIT 25",
      )
      .all(after);
    users = rows.map((r) => r.user_id);
    cursors.set(store, rows.length < 25 ? "" : users.at(-1));
  }
  let planned = 0;
  for (const id of users) {
    if (Date.now() >= deadline) break;
    try {
      const p = await planDeliveries(store, id, new Date(now));
      planned += p.created;
    } catch {
      // One account's failure must not block others.
    }
  }
  return {
    planned,
    ...(await dispatchDeliveries(store, { ...options, now, deadline })),
  };
}
const httpUrl = (v) => (/^https?:\/\/[^\s]+$/i.test(v || "") ? v : "");
const publicDelivery = (d, urls = new Map()) => ({
  id: d.id,
  sourceKind: d.sourceKind,
  sourceId: d.sourceId,
  sourceUrl: d.sourceKind === "round" ? urls.get(d.sourceId) || "" : "",
  ruleId: d.ruleId,
  channel: d.channel,
  title: d.title,
  when: d.when,
  precision: d.precision,
  fireAt: d.fireAt,
  state: d.state,
  reason: d.reason || "",
  attempts: d.attempts,
  sentAt: d.sentAt || "",
  applicationId: d.applicationId,
});
export function mountReminderRules(app, store, options = {}) {
  const provider = options.provider || createDisabledEmailProvider();
  const view = async (userId) => {
    const deliveries = (await store.list(userId, "reminder_delivery"))
      .filter((d) => d.state !== "canceled")
      .sort((a, b) => a.fireAt.localeCompare(b.fireAt))
      .slice(-100);
    const urls = new Map(
      (await store.list(userId, "round")).map((r) => [r.id, httpUrl(r.url)]),
    );
    return {
      settings: await loadSettings(store, userId),
      deliveries: deliveries.map((d) => publicDelivery(d, urls)),
      email: {
        available: provider.enabled === true,
        note: provider.enabled
          ? "Email is delivered only to your account address after you opt in."
          : "Email delivery is not enabled in this deployment. Preferences are saved but nothing is sent.",
      },
    };
  };
  app.get("/api/reminder-settings", async (req, res) => {
    await planDeliveries(store, req.user.id);
    await dispatchDeliveries(store, { userId: req.user.id, provider });
    res.json(await view(req.user.id));
  });
  app.put("/api/reminder-settings", async (req, res) => {
    const body = settingsSchema.parse(req.body);
    if (new Set(body.rules.map((r) => r.id)).size !== 5)
      throw new HttpError(400, "Each reminder rule must appear once");
    for (const r of body.rules) {
      const [min, max] = bounds[kindOf(r.id)];
      if (r.value < min || r.value > max)
        throw new HttpError(400, `Reminder timing for ${r.id} is out of range`);
    }
    const current = await loadSettings(store, req.user.id);
    if ((body.version || 0) !== current.version)
      throw new HttpError(409, "Settings changed. Refresh before saving.");
    const optInChanged = body.emailOptIn !== current.emailOptIn;
    const data = {
      emailOptIn: body.emailOptIn,
      emailOptInAt: optInChanged
        ? body.emailOptIn
          ? new Date().toISOString()
          : ""
        : current.emailOptInAt,
      rules: body.rules.map((r) => ({
        ...r,
        email: body.emailOptIn ? r.email : false,
      })),
    };
    await store.save(
      req.user.id,
      "reminder_settings",
      data,
      current.version
        ? (await store.list(req.user.id, "reminder_settings"))[0].id
        : undefined,
      current.version || undefined,
      "reminder_settings",
    );
    await planDeliveries(store, req.user.id);
    await dispatchDeliveries(store, { userId: req.user.id, provider });
    res.json(await view(req.user.id));
  });
}
