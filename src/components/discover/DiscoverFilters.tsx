import { FormEvent, useState } from "react";

export type Filters = {
  q: string;
  seniority: string[];
  location: string;
  arrangements: string[];
  salaryMin: number | null;
  eligibility: string[];
  platforms: string[];
  sizes: string[];
  includeUnknownSize: boolean;
  includeUncertainSize: boolean;
  minFit: number;
  window: string;
  from: string;
  to: string;
};
export const defaultFilters: Filters = {
  q: "",
  seniority: [],
  location: "",
  arrangements: [],
  salaryMin: null,
  eligibility: ["meets", "needs_verification"],
  platforms: [],
  sizes: [],
  includeUnknownSize: false,
  includeUncertainSize: false,
  minFit: 0,
  window: "",
  from: "",
  to: "",
};
const LEVELS = [
  "intern",
  "junior",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
];
function Group({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: [string, string][];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="discover-group">
      <legend>{legend}</legend>
      {options.map(([v, label]) => (
        <label key={v} className="checkbox-label">
          <input
            type="checkbox"
            checked={value.includes(v)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...value, v] : value.filter((x) => x !== v),
              )
            }
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
export function DiscoverFilters({
  value,
  onApply,
  onSaveSearch,
}: {
  value: Filters;
  onApply: (filters: Filters) => void;
  onSaveSearch: (name: string, filters: Filters) => void;
}) {
  const [draft, setDraft] = useState<Filters>(value);
  const [name, setName] = useState("");
  const set = <K extends keyof Filters>(key: K, next: Filters[K]) =>
    setDraft({ ...draft, [key]: next });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(draft);
  };
  return (
    <form
      className="discover-filters panel"
      onSubmit={submit}
      aria-label="Filters"
    >
      <div className="discover-filter-grid">
        <label>
          Role or company
          <input
            value={draft.q}
            maxLength={100}
            onChange={(e) => set("q", e.target.value)}
          />
        </label>
        <label>
          Location contains
          <input
            value={draft.location}
            maxLength={100}
            onChange={(e) => set("location", e.target.value)}
          />
        </label>
        <label>
          Minimum stated salary (excludes jobs that do not state pay)
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={draft.salaryMin ?? ""}
            onChange={(e) =>
              set("salaryMin", e.target.value ? Number(e.target.value) : null)
            }
          />
        </label>
        <label>
          Minimum fit score
          <input
            type="number"
            min={0}
            max={100}
            value={draft.minFit}
            onChange={(e) =>
              set(
                "minFit",
                Math.min(100, Math.max(0, Number(e.target.value) || 0)),
              )
            }
          />
        </label>
        <label>
          Recency window
          <select
            value={draft.window}
            onChange={(e) => set("window", e.target.value)}
          >
            <option value="">Any time</option>
            <option value="24h">Last 24 hours</option>
            <option value="3d">Last 3 days</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {draft.window === "custom" && (
          <>
            <label>
              From
              <input
                type="date"
                value={draft.from}
                onChange={(e) => set("from", e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={draft.to}
                onChange={(e) => set("to", e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <p className="muted discover-note">
        Latest filters by the employer's posting date; New to your feed filters
        by when Offerly first found the job. Jobs with unknown posting dates
        never count as recently posted.
      </p>
      <div className="discover-group-row">
        <Group
          legend="Seniority"
          options={LEVELS.map((l) => [l, l[0].toUpperCase() + l.slice(1)])}
          value={draft.seniority}
          onChange={(v) => set("seniority", v)}
        />
        <Group
          legend="Work arrangement"
          options={[
            ["Remote", "Remote"],
            ["Hybrid", "Hybrid"],
            ["On-site", "On-site"],
          ]}
          value={draft.arrangements}
          onChange={(v) => set("arrangements", v)}
        />
        <Group
          legend="Eligibility"
          options={[
            ["meets", "Meets stated requirements"],
            ["needs_verification", "Needs verification"],
            ["does_not_meet", "Does not meet"],
          ]}
          value={draft.eligibility}
          onChange={(v) => set("eligibility", v)}
        />
        <Group
          legend="Source"
          options={[
            ["greenhouse", "Greenhouse"],
            ["lever", "Lever"],
            ["ashby", "Ashby"],
          ]}
          value={draft.platforms}
          onChange={(v) => set("platforms", v)}
        />
        <Group
          legend="Company size"
          options={[
            ["Small", "Small (1–199)"],
            ["Mid", "Mid-sized (200–999)"],
            ["Large", "Large (1,000+)"],
          ]}
          value={draft.sizes}
          onChange={(v) => set("sizes", v)}
        />
        <fieldset className="discover-group">
          <legend>Size uncertainty</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.includeUnknownSize}
              onChange={(e) => set("includeUnknownSize", e.target.checked)}
            />
            Include unknown size
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.includeUncertainSize}
              onChange={(e) => set("includeUncertainSize", e.target.checked)}
            />
            Include ambiguous size ranges
          </label>
        </fieldset>
      </div>
      <div className="discover-actions">
        <button className="primary" type="submit">
          Apply filters
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setDraft(defaultFilters);
            onApply(defaultFilters);
          }}
        >
          Reset
        </button>
        <label className="discover-inline">
          Save these filters as
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            onSaveSearch(name.trim(), draft);
            setName("");
          }}
        >
          Save search
        </button>
      </div>
    </form>
  );
}
