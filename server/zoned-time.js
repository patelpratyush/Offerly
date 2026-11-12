// Wall-clock <-> UTC conversion without inventing facts. Nonexistent (spring
// forward) and ambiguous (fall back) local times return null so callers can
// route them to review instead of guessing.
const formatters = new Map();
function parts(ms, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  const out = {};
  for (const p of f.formatToParts(new Date(ms))) out[p.type] = p.value;
  return `${out.year}-${out.month}-${out.day}T${out.hour}:${out.minute}`;
}
export function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}
/** Returns epoch ms for a local date/time, or null when nonexistent/ambiguous. */
export function zonedToUtc(date, time, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return null;
  if (!validTimeZone(timeZone)) return null;
  const wall = `${date}T${time}`;
  const guess = Date.parse(wall + ":00Z");
  if (!Number.isFinite(guess)) return null;
  const found = new Set();
  for (const hours of [-26, -13, -1, 0, 1, 13, 26]) {
    const probe = guess + hours * 3600000;
    const offset = Date.parse(parts(probe, timeZone) + ":00Z") - probe;
    const candidate = guess - offset;
    if (parts(candidate, timeZone) === wall) found.add(candidate);
  }
  return found.size === 1 ? [...found][0] : null;
}
/** Local wall-clock "YYYY-MM-DD HH:mm" for an instant in a time zone. */
export function localDateTimeOf(ms, timeZone) {
  return parts(ms, timeZone).replace("T", " ");
}
export function localDateOf(ms, timeZone) {
  return parts(ms, timeZone).slice(0, 10);
}
export function addDays(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function dayNumber(date) {
  return Math.round(Date.parse(date + "T00:00:00Z") / 86400000);
}
