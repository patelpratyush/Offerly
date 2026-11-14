import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

import { RecruitingAction } from "./RecruitingAction";

type Item = { id: string; version: number; [key: string]: any };
type Request = (path: string, method?: string, body?: any) => Promise<any>;
type Props = {
  rounds: Item[];
  tasks: Item[];
  assessments: Item[];
  applications: Item[];
  evidence: Item[];
  recruitingJobs: Item[];
  reviews: Item[];
  fieldLocks: Item[];
  stages: string[];
  request: Request;
  onChanged: () => Promise<any>;
};
const owners = ["You", "Employer", "Nobody", "Unclear"];
const activeJob = (job: Item) =>
  ["queued", "running", "retry"].includes(job.status);
const panelStyle = { padding: 20, marginBottom: 20, minWidth: 0 };
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Request failed. Your input has been kept.";
}
function safeLink(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function useOperation(request: Request, onChanged: () => Promise<any>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const previous = useRef<{ key: string; operationId: string } | null>(null);
  async function run(path: string, payload: any, onSaved?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify({ path, payload });
    if (previous.current?.key !== key)
      previous.current = { key, operationId: crypto.randomUUID() };
    let saved = false;
    try {
      await request(path, "POST", {
        ...payload,
        operationId: previous.current.operationId,
      });
      saved = true;
      onSaved?.();
      await onChanged();
      previous.current = null;
    } catch (error) {
      setError(
        saved
          ? "Saved, but refresh failed. Refresh the workspace before another change."
          : message(error),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function RecruitingReview(props: Props) {
  const {
    applications,
    rounds,
    tasks,
    assessments,
    evidence,
    recruitingJobs,
    reviews,
    fieldLocks,
    stages,
    request,
    onChanged,
  } = props;
  const empty = {
    sourceId: "",
    sourceUrl: "",
    effectiveAt: "",
    excerpt: "",
    company: "",
    title: "",
    requisition: "",
    applicationId: "",
    stage: "",
    owner: "",
  };
  const [draft, setDraft] = useState(empty),
    [notice, setNotice] = useState("");
  const [refreshError, setRefreshError] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  const operation = useOperation(request, onChanged);
  const refresh = useRef(onChanged);
  refresh.current = onChanged;
  const activeIds = recruitingJobs
    .filter(activeJob)
    .map((job) => job.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!activeIds) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      attempts = 0;
    async function poll() {
      try {
        await refresh.current();
      } catch (error) {
        if (!stopped) setRefreshError(message(error));
      }
      if (!stopped && ++attempts < 30) timer = setTimeout(poll, 2000);
      else if (!stopped)
        setRefreshError(
          "Automatic refresh paused after one minute. Use Refresh reviews to check progress.",
        );
    }
    timer = setTimeout(poll, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeIds]);
  const change = (field: keyof typeof draft, value: string) =>
    setDraft((old) => ({ ...old, [field]: value }));
  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      await onChanged();
    } catch (error) {
      setRefreshError(message(error));
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <div className="recruiting-review">
      <div className="section-head">
        <div>
          <h2>Recruiting review</h2>
          <p className="muted">Check the evidence. You decide what changes.</p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={refreshing}
          onClick={() => void manualRefresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh reviews"}
        </button>
      </div>
      <p className="notice">
        Review Gmail proposals or paste evidence and propose updates yourself.
        Every application update needs your decision. Production AI remains
        disabled.
      </p>
      {refreshError && (
        <p role="alert" className="form-error">
          {refreshError}
        </p>
      )}
      <section className="wire-list" aria-label="Proposed updates">
        <h2>Proposed updates</h2>
        {!reviews.length && (
          <p className="muted">
            Reviews appear after processing. No update applies automatically.
          </p>
        )}
        {reviews.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            rounds={rounds}
            tasks={tasks}
            assessments={assessments}
            evidence={evidence.find((item) => item.id === review.evidenceId)}
            {...{ applications, stages, fieldLocks, request, onChanged }}
          />
        ))}
      </section>
      <section
        className="panel"
        style={panelStyle}
        aria-label="Add recruiting evidence"
      >
        <h2>Add evidence for review</h2>
        <p className="muted">
          Adding evidence queues a review. It does not change an application.
        </p>
        <form
          className="form-fields"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice("");
            const { stage, owner, ...data } = draft;
            const changes = {
              ...(stage ? { stage } : {}),
              ...(owner ? { owner } : {}),
            };
            void operation.run(
              "/recruiting/evidence",
              {
                ...data,
                effectiveAt: draft.effectiveAt,
                applicationId: data.applicationId || undefined,
                changes,
              },
              () => {
                setDraft(empty);
                setNotice(
                  "Evidence queued. Review the proposed update before applying it.",
                );
              },
            );
          }}
        >
          <div className="filter-grid">
            <label>
              Source identifier
              <input
                required
                maxLength={200}
                disabled={operation.busy}
                value={draft.sourceId}
                onChange={(e) => change("sourceId", e.target.value)}
                placeholder="Email message ID or personal reference"
              />
            </label>
            <label>
              Source link (optional)
              <input
                type="url"
                maxLength={2000}
                disabled={operation.busy}
                value={draft.sourceUrl}
                onChange={(e) => change("sourceUrl", e.target.value)}
                placeholder="https://…"
              />
            </label>
            <label>
              Evidence time (ISO timestamp with UTC offset)
              <input
                type="text"
                placeholder="2026-10-20T14:00:00-04:00"
                required
                disabled={operation.busy}
                value={draft.effectiveAt}
                onChange={(e) => change("effectiveAt", e.target.value)}
              />
            </label>
          </div>
          <label>
            Evidence excerpt
            <textarea
              aria-label="Evidence excerpt"
              required
              rows={4}
              maxLength={10000}
              disabled={operation.busy}
              value={draft.excerpt}
              onChange={(e) => change("excerpt", e.target.value)}
            />
          </label>
          <div className="filter-grid">
            <label>
              Possible company
              <input
                required
                maxLength={200}
                disabled={operation.busy}
                value={draft.company}
                onChange={(e) => change("company", e.target.value)}
              />
            </label>
            <label>
              Possible role
              <input
                required
                maxLength={200}
                disabled={operation.busy}
                value={draft.title}
                onChange={(e) => change("title", e.target.value)}
              />
            </label>
            <label>
              Requisition (optional)
              <input
                maxLength={200}
                disabled={operation.busy}
                value={draft.requisition}
                onChange={(e) => change("requisition", e.target.value)}
              />
            </label>
            <label>
              Known application (optional)
              <select
                aria-label="Known application (optional)"
                disabled={operation.busy}
                value={draft.applicationId}
                onChange={(e) => change("applicationId", e.target.value)}
              >
                <option value="">Match from evidence</option>
                {applications
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.company} · {a.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              User-proposed stage
              <select
                aria-label="User-proposed stage"
                disabled={operation.busy}
                value={draft.stage}
                onChange={(e) => change("stage", e.target.value)}
              >
                <option value="">No stage update</option>
                {stages.map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </label>
            <label>
              User-proposed response owner
              <select
                aria-label="User-proposed response owner"
                disabled={operation.busy}
                value={draft.owner}
                onChange={(e) => change("owner", e.target.value)}
              >
                <option value="">No owner update</option>
                {owners.map((owner) => (
                  <option key={owner}>{owner}</option>
                ))}
              </select>
            </label>
          </div>
          {operation.error && (
            <p role="alert" className="form-error">
              {operation.error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          <button
            className="primary"
            disabled={operation.busy || (!draft.stage && !draft.owner)}
          >
            {operation.busy ? "Queuing…" : "Queue evidence for review"}
          </button>
        </form>
      </section>
      <section
        className="panel"
        style={panelStyle}
        aria-label="Evidence processing jobs"
      >
        <h2>Processing jobs</h2>
        {!recruitingJobs.length && (
          <p className="muted">No evidence queued yet.</p>
        )}
        {recruitingJobs.map((job) => (
          <article className="detail-item" key={job.id}>
            <div>
              <strong>
                {evidence.find((item) => item.id === job.evidenceId)
                  ?.sourceId || "Evidence processing"}
              </strong>
              <p>
                Status: {job.status} · Attempts: {job.attempts || 0}
              </p>
              {job.lastError && <p className="form-error">{job.lastError}</p>}
            </div>
            {job.status === "failed" && (
              <button
                type="button"
                disabled={operation.busy}
                onClick={() =>
                  void operation.run(`/recruiting/jobs/${job.id}/retry`, {
                    version: job.version,
                  })
                }
              >
                Retry processing
              </button>
            )}
            {activeJob(job) && (
              <button
                type="button"
                className="text-button"
                disabled={operation.busy}
                onClick={() =>
                  void operation.run(`/recruiting/jobs/${job.id}/cancel`, {
                    version: job.version,
                  })
                }
              >
                Cancel processing
              </button>
            )}
          </article>
        ))}
      </section>

      <section
        className="panel"
        style={panelStyle}
        aria-label="Protected manual fields"
      >
        <h2>Protected manual fields</h2>
        <p className="muted">
          Manual decisions stay protected. Unlock a field only when you want
          later evidence to be considered without overriding its lock.
        </p>
        {!fieldLocks.some((lock) => lock.locked) && <p>No locked fields.</p>}
        {fieldLocks
          .filter((lock) => lock.locked)
          .map((lock) => {
            const application = applications.find(
              (item) => item.id === lock.applicationId,
            );
            return (
              <article className="detail-item" key={lock.id}>
                <div>
                  <strong>
                    {application?.company} · {application?.title}
                  </strong>
                  <p>
                    {lock.field}: {lock.value}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={operation.busy}
                  onClick={() =>
                    void operation.run(`/recruiting/locks/${lock.id}/unlock`, {
                      version: lock.version,
                    })
                  }
                >
                  Unlock {lock.field}
                </button>
              </article>
            );
          })}
      </section>
    </div>
  );
}

function ReviewCard({
  rounds,
  tasks,
  assessments,
  review,
  evidence,
  applications,
  stages,
  fieldLocks,
  request,
  onChanged,
}: Omit<Props, "evidence" | "recruitingJobs" | "reviews"> & {
  review: Item;
  evidence?: Item;
}) {
  const [applicationId, setApplicationId] = useState(
    review.applicationId ||
      (review.candidateApplicationIds?.length === 1
        ? review.candidateApplicationIds[0]
        : ""),
  );
  const [stage, setStage] = useState(review.proposedChanges?.stage || ""),
    [owner, setOwner] = useState(review.proposedChanges?.owner || ""),
    [override, setOverride] = useState(false);
  const operation = useOperation(request, onChanged);
  const application = applications.find((item) => item.id === applicationId);
  useEffect(() => {
    setOverride(false);
  }, [application?.version]);
  const pending = review.status === "pending";
  const locks = fieldLocks.filter(
    (lock) => lock.applicationId === applicationId && lock.locked,
  );
  const link = safeLink(evidence?.sourceUrl);
  async function decide(decision: string) {
    await operation.run(`/recruiting/reviews/${review.id}/decide`, {
      version: review.version,
      decision,
      ...(decision !== "reject"
        ? { applicationId, applicationVersion: application?.version, override }
        : {}),
      ...(decision === "correct"
        ? {
            changes: {
              ...(stage ? { stage } : {}),
              ...(owner ? { owner } : {}),
            },
          }
        : {}),
    });
  }
  const candidates: string[] = review.candidateApplicationIds || [];
  const lockedFor = (field: string) =>
    locks.find((lock) => String(lock.field).toLowerCase().includes(field));
  const rows = [
    {
      key: "stage",
      label: "Stage",
      current: application?.stage,
      proposed: review.proposedChanges?.stage,
      empty: "Choose an application",
    },
    {
      key: "owner",
      label: "Next response",
      current: application?.owner,
      proposed: review.proposedChanges?.owner,
      empty: "Not selected",
    },
  ];
  const decided = ["accepted", "corrected", "rejected"].includes(review.status);
  return (
    <article
      className="panel wire"
      data-status={review.status}
      aria-label={`Review ${evidence?.sourceId || review.id}`}
    >
      <header className="wire-head">
        <span className="wire-code">Wire</span>
        <h3>{evidence?.sourceId || "Evidence review"}</h3>
        <span className="badge wire-status">{review.status}</span>
      </header>
      {candidates.length > 1 && (
        <p className="wire-banner" data-kind="ambiguity">
          <strong>Ambiguous match.</strong> {candidates.length} applications
          could fit this evidence. Choose the target explicitly before deciding.
        </p>
      )}
      {candidates.length === 0 && !application && pending && (
        <p className="wire-banner" data-kind="ambiguity">
          <strong>No match found.</strong> Select the application yourself.
        </p>
      )}
      <div className="wire-body">
        <section className="wire-source" aria-label="Source evidence">
          <h4 className="wire-label">Source evidence</h4>
          <blockquote>{evidence?.excerpt || "Evidence unavailable"}</blockquote>
          <p className="wire-meta">
            Evidence time:{" "}
            {review.effectiveAt || evidence?.effectiveAt || "Unknown"}
          </p>
          {evidence?.parserVersion ||
          evidence?.model ||
          evidence?.promptVersion ? (
            <p className="wire-meta">
              Extraction provenance:{" "}
              {evidence.parserVersion || "Unknown parser"}
              {evidence.model && ` · Model: ${evidence.model}`}
              {evidence.promptVersion && ` · Prompt: ${evidence.promptVersion}`}
              . The excerpt above is the retained source evidence; verify it
              before accepting.
            </p>
          ) : (
            <p className="wire-meta">
              Extraction provenance not recorded. Verify the excerpt before
              accepting.
            </p>
          )}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer">
              Open evidence source
            </a>
          )}
          <p className="wire-meta">{review.matchingRationale}</p>
          <p className="wire-meta">
            Candidate applications:{" "}
            {candidates
              .map((id: string) => {
                const a = applications.find((item) => item.id === id);
                return a
                  ? `${a.company} · ${a.title}`
                  : "Unavailable application";
              })
              .join("; ") || "No match — select the application explicitly."}
          </p>
        </section>
        <section className="wire-change" aria-label="Proposed change">
          <h4 className="wire-label">Current record to proposed update</h4>
          <dl
            className="review-comparison"
            aria-label="Current and proposed values"
          >
            <div className="wire-cols" aria-hidden="true">
              <span>Current record</span>
              <span />
              <span>Proposed update · requires your decision</span>
            </div>
            {rows.map((row) => {
              const lock = lockedFor(row.key);
              return (
                <div className="wire-row" key={row.key} data-locked={!!lock}>
                  <dt>{row.label}</dt>
                  <dd className="wire-current">
                    <span className="sr-only">Current: </span>
                    {row.current && row.proposed ? (
                      <del>{row.current}</del>
                    ) : (
                      row.current || row.empty
                    )}
                  </dd>
                  <dd className="wire-arrow" aria-hidden="true">
                    →
                  </dd>
                  <dd className="wire-proposed">
                    <span className="sr-only">Proposed: </span>
                    {row.proposed ? (
                      <ins>{row.proposed}</ins>
                    ) : (
                      "No change proposed"
                    )}
                    {lock && (
                      <span className="wire-lock">
                        <Lock size={12} aria-hidden="true" /> Locked by you
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {!!locks.length && (
            <p className="wire-banner" data-kind="lock">
              <Lock size={14} aria-hidden="true" />
              <span>
                Protected fields: {locks.map((lock) => lock.field).join(", ")}.
                Applying changes may require explicit override.
              </span>
            </p>
          )}
          {pending && (
            <div className="form-fields wire-controls">
              <label>
                Review target application
                <select
                  aria-label="Review target application"
                  value={applicationId}
                  disabled={operation.busy}
                  onChange={(event) => {
                    setApplicationId(event.target.value);
                    setOverride(false);
                  }}
                >
                  <option value="">Choose the target application</option>
                  {applications
                    .filter((item) => !item.archived)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.company} · {item.title}
                      </option>
                    ))}
                </select>
              </label>
              {application && (
                <p className="wire-meta">
                  Current stage: {application.stage} · Response owner:{" "}
                  {application.owner}
                </p>
              )}
              <div className="filter-grid">
                <label>
                  Corrected stage
                  <select
                    aria-label="Corrected stage"
                    value={stage}
                    disabled={operation.busy}
                    onChange={(event) => setStage(event.target.value)}
                  >
                    <option value="">No stage update</option>
                    {stages.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Corrected response owner
                  <select
                    aria-label="Corrected response owner"
                    value={owner}
                    disabled={operation.busy}
                    onChange={(event) => setOwner(event.target.value)}
                  >
                    <option value="">No owner update</option>
                    {owners.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={override}
                  disabled={operation.busy}
                  onChange={(event) => setOverride(event.target.checked)}
                />
                Explicitly override protected fields, older evidence, or
                terminal-stage safeguards for this decision
              </label>
            </div>
          )}
        </section>
      </div>
      {evidence?.eventType && (
        <p className="wire-meta wire-pad">
          Proposed event: {evidence.eventType}. Confirm details from source
          evidence.
        </p>
      )}
      {["accepted", "corrected"].includes(review.status) && (
        <RecruitingAction
          review={review}
          rounds={rounds}
          tasks={tasks}
          assessments={assessments}
          busy={operation.busy}
          submit={(payload) =>
            operation.run(`/recruiting/reviews/${review.id}/action`, payload)
          }
        />
      )}
      {evidence?.proposedContacts?.length > 0 && (
        <section className="wire-contacts">
          <h4 className="wire-label">Proposed contacts</h4>
          <p>
            Unverified identities from message participants. Save only after
            checking the source.
          </p>
          {evidence?.proposedContacts.map((contact: any, index: number) => (
            <p key={index}>
              {contact.name || "Unnamed contact"} · {contact.email} ·{" "}
              {contact.source || "Gmail participant"}
            </p>
          ))}
          {["accepted", "corrected"].includes(review.status) && (
            <button
              type="button"
              disabled={operation.busy || !!review.contactsSaved}
              onClick={() =>
                void operation.run(
                  `/recruiting/reviews/${review.id}/contacts`,
                  { version: review.version },
                )
              }
            >
              {review.contactsSaved
                ? "Contacts saved"
                : "Save proposed contacts"}
            </button>
          )}
        </section>
      )}
      {operation.error && (
        <p role="alert" className="form-error wire-banner" data-kind="error">
          {operation.error}
        </p>
      )}
      {(pending || decided) && (
        <footer className="wire-decide">
          <span className="wire-label">
            {pending ? "Your decision" : "Decision recorded"}
          </span>
          {pending && (
            <>
              <button
                type="button"
                className="primary"
                disabled={operation.busy || !application}
                onClick={() => void decide("accept")}
              >
                Accept proposed update
              </button>
              <button
                type="button"
                className="secondary"
                disabled={operation.busy || !application || (!stage && !owner)}
                onClick={() => void decide("correct")}
              >
                Apply corrected update
              </button>
              <button
                type="button"
                className="text-button"
                disabled={operation.busy}
                onClick={() => void decide("reject")}
              >
                Reject update
              </button>
            </>
          )}
          {decided && (
            <button
              type="button"
              className="secondary"
              disabled={operation.busy}
              onClick={() =>
                void operation.run(`/recruiting/reviews/${review.id}/undo`, {
                  version: review.version,
                })
              }
            >
              Undo review decision
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
