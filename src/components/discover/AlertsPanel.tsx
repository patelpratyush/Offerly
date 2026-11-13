import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
  cadence: Cadence;
  warnings: string;
  filters: Filters;
};
type Cadence = "immediate" | "daily" | "weekly";
type Digest = {
  id: string;
  cadence: "daily" | "weekly";
  deliveredAt: string;
  read: boolean;
  message: string;
  items: {
    jobId: string;
    title: string;
    company: string;
    event: string;
    postedLabel: string;
    firstDiscoveredAt: string;
    rules: { id: string; name: string; why: string[] }[];
  }[];
  excluded: { total: number };
};
const WINDOW_HOURS: Record<string, number> = {
  "24h": 24,
  "3d": 72,
  "7d": 168,
  "30d": 720,
};
const INTERVAL_HOURS = { daily: 24, weekly: 168 };
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
// Mirrors server/discovery/digest-rules.js so the warning shows while editing.
const windowWarning = (windowValue: string, cadence: Cadence) => {
  if (cadence === "immediate") return "";
  const hours = WINDOW_HOURS[windowValue];
  if (!hours || hours >= INTERVAL_HOURS[cadence]) return "";
  return `The recency window (${windowValue}) is shorter than the ${cadence} digest interval, so jobs that match when found may age out before the digest is sent and will be left out.`;
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
  const [digests, setDigests] = useState<Digest[]>([]);
  const [settings, setSettings] = useState({ hour: 8, weekday: 1 });
  // Latest digest settings, updated synchronously so back-to-back changes never
  // send a stale value for the other field.
  const settingsRef = useRef(settings);
  const saveDigest = (
    patch: Partial<{ hour: number; weekday: number }>,
    done: string,
  ) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    void run(() => discoveryApi("/digest-settings", "PUT", next), done);
  };
  const [cadence, setCadence] = useState<Cadence>("immediate");
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
      const [r, n, d, st] = await Promise.all([
        discoveryApi<Rule[]>("/alerts"),
        discoveryApi<{ unread: number; notifications: Note[] }>(
          "/notifications",
        ),
        discoveryApi<{ unread: number; digests: Digest[] }>("/digests"),
        discoveryApi<{ hour: number; weekday: number }>("/digest-settings"),
      ]);
      setRules(r);
      setNotes(n.notifications);
      setDigests(d.digests);
      settingsRef.current = st;
      setSettings(st);
      onNewAlerts(n.unread + d.unread);
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
        cadence,
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
    cadence: r.cadence,
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
      <h3>Digests</h3>
      {digests.length ? (
        <ul className="discover-notes" aria-label="Digests">
          {digests.map((d) => (
            <li key={d.id} className={d.read ? "" : "is-unread"}>
              <strong>
                {d.cadence === "weekly" ? "Weekly" : "Daily"} digest
              </strong>
              <span className="muted"> · sent {when(d.deliveredAt)}</span>
              <p>{d.message}</p>
              {d.items.length > 0 && (
                <ul>
                  {d.items.map((i) => (
                    <li key={i.jobId}>
                      <strong>
                        {i.event === "reopened" ? "Reopened: " : ""}
                        {i.title}
                      </strong>{" "}
                      at {i.company}
                      <span className="muted">
                        {" "}
                        · {i.postedLabel} · found {when(i.firstDiscoveredAt)}
                      </span>
                      <ul>
                        {i.rules.map((r) => (
                          <li key={r.id} className="muted">
                            Matched rule "{r.name}": {r.why.join("; ")}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              {!d.read && (
                <button
                  className="text-button"
                  onClick={() =>
                    run(() =>
                      discoveryApi("/digests/read", "POST", { id: d.id }),
                    )
                  }
                >
                  Mark digest read
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          No digests yet. Digests are sent only at your scheduled time, and only
          when something matched.
        </p>
      )}
      <div className="discover-filter-grid">
        <label>
          Digest time (your local time)
          <select
            value={settings.hour}
            onChange={(e) =>
              saveDigest({ hour: Number(e.target.value) }, "Digest time saved.")
            }
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <label>
          Weekly digest day
          <select
            value={settings.weekday}
            onChange={(e) =>
              saveDigest(
                { weekday: Number(e.target.value) },
                "Digest day saved.",
              )
            }
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
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
                ·{" "}
                {r.cadence === "immediate"
                  ? "immediate"
                  : r.cadence + " digest"}
                · min fit {r.minFit} · max {r.dailyCap}/day
                {r.quietStart ? ` · quiet ${r.quietStart}–${r.quietEnd}` : ""}
                {r.paused ? " · paused" : ""}
              </span>{" "}
              {r.warnings && (
                <span role="note" className="discover-warning">
                  Warning: {r.warnings}{" "}
                </span>
              )}
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
            Delivery
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
            >
              <option value="immediate">Immediately</option>
              <option value="daily">Daily digest</option>
              <option value="weekly">Weekly digest</option>
            </select>
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
        {windowWarning(filters.window, cadence) && (
          <p role="note" className="discover-warning">
            Warning: {windowWarning(filters.window, cadence)}
          </p>
        )}
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
