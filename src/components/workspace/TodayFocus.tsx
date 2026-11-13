import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { TodayReminders } from "./TodayReminders";
import { Departures, type DepartureSource } from "../today/Departures";
import { Flap } from "../applications/dispatch";

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
  const pad = (n: number) => String(n).padStart(2, "0");
  const open = (kind: DepartureSource, record: RecordItem) =>
    kind === "application" || !onSource
      ? onOpen(record)
      : onSource(kind, record);
  return (
    <>
      <section
        className="departures"
        id="reply-ownership"
        aria-label="Daily priorities"
      >
        <div className="dep-top">
          <div>
            <span className="tiny-label">TODAY · {today}</span>
            <h2 className="dep-title">Departures</h2>
          </div>
          <div className="brief-signals">
            <a href="#today-actions" className="brief-signal">
              <Flap value={pad(overdue)} />
              <span>
                Overdue {overdue === 1 ? "item" : "items"}
                <ArrowUpRight size={14} aria-hidden="true" />
              </span>
            </a>
            <a href="#reply-ownership" className="brief-signal">
              <Flap value={pad(replies.length)} />
              <span>
                {replies.length === 1 ? "Reply" : "Replies"} owed
                <ArrowUpRight size={14} aria-hidden="true" />
              </span>
            </a>
            <button onClick={onReviews} className="brief-signal">
              <Flap value={pad(pending.length)} />
              <span>
                Pending {pending.length === 1 ? "review" : "reviews"}
                <ArrowRight size={14} aria-hidden="true" />
              </span>
            </button>
          </div>
        </div>
        <Departures
          applications={w.applications}
          tasks={w.tasks}
          assessments={w.assessments}
          rounds={w.rounds}
          today={today}
          onSource={open}
        />
        {!w.assessments.some(
          (a) => !["Completed", "Canceled"].includes(a.status),
        ) && <p className="dep-note">No assessment deadlines.</p>}
        <p className="dep-note">Recorded next steps. You decide what changes.</p>
      </section>
      <section className="hold" aria-labelledby="hold-heading">
        <div className="section-head">
          <h2 id="hold-heading">
            Hold <span className="count">{pending.length}</span>
          </h2>
          <button className="text-button" onClick={onReviews}>
            Open reviews <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
        {pending.length ? (
          <ul className="hold-list">
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
                    <span className="status-word">HOLD</span>
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
          <p className="hold-empty">
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
