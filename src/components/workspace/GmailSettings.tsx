import { useEffect, useState } from "react";

type Request = (path: string, method?: string, body?: any) => Promise<any>;
type Status = {
  configured: boolean;
  status: string;
  retentionDays: number;
};
export function GmailSettings({ request }: { request: Request }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [maxMessages, setMaxMessages] = useState(100);
  async function refresh() {
    setStatus(await request("/gmail/status"));
    setProgress(await request("/gmail/import"));
  }
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const value = await request("/gmail/status");
        const imported = await request("/gmail/import");
        if (alive) {
          setStatus(value);
          setProgress(imported);
        }
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error ? e.message : "Connection status unavailable.",
          );
      }
    }
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [request]);
  async function act(path: string, body = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request(path, "POST", body);
      if (path === "/gmail/connect") {
        const target = new URL(result.url);
        if (target.origin !== "https://accounts.google.com")
          throw new Error("Invalid authorization destination.");
        window.location.assign(target.href);
      } else {
        if (path === "/gmail/disconnect")
          setNotice(
            result.revoked
              ? "Gmail disconnected."
              : "Local access removed. Provider revocation could not be confirmed; remove Offerly access in your Google account.",
          );
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const importing = ["queued", "running", "retry"].includes(progress?.status);
  return (
    <section
      className="panel settings-panel space-top"
      aria-labelledby="gmail-heading"
    >
      <h2 id="gmail-heading">Gmail recruiting import</h2>
      <p>
        Read-only access. Offerly never sends email. Proposed application
        changes require your acceptance in the review queue.
      </p>
      <p className="muted">
        Production AI and automatic stage updates are disabled.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!status ? (
        <p>Loading connection status…</p>
      ) : (
        <>
          <p role="status">{status.status.replaceAll("_", " ")}</p>
          {!status.configured && (
            <p>
              Hosted Gmail is not enabled. Server OAuth configuration is
              required.
            </p>
          )}
          {status.status !== "connected" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />{" "}
                I agree to retain recruiting evidence for{" "}
                {status.retentionDays || 30} days. Unrelated message content is
                not retained.
              </label>
              <button
                className="secondary"
                disabled={busy || !status.configured || !consent}
                onClick={() =>
                  void act("/gmail/connect", { retentionAccepted: true })
                }
              >
                {status.status === "reconnect_required"
                  ? "Reconnect Gmail"
                  : "Connect Gmail"}
              </button>
            </>
          )}
          {status.status === "connected" && (
            <>
              <p>
                Choose a bounded historical import. Ongoing sync checks for new
                mail every two hours.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("/gmail/import", { after, before, maxMessages });
                }}
              >
                <label>
                  From date
                  <input
                    type="date"
                    required
                    value={after}
                    max={before || undefined}
                    onChange={(e) => setAfter(e.target.value)}
                  />
                </label>
                <label>
                  Until date (exclusive, UTC)
                  <input
                    type="date"
                    required
                    value={before}
                    min={after || undefined}
                    onChange={(e) => setBefore(e.target.value)}
                  />
                </label>
                <label>
                  Maximum messages
                  <input
                    type="number"
                    required
                    min={1}
                    max={1000}
                    value={maxMessages}
                    onChange={(e) => setMaxMessages(Number(e.target.value))}
                  />
                </label>
                <button className="primary" disabled={busy || importing}>
                  Start historical import
                </button>
              </form>
              <div className="space-top">
                <button
                  className="secondary"
                  disabled={busy || !importing}
                  onClick={() => void act("/gmail/import/cancel")}
                >
                  Cancel import
                </button>{" "}
                <button
                  className="secondary"
                  disabled={busy || progress?.status !== "failed"}
                  onClick={() => void act("/gmail/import/retry")}
                >
                  Retry failed import
                </button>
              </div>
            </>
          )}
          {progress?.extractionIncomplete && (
            <p role="status">
              Some messages were not evaluated by AI because processing gates or
              input limits prevented analysis. Deterministic suggestions remain
              available; this import does not establish complete extraction.
            </p>
          )}
          {progress?.coverageIncomplete && (
            <p role="status">
              Import coverage is incomplete because the message limit was
              reached. Choose another bounded import to recover omitted
              messages. Ongoing sync does not fill this historical gap.
            </p>
          )}
          {progress?.resync && (
            <p role="status">
              History expired. Rechecking the bounded mailbox range; existing
              review decisions stay preserved.
            </p>
          )}
          {progress && (
            <p role="status">
              Status: {progress.status} · Messages processed:{" "}
              {progress.processed || 0} · Proposed reviews:{" "}
              {progress.proposed || 0}
              {progress.lastError && <span> · {progress.lastError}</span>}
              {progress.nextSyncAt > 0 && (
                <span>
                  {" "}
                  · Next sync: {new Date(progress.nextSyncAt).toLocaleString()}
                </span>
              )}
            </p>
          )}
          {status.status !== "disconnected" && (
            <>
              <p>
                Disconnect stops sync and removes stored credentials and
                retained Gmail evidence. Accepted manual workspace changes
                remain.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void act("/gmail/disconnect")}
              >
                Disconnect Gmail
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
