import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Job, discoveryApi, when } from "./api";
import { JobCard } from "./JobCard";
import { DiscoverFilters, Filters, defaultFilters } from "./DiscoverFilters";
import { ProfilePanel } from "./ProfilePanel";
import { AlertsPanel } from "./AlertsPanel";
import { SavedSearch, SavedSearches } from "./SavedSearches";

const VIEWS: [string, string, string][] = [
  [
    "best",
    "Best matches",
    "Highest explainable fit to your approved profile. Not an interview probability.",
  ],
  [
    "latest",
    "Latest",
    "Newest by the employer's posting date. Jobs with unknown posting dates are listed last.",
  ],
  [
    "new",
    "New to your feed",
    "Jobs Offerly found recently, whatever date the employer posted them.",
  ],
  ["watchlist", "Watchlist", "Open jobs at companies you watch."],
  ["stretch", "Stretch roles", "One seniority step above your approved level."],
  ["saved", "Saved", "Jobs you saved."],
  [
    "applied",
    "Already applied",
    "Jobs that match an application you already track, by requisition or URL.",
  ],
];
const TOOLS: [string, string][] = [
  ["profile", "Candidate profile"],
  ["alerts", "Alerts"],
  ["searches", "Saved searches"],
];
export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("view") || "best";
  const view = VIEWS.some(([v]) => v === requested) ? requested : "best";
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [approved, setApproved] = useState(true);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [tool, setTool] = useState("");
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [unread, setUnread] = useState(0);
  const [generatedAt, setGeneratedAt] = useState("");
  const [coverage, setCoverage] = useState<any>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setState("loading");
    try {
      const query = new URLSearchParams({
        view,
        filters: JSON.stringify(filters),
      });
      const data = await discoveryApi(`/feed?${query}`);
      if (id !== request.current) return; // A newer request owns the screen.
      setJobs(data.jobs);
      setNextCursor(data.nextCursor || null);
      setApproved(data.profileApproved);
      setGeneratedAt(data.generatedAt);
      setState("ready");
    } catch (e) {
      if (id !== request.current) return;
      setMessage(e instanceof Error ? e.message : "Could not load jobs");
      setState("error");
    }
  }, [view, filters]);
  useEffect(() => {
    void load();
  }, [load]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const id = request.current;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({
        view,
        filters: JSON.stringify(filters),
        cursor: nextCursor,
      });
      const data = await discoveryApi(`/feed?${query}`);
      if (id !== request.current) return;
      setJobs((current) => {
        const seen = new Set(current.map((j) => j.id));
        return [...current, ...data.jobs.filter((j: Job) => !seen.has(j.id))];
      });
      setNextCursor(data.nextCursor || null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load more jobs");
    } finally {
      setLoadingMore(false);
    }
  };
  const loadSearches = useCallback(async () => {
    try {
      setSearches(await discoveryApi("/searches"));
    } catch {
      /* Non-critical; the list stays as is. */
    }
  }, []);
  useEffect(() => {
    void loadSearches();
    discoveryApi("/coverage")
      .then(setCoverage)
      .catch(() => {});
    discoveryApi("/notifications")
      .then((n) => setUnread(n.unread))
      .catch(() => {});
  }, [loadSearches]);
  const current = VIEWS.find(([v]) => v === view)!;
  const saveSearch = async (name: string, value: Filters) => {
    try {
      await discoveryApi("/searches", "POST", { name, filters: value });
      setMessage(`Saved search "${name}".`);
      await loadSearches();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save search");
    }
  };
  const empty =
    coverage && coverage.summary.collectingSources === 0
      ? "Offerly is not collecting from any employer boards yet, so there are no jobs to show. Nothing here is sample data."
      : view === "best" && !approved
        ? "Approve your candidate profile to see ranked matches."
        : "No jobs match these filters.";
  return (
    <div className="discover" id="discover-root">
      <section className="discover-coverage panel" aria-label="Source coverage">
        {coverage && (
          <span className="discover-board" aria-hidden="true">
            <b>{coverage.summary.collectingSources}</b>/
            {coverage.summary.sources}
            <i>boards collected</i>
          </span>
        )}
        <strong>Coverage is limited.</strong>{" "}
        {coverage
          ? `${coverage.summary.collectingSources} of ${coverage.summary.sources} registered employer boards are being collected across ${coverage.summary.companies} companies${
              coverage.summary.unverifiedSources
                ? `; ${coverage.summary.unverifiedSources} could not be verified recently`
                : ""
            }. `
          : ""}
        This is not the whole job market.{" "}
        <Link to="/companies">
          See every source and when it was last checked
        </Link>
        .
      </section>
      <div className="discover-views" role="group" aria-label="Views">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            className={view === v ? "is-active" : ""}
            aria-pressed={view === v}
            onClick={() => setParams({ view: v })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted discover-note">{current[2]}</p>
      <DiscoverFilters
        key={JSON.stringify(filters)}
        value={filters}
        onApply={setFilters}
        onSaveSearch={saveSearch}
      />
      <div className="discover-tools" role="group" aria-label="Tools">
        {TOOLS.map(([id, label]) => (
          <button
            key={id}
            className="secondary"
            aria-expanded={tool === id}
            onClick={() => setTool(tool === id ? "" : id)}
          >
            {label}
            {id === "alerts" && unread ? ` (${unread} unread)` : ""}
          </button>
        ))}
      </div>
      {tool === "profile" && <ProfilePanel onSaved={load} />}
      {tool === "alerts" && (
        <AlertsPanel filters={filters} onNewAlerts={setUnread} />
      )}
      {tool === "searches" && (
        <section className="panel">
          <SavedSearches
            searches={searches}
            onApply={(f) => setFilters({ ...defaultFilters, ...f })}
            onDelete={async (id) => {
              await discoveryApi(`/searches/${id}`, "DELETE", {}).catch(
                () => {},
              );
              await loadSearches();
            }}
          />
        </section>
      )}
      <div role="status" aria-live="polite" className="discover-status">
        {message}
      </div>
      <section aria-label={current[1]} aria-busy={state === "loading"}>
        {state === "error" ? (
          <div className="panel" role="alert">
            <p>{message}</p>
            <button className="secondary" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : state === "loading" && !jobs.length ? (
          <p className="loading-copy">Loading jobs…</p>
        ) : jobs.length ? (
          <>
            <p className="muted discover-count">
              {jobs.length} {jobs.length === 1 ? "job" : "jobs"} shown · as of{" "}
              {when(generatedAt)}
              {nextCursor ? " · more available" : ""}
            </p>
            <div className="discover-colhead" aria-hidden="true">
              <span>Service</span>
              <span>Where</span>
              <span>Fit</span>
              <span>Eligibility</span>
              <span>Freshness</span>
            </div>
            <div className="discover-list">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onChanged={load}
                  onError={setMessage}
                />
              ))}
            </div>
            {nextCursor && (
              <button
                className="secondary discover-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading…" : "Load more jobs"}
              </button>
            )}
          </>
        ) : (
          <div className="panel discover-empty">
            <span className="discover-code">
              {coverage && coverage.summary.collectingSources === 0
                ? "NO SERVICE"
                : "NO MATCH"}
            </span>
            <h2>{current[1]}: nothing to show</h2>
            <p>{empty}</p>
            {nextCursor && (
              <button
                className="secondary discover-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading…" : "Keep searching older jobs"}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
