import { useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  EyeOff,
  Undo2,
} from "lucide-react";
import { Link } from "react-router";
import { Job, discoveryApi, when } from "./api";

const REASONS: [string, string][] = [
  ["not_relevant", "Not relevant"],
  ["wrong_seniority", "Wrong seniority"],
  ["wrong_location", "Wrong location"],
  ["company", "Not this company"],
  ["compensation", "Compensation"],
  ["already_seen", "Already seen"],
  ["other", "Other"],
];
const ELIGIBILITY: Record<string, string> = {
  meets: "Meets stated requirements",
  needs_verification: "Needs verification",
  does_not_meet: "Does not meet a stated requirement",
};
const PLATFORM: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
};
function money(job: Job) {
  const c = job.compensation;
  if (!c.stated) return "Compensation not stated";
  const range =
    c.min && c.max && c.min !== c.max
      ? `${c.min.toLocaleString()}–${c.max.toLocaleString()}`
      : (c.max || c.min || 0).toLocaleString();
  return (
    `${range} ${c.currency}`.trim() +
    (c.period !== "Unknown" ? ` per ${c.period.toLowerCase()}` : "") +
    (c.basis !== "Unknown" ? ` (${c.basis.toLowerCase()})` : "")
  );
}
export function JobCard({
  job,
  onChanged,
  onError,
}: {
  job: Job;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("not_relevant");
  const act = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      await discoveryApi(path, method, body);
      setDismissing(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  const f = job.freshness;
  const dateOnly = f.postedPrecision === "date";
  const labelId = `job-${job.id}`;
  return (
    <article className="discover-card" aria-labelledby={labelId}>
      <header>
        <div>
          <h3 id={labelId}>{job.title}</h3>
          <p className="discover-company">
            {job.company.name}
            {job.location ? ` · ${job.location}` : ""}
            {job.workArrangement !== "Unknown"
              ? ` · ${job.workArrangement}`
              : ""}
          </p>
        </div>
        {job.fit?.score !== null && job.fit ? (
          <div
            className="discover-fit"
            aria-label={`Fit ${job.fit.score} out of 100. Not an interview probability.`}
          >
            <strong>{job.fit.score}</strong>
            <span>fit / 100</span>
          </div>
        ) : (
          <div className="discover-fit is-empty">
            <strong>–</strong>
            <span>{job.fit ? "not enough evidence" : "no profile"}</span>
          </div>
        )}
      </header>
      <ul className="discover-badges" aria-label="Status">
        {job.applied && (
          <li className="is-applied">
            Already applied ({job.applied.stage}) ·{" "}
            <Link to={`/applications/${job.applied.applicationId}`}>
              open application
            </Link>
          </li>
        )}
        <li className={"is-" + job.eligibility.status}>
          {ELIGIBILITY[job.eligibility.status]}
        </li>
        <li className={job.company.size.ambiguous ? "is-warn" : ""}>
          {job.company.size.label}
          {job.company.size.entity !== "employer"
            ? ` · ${job.company.size.entity}`
            : ""}
        </li>
        {job.verification === "could_not_verify" && (
          <li className="is-warn">Could not verify recently</li>
        )}
        {job.status === "not_listed" && (
          <li className="is-warn">No longer listed by source</li>
        )}
        {f.reopenedCount > 0 && <li>Reposted or reopened</li>}
      </ul>
      <dl className="discover-dates">
        <div>
          <dt>Posted</dt>
          <dd>
            {f.postedPrecision === "unknown"
              ? "Posting date unknown"
              : dateOnly
                ? `${when(f.employerPostedAt, true)} (date only)`
                : when(f.employerPostedAt)}
          </dd>
        </div>
        <div>
          <dt>First discovered</dt>
          <dd>{when(f.firstDiscoveredAt)}</dd>
        </div>
        <div>
          <dt>Last checked</dt>
          <dd>{when(f.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>Last changed</dt>
          <dd>{when(f.lastChangedAt)}</dd>
        </div>
        <div>
          <dt>Compensation</dt>
          <dd>{money(job)}</dd>
        </div>
      </dl>
      {job.excerpt && <p className="discover-excerpt">{job.excerpt}…</p>}
      <details className="discover-why">
        <summary>Why this score and eligibility</summary>
        {job.fit ? (
          <ul>
            {job.fit.components.map((c) => (
              <li key={c.key}>
                <strong>
                  {c.label} ({c.weight}%):{" "}
                  {c.score === null
                    ? "unknown"
                    : Math.round(c.score * 100) + "%"}
                </strong>
                <ul>
                  {c.evidence.map((e) => (
                    <li key={e}>Supported: {e}</li>
                  ))}
                  {c.gaps.map((e) => (
                    <li key={e}>Gap: {e}</li>
                  ))}
                  {c.unknowns.map((e) => (
                    <li key={e}>Unknown: {e}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p>Approve your candidate profile to see an explainable fit score.</p>
        )}
        {job.fit && (
          <p className="muted">
            Rubric {job.fit.rubricVersion}. {job.fit.disclaimer}
          </p>
        )}
        <h4>Eligibility</h4>
        {job.eligibility.checks.length ? (
          <ul>
            {job.eligibility.checks.map((c) => (
              <li key={c.check}>
                {c.check.replace("_", " ")}: {c.status.replaceAll("_", " ")} —{" "}
                {c.detail} <q>{c.evidence}</q>
              </li>
            ))}
          </ul>
        ) : (
          <p>{job.eligibility.note}</p>
        )}
      </details>
      <p className="discover-sources">
        Source{job.sources.length === 1 ? "" : "s"}:{" "}
        {job.sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
            {PLATFORM[s.platform] || "Employer"} listing
            <ExternalLink size={12} aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ))}
      </p>
      <div className="discover-actions">
        {job.saved ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => act(`/jobs/${job.id}/save`, "DELETE")}
          >
            <BookmarkCheck size={15} aria-hidden="true" /> Saved
            <span className="sr-only"> — remove {job.title}</span>
          </button>
        ) : (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => act(`/jobs/${job.id}/save`, "PUT")}
          >
            <Bookmark size={15} aria-hidden="true" /> Save
            <span className="sr-only"> {job.title}</span>
          </button>
        )}
        <button
          className="secondary"
          disabled={busy}
          aria-pressed={job.watched}
          onClick={() =>
            act(
              `/companies/${job.company.id}/watch`,
              job.watched ? "DELETE" : "PUT",
            )
          }
        >
          {job.watched ? "Watching" : "Watch"} {job.company.name}
        </button>
        {job.dismissed ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => act(`/jobs/${job.id}/dismiss`, "DELETE")}
          >
            <Undo2 size={15} aria-hidden="true" /> Restore
          </button>
        ) : dismissing ? (
          <span className="discover-dismiss">
            <label>
              Why dismiss?
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {REASONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={busy}
              onClick={() => act(`/jobs/${job.id}/dismiss`, "PUT", { reason })}
            >
              Dismiss
            </button>
            <button className="secondary" onClick={() => setDismissing(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="secondary" onClick={() => setDismissing(true)}>
            <EyeOff size={15} aria-hidden="true" /> Not for me
            <span className="sr-only">: {job.title}</span>
          </button>
        )}
      </div>
    </article>
  );
}
