import { ArrowUpRight, ArrowRight, Check, Clock } from "lucide-react";

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
  onReviews: () => void;
};

function waitingLabel(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return "Start date not recorded";
  const days = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 86400000),
  );
  return `${days} ${days === 1 ? "day" : "days"} waiting`;
}

/** Uses recorded ownership and dates only; elapsed time never changes a stage. */
export function TodayFocus({ workspace: w, today, onOpen, onReviews }: Props) {
  const active = w.applications.filter(
    (a) => !a.archived && !["Rejected", "Withdrawn"].includes(a.stage),
  );
  const replies = active.filter((a) => a.owner === "You");
  const waiting = active.filter((a) => a.owner === "Employer");
  const overdue = [
    ...w.tasks.filter((t) => !t.done && t.due && t.due < today),
    ...w.assessments.filter(
      (a) =>
        !["Completed", "Canceled"].includes(a.status) && a.due && a.due < today,
    ),
  ].length;
  const reviews = w.reviews.filter((r) => r.status === "pending").length;
  return (
    <section className="daily-brief" aria-label="Daily priorities">
      <div className="daily-brief-summary">
        <span className="tiny-label">ATTENTION FIRST</span>
        <p>
          <strong>{overdue}</strong> overdue {overdue === 1 ? "item" : "items"}
          <span aria-hidden="true"> / </span>
          <strong>{replies.length}</strong>{" "}
          {replies.length === 1 ? "reply" : "replies"} owed
          <span aria-hidden="true"> / </span>
          <button onClick={onReviews} className="brief-review-link">
            <strong>{reviews}</strong> pending{" "}
            {reviews === 1 ? "review" : "reviews"}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </p>
        <small>Recorded next steps. You decide what changes.</small>
      </div>
      <div className="reply-agenda">
        <div className="reply-agenda-column">
          <div className="section-head">
            <h2>Your reply is next</h2>
            <span className="count">{replies.length}</span>
          </div>
          {replies.length ? (
            replies.slice(0, 4).map((a) => (
              <button
                className="brief-application"
                key={a.id}
                onClick={() => onOpen(a)}
              >
                <span className="company-icon">
                  {a.company.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{a.company}</strong>
                  <small>{a.title}</small>
                </span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </button>
            ))
          ) : (
            <p className="brief-empty">
              <Check size={17} aria-hidden="true" /> No applications marked as
              waiting on you.
            </p>
          )}
          {replies.length > 4 && (
            <p className="brief-overflow">
              {replies.length - 4} more in Applications · filter Next response
              to You.
            </p>
          )}
        </div>
        <div className="reply-agenda-column waiting-agenda">
          <div className="section-head">
            <h2>With the employer</h2>
            <span className="count">{waiting.length}</span>
          </div>
          {waiting.length ? (
            waiting.slice(0, 3).map((a) => (
              <button
                className="brief-application"
                key={a.id}
                onClick={() => onOpen(a)}
              >
                <Clock size={17} aria-hidden="true" />
                <span>
                  <strong>{a.company}</strong>
                  <small>
                    {a.title} · {waitingLabel(a.ownerEffectiveAt)}
                  </small>
                </span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </button>
            ))
          ) : (
            <p className="brief-empty">
              No applications marked as waiting on an employer.
            </p>
          )}
          {waiting.length > 3 && (
            <p className="brief-overflow">
              {waiting.length - 3} more in Applications · filter Next response
              to Employer.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
