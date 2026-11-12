import { useEffect, useState } from "react";
import "../../styles/insights-reminders.css";

type Request = (path: string, method?: string, body?: any) => Promise<any>;
type Rule = {
  id: string;
  enabled: boolean;
  value: number;
  inApp: boolean;
  email: boolean;
};
const copy: Record<
  string,
  { name: string; unit: "hours" | "days"; min: number; max: number }
> = {
  interview_24h: {
    name: "Before interviews (first)",
    unit: "hours",
    min: 1,
    max: 168,
  },
  interview_1h: {
    name: "Before interviews (second)",
    unit: "hours",
    min: 1,
    max: 168,
  },
  assessment_48h: {
    name: "Before assessment deadlines (first)",
    unit: "hours",
    min: 1,
    max: 336,
  },
  assessment_24h: {
    name: "Before assessment deadlines (second)",
    unit: "hours",
    min: 1,
    max: 336,
  },
  followup_7d: {
    name: "Follow up after no reply",
    unit: "days",
    min: 1,
    max: 60,
  },
};
const shown = (rule: Rule) =>
  copy[rule.id].unit === "days" ? rule.value : Math.round(rule.value / 60);
const stored = (id: string, v: number) =>
  copy[id].unit === "days" ? v : v * 60;
const fmt = (d: any) =>
  d.precision === "date" ? `Date ${d.when}` : new Date(d.when).toLocaleString();

export function ReminderRulesSettings({ request }: { request: Request }) {
  const [view, setView] = useState<any>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const load = (v: any) => {
    setView(v);
    setRules(v.settings.rules);
    setEmailOptIn(v.settings.emailOptIn);
  };
  useEffect(() => {
    let alive = true;
    request("/reminder-settings")
      .then((v) => alive && load(v))
      .catch(
        (e) =>
          alive &&
          setError(
            e instanceof Error ? e.message : "Reminder settings unavailable.",
          ),
      );
    return () => {
      alive = false;
    };
  }, [request]);
  const update = (id: string, patch: Partial<Rule>) =>
    setRules((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  async function save() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const next = await request("/reminder-settings", "PUT", {
        ...(view.settings.version ? { version: view.settings.version } : {}),
        emailOptIn,
        rules,
      });
      load(next);
      setStatus("Reminder preferences saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!view)
    return (
      <section
        className="panel settings-panel space-top"
        aria-labelledby="ir-rem-heading"
      >
        <h2 id="ir-rem-heading">Reminder rules</h2>
        {error ? (
          <p className="ir-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="ir-status">Loading reminder rules…</p>
        )}
      </section>
    );
  const upcoming = view.deliveries.slice(-12).reverse();
  return (
    <section
      className="panel settings-panel space-top ir-section"
      aria-labelledby="ir-rem-heading"
    >
      <h2 id="ir-rem-heading">Reminder rules</h2>
      <p>
        Reminders come only from interviews, assessments and applications you
        recorded. They never change a stage and never contact an employer.
        Date-only deadlines stay date-only: they are reminded by whole days at
        09:00 in your timezone, so hour-based timing is skipped for them.
      </p>
      <ul className="ir-rules">
        {rules.map((rule) => {
          const c = copy[rule.id];
          return (
            <li className="ir-rule" key={rule.id}>
              <label>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) =>
                    update(rule.id, { enabled: e.target.checked })
                  }
                />
                <span>{c.name}</span>
              </label>
              <label>
                <span>{c.unit === "days" ? "Days" : "Hours"}</span>
                <input
                  type="number"
                  min={c.min}
                  max={c.max}
                  value={shown(rule)}
                  disabled={!rule.enabled}
                  aria-label={`${c.name}, ${c.unit}`}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n) && n >= c.min && n <= c.max)
                      update(rule.id, { value: stored(rule.id, n) });
                  }}
                />
              </label>
              <fieldset disabled={!rule.enabled}>
                <legend className="sr-only">Channels for {c.name}</legend>
                <div className="ir-channels">
                  <label>
                    <input
                      type="checkbox"
                      checked={rule.inApp}
                      onChange={(e) =>
                        update(rule.id, { inApp: e.target.checked })
                      }
                    />
                    In-app
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={rule.email && emailOptIn}
                      disabled={!emailOptIn}
                      onChange={(e) =>
                        update(rule.id, { email: e.target.checked })
                      }
                    />
                    Email
                  </label>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
      <label className="ir-check">
        <input
          type="checkbox"
          checked={emailOptIn}
          onChange={(e) => setEmailOptIn(e.target.checked)}
        />
        <span>
          I opt in to email reminders at my account address (you can withdraw at
          any time).
        </span>
      </label>
      <p role="note">{view.email.note}</p>
      <div className="ir-actions">
        <button className="secondary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save reminder preferences"}
        </button>
        <span className="ir-status" role="status">
          {status}
        </span>
      </div>
      {error && (
        <p className="ir-error" role="alert">
          {error}
        </p>
      )}
      <h3>Reminder deliveries</h3>
      {upcoming.length === 0 ? (
        <p>
          No reminders planned. Schedule an interview or assessment with a
          future date to see them here.
        </p>
      ) : (
        <ul className="ir-deliveries" aria-label="Reminder deliveries">
          {upcoming.map((d: any) => (
            <li key={d.id}>
              <span>
                {d.title}
                <br />
                <small>
                  {d.channel === "email" ? "Email" : "In-app"} · {fmt(d)}
                  {d.reason ? ` · ${d.reason}` : ""}
                </small>
              </span>
              <span className="ir-state" data-state={d.state}>
                {d.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
