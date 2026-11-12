import { useMemo, useState } from "react";
import { analyzeCoverage } from "../../../lib/coverage";
import {
  Item,
  appLabel,
  prepApi,
  prepBlob,
  saveBlob,
  newId,
} from "./prepareApi";

const statusText = {
  found: "Words found in your text",
  partial: "Partly found",
  gap: "Gap: not found",
} as const;

export function TailorPanel({
  applications,
  documents,
  tailored,
  reload,
}: {
  applications: Item[];
  documents: Item[];
  tailored: Item[];
  reload: () => Promise<void>;
}) {
  const [applicationId, setApplicationId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(newId());
  const [saveFormat, setSaveFormat] = useState<"docx" | "pdf">("docx");
  const application = applications.find((a) => a.id === applicationId);
  const description: string = application?.description || "";
  const version = documents.find((d) => d.id === documentId);
  const coverage = useMemo(
    () => (text && description ? analyzeCoverage(text, description) : null),
    [text, description],
  );
  const changed = !!text.trim() && text.trim() !== source.trim();
  const gaps = (coverage?.requirements || [])
    .filter((r) => r.status !== "found")
    .map((r) => r.text);
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
  const load = () =>
    run(async () => {
      const result = await prepApi(`/prepare/document-text/${documentId}`);
      if (!result.available) {
        setNotice(result.reason);
        return;
      }
      setSource(result.text);
      setText(result.text);
      setReviewed(false);
      setClientId(newId());
      setNotice(result.notice);
    });
  const label = `${version?.title || "resume"}`;
  const siblings = tailored.filter((t) => t.applicationId === applicationId);
  return (
    <div className="prepare-section">
      <div className="prepare-head">
        <div>
          <h2>Tailor a resume</h2>
          <p>
            Compare a resume version with the job description you saved, see
            which requirement words are missing, then edit the text yourself.
            Offerly does not write or rewrite resume content, and the match is a
            plain word comparison: it is not an ATS score and does not predict
            interviews. Add only what is true for you.
          </p>
        </div>
      </div>
      <div className="prepare-form">
        <label>
          Application
          <select
            value={applicationId}
            onChange={(e) => {
              setApplicationId(e.target.value);
              setStatus("");
            }}
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
          Resume version
          <select
            value={documentId}
            onChange={(e) => {
              setDocumentId(e.target.value);
              setSource("");
              setText("");
              setNotice("");
            }}
          >
            <option value="">Choose a version…</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · v{d.versionNumber || 1} · {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="prepare-actions wide">
          <button
            className="secondary"
            disabled={!documentId || busy}
            onClick={load}
            type="button"
          >
            Load text from this version
          </button>
          <span className="prepare-hint">
            Text can be read from DOCX versions and simple text-based PDFs.
            Scanned or custom-font PDFs are not supported: paste the text below
            instead.
          </span>
        </div>
        {notice && (
          <p className="prepare-hint wide" role="status">
            {notice}
          </p>
        )}
      </div>
      {applicationId && !description && (
        <p className="prepare-error" role="status">
          This application has no saved job description, so there is nothing to
          compare against. Add the description to the application first.
        </p>
      )}
      <div className="prepare-compare">
        <label>
          Source text (loaded or pasted baseline)
          <textarea
            rows={14}
            value={source}
            placeholder="Load a DOCX or text-based PDF version, or paste text here, then edit the right-hand copy."
            onChange={(e) => {
              setSource(e.target.value);
              setText(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label>
          Your edited text
          <textarea
            rows={14}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <div className="prepare-jd">
          <strong>Saved job description</strong>
          {application?.descriptionCapturedDate && (
            <small>Captured {application.descriptionCapturedDate}</small>
          )}
          <pre>{description || "None saved."}</pre>
        </div>
      </div>
      {coverage && (
        <section aria-label="Requirement coverage" className="prepare-coverage">
          <h3>Requirement coverage</h3>
          <p className="prepare-meta" role="status">
            {coverage.counts.found} found · {coverage.counts.partial} partial ·{" "}
            {coverage.counts.gap} gaps, in your current text. This compares
            words only; finding a word does not prove the experience, and a gap
            is not a reason to claim something untrue. Learning gaps belong in
            your own notes, not in your resume.
          </p>
          <ul className="prepare-list">
            {coverage.requirements.map((r) => (
              <li key={r.text} className={`prepare-card coverage-${r.status}`}>
                <span className="badge">{statusText[r.status]}</span>
                <p>{r.text}</p>
                {!!r.missing.length && (
                  <p className="prepare-meta">
                    Not found: {r.missing.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <h3>Top job-description terms</h3>
          <ul className="prepare-chips">
            {coverage.keywords.map((k) => (
              <li key={k.term} className={k.found ? "found" : "missing"}>
                {k.term} ({k.count}) ·{" "}
                {k.found ? "in your text" : "not in your text"}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="prepare-form">
        <label className="checkbox-label wide">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={!changed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I reviewed this text and every statement in it is accurate
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
          <label>
            Saved version format
            <select
              value={saveFormat}
              onChange={(e) => setSaveFormat(e.target.value as "docx" | "pdf")}
            >
              <option value="docx">DOCX</option>
              <option value="pdf">PDF (plain text)</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={
              !changed || !reviewed || !applicationId || !documentId || busy
            }
            onClick={() =>
              run(async () => {
                await prepApi("/prepare/tailored", "POST", {
                  clientId,
                  applicationId,
                  baseDocumentId: documentId,
                  text,
                  gaps,
                  format: saveFormat,
                });
                setClientId(newId());
                setReviewed(false);
                setStatus(
                  "Saved as a new document version labeled “Tailored (edited text)”. Earlier versions, including any you submitted, are unchanged. Find it under Documents.",
                );
                await reload();
              })
            }
          >
            Save as new version
          </button>
          <button
            className="secondary"
            disabled={!text.trim() || busy}
            onClick={() =>
              run(async () => {
                saveBlob(
                  await prepBlob("/prepare/export", { text, name: label }),
                  `${label} - tailored.docx`,
                );
              })
            }
          >
            Download .docx
          </button>
          <button
            className="secondary"
            disabled={!text.trim() || busy}
            onClick={() =>
              run(async () => {
                saveBlob(
                  await prepBlob("/prepare/export", {
                    text,
                    name: label,
                    format: "pdf",
                  }),
                  `${label} - tailored.pdf`,
                );
              })
            }
          >
            Download .pdf
          </button>
          <button
            className="secondary"
            disabled={!text.trim()}
            onClick={() =>
              saveBlob(
                new Blob([text], { type: "text/plain;charset=utf-8" }),
                `${label} - tailored.txt`,
              )
            }
          >
            Download .txt
          </button>
        </div>
        <p className="prepare-hint wide">
          DOCX, PDF and plain text are plain, unformatted exports of exactly
          this text (the PDF is a simple one-font layout; characters outside
          Latin-1 appear as “?”). Formatting-preserving export is not available.
        </p>
      </div>
      {!!siblings.length && (
        <>
          <h3>Tailored versions saved for this application</h3>
          <ul className="prepare-list">
            {siblings.map((t) => {
              const doc = documents.find((d) => d.id === t.documentVersionId);
              return (
                <li className="prepare-card" key={t.id}>
                  <strong>
                    {doc?.title} · v{doc?.versionNumber}
                  </strong>
                  <p className="prepare-meta">
                    {t.origin} Based on version{" "}
                    {documents.find((d) => d.id === t.baseDocumentVersionId)
                      ?.versionNumber || "?"}
                    . {t.gaps?.length || 0} requirement gaps were open when
                    saved.
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
