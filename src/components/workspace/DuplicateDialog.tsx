import { useState } from "react";
import { X, Copy, Undo2, CheckCheck, Archive } from "lucide-react";
export function DuplicateDialog({
  w,
  request,
  refresh,
  onClose,
}: {
  w: any;
  request: (path: string, method?: string, body?: any) => Promise<any>;
  refresh: () => Promise<any>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [merge, setMerge] = useState<any>(null);
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay modal-overlay">
      <section
        className="modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate review"
      >
        <div className="section-head">
          <div>
            <span className="eyebrow">A CLEARER PIPELINE</span>
            <h2>Review possible duplicates</h2>
          </div>
          <button aria-label="Close duplicate review" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p className="muted">
          Same employer can mean different opportunities. Compare before
          deciding. Archiving preserves all history, contacts, and documents.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {w.duplicateScanLimited && (
          <p role="status" className="notice">
            Showing a bounded set of suggestions. Review these first; more may
            remain. For large sets, narrow your applications manually.
          </p>
        )}
        {!w.duplicates.length && !w.duplicateScanLimited && (
          <div className="empty">
            <CheckCheck size={32} />
            <h2>All caught up.</h2>
            <p>No unresolved duplicate candidates.</p>
          </div>
        )}
        <div className="duplicate-list">
          {w.duplicates.map((pair: any) => (
            <article className="duplicate-pair" key={pair.key}>
              <div className="duplicate-reason">
                <Copy size={14} />
                {pair.reason}
              </div>
              <div className="compare-grid">
                {[pair.left, pair.right].map((a) => (
                  <div className="compare-card" key={a.id}>
                    <strong>{a.title}</strong>
                    <p>{a.company}</p>
                    <span className="badge">{a.stage}</span>
                    <dl>
                      <dt>Applied</dt>
                      <dd>{a.appliedDate || "Unknown"}</dd>
                      <dt>Requisition</dt>
                      <dd>{a.requisition || "Unknown"}</dd>
                      <dt>Source</dt>
                      <dd>{a.source || "Unknown"}</dd>
                    </dl>
                    {a.url && (
                      <a
                        className="text-button"
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open listing ↗
                      </a>
                    )}
                    <p className="notes">{a.notes || "No notes"}</p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          request("/duplicates/review", "POST", {
                            leftId: pair.left.id,
                            rightId: pair.right.id,
                            leftVersion: pair.left.version,
                            rightVersion: pair.right.version,
                            decision: "archive",
                            targetId: a.id,
                          }),
                        )
                      }
                    >
                      <Archive size={14} /> Archive this application
                    </button>
                  </div>
                ))}
              </div>
              <div className="merge-actions">
                {[pair.left, pair.right].map((primary: any, index: number) => (
                  <button
                    key={primary.id}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const preview = await request(
                          "/duplicates/merge-preview",
                          "POST",
                          {
                            leftId: pair.left.id,
                            rightId: pair.right.id,
                            targetId: primary.id,
                          },
                        );
                        setMerge({ ...preview, pairKey: pair.key });
                      })
                    }
                  >
                    Preview merge into {index === 0 ? "left" : "right"}{" "}
                    application
                  </button>
                ))}
              </div>
              {merge?.pairKey === pair.key && (
                <section className="merge-preview" aria-label="Merge preview">
                  <h3>Review linked records before merging</h3>
                  <p>
                    <strong>
                      Primary:{" "}
                      {merge.primaryId === pair.left.id ? "Left" : "Right"}{" "}
                      application ·{" "}
                      {merge.primaryId === pair.left.id
                        ? pair.left.stage
                        : pair.right.stage}
                    </strong>
                  </p>
                  <p>
                    Keep the selected primary application's fields. Archive the
                    other application and move these links. Original notes and
                    history remain on the archived application. No emails are
                    connected yet.
                  </p>
                  {merge.affected.length ? (
                    <ul>
                      {merge.affected.map((r: any) => (
                        <li key={r.id}>
                          {r.kind}: {r.title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No linked records to move.</p>
                  )}
                  <p>
                    Document file bytes stay unchanged. Undo is available until
                    an affected record is edited again.
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await request("/duplicates/review", "POST", {
                          leftId: pair.left.id,
                          rightId: pair.right.id,
                          leftVersion: pair.left.version,
                          rightVersion: pair.right.version,
                          decision: "merge",
                          targetId: merge.primaryId,
                          fingerprint: merge.fingerprint,
                        });
                        setMerge(null);
                      })
                    }
                  >
                    Confirm merge
                  </button>
                  <button disabled={busy} onClick={() => setMerge(null)}>
                    Cancel merge
                  </button>
                </section>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    request("/duplicates/review", "POST", {
                      leftId: pair.left.id,
                      rightId: pair.right.id,
                      leftVersion: pair.left.version,
                      rightVersion: pair.right.version,
                      decision: "keep",
                    }),
                  )
                }
              >
                <CheckCheck size={16} /> These are different applications — keep
                both
              </button>
            </article>
          ))}
        </div>
        {w.duplicateReviews.length > 0 && (
          <section className="review-history">
            <h3>Previous decisions</h3>
            {w.duplicateReviews.map((r: any) => (
              <div className="detail-item" key={r.id}>
                <span>
                  {r.decision === "keep"
                    ? "Kept separate"
                    : r.decision === "merge"
                      ? "Merged applications"
                      : "Archived one application"}
                  <small>
                    {r.applicationIds
                      .map(
                        (id: string) =>
                          w.applications.find((a: any) => a.id === id)?.title ||
                          "Unknown",
                      )
                      .join(" / ")}
                  </small>
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    run(() => request("/duplicates/" + r.id + "/undo", "POST"))
                  }
                >
                  <Undo2 size={14} /> Undo
                </button>
              </div>
            ))}
          </section>
        )}
      </section>
    </div>
  );
}
