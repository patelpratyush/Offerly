import { useState } from "react";
import { Item, prepApi, newId } from "./prepareApi";

const fields: [string, string][] = [
  ["name", "Name (required)"],
  ["email", "Email"],
  ["company", "Company"],
  ["role", "Role"],
  ["phone", "Phone"],
  ["linkedinUrl", "LinkedIn URL"],
  ["relationshipType", "Relationship type"],
  ["notes", "Notes"],
];
const statusLabels: Record<string, string> = {
  new: "New contact",
  invalid: "Invalid, will be skipped",
  duplicate: "Same verified email, will be skipped",
  already_imported: "Already imported, will be skipped",
  file_duplicate: "Repeated in this file, will be skipped",
};

export function ContactImportPanel({
  onChanged,
}: {
  onChanged: () => Promise<unknown>;
}) {
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<Record<string, string> | undefined>();
  const [preview, setPreview] = useState<any>(null);
  const [operationId, setOperationId] = useState(newId());
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
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
  const runPreview = (nextMapping = mapping, nextCsv = csv) =>
    run(async () => {
      const result = await prepApi("/import/contacts/preview", "POST", {
        csv: nextCsv,
        ...(nextMapping ? { mapping: nextMapping } : {}),
      });
      setPreview(result);
      setMapping(result.mapping);
      setOperationId(newId());
      setStatus("");
    });
  const importable =
    preview?.rows.filter((r: Item) => r.status === "new") || [];
  return (
    <div className="prepare-section">
      <div className="prepare-head">
        <div>
          <h2>Import contacts from CSV</h2>
          <p>
            Preview before anything is saved. Imported people are marked as
            imported and unverified. Only a contact whose email you have already
            confirmed counts as the same person; matching names are only
            suggestions and are never merged.
          </p>
        </div>
      </div>
      <div className="prepare-form">
        <label>
          CSV file (up to 2 MB, 1,000 rows)
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2_000_000) {
                setError("Choose a CSV smaller than 2 MB");
                return;
              }
              const content = await file.text();
              setCsv(content);
              setMapping(undefined);
              setPreview(null);
              setStatus("");
              runPreview(undefined, content);
            }}
          />
        </label>
        <label className="wide">
          Or paste CSV text (first row must be column names)
          <textarea
            rows={5}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
              setMapping(undefined);
            }}
          />
        </label>
        <div className="prepare-actions wide">
          <button
            className="primary"
            disabled={!csv.trim() || busy}
            onClick={() => runPreview(mapping)}
            type="button"
          >
            Preview import
          </button>
        </div>
      </div>
      {error && (
        <p className="prepare-error" role="alert">
          {error}
        </p>
      )}
      <p className="prepare-status" role="status">
        {status}
      </p>
      {preview && (
        <>
          <fieldset className="prepare-mapping">
            <legend>Column mapping</legend>
            {fields.map(([field, label]) => (
              <label key={field}>
                {label}
                <select
                  value={mapping?.[field] || ""}
                  onChange={(e) =>
                    setMapping({ ...(mapping || {}), [field]: e.target.value })
                  }
                >
                  <option value="">Not in file</option>
                  {preview.headers.map((h: string) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => runPreview(mapping)}
            >
              Update preview
            </button>
          </fieldset>
          <p className="prepare-meta" role="status">
            {preview.rows.length} rows ·{" "}
            {Object.entries(preview.counts)
              .map(
                ([k, v]) =>
                  `${v} ${statusLabels[k]?.split(",")[0].toLowerCase() || k}`,
              )
              .join(" · ")}
          </p>
          <div
            className="prepare-table"
            tabIndex={0}
            role="region"
            aria-label="Import preview rows"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r: any) => (
                  <tr key={r.row} className={`import-${r.status}`}>
                    <td>{r.row}</td>
                    <td>{r.contact?.name || r.input?.name || "—"}</td>
                    <td>{r.contact?.email || r.input?.email || "—"}</td>
                    <td>
                      <strong>{statusLabels[r.status]}</strong>
                      {r.errors && <div>{r.errors.join("; ")}</div>}
                      {r.duplicateOf && (
                        <div>
                          Matches your saved contact {r.duplicateOf.name}
                        </div>
                      )}
                      {!!r.suggestions?.length && (
                        <div>
                          Possible same name:{" "}
                          {r.suggestions
                            .map(
                              (s: Item) =>
                                `${s.name}${s.company ? " (" + s.company + ")" : ""}`,
                            )
                            .join(", ")}
                          . Imported separately; merge yourself if it is the
                          same person.
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="prepare-actions">
            <button
              className="primary"
              disabled={!importable.length || busy}
              onClick={() =>
                run(async () => {
                  const result = await prepApi(
                    "/import/contacts/commit",
                    "POST",
                    { csv, mapping, operationId },
                  );
                  setStatus(
                    `${result.created} contact${result.created === 1 ? "" : "s"} imported${result.replayed ? " (this import was already applied)" : ""}; ${result.skipped} skipped.`,
                  );
                  setPreview(null);
                  setCsv("");
                  setOperationId(newId());
                  await onChanged();
                })
              }
            >
              Import {importable.length} new contact
              {importable.length === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
