import { useEffect, useState } from "react";
import { ArrowUpRight, BellRing } from "lucide-react";
import "../../styles/insights-reminders.css";

type Delivery = {
  id: string;
  title: string;
  state: "pending" | "sent" | "suppressed" | "failed" | string;
  channel: string;
  when: string;
  precision: "date" | "time" | string;
  reason: string;
  sentAt: string;
  sourceKind: string;
  sourceUrl: string;
  applicationId: string;
};
type Props = {
  applications: { id: string; [key: string]: any }[];
  request: (path: string, method?: string, body?: any) => Promise<any>;
  onOpen: (application: any) => void;
};

const stateText: Record<string, string> = {
  pending: "Pending",
  sent: "Shown",
  suppressed: "Suppressed",
  failed: "Failed",
};
const order = ["pending", "failed", "suppressed", "sent"];

// Shows the recorded date or time exactly as stored; nothing is inferred.
export function whenLabel(d: Pick<Delivery, "when" | "precision">) {
  if (d.precision === "date") return d.when;
  const ms = Date.parse(d.when);
  return Number.isFinite(ms)
    ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "Time not recorded";
}

export function TodayReminders({ applications, request, onOpen }: Props) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    request("/reminder-settings")
      .then((v) => alive && setDeliveries(v.deliveries || []))
      .catch(
        () => alive && setError("Reminder deliveries could not be loaded."),
      );
    return () => {
      alive = false;
    };
  }, [request]);
  if (error)
    return (
      <p className="ir-error" role="alert">
        {error}
      </p>
    );
  if (!deliveries) return null;
  const summary = order
    .map((s) => [s, deliveries.filter((d) => d.state === s).length] as const)
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${stateText[s].toLowerCase()}`)
    .join(" · ");
  const shown = [...deliveries]
    .sort(
      (a, b) =>
        order.indexOf(a.state) - order.indexOf(b.state) ||
        a.when.localeCompare(b.when),
    )
    .slice(0, 6);
  return (
    <section
      className="panel today-reminders"
      aria-labelledby="today-reminders-heading"
    >
      <div className="section-head">
        <h2 id="today-reminders-heading">
          <BellRing size={17} aria-hidden="true" /> Reminder deliveries
        </h2>
        <span className="count">{deliveries.length}</span>
      </div>
      {deliveries.length ? (
        <>
          <p className="muted" role="status">
            {summary}. Dates are the ones recorded on the interview, assessment
            or application. No email is sent.
          </p>
          <ul className="today-reminder-list">
            {shown.map((d) => {
              const application = applications.find(
                (a) => a.id === d.applicationId,
              );
              return (
                <li key={d.id} data-state={d.state}>
                  <span className={`badge delivery-${d.state}`}>
                    {stateText[d.state] || d.state}
                  </span>
                  <span>
                    <strong>{d.title}</strong>
                    <small>
                      {d.precision === "date" ? "Date" : "Starts"}:{" "}
                      {whenLabel(d)} ·{" "}
                      {d.channel === "email" ? "Email" : "In app"}
                      {d.sentAt
                        ? ` · shown ${d.sentAt.slice(0, 16).replace("T", " ")} UTC`
                        : ""}
                      {d.reason ? ` · ${d.reason}` : ""}
                    </small>
                  </span>
                  <span className="today-reminder-links">
                    {application && (
                      <button
                        className="text-button"
                        onClick={() => onOpen(application)}
                      >
                        Open application{" "}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </button>
                    )}
                    {d.sourceUrl && (
                      <a
                        href={d.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Meeting link
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {deliveries.length > shown.length && (
            <p className="muted">
              {deliveries.length - shown.length} more in Settings, Reminder
              rules.
            </p>
          )}
        </>
      ) : (
        <p className="muted">
          No reminders planned. Scheduled interviews, open assessments and
          follow-ups create them from your reminder rules.
        </p>
      )}
    </section>
  );
}
