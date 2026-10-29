import { useState } from "react";
import {
  Upload,
  ArrowRight,
  Check,
  X,
  FileSpreadsheet,
  AlertCircle,
} from "lucide-react";
type Request = (path: string, method?: string, body?: any) => Promise<any>;
const labels: Record<string, string> = {
  company: "Company",
  title: "Role title",
  stage: "Stage",
  appliedDate: "Applied date",
  offerOutcome: "Offer outcome",
  offerReceivedDate: "Offer received date",
  offerDecisionDate: "Offer decision date",
  descriptionCapturedDate: "Listing captured date",
  descriptionSourceUrl: "Listing source URL",
  location: "Location",
  source: "Source",
  requisition: "Requisition ID",
  url: "Job URL",
  priority: "Priority",
  owner: "Next response",
  workArrangement: "Work arrangement",
  employmentType: "Employment type",
  compensationMin: "Compensation minimum",
  compensationMax: "Compensation maximum",
  compensationCurrency: "Compensation currency",
  compensationPeriod: "Compensation period",
  compensationBasis: "Compensation basis",
  notes: "Notes",
  description: "Job description",
  archived: "Archived",
};
// The preview API retains its error contract. Present schema issues as field guidance.
function rowErrorMessages(error: string, dateFormat: string): string[] {
  try {
    const issues = JSON.parse(error);
    if (!Array.isArray(issues)) return [error];
    const dateExample =
      dateFormat === "MDY"
        ? "MM/DD/YYYY"
        : dateFormat === "DMY"
          ? "DD/MM/YYYY"
          : "YYYY-MM-DD";
    return [
      ...new Set<string>(
        issues.map((issue: any) => {
          const key = String(issue.path?.[0] || "");
          const label = labels[key] || "Row";
          if (/date$/i.test(key))
            return `${label}: enter a valid date using ${dateExample}, or leave it blank if unknown.`;
          if (issue.code === "invalid_type") return `${label}: enter a value.`;
          if (issue.code === "invalid_value")
            return `${label}: use a supported value. Check the column mapping.`;
          if (issue.code === "invalid_format") {
            if (issue.format === "url")
              return `${label}: enter a full URL, starting with https:// or http://.`;
            if (key === "compensationCurrency")
              return `${label}: use a three-letter code, such as USD.`;
            if (["compensationMin", "compensationMax"].includes(key))
              return `${label}: enter an amount such as 90000 or 90000.50.`;
            return `${label}: check this value and the column mapping.`;
          }
          if (issue.code === "too_small")
            return `${label}: enter a value that meets the minimum length.`;
          if (issue.code === "too_big")
            return `${label}: shorten this value or check its allowed range.`;
          return `${label}: ${typeof issue.message === "string" ? issue.message : "check this value."}`;
        }),
      ),
    ];
  } catch {
    return [error];
  }
}
export function ImportDialog({
  request,
  onClose,
  onComplete,
}: {
  request: Request;
  onClose: () => void;
  onComplete: (result: any) => void;
}) {
  const [csv, setCsv] = useState(""),
    [columns, setColumns] = useState<any>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [format, setFormat] = useState("ISO"),
    [preview, setPreview] = useState<any>(null),
    [decisions, setDecisions] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filename, setFilename] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const step = preview ? 3 : columns ? 2 : 1;
  return (
    <div className="overlay modal-overlay">
      <section
        className="modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import applications"
      >
        <div className="section-head">
          <div>
            <span className="eyebrow">BRING YOUR SEARCH WITH YOU</span>
            <h2>Import your applications</h2>
          </div>
          <button aria-label="Close import" disabled={busy} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="wizard-steps">
          {["Choose file", "Match columns", "Review & import"].map(
            (title, i) => (
              <div
                key={title}
                className={
                  step === i + 1 ? "current" : step > i + 1 ? "complete" : ""
                }
              >
                <span>{step > i + 1 ? <Check size={13} /> : i + 1}</span>
                {title}
              </div>
            ),
          )}
        </div>
        {!columns ? (
          <label className="upload-zone">
            <FileSpreadsheet size={34} />
            <strong>A fresh start for your spreadsheet</strong>
            <span>Choose a CSV file · up to 1,000 rows / 2 MB</span>
            <input
              aria-label="Choose CSV"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  run(async () => {
                    if (f.size > 2000000)
                      throw new Error("Choose a file smaller than 2 MB");
                    const text = await f.text();
                    const info = await request("/import/columns", "POST", {
                      csv: text,
                    });
                    setCsv(text);
                    setFilename(f.name);
                    setColumns(info);
                    setMapping(
                      Object.fromEntries(
                        info.fields.map((field: string) => [
                          field,
                          info.headers.find(
                            (h: string) =>
                              h.toLowerCase() === field.toLowerCase(),
                          ) || "",
                        ]),
                      ),
                    );
                  });
              }}
            />
          </label>
        ) : (
          <>
            <div className="file-summary">
              <FileSpreadsheet size={21} />
              <div>
                <strong>{filename}</strong>
                <small>
                  {columns.count} rows · {columns.headers.length} columns
                </small>
              </div>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setColumns(null);
                  setPreview(null);
                  setError("");
                }}
              >
                Change file
              </button>
            </div>
            {!preview ? (
              <>
                <p className="muted">
                  Match your spreadsheet columns. Blank optional fields stay
                  unknown.
                </p>
                <div className="mapping-grid">
                  {columns.fields.map((field: string) => (
                    <label key={field}>
                      {labels[field]}
                      {["company", "title"].includes(field) ? " *" : ""}
                      <select
                        aria-label={`Map ${labels[field]}`}
                        value={mapping[field] || ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [field]: e.target.value })
                        }
                      >
                        <option value="">
                          {["company", "title"].includes(field)
                            ? "Choose a column"
                            : "Not included"}
                        </option>
                        {columns.headers.map((h: string) => (
                          <option key={h}>{h}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <label className="date-format">
                  Date format
                  <select
                    aria-label="CSV date format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="ISO">YYYY-MM-DD</option>
                    <option value="MDY">MM/DD/YYYY</option>
                    <option value="DMY">DD/MM/YYYY</option>
                  </select>
                </label>
                <p className="helper-text">
                  Dates are date-only. No timezone conversion or guessed
                  month/day order.
                </p>
              </>
            ) : (
              <>
                <div className="review-summary">
                  <strong>
                    {preview.rows.filter((r: any) => !r.error).length} valid
                  </strong>
                  <span>
                    {preview.rows.filter((r: any) => r.duplicate).length}{" "}
                    possible duplicates
                  </span>
                  <span>
                    {preview.rows.filter((r: any) => r.error).length} invalid
                  </span>
                </div>
                <div className="import-rows">
                  {preview.rows.map((row: any) => (
                    <div
                      key={row.row}
                      className={"import-row " + (row.error ? "invalid" : "")}
                    >
                      <span className="row-number">{row.row}</span>
                      <div>
                        {row.error ? (
                          <>
                            <strong>Cannot import this row</strong>
                            <ul className="row-errors">
                              {rowErrorMessages(row.error, format).map(
                                (message) => (
                                  <li key={message}>{message}</li>
                                ),
                              )}
                            </ul>
                            <small>
                              Fix this row in your CSV, then choose Change file.
                              Valid rows can still be imported.
                            </small>
                          </>
                        ) : (
                          <>
                            <strong>{row.data.title}</strong>
                            <small>
                              {row.data.company} · {row.data.stage} ·{" "}
                              {row.data.appliedDate || "Date unknown"}
                            </small>
                            {row.duplicate && (
                              <span className="duplicate-reason">
                                <AlertCircle size={12} />
                                {row.reason}
                                {row.matchId?.startsWith("row-")
                                  ? ` (CSV ${row.matchId.replace("-", " ")})`
                                  : ""}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {!row.error && (
                        <select
                          aria-label={`Decision for row ${row.row}`}
                          value={decisions[row.row]}
                          disabled={busy}
                          onChange={(e) =>
                            setDecisions({
                              ...decisions,
                              [row.row]: e.target.value,
                            })
                          }
                        >
                          <option value="skip">Skip row</option>
                          {row.duplicate ? (
                            <option value="keep">
                              Keep as separate application
                            </option>
                          ) : (
                            <option value="import">Import</option>
                          )}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
                <p className="helper-text">
                  Possible duplicates default to Skip. Choose Keep only for a
                  distinct application. Existing records are never overwritten.
                </p>
              </>
            )}
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button
            className="secondary"
            disabled={busy}
            onClick={
              preview
                ? () => {
                    setPreview(null);
                    setError("");
                  }
                : onClose
            }
          >
            {preview ? "Back to mapping" : "Cancel"}
          </button>
          {columns && !preview && (
            <button
              className="primary"
              disabled={busy || !mapping.company || !mapping.title}
              onClick={() =>
                run(async () => {
                  const result = await request("/import/preview", "POST", {
                    csv,
                    mapping,
                    dateFormat: format,
                  });
                  setPreview(result);
                  setDecisions(
                    Object.fromEntries(
                      result.rows
                        .filter((r: any) => !r.error)
                        .map((r: any) => [
                          r.row,
                          r.duplicate ? "skip" : "import",
                        ]),
                    ),
                  );
                })
              }
            >
              {busy ? "Preparing…" : "Preview import"}
              <ArrowRight size={16} />
            </button>
          )}
          {preview && (
            <button
              className="primary"
              disabled={
                busy || !Object.values(decisions).some((d) => d !== "skip")
              }
              onClick={() =>
                run(async () =>
                  onComplete(
                    await request("/import/commit", "POST", {
                      id: preview.id,
                      decisions,
                    }),
                  ),
                )
              }
            >
              <Upload size={16} />
              {busy
                ? "Importing…"
                : `Import ${Object.values(decisions).filter((d) => d !== "skip").length} applications`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
