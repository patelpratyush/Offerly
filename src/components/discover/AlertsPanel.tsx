import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { discoveryApi, when } from "./api";
import { Filters } from "./DiscoverFilters";

type Rule = {
  id: string;
  name: string;
  minFit: number;
  includeUnknownEligibility: boolean;
  watchlistOnly: boolean;
  paused: boolean;
  quietStart: string;
  quietEnd: string;
  dailyCap: number;
  filters: Filters;
};
type Note = {
  id: string;
  jobId: string;
  title: string;
  company: string;
  ruleName: string;
  deliveredAt: string;
  read: boolean;
  event: string;
};
export function AlertsPanel({
  filters,
  onNewAlerts,
}: {
  filters: Filters;
  onNewAlerts: (unread: number) => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [minFit, setMinFit] = useState(0);
  const [unknown, setUnknown] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [cap, setCap] = useState(10);
  const [backfill, setBackfill] = useState(false);
  const load = useCallback(async () => {
    try {
      const [r, n] = await Promise.all([
        discoveryApi<Rule[]>("/alerts"),
        discoveryApi<{ unread: number; notifications: Note[] }>(
          "/notifications",
        ),
      ]);
      setRules(r);
      setNotes(n.notifications);
      onNewAlerts(n.unread);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load alerts");
    }
  }, [onNewAlerts]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>, done = "") => {
    setMessage("");
    try {
      await fn();
      if (done) setMessage(done);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await discoveryApi("/alerts", "POST", {
        name,
        filters: { ...filters, eligibility: filters.eligibility },
        minFit,
        includeUnknownEligibility: unknown,
        watchlistOnly: watchOnly,
        quietStart,
        quietEnd,
        dailyCap: cap,
        backfill,
      });
      setName("");
    }, "Alert rule saved. In-app only; no email is sent.");
  };
  const toRule = (r: Rule, patch: Partial<Rule>) => ({
    name: r.name,
    filters: r.filters,
    minFit: r.minFit,
    includeUnknownEligibility: r.includeUnknownEligibility,
    watchlistOnly: r.watchlistOnly,
    paused: r.paused,
    quietStart: r.quietStart,
    quietEnd: r.quietEnd,
    dailyCap: r.dailyCap,
    ...patch,
  });
  return (
    <section className="panel discover-alerts" aria-label="Alerts">
      <p className="panel-copy muted">
        Alerts appear here inside Offerly only. Each job alerts once per rule,
        history is not replayed unless you ask, and eligibility, recency and
        dismissals are rechecked before an alert is delivered.
      </p>
      <div className="discover-actions">
        <button
          className="secondary"
          onClick={() =>
            run(
              () => discoveryApi("/alerts/process", "POST", {}),
              "Checked for new matches.",
            )
          }
        >
          Check for new matches now
        </button>
        <button
          className="secondary"
          disabled={!notes.some((n) => !n.read)}
          onClick={() =>
            run(() => discoveryApi("/notifications/read", "POST", {}))
          }
        >
          Mark all read
        </button>
        <span role="status" className="muted">
          {message}
        </span>
      </div>
      <h3>Notifications</h3>
      {notes.length ? (
        <ul className="discover-notes">
          {notes.map((n) => (
            <li key={n.id} className={n.read ? "" : "is-unread"}>
              <strong>
                {n.event === "reopened" ? "Reopened: " : "New: "}
                {n.title}
              </strong>{" "}
              at {n.company}
              <span className="muted">
                {" "}
                · rule "{n.ruleName}" · {when(n.deliveredAt)}
              </span>{" "}
              {!n.read && (
                <button
                  className="text-button"
                  onClick={() =>
                    run(() =>
                      discoveryApi("/notifications/read", "POST", { id: n.id }),
                    )
                  }
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No alerts delivered yet.</p>
      )}
      <h3>Alert rules</h3>
      {rules.length ? (
        <ul className="discover-notes">
          {rules.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong>
              <span className="muted">
                {" "}
                · min fit {r.minFit} · max {r.dailyCap}/day
                {r.quietStart ? ` · quiet ${r.quietStart}–${r.quietEnd}` : ""}
                {r.paused ? " · paused" : ""}
              </span>{" "}
              <button
                className="text-button"
                onClick={() =>
                  run(() =>
                    discoveryApi(
                      `/alerts/${r.id}`,
                      "PUT",
                      toRule(r, { paused: !r.paused }),
                    ),
                  )
                }
              >
                {r.paused ? "Resume" : "Pause"}
              </button>{" "}
              <button
                className="text-button"
                onClick={() =>
                  run(() => discoveryApi(`/alerts/${r.id}`, "DELETE", {}))
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No alert rules yet.</p>
      )}
      <form onSubmit={create} aria-label="New alert rule">
        <h3>New rule from the current filters</h3>
        <div className="discover-filter-grid">
          <label>
            Rule name
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Minimum fit
            <input
              type="number"
              min={0}
              max={100}
              value={minFit}
              onChange={(e) => setMinFit(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Quiet hours start
            <input
              type="time"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
            />
          </label>
          <label>
            Quiet hours end
            <input
              type="time"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </label>
          <label>
            Maximum alerts per day
            <input
              type="number"
              min={1}
              max={50}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value) || 1)}
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={unknown}
            onChange={(e) => setUnknown(e.target.checked)}
          />
          Include jobs whose eligibility needs verification
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={watchOnly}
            onChange={(e) => setWatchOnly(e.target.checked)}
          />
          Only companies on my watchlist
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={backfill}
            onChange={(e) => setBackfill(e.target.checked)}
          />
          Also alert on jobs found in the last 7 days
        </label>
        <button
          className="primary"
          disabled={!name.trim() || !!quietStart !== !!quietEnd}
        >
          Save alert rule
        </button>
      </form>
      <p className="muted">
        Matches open in <Link to="/discover?view=new">New to your feed</Link>.
      </p>
    </section>
  );
}
