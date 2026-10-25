import { useRef, useState } from "react";
import { Download, Plus } from "lucide-react";

type Request = (path: string, method?: string, body?: any) => Promise<any>;
type Draft = {
  id?: string;
  version?: number;
  documentVersionId: string;
  submittedDate: string;
  purpose: string;
  notes: string;
  retracted: boolean;
};

export function SubmittedDocuments({
  applicationId,
  documents,
  usages,
  request,
  onChanged,
}: {
  applicationId: string;
  documents: any[];
  usages: any[];
  request: Request;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const items = usages.filter((item) => item.applicationId === applicationId);
  const change = (key: keyof Draft, value: string) =>
    setDraft((current) => current && { ...current, [key]: value });

  async function save(value: Draft, closeEditor: boolean) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let persisted = false;
    try {
      await request(
        "/records/document_usage" + (value.id ? "/" + value.id : ""),
        value.id ? "PUT" : "POST",
        { ...value, applicationId },
      );
      persisted = true;
      if (closeEditor) setDraft(null);
      await onChanged();
      setNotice(
        value.retracted
          ? "Submission record retracted. History retained."
          : "Submitted document saved.",
      );
    } catch (cause) {
      setError(
        persisted
          ? "Saved, but the workspace could not refresh. Reload to see the latest records."
          : cause instanceof Error
            ? cause.message
            : "Could not save submitted document.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="detail-section" aria-label="Submitted documents">
      <div className="section-head">
        <h2>Submitted documents</h2>
        <button
          type="button"
          className="text-button"
          disabled={busy || !!draft || !documents.length}
          onClick={() => {
            setError("");
            setNotice("");
            setDraft({
              documentVersionId: "",
              submittedDate: "",
              purpose: "Resume",
              notes: "",
              retracted: false,
            });
          }}
        >
          <Plus size={15} /> Record submission
        </button>
      </div>
      <p className="muted">
        Record the exact version you sent and its actual submission date.
        Linking a document does not mean it was submitted.
      </p>
      {!documents.length && (
        <p className="muted">
          Upload a document first, then record the version you submitted.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {draft && (
        <form
          className="form-fields"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft, true);
          }}
        >
          <h3>
            {draft.id
              ? "Correct submission record"
              : "Record submitted version"}
          </h3>
          <label>
            Exact document version
            <select
              required
              value={draft.documentVersionId}
              disabled={busy}
              onChange={(event) =>
                change("documentVersionId", event.target.value)
              }
            >
              <option value="">Choose a document version</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title} ·{" "}
                  {document.versionNumber
                    ? `v${document.versionNumber}`
                    : "Legacy version"}{" "}
                  · {document.createdAt?.slice(0, 10) || "Legacy upload"} ·{" "}
                  {document.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Actual submission date
            <input
              type="date"
              required
              value={draft.submittedDate}
              disabled={busy}
              onChange={(event) => change("submittedDate", event.target.value)}
            />
          </label>
          <label>
            Document purpose
            <select
              value={draft.purpose}
              disabled={busy}
              onChange={(event) => change("purpose", event.target.value)}
            >
              <option>Resume</option>
              <option>Cover letter</option>
              <option>Other</option>
            </select>
          </label>
          <label>
            Submission notes
            <textarea
              maxLength={10000}
              value={draft.notes}
              disabled={busy}
              onChange={(event) => change("notes", event.target.value)}
              placeholder="Where you sent it or why this record was corrected"
            />
          </label>
          <div className="section-head">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save submission"}
            </button>
          </div>
        </form>
      )}
      {!items.length && !draft && (
        <p className="muted">No submitted versions recorded.</p>
      )}
      {items.map((item) => (
        <article className="document-card" key={item.id}>
          <div className="section-head">
            <strong>
              {item.title} ·{" "}
              {item.documentVersionNumber
                ? `v${item.documentVersionNumber}`
                : "Legacy version"}
            </strong>
            {item.retracted && <span className="badge">Retracted</span>}
          </div>
          <p>
            {item.purpose} · Submitted {item.submittedDate}
          </p>
          {item.notes && <p className="notes">{item.notes}</p>}
          <details>
            <summary>Exact version evidence</summary>
            <p className="notes">Version ID: {item.documentVersionId}</p>
            <p className="notes" style={{ overflowWrap: "anywhere" }}>
              SHA-256: {item.documentHash}
            </p>
            {item.documentCreatedAt && <p>Uploaded {item.documentCreatedAt}</p>}
          </details>
          <div className="section-head">
            <a
              className="text-button"
              href={"/api/files/" + encodeURIComponent(item.fileId)}
              aria-label={`Download submitted ${item.title}`}
            >
              <Download size={15} /> Download exact version
            </a>
            <button
              type="button"
              className="text-button"
              disabled={busy || !!draft}
              onClick={() => {
                setError("");
                setNotice("");
                setDraft({
                  id: item.id,
                  version: item.version,
                  documentVersionId: item.documentVersionId,
                  submittedDate: item.submittedDate,
                  purpose: item.purpose,
                  notes: item.notes || "",
                  retracted: item.retracted,
                });
              }}
            >
              Correct
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy || !!draft}
              onClick={() =>
                void save({ ...item, retracted: !item.retracted }, false)
              }
            >
              {item.retracted ? "Restore" : "Retract"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
