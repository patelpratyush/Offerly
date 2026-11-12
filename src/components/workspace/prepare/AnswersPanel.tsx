import { useState } from "react";
import {
  Item,
  categoryLabels,
  sensitiveCategories,
  prepApi,
  newId,
  copyText,
  dateOnly,
} from "./prepareApi";

const provenances = [
  "Written by me",
  "Copied from an application form",
  "From my resume or documents",
  "Other",
];
type Form = {
  id?: string;
  version?: number;
  clientId: string;
  question: string;
  category: string;
  answer: string;
  characterLimit: string;
  provenance: string;
  provenanceNote: string;
  confirm: boolean;
  original?: Item;
};
const blank = (): Form => ({
  clientId: newId(),
  question: "",
  category: "experience",
  answer: "",
  characterLimit: "",
  provenance: "Written by me",
  provenanceNote: "",
  confirm: false,
});

export function AnswersPanel({
  answers,
  reload,
}: {
  answers: Item[];
  reload: () => Promise<void>;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = answers.filter((a) => !a.archived);
  const sensitive = form ? sensitiveCategories.includes(form.category) : false;
  const body = (a: Item, extra: Record<string, unknown> = {}) => ({
    clientId: a.clientId,
    question: a.question,
    category: a.category,
    answer: a.answer,
    characterLimit: a.characterLimit,
    provenance: a.provenance,
    provenanceNote: a.provenanceNote,
    confirmed: a.confirmed,
    archived: a.archived,
    version: a.version,
    ...extra,
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const changed = form.answer.trim() !== (form.original?.answer ?? "");
    const payload = {
      clientId: form.clientId,
      question: form.question,
      category: form.category,
      answer: form.answer,
      characterLimit: form.characterLimit ? Number(form.characterLimit) : null,
      provenance: form.provenance,
      provenanceNote: form.provenanceNote,
      confirmed: form.confirm && !!form.answer.trim(),
      confirmedValue:
        form.confirm && (changed || !form.original?.confirmed)
          ? form.answer.trim()
          : undefined,
    };
    run(async () => {
      if (form.id)
        await prepApi(`/prepare/answers/${form.id}`, "PUT", {
          ...payload,
          version: form.version,
        });
      else await prepApi("/prepare/answers", "POST", payload);
      setForm(null);
      setStatus("Answer saved.");
      await reload();
    });
  };
  const count = form ? [...form.answer].length : 0;
  const limit = form?.characterLimit ? Number(form.characterLimit) : 0;
  return (
    <div className="prepare-section">
      <div className="prepare-head">
        <div>
          <h2>Reusable answers</h2>
          <p>
            Answers you have approved for recurring questions. Offerly never
            fills an application form for you or guesses an answer. Work
            eligibility, sponsorship, salary, relocation and start-date answers
            are saved only when you confirm the exact value; leave them blank if
            you have not decided.
          </p>
        </div>
        <button className="primary" onClick={() => setForm(blank())}>
          Add answer
        </button>
      </div>
      <p className="prepare-status" role="status">
        {status}
      </p>
      {error && !form && (
        <p className="prepare-error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form
          className="prepare-form"
          onSubmit={save}
          aria-label="Answer editor"
        >
          <label>
            Question
            <input
              required
              maxLength={500}
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
            />
          </label>
          <label>
            Type
            <select
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value, confirm: false })
              }
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Answer
            <textarea
              rows={5}
              value={form.answer}
              aria-describedby="answer-count"
              onChange={(e) =>
                setForm({ ...form, answer: e.target.value, confirm: false })
              }
            />
          </label>
          <label>
            Character limit (optional)
            <input
              type="number"
              min={1}
              max={100000}
              value={form.characterLimit}
              onChange={(e) =>
                setForm({ ...form, characterLimit: e.target.value })
              }
            />
          </label>
          <p
            id="answer-count"
            className={
              limit && count > limit ? "prepare-error" : "prepare-hint"
            }
            aria-live="polite"
          >
            {count} characters{limit ? ` of ${limit}` : ""}
            {limit && count > limit ? ` · ${count - limit} over the limit` : ""}
          </p>
          <label>
            Where this came from
            <select
              value={form.provenance}
              onChange={(e) => setForm({ ...form, provenance: e.target.value })}
            >
              {provenances.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Source note (optional)
            <input
              maxLength={500}
              value={form.provenanceNote}
              onChange={(e) =>
                setForm({ ...form, provenanceNote: e.target.value })
              }
            />
          </label>
          <label className="checkbox-label wide">
            <input
              type="checkbox"
              checked={form.confirm}
              disabled={!form.answer.trim()}
              onChange={(e) => setForm({ ...form, confirm: e.target.checked })}
            />
            I confirm this exact answer is correct as of today
          </label>
          {sensitive && (
            <p className="prepare-hint wide">
              This is a sensitive answer. It can only be saved with your
              confirmation, or left blank until you decide.
            </p>
          )}
          {error && (
            <p className="prepare-error wide" role="alert">
              {error}
            </p>
          )}
          <div className="prepare-actions wide">
            <button className="primary" disabled={busy}>
              Save answer
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setForm(null);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {!visible.length && !form && (
        <p className="panel-copy">
          No saved answers yet. Add the answers you reuse most, such as a short
          experience summary or your work preferences.
        </p>
      )}
      <ul className="prepare-list">
        {visible.map((a) => (
          <li key={a.id} className="prepare-card">
            <div className="prepare-card-head">
              <strong>{a.question}</strong>
              <span className="badge">{categoryLabels[a.category]}</span>
            </div>
            {a.answer ? (
              <p className="prepare-text">{a.answer}</p>
            ) : (
              <p className="prepare-hint">
                Unanswered. This stays blank until you decide.
              </p>
            )}
            <p className="prepare-meta">
              {a.characterCount} characters
              {a.characterLimit ? ` of ${a.characterLimit}` : ""} ·{" "}
              {a.provenance}
              {a.provenanceNote ? ` (${a.provenanceNote})` : ""} ·{" "}
              {a.confirmed
                ? `Last confirmed ${dateOnly(a.lastConfirmedAt)}`
                : "Not confirmed"}
            </p>
            <div className="prepare-actions">
              <button
                className="secondary"
                onClick={() =>
                  setForm({
                    id: a.id,
                    version: a.version,
                    clientId: a.clientId || newId(),
                    question: a.question,
                    category: a.category,
                    answer: a.answer,
                    characterLimit: a.characterLimit
                      ? String(a.characterLimit)
                      : "",
                    provenance: a.provenance,
                    provenanceNote: a.provenanceNote,
                    confirm: a.confirmed,
                    original: a,
                  })
                }
              >
                Edit
              </button>
              {a.answer && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await prepApi(
                        `/prepare/answers/${a.id}`,
                        "PUT",
                        body(a, { confirmed: true, confirmedValue: a.answer }),
                      );
                      setStatus("Confirmed today.");
                      await reload();
                    })
                  }
                >
                  {a.confirmed ? "Re-confirm today" : "Confirm as correct"}
                </button>
              )}
              {a.answer && (
                <button
                  className="secondary"
                  onClick={async () =>
                    setStatus(
                      (await copyText(a.answer))
                        ? "Answer copied."
                        : "Copy failed. Select the text and copy it manually.",
                    )
                  }
                >
                  Copy
                </button>
              )}
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await prepApi(
                      `/prepare/answers/${a.id}`,
                      "PUT",
                      body(a, { archived: true }),
                    );
                    setStatus("Answer archived.");
                    await reload();
                  })
                }
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
