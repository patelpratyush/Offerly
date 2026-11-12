// Explainable, deterministic fit scoring. Rubric weights follow the product
// requirements (JOB 06): responsibilities/experience 35, required skills 30,
// seniority 20, preferred qualifications 10, user preferences 5.
// The score describes match to the user's APPROVED profile. It is not a
// probability of an interview or offer, and no AI is involved.
import { LEVELS } from "./profile.js";
export const RUBRIC_VERSION = "fit-2026-11-v1";
export const WEIGHTS = {
  experience: 35,
  requiredSkills: 30,
  seniority: 20,
  preferredSkills: 10,
  preferences: 5,
};
const LABELS = {
  experience: "Responsibilities and experience",
  requiredSkills: "Required skills",
  seniority: "Seniority alignment",
  preferredSkills: "Preferred qualifications",
  preferences: "Your preferences",
};
// Closed vocabulary: a skill counts only if it is on this list AND appears in
// the listing text. Profile skills outside the listing never add points.
const SKILL_LIST = [
  ...new Set([
    "javascript",
    "typescript",
    "python",
    "java",
    "kotlin",
    "swift",
    "golang",
    "rust",
    "ruby",
    "php",
    "scala",
    "c++",
    "c#",
    ".net",
    "sql",
    "postgresql",
    "mysql",
    "mongodb",
    "redis",
    "kafka",
    "graphql",
    "react",
    "angular",
    "vue",
    "node.js",
    "django",
    "flask",
    "rails",
    "spring",
    "aws",
    "azure",
    "gcp",
    "docker",
    "kubernetes",
    "terraform",
    "ansible",
    "linux",
    "git",
    "ci/cd",
    "jenkins",
    "machine learning",
    "deep learning",
    "pytorch",
    "tensorflow",
    "pandas",
    "numpy",
    "spark",
    "hadoop",
    "airflow",
    "dbt",
    "snowflake",
    "tableau",
    "looker",
    "excel",
    "figma",
    "sketch",
    "seo",
    "salesforce",
    "hubspot",
    "jira",
    "agile",
    "scrum",
    "product management",
    "data analysis",
    "statistics",
    "a/b testing",
    "devops",
    "sre",
    "networking",
    "embedded",
    "ios",
    "android",
    "react native",
    "flutter",
    "html",
    "css",
    "sass",
    "webpack",
    "rest api",
    "distributed systems",
    "microservices",
  ]),
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const mentions = (text, term) =>
  new RegExp(`(?<![a-z0-9+#])${escape(term.toLowerCase())}(?![a-z0-9+#])`).test(
    text,
  );
function splitSections(description) {
  const text = String(description || "");
  const heading =
    /(?:^|\n)[^\n]{0,60}(?:preferred|nice[- ]to[- ]have|bonus|desired|a plus)[^\n]{0,60}(?:\n|$)/i.exec(
      text,
    );
  const index = heading ? heading.index : -1;
  return index >= 0
    ? { required: text.slice(0, index), preferred: text.slice(index) }
    : { required: text, preferred: "" };
}
export function jobLevel(title) {
  const t = ` ${String(title).toLowerCase()} `;
  if (/\b(intern|internship|co-?op)\b/.test(t)) return "intern";
  if (/\b(director|vp|head of)\b/.test(t)) return "director";
  if (/\b(manager|engineering manager)\b/.test(t)) return "manager";
  if (/\b(principal|distinguished)\b/.test(t)) return "principal";
  if (/\bstaff\b/.test(t)) return "staff";
  if (/\b(senior|sr\.?|lead)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|associate|entry|graduate|new grad)\b/.test(t))
    return "junior";
  return null; // Unstated titles are unknown, not "mid".
}
function yearsRequired(description) {
  const found = [
    ...String(description).matchAll(
      /(\d{1,2})\s*\+?\s*(?:or more\s+)?years?/gi,
    ),
  ].map((m) => Number(m[1]));
  return found.length
    ? Math.max(...found.filter((n) => n <= 30), 0) || null
    : null;
}
const unknown = (key, why) => ({
  key,
  label: LABELS[key],
  weight: WEIGHTS[key],
  score: null,
  status: "unknown",
  evidence: [],
  gaps: [],
  unknowns: [why],
});
function scored(key, score, evidence, gaps = [], unknowns = []) {
  return {
    key,
    label: LABELS[key],
    weight: WEIGHTS[key],
    score: Math.max(0, Math.min(1, score)),
    status: "scored",
    evidence,
    gaps,
    unknowns,
  };
}
export function scoreJob(job, profile) {
  const facts = profile.facts || {};
  const prefs = profile.preferences || {};
  const description = String(job.description || "");
  const lower = (job.title + "\n" + description).toLowerCase();
  const approved = new Set(
    (facts.skills || [])
      .filter((s) => s.approved)
      .map((s) => s.name.trim().toLowerCase()),
  );
  const components = [];

  // Responsibilities and experience (35)
  const roles = facts.targetRoles || [],
    terms = facts.experienceTerms || [];
  if (!roles.length && !terms.length)
    components.push(
      unknown(
        "experience",
        "Your profile has no approved target roles or experience terms.",
      ),
    );
  else {
    const title = job.title.toLowerCase();
    const roleHit = roles.find((r) =>
      r
        .toLowerCase()
        .split(/\s+/)
        .every((word) => title.includes(word)),
    );
    const termHits = terms.filter((t) => mentions(lower, t));
    const evidence = [],
      gaps = [];
    if (roleHit) evidence.push(`Title matches your target role "${roleHit}".`);
    else if (roles.length)
      gaps.push("Title does not match your approved target roles.");
    if (termHits.length)
      evidence.push(`Mentions your experience in: ${termHits.join(", ")}.`);
    const missing = terms.filter((t) => !termHits.includes(t));
    if (missing.length && description)
      gaps.push(`Not mentioned in listing: ${missing.join(", ")}.`);
    let value;
    if (!description && terms.length && !roleHit) value = null;
    else {
      const roleScore = roles.length ? (roleHit ? 1 : 0) : null;
      const termScore =
        terms.length && description ? termHits.length / terms.length : null;
      value =
        roleScore !== null && termScore !== null
          ? roleScore * 0.6 + termScore * 0.4
          : (roleScore ?? termScore);
    }
    const years = yearsRequired(description);
    if (
      value !== null &&
      years &&
      facts.yearsExperience !== null &&
      facts.yearsExperience < years
    ) {
      value *= Math.max(0.3, facts.yearsExperience / years);
      gaps.push(
        `Listing mentions ${years}+ years; your profile states ${facts.yearsExperience}.`,
      );
    }
    components.push(
      value === null
        ? unknown(
            "experience",
            "Listing has no description to compare with your experience.",
          )
        : scored("experience", value, evidence, gaps),
    );
  }

  // Required and preferred skills (30 / 10)
  const { required, preferred } = splitSections(description);
  const reqText = required.toLowerCase(),
    prefText = preferred.toLowerCase();
  const reqSkills = SKILL_LIST.filter((s) =>
    mentions(job.title.toLowerCase() + "\n" + reqText, s),
  );
  const prefSkills = SKILL_LIST.filter(
    (s) => !reqSkills.includes(s) && mentions(prefText, s),
  );
  if (!description || !reqSkills.length)
    components.push(
      unknown(
        "requiredSkills",
        description
          ? "No recognized skills were found in the listing text."
          : "Listing has no description to extract required skills from.",
      ),
    );
  else {
    const have = reqSkills.filter((s) => approved.has(s));
    const lacking = reqSkills.filter((s) => !approved.has(s));
    components.push(
      scored(
        "requiredSkills",
        have.length / reqSkills.length,
        have.map((s) => `Approved skill "${s}" is listed as required.`),
        lacking.map(
          (s) => `Required skill "${s}" is not in your approved profile.`,
        ),
      ),
    );
  }
  if (!prefSkills.length)
    components.push(
      unknown(
        "preferredSkills",
        "No preferred qualifications were recognized.",
      ),
    );
  else {
    const have = prefSkills.filter((s) => approved.has(s));
    components.push(
      scored(
        "preferredSkills",
        have.length / prefSkills.length,
        have.map((s) => `Approved skill "${s}" is preferred.`),
        prefSkills
          .filter((s) => !approved.has(s))
          .map((s) => `Preferred "${s}" is not in your approved profile.`),
      ),
    );
  }

  // Seniority (20)
  const level = jobLevel(job.title);
  if (!level || !facts.seniority)
    components.push(
      unknown(
        "seniority",
        !level
          ? "The title does not state a seniority level."
          : "Your profile has no approved seniority.",
      ),
    );
  else {
    const gap = LEVELS.indexOf(level) - LEVELS.indexOf(facts.seniority);
    const value = [1, 0.6, 0.25][Math.abs(gap)] ?? 0;
    components.push(
      scored(
        "seniority",
        value,
        gap === 0 ? [`Title level "${level}" matches your level.`] : [],
        gap === 0
          ? []
          : [
              `Title level "${level}" is ${Math.abs(gap)} step(s) ${gap > 0 ? "above" : "below"} your approved level "${facts.seniority}".`,
            ],
      ),
    );
  }

  // Preferences (5): unknown parts are omitted, never counted as zero.
  const parts = [],
    evidence = [],
    gaps = [],
    unknowns = [];
  if (prefs.arrangements?.length)
    if (job.work_arrangement && job.work_arrangement !== "Unknown") {
      const ok = prefs.arrangements.includes(job.work_arrangement);
      parts.push(ok ? 1 : 0);
      (ok ? evidence : gaps).push(
        `Work arrangement is ${job.work_arrangement}.`,
      );
    } else unknowns.push("Work arrangement is not stated.");
  if (prefs.locations?.length)
    if (job.location) {
      const ok =
        job.work_arrangement === "Remote" ||
        prefs.locations.some((l) =>
          job.location.toLowerCase().includes(l.toLowerCase()),
        );
      parts.push(ok ? 1 : 0);
      (ok ? evidence : gaps).push(`Location: ${job.location}.`);
    } else unknowns.push("Location is not stated.");
  if (prefs.salaryMin)
    if (job.comp_max || job.comp_min) {
      if (job.comp_basis !== "Unknown" && job.comp_basis !== prefs.salaryBasis)
        unknowns.push(
          `Listing states ${job.comp_basis.toLowerCase()} pay; you set a ${prefs.salaryBasis.toLowerCase()} minimum, so they are not compared.`,
        );
      else if (
        job.comp_period === "Year" &&
        (!prefs.salaryCurrency || prefs.salaryCurrency === job.comp_currency)
      ) {
        const ok = (job.comp_max || job.comp_min) >= prefs.salaryMin;
        parts.push(ok ? 1 : 0);
        (ok ? evidence : gaps).push(
          `Listed pay reaches ${job.comp_max || job.comp_min} ${job.comp_currency}.`,
        );
      } else unknowns.push("Pay period or currency differs from your minimum.");
    } else
      unknowns.push("Compensation is not stated; this is not treated as zero.");
  components.push(
    parts.length
      ? scored(
          "preferences",
          parts.reduce((a, b) => a + b, 0) / parts.length,
          evidence,
          gaps,
          unknowns,
        )
      : unknown("preferences", unknowns[0] || "You have not set preferences."),
  );

  components.sort(
    (a, b) =>
      Object.keys(WEIGHTS).indexOf(a.key) - Object.keys(WEIGHTS).indexOf(b.key),
  );
  const known = components.filter((c) => c.score !== null);
  const knownWeight = known.reduce((sum, c) => sum + c.weight, 0);
  // A score from under 35% of the rubric would be mostly guesswork.
  const score =
    knownWeight >= 35
      ? Math.round(
          (known.reduce((sum, c) => sum + c.weight * c.score, 0) /
            knownWeight) *
            100,
        )
      : null;
  return {
    rubricVersion: RUBRIC_VERSION,
    score,
    coverage: knownWeight,
    components,
    gaps: components.flatMap((c) => c.gaps),
    unknowns: components.flatMap((c) => c.unknowns),
    level,
    stretch:
      !!level &&
      !!facts.seniority &&
      LEVELS.indexOf(level) - LEVELS.indexOf(facts.seniority) === 1,
    disclaimer:
      "Fit describes how listing text matches your approved profile under this rubric. It is not a probability of an interview or offer.",
  };
}
