import { useEffect, useState } from "react";
type Request = (path: string, method?: string, body?: any) => Promise<any>;
type Policy = {
  enabled: boolean;
  qualityApproved: boolean;
  evidenceVersion?: string;
  consented: boolean;
  available: boolean;
  requiredConsentVersion: string;
  dailyRequestLimit: number;
  dailySpendLimitMicroDollars: number;
  requestsUsed: number;
  reservedMicroDollars: number;
  maxInputCharacters: number;
  maxOutputTokens: number;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value / 1000000);
export function RecruitingAISettings({ request }: { request: Request }) {
  const [policy, setPolicy] = useState<Policy | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request("/recruiting/ai-policy")
      .then((value) => {
        if (active) setPolicy(value);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "AI policy unavailable.");
      });
    return () => {
      active = false;
    };
  }, [request]);
  async function consent(value: boolean) {
    if (!policy) return;
    setBusy(true);
    setError("");
    try {
      await request(
        "/recruiting/ai-policy",
        "POST",
        value
          ? { consent: true, version: policy.requiredConsentVersion }
          : { consent: false },
      );
      setPolicy(await request("/recruiting/ai-policy"));
      setChecked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update consent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel settings-panel space-top"
      aria-labelledby="recruiting-ai-heading"
    >
      <h2 id="recruiting-ai-heading">AI recruiting extraction</h2>
      <p>
        Optional AI can propose recruiting events from minimized Gmail excerpts.
        Every application change still needs your acceptance. Automatic stage
        updates remain disabled.
      </p>
      {error && <p role="alert">{error}</p>}
      {!policy ? (
        <p>Loading AI readiness…</p>
      ) : (
        <>
          <p role="status">
            {policy.available
              ? "Available with your consent and within configured limits."
              : "Unavailable: AI extraction remains gated."}
          </p>
          <ul>
            <li>
              Server AI configuration: {policy.enabled ? "enabled" : "disabled"}
            </li>
            <li>
              Required quality evidence:{" "}
              {policy.qualityApproved
                ? "server approval recorded; not independent proof"
                : "not approved; capability incomplete"}
            </li>
            <li>
              Your data-sharing consent:{" "}
              {policy.consented ? "granted" : "not granted"}
            </li>
          </ul>
          {policy.evidenceVersion && (
            <p>Quality evidence reference: {policy.evidenceVersion}</p>
          )}
          <p>
            Daily request allowance: {policy.requestsUsed} /{" "}
            {policy.dailyRequestLimit}. Reserved budget:{" "}
            {money(policy.reservedMicroDollars)} /{" "}
            {money(policy.dailySpendLimitMicroDollars)}. Reservations are
            spending safeguards, not a billing statement.
          </p>
          <p>
            Each request is limited to {policy.maxInputCharacters} input
            characters and {policy.maxOutputTokens} output tokens.
          </p>
          <p>
            If enabled and consented, recruiting excerpts are sent to OpenAI.
            OpenAI may retain abuse-monitoring logs containing content for up to
            30 days by default, with longer retention possible for legal or
            safety reasons.{" "}
            <a
              href="https://developers.openai.com/api/docs/guides/your-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read OpenAI data controls
            </a>
            .
          </p>
          {!policy.consented ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  disabled={!policy.enabled || !policy.qualityApproved || busy}
                />{" "}
                I consent to sending minimized recruiting excerpts to OpenAI
                under this data policy.
              </label>
              <button
                className="secondary"
                disabled={
                  busy || !checked || !policy.enabled || !policy.qualityApproved
                }
                onClick={() => void consent(true)}
              >
                Grant AI data-sharing consent
              </button>
              <p>
                Consent cannot bypass server configuration or quality review. No
                AI calls run while either gate is closed.
              </p>
            </>
          ) : (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void consent(false)}
            >
              Revoke AI data-sharing consent
            </button>
          )}
        </>
      )}
    </section>
  );
}
