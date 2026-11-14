import { useEffect, useState } from "react";
import { Item, appLabel, prepApi, newId, copyText } from "./prepareApi";
import type { DraftSeed } from "./PrepareHub";

const templateLabels: Record<string, string> = {
  follow_up: "Follow-up",
  thank_you: "Thank-you",
  availability: "Availability reply",
  referral: "Referral request",
  deadline_extension: "Deadline extension",
};
const toneLabels: Record<string, string> = {
  standard: "Standard",
  concise: "Concise",
  warm: "Warm",
  formal: "Formal",
};
const placeholderPattern = /\[\[[^\]\n]{1,200}\]\]/g;
const findPlaceholders = (...parts: string[]) => [
  ...new Set(parts.join("\n").match(placeholderPattern) || []),
];
type Form = {
  id?: string;
  version?: number;
  clientId: string;
  template: string;
  tone: string;
  applicationId: string;
  roundId: string;
  contactIds: string[];
  subject: string;
  body: string;
  state: "draft" | "ready";
  generated: boolean;
};
const blank = (): Form => ({
  clientId: newId(),
  template: "follow_up",
  tone: "standard",
  applicationId: "",
  roundId: "",
  contactIds: [],
  subject: "",
  body: "",
  state: "draft",
  generated: false,
});

// A plain mailto: link opens the user's own mail app with fields prefilled.
// Offerly never transmits the message and cannot know whether it was sent.
export function mailtoLink(to: string[], subject: string, body: string) {
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, "\r\n"))}`;
  return `mailto:${to.map(encodeURIComponent).join(",")}?${query}`;
}

export function DraftsPanel({
  drafts,
  applications,
  contacts,
  rounds,
  seed,
  reload,
}: {
  drafts: Item[];
  applications: Item[];
  contacts: Item[];
  rounds: Item[];
  seed: DraftSeed | null;
  reload: () => Promise<void>;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const generate = async (f: Form) => {
    setBusy(true);
    setError("");
    try {
      const result = await prepApi("/prepare/drafts/generate", "POST", {
        template: f.template,
        tone: f.tone,
        applicationId: f.applicationId,
        roundId: f.roundId,
        contactIds: f.contactIds,
      });
      setForm({
        ...f,
        subject: result.subject,
        body: result.body,
        generated: true,
      });
      setNotes(result.notes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!seed) return;
    const f = {
      ...blank(),
      template: seed.template,
      applicationId: seed.applicationId,
      roundId: seed.roundId,
      contactIds: seed.contactIds,
    };
    setForm(f);
    setNotes([]);
    generate(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.key]);
  const byId = (id: string) => contacts.find((c) => c.id === id);
  const recipients = (form?.contactIds || [])
    .map(byId)
    .filter(Boolean) as Item[];
  const addressable = recipients.filter((c) => c.email);
  const open = form ? findPlaceholders(form.subject, form.body) : [];
  const application = applications.find((a) => a.id === form?.applicationId);
  const appRounds = rounds.filter(
    (r) => r.applicationId === form?.applicationId,
  );
  const linked = contacts.filter((c) =>
    (c.applicationIds || []).includes(form?.applicationId),
  );
  const others = contacts.filter((c) => !linked.includes(c));
  const canMail =
    !!form && open.length === 0 && addressable.length > 0 && !!form.body;
  const fullText = form
    ? `To: ${recipients.map((c) => (c.email ? `${c.name} <${c.email}>` : c.name)).join(", ")}\nSubject: ${form.subject}\n\n${form.body}`
    : "";
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    setStatus("");
    const payload = {
      clientId: form.clientId,
      template: form.template,
      applicationId: form.applicationId,
      roundId: form.roundId,
      contactIds: form.contactIds,
      subject: form.subject,
      body: form.body,
      state: form.state,
    };
    try {
      const saved = form.id
        ? await prepApi(`/prepare/drafts/${form.id}`, "PUT", {
            ...payload,
            version: form.version,
          })
        : await prepApi("/prepare/drafts", "POST", payload);
      setForm({ ...form, id: saved.id, version: saved.version });
      setStatus(`Draft saved as ${saved.state}.`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const visible = drafts.filter((d) => !d.archived);
  return (
    <div className="prepare-section">
      <div className="prepare-head">
        <div>
          <h2>Message drafts</h2>
          <p>
            Templates filled only from the application, people and round you
            select. Unknown facts appear as [[placeholders]] you must replace.
            Offerly cannot send messages: copy the text or open it in your own
            mail app, then send it yourself.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setForm(blank());
            setNotes([]);
            setStatus("");
            setError("");
          }}
        >
          New draft
        </button>
      </div>
      <p className="prepare-status" role="status">
        {!form ? status : ""}
      </p>
      {form && (
        <form
          className="prepare-form"
          onSubmit={save}
          aria-label="Message draft editor"
        >
          <label>
            Template
            <select
              value={form.template}
              onChange={(e) =>
                setForm({ ...form, template: e.target.value, generated: false })
              }
            >
              {Object.entries(templateLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tone
            <select
              value={form.tone}
              onChange={(e) =>
                setForm({ ...form, tone: e.target.value, generated: false })
              }
            >
              {Object.entries(toneLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Linked application
            <select
              required
              value={form.applicationId}
              disabled={!!form.id}
              onChange={(e) =>
                setForm({
                  ...form,
                  applicationId: e.target.value,
                  roundId: "",
                  generated: false,
                })
              }
            >
              <option value="">Choose an application…</option>
              {applications.map((a) => (
                <option key={a.id} value={a.id}>
                  {appLabel(a)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Interview round (optional)
            <select
              value={form.roundId}
              disabled={!form.applicationId}
              onChange={(e) =>
                setForm({ ...form, roundId: e.target.value, generated: false })
              }
            >
              <option value="">No round selected</option>
              {appRounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.date || "no date"} · {r.status}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="wide">
            <legend>Recipients</legend>
            {!contacts.length && (
              <p className="prepare-hint">
                No connections saved yet. Add a connection first.
              </p>
            )}
            {[...linked, ...others].map((c) => (
              <label className="checkbox-label" key={c.id}>
                <input
                  type="checkbox"
                  checked={form.contactIds.includes(c.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      generated: false,
                      contactIds: e.target.checked
                        ? [...form.contactIds, c.id]
                        : form.contactIds.filter((id) => id !== c.id),
                    })
                  }
                />
                {c.name} {c.email ? `<${c.email}>` : "(no email saved)"}
                {linked.includes(c) ? " · linked to this application" : ""}
              </label>
            ))}
          </fieldset>
          <div className="prepare-actions wide">
            <button
              type="button"
              className="secondary"
              disabled={busy || !form.applicationId}
              onClick={() => generate(form)}
            >
              {form.generated ? "Refill from template" : "Fill from template"}
            </button>
            <span className="prepare-hint">
              Tone only changes fixed wording; it never adds facts. Refilling
              replaces the subject and body below.
            </span>
          </div>
          {!!notes.length && (
            <ul className="prepare-notes wide" role="status">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className="prepare-summary wide" aria-label="Message summary">
            <p>
              <strong>To:</strong>{" "}
              {recipients.length
                ? recipients
                    .map((c) =>
                      c.email
                        ? `${c.name} <${c.email}>`
                        : `${c.name} (no email)`,
                    )
                    .join(", ")
                : "No recipients selected"}
            </p>
            <p>
              <strong>Linked application:</strong>{" "}
              {application ? appLabel(application) : "None selected"}
            </p>
          </div>
          <label className="wide">
            Subject
            <input
              required
              maxLength={300}
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </label>
          <label className="wide">
            Body
            <textarea
              rows={12}
              maxLength={10000}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          {!!open.length && (
            <div className="prepare-preview wide" aria-label="Open placeholders">
              <span className="prepare-code">TO FILL</span>
              <pre>
                {(form.subject + "\n\n" + form.body)
                  .split(/(\[\[[^\]\n]{1,200}\]\])/g)
                  .map((part, i) =>
                    i % 2 ? <mark key={i}>{part}</mark> : part,
                  )}
              </pre>
            </div>
          )}
          {!!open.length && (
            <p className="prepare-error wide" role="status">
              {open.length} placeholder{open.length === 1 ? "" : "s"} still to
              replace: {open.join(" ")}
            </p>
          )}
          <label>
            Status
            <select
              value={form.state}
              onChange={(e) =>
                setForm({ ...form, state: e.target.value as "draft" | "ready" })
              }
            >
              <option value="draft">Draft</option>
              <option value="ready">Ready (you reviewed it)</option>
            </select>
          </label>
          {error && (
            <p className="prepare-error wide" role="alert">
              {error}
            </p>
          )}
          <p className="prepare-status wide" role="status">
            {status}
          </p>
          <div className="prepare-actions wide">
            <button className="primary" disabled={busy || !form.applicationId}>
              Save draft
            </button>
            <button
              type="button"
              className="secondary"
              onClick={async () =>
                setStatus(
                  (await copyText(fullText))
                    ? "Copied to the clipboard."
                    : "Copy failed. Select the text and copy it manually.",
                )
              }
            >
              Copy message
            </button>
            {canMail ? (
              <a
                className="secondary prepare-link"
                href={mailtoLink(
                  addressable.map((c) => c.email),
                  form.subject,
                  form.body,
                )}
                onClick={() =>
                  setStatus(
                    "Opened your mail app. Offerly has not sent anything and cannot tell whether you do.",
                  )
                }
              >
                Open in my mail app
              </a>
            ) : (
              <button
                type="button"
                className="secondary"
                disabled
                aria-describedby="mail-reason"
              >
                Open in my mail app
              </button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setForm(null);
                setError("");
              }}
            >
              Close editor
            </button>
          </div>
          {!canMail && (
            <p id="mail-reason" className="prepare-hint wide">
              Opening a mail app needs at least one recipient with an email
              address and no remaining placeholders.
            </p>
          )}
          {form.body.length > 1800 && (
            <p className="prepare-hint wide">
              Long messages may be cut off by some mail apps. Use Copy message
              if the body looks truncated.
            </p>
          )}
        </form>
      )}
      {error && !form && (
        <p className="prepare-error" role="alert">
          {error}
        </p>
      )}
      <h3>Saved drafts</h3>
      {!visible.length && <p className="panel-copy">No saved drafts yet.</p>}
      <ul className="prepare-list">
        {visible.map((d) => (
          <li className="prepare-card" key={d.id}>
            <div className="prepare-card-head">
              <strong>{d.subject || templateLabels[d.template]}</strong>
              <span className="badge">
                {d.state === "ready" ? "Ready" : "Draft"}
              </span>
            </div>
            <p className="prepare-meta">
              {templateLabels[d.template]} ·{" "}
              {appLabel(applications.find((a) => a.id === d.applicationId))} ·
              To:{" "}
              {d.contactIds
                .map((id: string) => byId(id)?.name || "Unknown")
                .join(", ") || "no recipients"}
            </p>
            <div className="prepare-actions">
              <button
                className="secondary"
                onClick={() => {
                  setForm({
                    id: d.id,
                    version: d.version,
                    clientId: d.clientId || newId(),
                    template: d.template,
                    tone: "standard",
                    applicationId: d.applicationId,
                    roundId: d.roundId || "",
                    contactIds: d.contactIds,
                    subject: d.subject,
                    body: d.body,
                    state: d.state,
                    generated: false,
                  });
                  setNotes([]);
                  setStatus("");
                }}
              >
                Open
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await prepApi(`/prepare/drafts/${d.id}`, "PUT", {
                      ...d,
                      archived: true,
                      version: d.version,
                    });
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Archive
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
