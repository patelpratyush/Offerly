import { z } from "zod";
import { addDays, zonedToUtc } from "./zoned-time.js";
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
export async function calendarEvents(store, userId, { applicationId } = {}) {
  const apps = new Map(
    (await store.list(userId, "application")).map((a) => [a.id, a]),
  );
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
    };
    if (kind === "round") {
      if (!["Scheduled", "Rescheduled"].includes(item.status) || !item.date)
        return;
      const summary = `Interview: ${item.title} (${label})`;
      if (!item.time) {
        events.push({
          ...base,
          summary,
          allDay: item.date,
          description: "Date only: no time has been recorded.",
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
        description: `Local time: ${item.date} ${item.time} ${item.timezone}. No end time recorded.`,
      });
    } else if (kind === "assessment") {
      if (["Completed", "Canceled"].includes(item.status) || !item.due) return;
      events.push({
        ...base,
        summary: `Assessment due: ${item.title} (${label})`,
        allDay: item.due,
        description: "Date only: no deadline time has been recorded.",
      });
    }
  };
  for (const r of await store.list(userId, "round"))
    add("round", r, apps.get(r.applicationId));
  for (const a of await store.list(userId, "assessment"))
    add("assessment", a, apps.get(a.applicationId));
  events.sort((a, b) =>
    String(a.allDay || utcStamp(a.start)).localeCompare(
      String(b.allDay || utcStamp(b.start)),
    ),
  );
  return { events, skipped };
}
export function buildIcs(events, now = Date.now()) {
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
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
export function mountCalendar(app, store, limit) {
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
