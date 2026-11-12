import { FormEvent, useEffect, useState } from "react";
import { discoveryApi, when } from "./api";

type Answer = "yes" | "no" | "unknown";
type ProfileState = {
  roles: string;
  terms: string;
  skills: string;
  seniority: string;
  years: string;
  authUS: Answer;
  sponsorship: Answer;
  citizen: Answer;
  clearance: string;
  graduation: string;
  locations: string;
  arrangements: string[];
  salaryMin: string;
  currency: string;
  basis: string;
};
const empty: ProfileState = {
  roles: "",
  terms: "",
  skills: "",
  seniority: "",
  years: "",
  authUS: "unknown",
  sponsorship: "unknown",
  citizen: "unknown",
  clearance: "unknown",
  graduation: "",
  locations: "",
  arrangements: [],
  salaryMin: "",
  currency: "",
  basis: "Base",
};
const lines = (text: string, split = /\n|,/) =>
  text
    .split(split)
    .map((s) => s.trim())
    .filter(Boolean);
function AnswerSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: any) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="unknown">Not answered</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}
export function ProfilePanel({ onSaved }: { onSaved: () => void }) {
  const [state, setState] = useState<ProfileState>(empty);
  const [meta, setMeta] = useState<{
    approvedAt: string;
    version: number;
  } | null>(null);
  const [rubric, setRubric] = useState<{ version: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    discoveryApi("/profile")
      .then(({ profile: p, rubric: r }) => {
        if (!live) return;
        setRubric(r);
        if (!p.approved) return;
        setMeta({ approvedAt: p.approvedAt, version: p.version });
        setState({
          roles: p.facts.targetRoles.join(", "),
          terms: p.facts.experienceTerms.join(", "),
          skills: p.facts.skills
            .filter((s: any) => s.approved)
            .map((s: any) => s.name)
            .join("\n"),
          seniority: p.facts.seniority,
          years: p.facts.yearsExperience ?? "",
          authUS: p.eligibility.workAuthorization.US || "unknown",
          sponsorship: p.eligibility.needsSponsorship,
          citizen: p.eligibility.usCitizen,
          clearance: p.eligibility.securityClearance,
          graduation: p.eligibility.graduationYear ?? "",
          locations: p.preferences.locations.join(", "),
          arrangements: p.preferences.arrangements,
          salaryMin: p.preferences.salaryMin ?? "",
          currency: p.preferences.salaryCurrency,
          basis: p.preferences.salaryBasis,
        });
      })
      .catch((e) => live && setMessage(e.message));
    return () => {
      live = false;
    };
  }, []);
  const set = <K extends keyof ProfileState>(k: K, v: ProfileState[K]) =>
    setState((s) => ({ ...s, [k]: v }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const body = {
        facts: {
          targetRoles: lines(state.roles),
          experienceTerms: lines(state.terms),
          skills: lines(state.skills).map((name) => ({ name, approved: true })),
          seniority: state.seniority,
          yearsExperience: state.years === "" ? null : Number(state.years),
        },
        eligibility: {
          workAuthorization:
            state.authUS === "unknown" ? {} : { US: state.authUS },
          needsSponsorship: state.sponsorship,
          usCitizen: state.citizen,
          securityClearance: state.clearance,
          graduationYear:
            state.graduation === "" ? null : Number(state.graduation),
        },
        preferences: {
          locations: lines(state.locations),
          arrangements: state.arrangements,
          salaryMin: state.salaryMin === "" ? null : Number(state.salaryMin),
          salaryCurrency: state.currency.toUpperCase(),
          salaryBasis: state.basis,
        },
      };
      const { profile } = await discoveryApi("/profile", "PUT", body);
      setMeta({ approvedAt: profile.approvedAt, version: profile.version });
      setMessage(
        "Profile approved. Matches were re-scored; no job was treated as new.",
      );
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="panel discover-profile"
      onSubmit={submit}
      aria-label="Candidate profile"
    >
      <p className="panel-copy muted">
        Only facts you list and approve here are used for fit scoring. Skills a
        job asks for that are not listed are shown as gaps and never raise a
        score. Eligibility answers are separate from fit and are never guessed.
        {meta &&
          ` Approved ${when(meta.approvedAt)} (version ${meta.version}).`}
        {rubric && ` Scoring rubric ${rubric.version}.`}
      </p>
      <div className="discover-filter-grid">
        <label>
          Target roles (comma separated)
          <input
            value={state.roles}
            onChange={(e) => set("roles", e.target.value)}
          />
        </label>
        <label>
          Experience areas (comma separated)
          <input
            value={state.terms}
            onChange={(e) => set("terms", e.target.value)}
          />
        </label>
        <label>
          Approved skills (one per line)
          <textarea
            rows={4}
            value={state.skills}
            onChange={(e) => set("skills", e.target.value)}
          />
        </label>
        <label>
          Seniority
          <select
            value={state.seniority}
            onChange={(e) => set("seniority", e.target.value)}
          >
            <option value="">Not stated</option>
            {[
              "intern",
              "junior",
              "mid",
              "senior",
              "staff",
              "principal",
              "manager",
              "director",
            ].map((l) => (
              <option key={l} value={l}>
                {l[0].toUpperCase() + l.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Years of experience
          <input
            type="number"
            min={0}
            max={60}
            value={state.years}
            onChange={(e) => set("years", e.target.value)}
          />
        </label>
      </div>
      <fieldset className="discover-group">
        <legend>Eligibility answers</legend>
        <div className="discover-filter-grid">
          <AnswerSelect
            label="Authorized to work in the US"
            value={state.authUS}
            onChange={(v) => set("authUS", v)}
          />
          <AnswerSelect
            label="Need visa sponsorship"
            value={state.sponsorship}
            onChange={(v) => set("sponsorship", v)}
          />
          <AnswerSelect
            label="US citizen"
            value={state.citizen}
            onChange={(v) => set("citizen", v)}
          />
          <label>
            Security clearance
            <select
              value={state.clearance}
              onChange={(e) => set("clearance", e.target.value)}
            >
              <option value="unknown">Not answered</option>
              <option value="active">Active clearance</option>
              <option value="none">None</option>
            </select>
          </label>
          <label>
            Graduation year (if relevant)
            <input
              type="number"
              min={1950}
              max={2100}
              value={state.graduation}
              onChange={(e) => set("graduation", e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="discover-group">
        <legend>Preferences (5% of fit)</legend>
        <div className="discover-filter-grid">
          <label>
            Preferred locations (comma separated)
            <input
              value={state.locations}
              onChange={(e) => set("locations", e.target.value)}
            />
          </label>
          <label>
            Minimum yearly pay
            <input
              type="number"
              min={0}
              value={state.salaryMin}
              onChange={(e) => set("salaryMin", e.target.value)}
            />
          </label>
          <label>
            Currency (e.g. USD)
            <input
              value={state.currency}
              maxLength={3}
              onChange={(e) => set("currency", e.target.value)}
            />
          </label>
          <label>
            Pay basis
            <select
              value={state.basis}
              onChange={(e) => set("basis", e.target.value)}
            >
              <option value="Base">Base salary</option>
              <option value="Total">Total compensation</option>
            </select>
          </label>
        </div>
        {["Remote", "Hybrid", "On-site"].map((a) => (
          <label key={a} className="checkbox-label">
            <input
              type="checkbox"
              checked={state.arrangements.includes(a)}
              onChange={(e) =>
                set(
                  "arrangements",
                  e.target.checked
                    ? [...state.arrangements, a]
                    : state.arrangements.filter((x) => x !== a),
                )
              }
            />
            {a}
          </label>
        ))}
      </fieldset>
      <div className="discover-actions">
        <button className="primary" disabled={busy}>
          Approve profile
        </button>
        <span role="status" className="muted">
          {message}
        </span>
      </div>
    </form>
  );
}
