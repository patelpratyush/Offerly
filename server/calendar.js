import { z } from "zod";
import { addDays, localDateTimeOf, zonedToUtc } from "./zoned-time.js";
// CAL 01 minimal slice: user-initiated, owner-scoped .ics export only. No
// calendar OAuth, no writes to external calendars, no invitations sent.
const closed = (a) =>
  a.archived ||
  ["Rejected", "Withdrawn"].includes(a.stage) ||
  ["Accepted", "Declined"].includes(a.offerOutcome);
const escapeText = (v) =>
  String(v ?? "")
    .replaceAll(/\p{Cc}/gu, (c) => (c === "\n" || c === "\r" ? c : " "))
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
// RFC 5545 folding: 75 octets per line, continuation lines begin with a space.
function fold(line) {
  const out = [];
  let current = "",
    bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}
const utcStamp = (ms) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const dateStamp = (d) => d.replaceAll("-", "");
const safeUrl = (v) => (/^https?:\/\/[^\s]+$/i.test(v || "") ? v : "");
// No end times are recorded, so conflict checks assume this block length and
// say so wherever a conflict is shown.
export const ASSUMED_MINUTES = 60;
/** Same UID represented twice: keep one, preferring the higher revision. */
export function dedupeEvents(events) {
  const byUid = new Map();
  for (const e of events) {
    const kept = byUid.get(e.uid);
    if (!kept || (e.sequence || 0) > (kept.sequence || 0)) byUid.set(e.uid, e);
  }
  return [...byUid.values()];
}
/** Marks timed, active interviews whose assumed windows overlap. */
export function markConflicts(events) {
  const span = ASSUMED_MINUTES * 60000;
  const timed = events.filter(
    (e) => e.kind === "round" && !e.cancelled && e.start != null,
  );
  for (const e of events) e.conflictWith = [];
  for (const a of timed)
    for (const b of timed)
      if (a !== b && a.start < b.start + span && b.start < a.start + span)
        a.conflictWith.push(b.uid);
  return events;
}
const describe = (e, byUid) =>
  [
    e.detail,
    e.cancelled ? "Canceled in Offerly." : "",
    e.url ? `Conferencing link: ${e.url}` : "",
    e.conflictWith?.length
      ? `Possible conflict with: ${e.conflictWith.map((u) => byUid.get(u)?.summary || u).join("; ")} (no end times are recorded; ${ASSUMED_MINUTES} minutes assumed).`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
export async function calendarEvents(store, userId, { applicationId } = {}) {
  const apps = new Map(
    (await store.list(userId, "application")).map((a) => [a.id, a]),
  );
  const timezone = (
    await store.db.prepare("SELECT timezone FROM users WHERE id=?").get(userId)
  )?.timezone;
  const events = [],
    skipped = [];
  const add = (kind, item, application) => {
    if (!application || closed(application)) return;
    if (applicationId && application.id !== applicationId) return;
    const label = `${application.title} at ${application.company}`;
    const base = {
      uid: `${kind}-${item.id}@offerly.app`,
      sequence: Math.max(0, (item.version || 1) - 1),
      url: safeUrl(item.url),
      applicationId: application.id,
      kind,
      itemId: item.id,
      title: item.title,
      company: application.company,
      label,
    };
    if (kind === "round") {
      const cancelled = item.status === "Canceled";
      if (
        !["Scheduled", "Rescheduled", "Canceled"].includes(item.status) ||
        !item.date
      )
        return;
      const summary = `${cancelled ? "Canceled interview" : "Interview"}: ${item.title} (${label})`;
      base.cancelled = cancelled;
      if (!item.time) {
        events.push({
          ...base,
          summary,
          allDay: item.date,
          detail: "Date only: no time has been recorded.",
        });
        return;
      }
      const start = zonedToUtc(item.date, item.time, item.timezone);
      if (start === null) {
        skipped.push({
          id: item.id,
          reason:
            "Local time is ambiguous or does not exist in " +
            item.timezone +
            "; correct the interview time to export it.",
        });
        return;
      }
      events.push({
        ...base,
        summary,
        start,
        original: { date: item.date, time: item.time, timezone: item.timezone },
        local: timezone
          ? { dateTime: localDateTimeOf(start, timezone), timezone }
          : undefined,
        detail:
          `Local time: ${item.date} ${item.time} ${item.timezone}.` +
          (timezone && timezone !== item.timezone
            ? ` In your Offerly timezone (${timezone}): ${localDateTimeOf(start, timezone)}.`
            : "") +
          " No end time recorded.",
      });
    } else if (kind === "assessment") {
      if (["Completed", "Canceled"].includes(item.status) || !item.due) return;
      events.push({
        ...base,
        summary: `Assessment due: ${item.title} (${label})`,
        allDay: item.due,
        detail: "Date only: no deadline time has been recorded.",
      });
    }
  };
  for (const r of await store.list(userId, "round"))
    add("round", r, apps.get(r.applicationId));
  for (const a of await store.list(userId, "assessment"))
    add("assessment", a, apps.get(a.applicationId));
  const unique = dedupeEvents(events);
  unique.sort((a, b) =>
    String(a.allDay || utcStamp(a.start)).localeCompare(
      String(b.allDay || utcStamp(b.start)),
    ),
  );
  markConflicts(unique);
  const byUid = new Map(unique.map((e) => [e.uid, e]));
  for (const e of unique) e.description = describe(e, byUid);
  return { events: unique, skipped, timezone: timezone || "" };
}
export function buildIcs(input, now = Date.now()) {
  const events = dedupeEvents(input);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Offerly//Job search export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utcStamp(now)}`);
    if (e.allDay) {
      lines.push(
        `DTSTART;VALUE=DATE:${dateStamp(e.allDay)}`,
        `DTEND;VALUE=DATE:${dateStamp(addDays(e.allDay, 1))}`,
      );
    } else lines.push(`DTSTART:${utcStamp(e.start)}`);
    lines.push(
      `SEQUENCE:${e.sequence}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
    );
    if (e.url) lines.push(`URL:${e.url.replace(/[\r\n]/g, "")}`);
    if (e.url) lines.push(`LOCATION:${escapeText(e.url)}`);
    if (e.cancelled) lines.push("STATUS:CANCELLED");
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
const publicEvent = (e) => ({
  uid: e.uid,
  kind: e.kind,
  applicationId: e.applicationId,
  title: e.title,
  company: e.company,
  start: e.start != null ? new Date(e.start).toISOString() : "",
  allDay: e.allDay || "",
  original: e.original || null,
  local: e.local || null,
  url: e.url || "",
  cancelled: !!e.cancelled,
  conflictWith: e.conflictWith || [],
});
export function mountCalendar(app, store, limit) {
  app.get("/api/calendar/agenda", async (req, res) => {
    await limit("calendar-agenda:" + req.user.id, 60, 60000);
    const { events, skipped, timezone } = await calendarEvents(
      store,
      req.user.id,
    );
    res.json({
      timezone,
      assumedMinutes: ASSUMED_MINUTES,
      events: events.slice(0, 200).map(publicEvent),
      skipped: skipped.length,
    });
  });
  app.get("/api/calendar.ics", async (req, res) => {
    await limit("export:" + req.user.id, 10, 3600000);
    const { applicationId } = z
      .object({ applicationId: z.uuid().optional() })
      .strict()
      .parse(req.query);
    const { events, skipped } = await calendarEvents(store, req.user.id, {
      applicationId,
    });
    res
      .set("X-Offerly-Event-Count", String(events.length))
      .set("X-Offerly-Skipped-Count", String(skipped.length))
      .set("Access-Control-Expose-Headers", "X-Offerly-Skipped-Count")
      .type("text/calendar; charset=utf-8")
      .attachment("offerly-calendar.ics")
      .send(buildIcs(events));
  });
}
