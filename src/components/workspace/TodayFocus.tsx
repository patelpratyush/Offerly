import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { TodayReminders } from "./TodayReminders";
import {
  Departures,
  buildDepartures,
  type DepartureSource,
} from "../today/Departures";

type RecordItem = { id: string; [key: string]: any };
type Props = {
  workspace: {
    applications: RecordItem[];
    tasks: RecordItem[];
    assessments: RecordItem[];
    rounds: RecordItem[];
    reviews: RecordItem[];
  };
  today: string;
  onOpen: (application: any) => void;
  onSource?: (kind: DepartureSource, record: RecordItem) => void;
  onReviews: () => void;
  request?: (path: string, method?: string, body?: any) => Promise<any>;
  /** Rendered between Hold and reminders (the tasks checklist). */
  children?: ReactNode;
};

/** Uses recorded ownership and dates only; elapsed time never changes a stage. */
export function TodayFocus({
  workspace: w,
  today,
  onOpen,
  onSource,
  onReviews,
  request,
  children,
}: Props) {
  const active = w.applications.filter(
    (a) => !a.archived && !["Rejected", "Withdrawn"].includes(a.stage),
  );
  const replies = active.filter((a) => a.owner === "You");
  const overdue = [
    ...w.tasks.filter((t) => !t.done && t.due && t.due < today),
    ...w.assessments.filter(
      (a) =>
        !["Completed", "Canceled"].includes(a.status) && a.due && a.due < today,
    ),
  ].length;
  const pending = w.reviews.filter((r) => r.status === "pending");
  const byId = new Map(w.applications.map((a) => [a.id, a]));
  const upNext = buildDepartures({ ...w, today }).length;
  const open = (kind: DepartureSource, record: RecordItem) =>
    kind === "application" || !onSource
      ? onOpen(record)
      : onSource(kind, record);
  return (
    <>
      <div className="brief-signals" role="group" aria-label="Daily priorities">
        <a
          href="#today-actions"
          className={"brief-signal" + (overdue ? " is-alert" : "")}
        >
          <span className="brief-label">
            Overdue {overdue === 1 ? "item" : "items"}
            <ArrowUpRight size={14} aria-hidden="true" />
          </span>
          <span className="brief-value">{overdue}</span>
        </a>
        <a href="#reply-ownership" className="brief-signal">
          <span className="brief-label">
            {replies.length === 1 ? "Reply" : "Replies"} owed
            <ArrowUpRight size={14} aria-hidden="true" />
          </span>
          <span className="brief-value">{replies.length}</span>
        </a>
        <button onClick={onReviews} className="brief-signal">
          <span className="brief-label">
            Pending {pending.length === 1 ? "review" : "reviews"}
            <ArrowRight size={14} aria-hidden="true" />
          </span>
          <span className="brief-value">{pending.length}</span>
        </button>
      </div>
      <section
        className="departures today-section"
        id="reply-ownership"
        aria-labelledby="up-next-heading"
      >
        <div className="section-head">
          <h2 id="up-next-heading">
            Up next <span className="count">{upNext}</span>
          </h2>
        </div>
        <div className="today-card">
          <Departures
            applications={w.applications}
            tasks={w.tasks}
            assessments={w.assessments}
            rounds={w.rounds}
            today={today}
            onSource={open}
          />
        </div>
        <p className="dep-note">
          {!w.assessments.some(
            (a) => !["Completed", "Canceled"].includes(a.status),
          ) && <span>No assessment deadlines. </span>}
          Recorded next steps. You decide what changes.
        </p>
      </section>
      <section className="hold today-section" aria-labelledby="hold-heading">
        <div className="section-head">
          <h2 id="hold-heading">
            Hold <span className="count">{pending.length}</span>
          </h2>
          <button className="text-button" onClick={onReviews}>
            Open reviews <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
        {pending.length ? (
          <ul className="hold-list today-card">
            {pending.slice(0, 5).map((r) => {
              const a = byId.get(
                r.applicationId ||
                  (r.candidateApplicationIds?.length === 1
                    ? r.candidateApplicationIds[0]
                    : ""),
              );
              return (
                <li key={r.id}>
                  <button onClick={onReviews}>
                    <span className="code-tag amber">On hold</span>
                    <span>
                      <strong>
                        {a ? `${a.company} — ${a.title}` : "Evidence to match"}
                      </strong>
                      <small>
                        {r.proposedChanges?.stage
                          ? `Proposed stage: ${r.proposedChanges.stage}`
                          : r.proposedChanges?.owner
                            ? `Proposed next response: ${r.proposedChanges.owner}`
                            : "Update waiting for your decision"}
                      </small>
                    </span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hold-empty today-card">
            <Check size={16} aria-hidden="true" /> Nothing on hold. Evidence
            never changes applications without your decision.
          </p>
        )}
        {pending.length > 5 && (
          <p className="muted">{pending.length - 5} more in Reviews.</p>
        )}
      </section>
      {children}
      {request && (
        <TodayReminders
          applications={w.applications}
          request={request}
          onOpen={onOpen}
        />
      )}
    </>
  );
}
