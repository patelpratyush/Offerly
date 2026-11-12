import { useState } from "react";
import { CalendarDays } from "lucide-react";
import "../../styles/insights-reminders.css";

// Explicit user action only: downloads an .ics file. No calendar account is
// connected and nothing is written to an external calendar.
export function CalendarExport() {
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
    </section>
  );
}
