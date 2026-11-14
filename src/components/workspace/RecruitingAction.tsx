import { useState } from "react";
type Item = { id: string; version: number; [key: string]: any };
export function RecruitingAction({
  review,
  rounds,
  tasks,
  assessments,
  busy,
  submit,
}: {
  review: Item;
  rounds: Item[];
  tasks: Item[];
  assessments: Item[];
  busy: boolean;
  submit: (payload: any) => Promise<void>;
}) {
  const [kind, setKind] = useState("task"),
    [targetId, setTargetId] = useState(""),
    [override, setOverride] = useState(false),
    [title, setTitle] = useState(""),
    [date, setDate] = useState(""),
    [time, setTime] = useState(""),
    [timezone, setTimezone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [status, setStatus] = useState("Not started");
  const targets = (
    kind === "round" ? rounds : kind === "assessment" ? assessments : tasks
  ).filter((item) => item.applicationId === review.applicationId);
  const target = targets.find((item) => item.id === targetId);
  return (
    <details className="wire-action">
      <summary>Add or update a follow-up action</summary>
      <p>
        Check dates against the source. The message received time is not an
        interview time or deadline. Updating a canceled or rescheduled event
        updates its existing reminders. To add a new reminder, use Today after
        saving this action.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit({
            version: review.version,
            kind,
            ...(override ? { override: true } : {}),
            ...(target
              ? { targetId: target.id, targetVersion: target.version }
              : {}),
            data: {
              title,
              applicationId: review.applicationId,
              ...(kind === "round"
                ? {
                    status,
                    date,
                    time,
                    timezone,
                    url: target?.url || "",
                    notes: target?.notes || "",
                  }
                : kind === "assessment"
                  ? {
                      status,
                      due: date,
                      completedDate: status === "Completed" ? date : "",
                      score: target?.score || "",
                      url: target?.url || "",
                      notes: target?.notes || "",
                    }
                  : { due: date, done: status === "Completed" }),
            },
          });
        }}
      >
        <label>
          Action type
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setTargetId("");
              setStatus(e.target.value === "round" ? "Invited" : "Not started");
            }}
          >
            <option value="task">Task</option>
            <option value="round">Interview round</option>
            <option value="assessment">Assessment</option>
          </select>
        </label>
        <label>
          Existing action
          <select
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value);
              const item = targets.find((item) => item.id === e.target.value);
              if (item) {
                setTitle(item.title);
                setDate(item.date || item.due || "");
                setTime(item.time || "");
                setTimezone(item.timezone || timezone);
                setStatus(
                  item.status || (item.done ? "Completed" : "Not started"),
                );
              }
            }}
          >
            <option value="">Create new action</option>
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Action status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {(kind === "round"
              ? ["Invited", "Scheduled", "Completed", "Canceled", "Rescheduled"]
              : kind === "assessment"
                ? ["Not started", "In progress", "Completed", "Canceled"]
                : ["Not started", "Completed"]
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Confirmed date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required={
              kind === "round" && ["Scheduled", "Rescheduled"].includes(status)
            }
          />
        </label>
        {kind === "round" && (
          <>
            <label>
              Confirmed time
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <label>
              Event timezone
              <input
                required
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </label>
          </>
        )}
        <label>
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
          />{" "}
          Override older event evidence
        </label>
        <button disabled={busy}>Save reviewed action</button>
      </form>
    </details>
  );
}
