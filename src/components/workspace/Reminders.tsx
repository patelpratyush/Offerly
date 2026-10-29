import { useRef, useState } from "react";

type Item = { id: string; [key: string]: any };
type Props = {
  applications: Item[];
  rounds: Item[];
  assessments: Item[];
  tasks: Item[];
  reminders: Item[];
  request: (path: string, method?: string, body?: any) => Promise<any>;
  onChanged: () => void | Promise<void>;
};
export function Reminders({
  applications,
  rounds,
  assessments,
  tasks,
  reminders,
  request,
  onChanged,
}: Props) {
  const [applicationId, setApplicationId] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [snoozes, setSnoozes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const retry = useRef<{ key: string; id: string } | null>(null);
  const sources = [
    ...applications
      .filter((item) => item.id === applicationId)
      .map((item) => ({
        ...item,
        sourceKind: "application",
        sourceTitle: "Application follow-up",
      })),
    ...[
      ["round", rounds],
      ["assessment", assessments],
      ["task", tasks],
    ].flatMap(([kind, values]) =>
      (values as Item[])
        .filter((item) => item.applicationId === applicationId)
        .map((item) => ({
          ...item,
          sourceKind: kind as string,
          sourceTitle: `${kind}: ${item.title}`,
        })),
    ),
  ];
  const mutate = async (path: string, body: any) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify({ path, body });
    if (retry.current?.key !== key)
      retry.current = { key, id: crypto.randomUUID() };
    let saved = false;
    try {
      await request(path, "POST", {
        ...body,
        operationId: retry.current.id,
      });
      saved = true;
      await onChanged();
      retry.current = null;
      return true;
    } catch (failure) {
      setError(
        saved
          ? "Saved, but refresh failed. Refresh before making another change."
          : failure instanceof Error
            ? failure.message
            : "Could not update reminder",
      );
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const active = reminders
    .filter((item) => ["scheduled", "due"].includes(item.state))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <section className="panel reminders-panel" aria-label="In-app reminders">
      <h2>In-app reminders</h2>
      <p className="muted">
        Date-only reminders become due on that date in your workspace timezone.
        They appear here; no email or push notification is sent.
      </p>
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Add reminder</summary>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const source = sources.find(
              (item) => `${item.sourceKind}:${item.id}` === selectedSource,
            );
            if (!source) {
              setError("Choose a reminder source");
              return;
            }
            if (
              await mutate("/reminders", {
                title,
                applicationId,
                sourceKind: source.sourceKind,
                sourceId: source.id,
                dueDate,
              })
            ) {
              setTitle("");
              setDueDate("");
            }
          }}
        >
          <fieldset disabled={busy} className="filter-grid">
            <legend>New reminder</legend>
            <label>
              Reminder title
              <input
                required
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Reminder application
              <select
                aria-label="Reminder application"
                required
                value={applicationId}
                onChange={(e) => {
                  setApplicationId(e.target.value);
                  setSelectedSource(`application:${e.target.value}`);
                }}
              >
                <option value="">Choose application</option>
                {applications.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.company} · {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reminder source
              <select
                aria-label="Reminder source"
                required
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
              >
                <option value="">Choose source</option>
                {sources.map((item) => (
                  <option
                    key={`${item.sourceKind}:${item.id}`}
                    value={`${item.sourceKind}:${item.id}`}
                  >
                    {item.sourceTitle}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reminder date
              <input
                required
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
            <button type="submit">Create reminder</button>
          </fieldset>
        </form>
      </details>
      {!active.length && <p className="muted">No active reminders.</p>}
      {active.map((item) => (
        <article key={item.id} className="detail-section">
          <h3>{item.title}</h3>
          <p>
            {item.state === "due" ? "Due" : "Scheduled"} · {item.dueDate} · date
            only
          </p>
          <p className="muted">
            {applications.find(
              (application) => application.id === item.applicationId,
            )?.company || "Application"}
          </p>
          <div className="merge-actions">
            <button
              disabled={busy}
              onClick={() =>
                mutate(`/reminders/${item.id}/action`, {
                  version: item.version,
                  action: "dismiss",
                })
              }
            >
              Dismiss {item.title}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                mutate(`/reminders/${item.id}/action`, {
                  version: item.version,
                  action: "cancel",
                })
              }
            >
              Cancel {item.title}
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(`/reminders/${item.id}/action`, {
                version: item.version,
                action: "snooze",
                dueDate: snoozes[item.id],
              });
            }}
          >
            <label>
              Snooze date for {item.title}
              <input
                type="date"
                required
                disabled={busy}
                value={snoozes[item.id] || ""}
                onChange={(e) =>
                  setSnoozes((values) => ({
                    ...values,
                    [item.id]: e.target.value,
                  }))
                }
              />
            </label>
            <button disabled={busy} type="submit">
              Snooze {item.title}
            </button>
          </form>
        </article>
      ))}
      <details>
        <summary>Reminder history</summary>
        {reminders
          .filter((item) => !["scheduled", "due"].includes(item.state))
          .map((item) => (
            <p key={item.id}>
              {item.title} · {item.state}
              {item.cancellationReason ? ` · ${item.cancellationReason}` : ""}
            </p>
          ))}
      </details>
    </section>
  );
}
