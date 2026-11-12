import { useEffect, useState } from "react";
import { Item, appLabel, roundLabel, prepApi, newId } from "./prepareApi";

type Person = { name: string; role: string; contactId: string };
type Question = { question: string; myNotes: string };
type Form = {
  roleDescriptionUrl: string;
  roleDescriptionNote: string;
  people: Person[];
  logistics: { format: string; location: string; link: string; notes: string };
  notes: string;
  projectExamples: string;
  practiceQuestions: Question[];
  postInterviewNotes: string;
};
const empty = (): Form => ({
  roleDescriptionUrl: "",
  roleDescriptionNote: "",
  people: [],
  logistics: { format: "", location: "", link: "", notes: "" },
  notes: "",
  projectExamples: "",
  practiceQuestions: [],
  postInterviewNotes: "",
});
const fromRecord = (p: Item): Form => ({
  roleDescriptionUrl: p.roleDescriptionUrl || "",
  roleDescriptionNote: p.roleDescriptionNote || "",
  people: p.people || [],
  logistics: { ...empty().logistics, ...(p.logistics || {}) },
  notes: p.notes || "",
  projectExamples: p.projectExamples || "",
  practiceQuestions: p.practiceQuestions || [],
  postInterviewNotes: p.postInterviewNotes || "",
});

export function InterviewPrepPanel({
  preps,
  applications,
  contacts,
  rounds,
  reload,
  onDraftThanks,
}: {
  preps: Item[];
  applications: Item[];
  contacts: Item[];
  rounds: Item[];
  reload: () => Promise<void>;
  onDraftThanks: (round: Item, contactIds: string[]) => void;
}) {
  const [roundId, setRoundId] = useState("");
  const round = rounds.find((r) => r.id === roundId);
  const application = applications.find((a) => a.id === round?.applicationId);
  const prep = preps.find((p) => p.roundId === roundId && !p.archived);
  const [form, setForm] = useState<Form>(empty());
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(newId());
  useEffect(() => {
    setForm(prep ? fromRecord(prep) : empty());
    setClientId(newId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, prep?.id, prep?.version]);
  useEffect(() => {
    setError("");
    setStatus("");
  }, [roundId]);
  const sorted = [...rounds].sort((a, b) =>
    (b.date || "").localeCompare(a.date || ""),
  );
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!round) return;
    setBusy(true);
    setError("");
    setStatus("");
    const payload = {
      ...form,
      applicationId: round.applicationId,
      roundId: round.id,
    };
    try {
      if (prep)
        await prepApi(`/prepare/preps/${prep.id}`, "PUT", {
          ...payload,
          version: prep.version,
        });
      else await prepApi("/prepare/preps", "POST", { ...payload, clientId });
      setStatus("Preparation saved.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  return (
    <div className="prepare-section">
      <div className="prepare-head">
        <div>
          <h2>Interview preparation</h2>
          <p>
            One page per interview round for your own notes. Preparation is not
            the employer&apos;s live or take-home assessment, which you track
            under the application&apos;s assessments.
          </p>
        </div>
      </div>
      {!rounds.length ? (
        <p className="panel-copy">
          No interview rounds yet. Add a round to an application, then prepare
          for it here.
        </p>
      ) : (
        <label className="prepare-picker">
          Interview round
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            <option value="">Choose a round…</option>
            {sorted.map((r) => (
              <option key={r.id} value={r.id}>
                {appLabel(applications.find((a) => a.id === r.applicationId))} —{" "}
                {roundLabel(r)}
              </option>
            ))}
          </select>
        </label>
      )}
      {round && application && (
        <form
          className="prepare-form"
          onSubmit={save}
          aria-label="Interview preparation"
        >
          <p className="prepare-meta wide">
            {appLabel(application)} · {round.title} ·{" "}
            {round.date ? `${round.date} ${round.time || ""}` : "No date saved"}{" "}
            · {round.status}
            {prep ? "" : " · No preparation saved yet"}
          </p>
          <fieldset className="wide">
            <legend>Role description</legend>
            <label>
              Link to the role description
              <input
                type="url"
                value={form.roleDescriptionUrl}
                placeholder={application.url || "https://"}
                onChange={(e) => set("roleDescriptionUrl", e.target.value)}
              />
            </label>
            <label>
              Your notes on the role
              <textarea
                rows={3}
                value={form.roleDescriptionNote}
                onChange={(e) => set("roleDescriptionNote", e.target.value)}
              />
            </label>
            {application.description ? (
              <details>
                <summary>
                  Saved job description
                  {application.descriptionCapturedDate
                    ? ` (captured ${application.descriptionCapturedDate})`
                    : " (capture date unknown)"}
                </summary>
                <p className="prepare-text">{application.description}</p>
              </details>
            ) : (
              <p className="prepare-hint">
                No job description is saved on this application.
              </p>
            )}
          </fieldset>
          <fieldset className="wide">
            <legend>People involved</legend>
            {form.people.map((person, index) => (
              <div className="prepare-row" key={index}>
                <label>
                  Name
                  <input
                    required
                    value={person.name}
                    onChange={(e) =>
                      set(
                        "people",
                        form.people.map((p, i) =>
                          i === index ? { ...p, name: e.target.value } : p,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Role
                  <input
                    value={person.role}
                    onChange={(e) =>
                      set(
                        "people",
                        form.people.map((p, i) =>
                          i === index ? { ...p, role: e.target.value } : p,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Saved connection
                  <select
                    value={person.contactId}
                    onChange={(e) =>
                      set(
                        "people",
                        form.people.map((p, i) =>
                          i === index ? { ...p, contactId: e.target.value } : p,
                        ),
                      )
                    }
                  >
                    <option value="">Not linked</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Remove person ${person.name || index + 1}`}
                  onClick={() =>
                    set(
                      "people",
                      form.people.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={form.people.length >= 20}
              onClick={() =>
                set("people", [
                  ...form.people,
                  { name: "", role: "", contactId: "" },
                ])
              }
            >
              Add person
            </button>
          </fieldset>
          <fieldset className="wide">
            <legend>Logistics</legend>
            <label>
              Format
              <input
                value={form.logistics.format}
                placeholder="Video, phone, on-site…"
                onChange={(e) =>
                  set("logistics", {
                    ...form.logistics,
                    format: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Location
              <input
                value={form.logistics.location}
                onChange={(e) =>
                  set("logistics", {
                    ...form.logistics,
                    location: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Meeting link
              <input
                type="url"
                value={form.logistics.link}
                placeholder={round.url || "https://"}
                onChange={(e) =>
                  set("logistics", { ...form.logistics, link: e.target.value })
                }
              />
            </label>
            <label>
              Other logistics
              <textarea
                rows={2}
                value={form.logistics.notes}
                onChange={(e) =>
                  set("logistics", { ...form.logistics, notes: e.target.value })
                }
              />
            </label>
          </fieldset>
          <label className="wide">
            Your preparation notes
            <textarea
              rows={4}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>
          <label className="wide">
            Project examples to discuss
            <textarea
              rows={3}
              value={form.projectExamples}
              onChange={(e) => set("projectExamples", e.target.value)}
            />
          </label>
          <fieldset className="wide">
            <legend>Practice questions (written by you)</legend>
            {form.practiceQuestions.map((q, index) => (
              <div className="prepare-row" key={index}>
                <label>
                  Question
                  <input
                    required
                    value={q.question}
                    onChange={(e) =>
                      set(
                        "practiceQuestions",
                        form.practiceQuestions.map((x, i) =>
                          i === index ? { ...x, question: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  My notes
                  <input
                    value={q.myNotes}
                    onChange={(e) =>
                      set(
                        "practiceQuestions",
                        form.practiceQuestions.map((x, i) =>
                          i === index ? { ...x, myNotes: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Remove question ${index + 1}`}
                  onClick={() =>
                    set(
                      "practiceQuestions",
                      form.practiceQuestions.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={form.practiceQuestions.length >= 50}
              onClick={() =>
                set("practiceQuestions", [
                  ...form.practiceQuestions,
                  { question: "", myNotes: "" },
                ])
              }
            >
              Add practice question
            </button>
          </fieldset>
          <label className="wide">
            Post-interview notes
            <textarea
              rows={4}
              value={form.postInterviewNotes}
              onChange={(e) => set("postInterviewNotes", e.target.value)}
            />
          </label>
          {error && (
            <p className="prepare-error wide" role="alert">
              {error}
            </p>
          )}
          <p className="prepare-status wide" role="status">
            {status}
            {prep ? ` Last saved version ${prep.version}.` : ""}
          </p>
          <div className="prepare-actions wide">
            <button className="primary" disabled={busy}>
              Save preparation
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                onDraftThanks(
                  round,
                  form.people
                    .map((p) => p.contactId)
                    .filter((id, i, all) => id && all.indexOf(id) === i),
                )
              }
            >
              Draft a thank-you (manual template)
            </button>
          </div>
          {prep && (
            <p className="prepare-meta wide">
              Saving replaces this page&apos;s content; earlier edits are kept
              in your workspace change history.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
