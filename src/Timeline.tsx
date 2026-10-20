function linked(data: any, id: string) {
  return data?.applicationId === id || data?.applicationIds?.includes(id);
}
const names: Record<string, string> = {
  application: "Application",
  round: "Interview round",
  task: "Task",
  contact: "Contact",
  document: "Document",
  document_usage: "Submitted document",
  listing_snapshot: "Listing snapshot",
  assessment: "Assessment",
  duplicate_review: "Duplicate review",
  recruiting_review: "Evidence review",
  recruiting_clock: "Evidence chronology",
  field_lock: "Field protection",
  reminder: "Reminder",
  recruiting_evidence: "Source evidence",
};
export function Timeline({
  events,
  applicationId,
  timezone,
}: {
  events: any[];
  applicationId: string;
  timezone: string;
}) {
  return (
    <div className="timeline">
      {events.map((e) => {
        const after = JSON.parse(e.after_data),
          before = e.before_data ? JSON.parse(e.before_data) : null;
        const kind = e.kind || "application",
          name = names[kind] || kind;
        let label = before ? `${name} updated` : `${name} added`;
        if (kind === "application" && before) {
          if (before.stage !== after.stage)
            label = `${before.stage} → ${after.stage}`;
          else if (before.archived !== after.archived)
            label = after.archived
              ? "Application archived"
              : "Application restored";
        } else if (kind !== "application" && before) {
          if (!linked(after, applicationId) && linked(before, applicationId))
            label = `${name} unlinked`;
          else if (
            !linked(before, applicationId) &&
            linked(after, applicationId)
          )
            label = `${name} linked`;
          else if (
            kind === "document_usage" &&
            before.retracted !== after.retracted
          )
            label = after.retracted
              ? "Submission record retracted"
              : "Submission record restored";
          else if (before.status !== after.status)
            label = `${name}: ${before.status} → ${after.status}`;
          else if (kind === "task" && before.done !== after.done)
            label = after.done ? "Task completed" : "Task reopened";
        }
        const changes = before
          ? Object.keys(after).filter(
              (k) =>
                JSON.stringify(before[k]) !== JSON.stringify(after[k]) &&
                ![
                  "notes",
                  "applicationIds",
                  "applicationId",
                  "pairKey",
                  "targetId",
                  "targetVersion",
                  "provenance",
                  "undo",
                  "lockSnapshots",
                  "clockSnapshots",
                  "beforeApplication",
                  "sourceSignature",
                ].includes(k),
            )
          : [];
        return (
          <article key={e.id}>
            <span className="timeline-dot" />
            <div className="timeline-kind">{name}</div>
            <strong>{label}</strong>
            {kind !== "application" && (
              <p className="event-title">
                {after.title ||
                  after.name ||
                  (after.decision === "keep"
                    ? "Kept both applications"
                    : after.decision === "undone"
                      ? "Review undone"
                      : kind === "duplicate_review"
                        ? "Archived duplicate"
                        : after.field || "Recorded update")}
              </p>
            )}
            <small>
              {new Date(e.at).toLocaleString("en-US", { timeZone: timezone })} ·{" "}
              {e.actor === "csv import"
                ? "CSV import"
                : e.actor === "manual_bulk"
                  ? "Manual bulk edit"
                  : e.actor === "manual_merge"
                    ? "Manual merge"
                    : e.actor === "manual_merge_undo"
                      ? "Merge reversed"
                      : e.actor.startsWith("recruiting")
                        ? "Reviewed evidence / field protection"
                        : e.actor.startsWith("reminder")
                          ? "In-app reminder"
                          : "Manual"}
            </small>
            {kind === "listing_snapshot" && (
              <p>
                Captured: {after.capturedDate || "Unknown date"}
                {after.sourceUrl
                  ? ` · ${after.sourceUrl}`
                  : " · Source unknown"}
              </p>
            )}
            {kind === "document_usage" && (
              <p>
                {after.purpose} · Submitted {after.submittedDate} ·{" "}
                {after.retracted ? "Retracted record" : "Confirmed by you"}
              </p>
            )}
            {changes.map((k) => (
              <div className="event-change" key={k}>
                <span>{k.replace(/([A-Z])/g, " $1")}</span>
                <del>
                  {(typeof before[k] === "object" && before[k] !== null
                    ? JSON.stringify(before[k])
                    : String(before[k] ?? "Unknown")) || "Empty"}
                </del>
                <span>→</span>
                <span>
                  {(typeof after[k] === "object" && after[k] !== null
                    ? JSON.stringify(after[k])
                    : String(after[k] ?? "Unknown")) || "Empty"}
                </span>
              </div>
            ))}
            {before?.notes !== after.notes && (
              <div className="note-revision">
                {before?.notes && (
                  <details>
                    <summary>Previous note</summary>
                    <p className="notes">{before.notes}</p>
                  </details>
                )}
                {after.notes ? (
                  <p className="notes">{after.notes}</p>
                ) : before?.notes ? (
                  <p className="muted">Note cleared</p>
                ) : null}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
