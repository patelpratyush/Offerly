#!/usr/bin/env node
// Evaluation harness for the discovery fit rubric and eligibility checks.
// Scores a labeled dataset with the CURRENT deterministic rubric and compares it
// with reviewer labels. No model calls, no network, no database.
//
// Usage:
//   node scripts/discovery-evaluate.js <dataset.json> [--labels labels.csv] [--json] [--out report.json]
//   node scripts/discovery-evaluate.js <dataset.json> --template      (blank label CSV for reviewers)
//
// IMPORTANT: results on datasets with datasetKind "synthetic" are NOT
// validation of the rubric. The report says so; so must anyone quoting it.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { wilson95 } from "./phase0-evaluate.js";
import { scoreJob, RUBRIC_VERSION } from "../server/discovery/scoring.js";
import { checkEligibility } from "../server/discovery/eligibility.js";
import { profileSchema } from "../server/discovery/profile.js";

export const ELIGIBILITY_LABELS = [
  "meets",
  "needs_verification",
  "does_not_meet",
];
export const FIT_SCALE = { min: 0, max: 3 };
export const TOP_N = 10;
export const TARGET_RELEVANT_RATE = 0.7;
// Below these, a human-labeled run is reported as preliminary, not interpretable.
export const MIN_EXAMPLES = 30;
export const MIN_PROFILES = 3;
export const MIN_INDEPENDENT_REVIEWERS = 2;
export const ADJUDICATOR = "adjudicated";

const id = z.string().trim().min(1).max(80);
const listingSchema = z
  .object({
    title: z.string().min(1).max(300),
    location: z.string().max(300).default(""),
    description: z.string().max(40000).default(""),
    work_arrangement: z
      .enum(["Remote", "Hybrid", "On-site", "Unknown"])
      .default("Unknown"),
    comp_min: z.number().nullable().default(null),
    comp_max: z.number().nullable().default(null),
    comp_currency: z.string().max(3).default(""),
    comp_period: z
      .enum(["Year", "Month", "Week", "Day", "Hour", "Unknown"])
      .default("Unknown"),
    comp_basis: z.enum(["Base", "Total", "Unknown"]).default("Unknown"),
  })
  .strict();
const labelSchema = z
  .object({
    exampleId: id,
    reviewer: id,
    fit: z.number().int().min(FIT_SCALE.min).max(FIT_SCALE.max).nullable(),
    eligibility: z.enum(ELIGIBILITY_LABELS).nullable(),
    relevant: z.boolean().nullable(),
    notes: z.string().max(2000).default(""),
  })
  .strict();
export const datasetSchema = z
  .object({
    version: z.literal(1),
    datasetKind: z.enum(["synthetic", "human"]),
    provenance: z.string().trim().min(1),
    reviewers: z
      .array(
        z
          .object({
            id,
            // Reviewer labeled without seeing rubric scores or other reviewers.
            independent: z.boolean(),
          })
          .strict(),
      )
      .default([]),
    profiles: z
      .array(
        z
          .object({
            id,
            profile: profileSchema,
            description: z.string().default(""),
          })
          .strict(),
      )
      .default([]),
    examples: z
      .array(z.object({ id, profileId: id, listing: listingSchema }).strict())
      .default([]),
    labels: z.array(labelSchema).default([]),
  })
  .strict();

// ---------- label CSV ----------
export const CSV_HEADER = [
  "example_id",
  "reviewer_id",
  "fit_label",
  "eligibility_label",
  "relevant_top10",
  "notes",
];
export function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip a UTF-8 BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') ((cell += '"'), i++);
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const csvCell = (v) =>
  /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
export function templateCsv(dataset, reviewer = "") {
  const lines = [CSV_HEADER.join(",")];
  for (const e of dataset.examples)
    lines.push([e.id, reviewer, "", "", "", ""].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}
const bool = (v, where) => {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (["yes", "true", "y", "1"].includes(t)) return true;
  if (["no", "false", "n", "0"].includes(t)) return false;
  if (["unsure", "?"].includes(t)) return null;
  throw new Error(`${where}: relevant_top10 must be yes, no or unsure`);
};
export function labelsFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  for (const name of CSV_HEADER)
    if (!header.includes(name))
      throw new Error(`Label CSV missing column ${name}`);
  const at = (row, name) => (row[header.indexOf(name)] ?? "").trim();
  const labels = [];
  rows.slice(1).forEach((row, i) => {
    const where = `labels row ${i + 2}`;
    const fit = at(row, "fit_label"),
      elig = at(row, "eligibility_label").toLowerCase(),
      relevant = bool(at(row, "relevant_top10"), where);
    // A row with no judgement at all is an unfilled template line.
    if (!fit && !elig && relevant === null && !at(row, "relevant_top10"))
      return;
    if (fit && !/^[0-3]$/.test(fit))
      throw new Error(`${where}: fit_label must be 0-3`);
    if (elig && !ELIGIBILITY_LABELS.includes(elig))
      throw new Error(
        `${where}: eligibility_label must be one of ${ELIGIBILITY_LABELS.join(", ")}`,
      );
    labels.push({
      exampleId: at(row, "example_id"),
      reviewer: at(row, "reviewer_id"),
      fit: fit === "" ? null : Number(fit),
      eligibility: elig || null,
      relevant,
      notes: at(row, "notes"),
    });
  });
  return labels;
}

// ---------- statistics ----------
const fraction = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
  wilson95: wilson95(numerator, denominator),
});
function averageRanks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = rank;
    i = j + 1;
  }
  return ranks;
}
/** Spearman rho with tie correction (Pearson on average ranks); null if undefined. */
export function spearman(xs, ys) {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const a = averageRanks(xs),
    b = averageRanks(ys);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a),
    mb = mean(b);
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

// ---------- consensus ----------
function consensus(labels) {
  const adjudicated = labels.find((l) => l.reviewer === ADJUDICATOR);
  const pool = labels.filter((l) => l.reviewer !== ADJUDICATOR);
  const pick = adjudicated ? [adjudicated] : pool;
  const fits = pick.map((l) => l.fit).filter((v) => v !== null);
  const elig = pick.map((l) => l.eligibility).filter(Boolean);
  const rel = pick.map((l) => l.relevant).filter((v) => v !== null);
  const yes = rel.filter(Boolean).length;
  return {
    adjudicated: !!adjudicated,
    reviewers: pool.length,
    fit: fits.length ? fits.reduce((s, v) => s + v, 0) / fits.length : null,
    eligibility:
      elig.length && elig.every((e) => e === elig[0]) ? elig[0] : null,
    eligibilityConflict: elig.length > 0 && !elig.every((e) => e === elig[0]),
    relevant:
      rel.length && yes * 2 !== rel.length ? yes * 2 > rel.length : null,
    relevantConflict: rel.length > 0 && yes * 2 === rel.length,
  };
}

// ---------- evaluation ----------
export function evaluateDataset(input, extraLabels = []) {
  const dataset = datasetSchema.parse(input);
  const labels = [
    ...dataset.labels,
    ...extraLabels.map((l) => labelSchema.parse(l)),
  ];
  const profiles = new Map(dataset.profiles.map((p) => [p.id, p]));
  const examples = new Map();
  for (const e of dataset.examples) {
    if (examples.has(e.id)) throw new Error(`Duplicate example id ${e.id}`);
    if (!profiles.has(e.profileId))
      throw new Error(
        `Example ${e.id} references unknown profile ${e.profileId}`,
      );
    examples.set(e.id, e);
  }
  const byExample = new Map();
  for (const l of labels) {
    if (!examples.has(l.exampleId))
      throw new Error(`Label references unknown example ${l.exampleId}`);
    const key = `${l.exampleId}\u0000${l.reviewer}`;
    if (byExample.has(key))
      throw new Error(`Duplicate label for ${l.exampleId} by ${l.reviewer}`);
    byExample.set(key, true);
  }
  const reviewerIds = [...new Set(labels.map((l) => l.reviewer))].filter(
    (r) => r !== ADJUDICATOR,
  );
  const declared = new Map(dataset.reviewers.map((r) => [r.id, r]));
  const undeclared = reviewerIds.filter((r) => !declared.has(r));
  const independentReviewers = reviewerIds.filter(
    (r) => declared.get(r)?.independent,
  );

  const rows = [...examples.values()].map((e) => {
    const profile = { ...profiles.get(e.profileId).profile, approved: true };
    const fit = scoreJob(e.listing, profile);
    const eligibility = checkEligibility(e.listing, profile);
    const human = consensus(labels.filter((l) => l.exampleId === e.id));
    return {
      id: e.id,
      profileId: e.profileId,
      title: e.listing.title,
      fit,
      eligibility,
      human,
    };
  });
  const labeled = rows.filter(
    (r) => r.human.reviewers > 0 || r.human.adjudicated,
  );

  // Eligibility agreement (rubric status vs consensus label).
  const eligRows = labeled.filter((r) => r.human.eligibility);
  const eligAgree = eligRows.filter(
    (r) => r.eligibility.status === r.human.eligibility,
  );
  const confusion = {};
  for (const r of eligRows) {
    const k = `human:${r.human.eligibility} -> rubric:${r.eligibility.status}`;
    confusion[k] = (confusion[k] || 0) + 1;
  }
  // The costly error: the rubric says "meets" but a person found a stated restriction.
  const falseMeets = eligRows.filter(
    (r) =>
      r.eligibility.status === "meets" &&
      r.human.eligibility === "does_not_meet",
  );

  // Coverage: how often the rubric declines to score.
  const scoredRows = rows.filter((r) => r.fit.score !== null);
  const coverage = fraction(scoredRows.length, rows.length);

  // Rank correlation by profile.
  const perProfile = [];
  for (const [pid] of profiles) {
    const set = labeled.filter(
      (r) =>
        r.profileId === pid && r.fit.score !== null && r.human.fit !== null,
    );
    const rho = spearman(
      set.map((r) => r.fit.score),
      set.map((r) => r.human.fit),
    );
    perProfile.push({ profileId: pid, n: set.length, spearman: rho });
  }
  const defined = perProfile.filter((p) => p.spearman !== null);
  const meanRho = defined.length
    ? defined.reduce((s, p) => s + p.spearman, 0) / defined.length
    : null;

  // Top-10 relevance: rubric's own top N (excluding known ineligible) per profile.
  const top = [];
  for (const [pid] of profiles) {
    const candidates = rows
      .filter(
        (r) =>
          r.profileId === pid &&
          r.fit.score !== null &&
          r.eligibility.status !== "does_not_meet",
      )
      .sort((a, b) => b.fit.score - a.fit.score || (a.id < b.id ? -1 : 1))
      .slice(0, TOP_N);
    const judged = candidates.filter((r) => r.human.relevant !== null);
    const relevant = judged.filter((r) => r.human.relevant);
    top.push({
      profileId: pid,
      listed: candidates.length,
      judged: judged.length,
      relevant: relevant.length,
      rate: judged.length ? relevant.length / judged.length : null,
      fewerThanTen: candidates.length < TOP_N,
      topIds: candidates.map((r) => r.id),
    });
  }
  const pooled = fraction(
    top.reduce((s, t) => s + t.relevant, 0),
    top.reduce((s, t) => s + t.judged, 0),
  );
  const profilesAtTarget = top.filter(
    (t) => t.rate !== null && t.rate >= TARGET_RELEVANT_RATE,
  ).length;

  // Inter-reviewer agreement (independent reviewers' raw labels only).
  const pairs = { eligibility: [0, 0], fitWithinOne: [0, 0], relevant: [0, 0] };
  for (const e of examples.values()) {
    const ls = labels.filter(
      (l) => l.exampleId === e.id && l.reviewer !== ADJUDICATOR,
    );
    for (let i = 0; i < ls.length; i++)
      for (let j = i + 1; j < ls.length; j++) {
        const a = ls[i],
          b = ls[j];
        if (a.eligibility && b.eligibility) {
          pairs.eligibility[1]++;
          if (a.eligibility === b.eligibility) pairs.eligibility[0]++;
        }
        if (a.fit !== null && b.fit !== null) {
          pairs.fitWithinOne[1]++;
          if (Math.abs(a.fit - b.fit) <= 1) pairs.fitWithinOne[0]++;
        }
        if (a.relevant !== null && b.relevant !== null) {
          pairs.relevant[1]++;
          if (a.relevant === b.relevant) pairs.relevant[0]++;
        }
      }
  }

  // Honesty gate.
  const warnings = [];
  const synthetic = dataset.datasetKind === "synthetic";
  if (synthetic)
    warnings.push(
      "SYNTHETIC DATA: labels were written by the developers alongside the rubric. These results only show the harness runs. They are NOT validation of the rubric, eligibility checks, or the 7/10 relevance target.",
    );
  if (!synthetic) {
    if (rows.length < MIN_EXAMPLES)
      warnings.push(
        `Only ${rows.length} examples (< ${MIN_EXAMPLES}); results are preliminary.`,
      );
    if (profiles.size < MIN_PROFILES)
      warnings.push(
        `Only ${profiles.size} candidate profile(s) (< ${MIN_PROFILES}); ranking results do not generalize across candidates.`,
      );
    if (independentReviewers.length < MIN_INDEPENDENT_REVIEWERS)
      warnings.push(
        `Fewer than ${MIN_INDEPENDENT_REVIEWERS} declared independent reviewers; no agreement between humans can be shown.`,
      );
    if (undeclared.length)
      warnings.push(
        `Reviewers not declared in dataset.reviewers: ${undeclared.join(", ")}.`,
      );
  }
  if (top.some((t) => t.fewerThanTen))
    warnings.push(
      "At least one profile has fewer than 10 rankable examples, so its top-10 is smaller than the PRD metric describes.",
    );
  const unresolved = labeled.filter(
    (r) => r.human.eligibilityConflict || r.human.relevantConflict,
  ).length;
  if (unresolved)
    warnings.push(
      `${unresolved} example(s) have unresolved reviewer disagreement and are excluded from those metrics; adjudicate them.`,
    );
  if (!labeled.length)
    warnings.push(
      "No reviewer labels were supplied; only rubric outputs are shown.",
    );

  const meetsPointTarget =
    pooled.value !== null && pooled.value >= TARGET_RELEVANT_RATE;
  const lowerClears = pooled.wilson95
    ? pooled.wilson95.lower >= TARGET_RELEVANT_RATE
    : false;
  return {
    harness: "discovery-evaluate",
    rubricVersion: RUBRIC_VERSION,
    datasetKind: dataset.datasetKind,
    validation: synthetic
      ? "NOT VALIDATION: synthetic, developer-authored data"
      : warnings.length
        ? "PRELIMINARY: human-labeled but below minimum sample or independence requirements"
        : "Human-labeled run meeting minimum sample thresholds; interpret with the intervals shown. This tool does not certify the rubric.",
    datasetSha256: createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex"),
    provenance: dataset.provenance,
    sizes: {
      profiles: profiles.size,
      examples: rows.length,
      labeledExamples: labeled.length,
      labels: labels.length,
      reviewers: reviewerIds.length,
      independentReviewers: independentReviewers.length,
    },
    eligibility: {
      agreement: fraction(eligAgree.length, eligRows.length),
      confusion,
      falseMeets: {
        count: falseMeets.length,
        ids: falseMeets.map((r) => r.id),
      },
    },
    rankCorrelation: {
      method:
        "Spearman rho per profile (average ranks for ties), unscored examples excluded",
      meanAcrossProfiles: meanRho,
      profilesWithDefinedRho: defined.length,
      perProfile,
    },
    topTenRelevance: {
      definition:
        "Reviewers' relevant_top10 flag (see REVIEW_INSTRUCTIONS.md) for the rubric's own top 10 per profile among examples not known to be ineligible.",
      target: TARGET_RELEVANT_RATE,
      pooled,
      pooledMeetsPointTarget: meetsPointTarget,
      pooledWilsonLowerClearsTarget: lowerClears,
      profilesAtTarget,
      perProfile: top,
    },
    coverage: {
      scored: coverage,
      nullScoreIds: rows.filter((r) => r.fit.score === null).map((r) => r.id),
      note: "A null score means the rubric had under 35 of 100 weight of evidence; it is reported, never counted as a low score.",
    },
    reviewerAgreement: Object.fromEntries(
      Object.entries(pairs).map(([k, [n, d]]) => [k, fraction(n, d)]),
    ),
    warnings,
  };
}

// ---------- output ----------
const pct = (f) =>
  f.denominator === 0
    ? "n/a (0 samples)"
    : `${f.numerator}/${f.denominator} (${(f.value * 100).toFixed(1)}%, Wilson 95% ${(f.wilson95.lower * 100).toFixed(1)}-${(f.wilson95.upper * 100).toFixed(1)}%)`;
export function formatReport(r) {
  const out = [];
  const bar = "=".repeat(72);
  out.push(
    bar,
    `DATA: ${r.datasetKind.toUpperCase()}   rubric ${r.rubricVersion}`,
    r.validation,
    bar,
  );
  for (const w of r.warnings) out.push(`! ${w}`);
  out.push(
    "",
    `Sample: ${r.sizes.examples} examples, ${r.sizes.profiles} profiles, ${r.sizes.labeledExamples} labeled, ${r.sizes.reviewers} reviewer(s) (${r.sizes.independentReviewers} independent)`,
    `Coverage (rubric produced a score): ${pct(r.coverage.scored)}`,
    `Eligibility agreement (rubric vs reviewers): ${pct(r.eligibility.agreement)}`,
    `  rubric "meets" where reviewers found a stated restriction: ${r.eligibility.falseMeets.count}`,
  );
  const rc = r.rankCorrelation;
  out.push(
    `Rank correlation vs reviewer fit: mean Spearman ${rc.meanAcrossProfiles === null ? "n/a" : rc.meanAcrossProfiles.toFixed(2)} over ${rc.profilesWithDefinedRho} profile(s) with enough data`,
  );
  const t = r.topTenRelevance;
  out.push(
    `Top-10 relevance (target >= ${t.target * 100}%): ${pct(t.pooled)}`,
    `  point estimate ${t.pooledMeetsPointTarget ? "meets" : "does not meet"} target; Wilson lower bound ${t.pooledWilsonLowerClearsTarget ? "clears" : "does not clear"} it; ${t.profilesAtTarget}/${t.perProfile.length} profiles at target`,
  );
  for (const [k, v] of Object.entries(r.reviewerAgreement))
    if (v.denominator) out.push(`Reviewer agreement, ${k}: ${pct(v)}`);
  out.push("");
  if (r.datasetKind === "synthetic")
    out.push("REMINDER: synthetic results are NOT validation.");
  return out.join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const path = args.find(
    (a, i) =>
      !a.startsWith("--") &&
      args[i - 1] !== "--labels" &&
      args[i - 1] !== "--out" &&
      args[i - 1] !== "--reviewer",
  );
  if (!path) {
    console.error(
      "Usage: discovery-evaluate <dataset.json> [--labels file.csv] [--template [--reviewer id]] [--json] [--out report.json]",
    );
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(path, "utf8"));
  if (flag("--template")) {
    process.stdout.write(
      templateCsv(datasetSchema.parse(input), value("--reviewer") || ""),
    );
    return;
  }
  const extra = value("--labels")
    ? labelsFromCsv(readFileSync(value("--labels"), "utf8"))
    : [];
  const report = evaluateDataset(input, extra);
  if (value("--out"))
    writeFileSync(value("--out"), JSON.stringify(report, null, 2) + "\n");
  console.log(
    flag("--json") ? JSON.stringify(report, null, 2) : formatReport(report),
  );
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main(process.argv);
  } catch (error) {
    console.error("discovery-evaluate:", error.message);
    process.exit(1);
  }
}
