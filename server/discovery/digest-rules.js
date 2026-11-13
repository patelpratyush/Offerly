// Pure helpers for digest cadence: interval, recency-window warning and the
// "latest scheduled send" in the user's own time zone. No database access.
export const CADENCES = ["immediate", "daily", "weekly"];
export const INTERVAL_MS = { daily: 864e5, weekly: 7 * 864e5 };
const WINDOW_MS = {
  "24h": 864e5,
  "3d": 3 * 864e5,
  "7d": 7 * 864e5,
  "30d": 30 * 864e5,
};
const LABEL = { daily: "daily (24 hours)", weekly: "weekly (7 days)" };
/**
 * A recency window shorter than the digest interval means a job can match when
 * it is found yet age out before the digest is sent. Those jobs are left out
 * of the digest, never shown as fresh, so tell the user up front.
 */
export function digestWindowWarning(filters, cadence) {
  if (!INTERVAL_MS[cadence] || !filters?.window) return "";
  const length = WINDOW_MS[filters.window];
  if (!length || length >= INTERVAL_MS[cadence]) return "";
  return `This rule's recency window (${filters.window}) is shorter than its ${LABEL[cadence]} digest interval, so jobs that match when found may age out before the digest is sent and will be left out.`;
}
const formatters = new Map();
function zoned(ms, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  const p = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      p.weekday,
    ),
  };
}
/**
 * Most recent scheduled send at or before `now` (local hour:00 daily, or on the
 * given weekday). Real zones differ from UTC by multiples of 15 minutes, so a
 * 15-minute walk back finds it, including across daylight-saving changes.
 * Returns null if the local hour does not exist in the search span.
 */
export function latestSlot(now, timeZone, cadence, { hour, weekday }) {
  const span = cadence === "weekly" ? 8 * 96 : 2 * 96;
  let t = Math.floor(now / 9e5) * 9e5;
  for (let i = 0; i < span; i++, t -= 9e5) {
    const z = zoned(t, timeZone);
    if (z.minutes !== hour * 60) continue;
    if (cadence === "weekly" && z.weekday !== weekday) continue;
    return { at: t, key: z.day };
  }
  return null;
}
