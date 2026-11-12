import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import "../../styles/insights-reminders.css";

// Explicit user action only: downloads an .ics file. No calendar account is
// connected and nothing is written to an external calendar.
type AgendaEvent = {
  uid: string;
  kind: string;
  title: string;
  company: string;
  start: string;
  allDay: string;
  original: { date: string; time: string; timezone: string } | null;
  local: { dateTime: string; timezone: string } | null;
  url: string;
  cancelled: boolean;
  conflictWith: string[];
};
type Agenda = {
  timezone: string;
  assumedMinutes: number;
  events: AgendaEvent[];
  skipped: number;
};

export function CalendarExport() {
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/calendar/agenda", { headers: { "X-Offerly-Request": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => alive && setAgenda(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const titleOf = (uid: string) =>
    agenda?.events.find((e) => e.uid === uid)?.title || "another interview";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/calendar.ics", {
        headers: { "X-Offerly-Request": "1" },
      });
      if (!res.ok) throw new Error("Calendar export failed. Try again later.");
      const count = Number(res.headers.get("X-Offerly-Event-Count") || 0);
      const skipped = Number(res.headers.get("X-Offerly-Skipped-Count") || 0);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "offerly-calendar.ics";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(
        `Downloaded ${count} event${count === 1 ? "" : "s"}.` +
          (skipped
            ? ` ${skipped} interview${skipped === 1 ? " was" : "s were"} left out because its local time is ambiguous or does not exist; correct the time to include it.`
            : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Calendar export failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel settings-panel space-top ir-section"
      aria-labelledby="ir-cal-heading"
    >
      <h2 id="ir-cal-heading">Calendar export</h2>
      <p>
        Download scheduled interviews and open assessment deadlines as an .ics
        file to import into any calendar. Timed interviews are exported in UTC
        with your original timezone in the description; date-only items stay
        all-day. Offerly does not connect to or change any calendar.
      </p>
      <div className="ir-actions">
        <button className="secondary" disabled={busy} onClick={download}>
          <CalendarDays size={16} aria-hidden="true" />{" "}
          {busy ? "Preparing…" : "Download calendar (.ics)"}
        </button>
        <span className="ir-status" role="status">
          {message}
        </span>
      </div>
      {error && (
        <p className="ir-error" role="alert">
          {error}
        </p>
      )}
      {agenda && agenda.events.length > 0 && (
        <>
          <h3>Upcoming in the export</h3>
          <ul className="cal-agenda" aria-label="Calendar agenda">
            {agenda.events.slice(0, 12).map((e) => (
              <li key={e.uid} data-cancelled={e.cancelled}>
                <strong>
                  {e.kind === "round" ? "Interview" : "Assessment due"}:{" "}
                  {e.title} · {e.company}
                </strong>
                {e.cancelled && <span className="badge"> Canceled</span>}
                {e.original ? (
                  <small>
                    Original: {e.original.date} {e.original.time}{" "}
                    {e.original.timezone}
                    {e.local && e.local.timezone !== e.original.timezone
                      ? ` · Your time (${e.local.timezone}): ${e.local.dateTime}`
                      : e.local
                        ? " · Same as your timezone"
                        : ""}
                  </small>
                ) : (
                  <small>Date only: {e.allDay}. No time recorded.</small>
                )}
                {e.url && (
                  <small>
                    <a href={e.url} target="_blank" rel="noopener noreferrer">
                      Conferencing link
                    </a>
                  </small>
                )}
                {e.conflictWith.length > 0 && (
                  <small role="status">
                    Possible conflict with{" "}
                    {e.conflictWith.map(titleOf).join(", ")}. No end times are
                    recorded, so {agenda.assumedMinutes} minutes is assumed.
                  </small>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
