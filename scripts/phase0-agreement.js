#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "csv-parse/sync";
import { evaluate } from "./phase0-evaluate.js";

const required = [
  "case_id",
  "subject",
  "body",
  "received_at",
  "candidate_applications",
  "reviewer_application_id",
  "reviewer_events",
  "confidence",
];
const allowedEvents = ["confirmation", "assessment", "interview", "rejection", "offer"];
const confidences = new Set(["high", "medium", "low"]);

function readReviewer(path) {
  let rows;
  try {
    rows = parse(readFileSync(path), { columns: true, bom: true, skip_empty_lines: true, trim: true });
  } catch {
    throw new Error("Invalid reviewer CSV");
  }
  if (!rows.length || required.some((field) => !Object.hasOwn(rows[0], field)))
    throw new Error("Reviewer CSV missing required columns or rows");
  const seen = new Set();
  for (const row of rows) {
    if (required.some((field) => !row[field]?.trim())) throw new Error("Reviewer CSV is incomplete");
    if (seen.has(row.case_id)) throw new Error("Duplicate case_id");
    seen.add(row.case_id);
    let candidates;
    try { candidates = JSON.parse(row.candidate_applications); } catch { throw new Error("Invalid candidate applications"); }
    if (!Array.isArray(candidates) || candidates.some((item) => !item || typeof item.id !== "string"))
      throw new Error("Invalid candidate applications");
    const app = row.reviewer_application_id;
    if (app !== "NONE" && !candidates.some((item) => item.id === app))
      throw new Error("Reviewer application ID is not a candidate");
    const events = row.reviewer_events === "NONE" ? [] : row.reviewer_events.split(",").map((value) => value.trim());
    if (events.some((value) => !allowedEvents.includes(value)) || new Set(events).size !== events.length)
      throw new Error("Invalid reviewer event labels");
    if (!confidences.has(row.confidence)) throw new Error("Invalid reviewer confidence");
    row._events = events;
    row._candidates = candidates;
  }
  return new Map(rows.map((row) => [row.case_id, row]));
}

function metric(left, right) {
  const n = left.length;
  const observed = left.reduce((sum, value, i) => sum + Number(value === right[i]), 0) / n;
  const categories = new Set([...left, ...right]);
  const expected = [...categories].reduce((sum, category) =>
    sum + (left.filter((value) => value === category).length / n) * (right.filter((value) => value === category).length / n), 0);
  return { agreement: observed, percentAgreement: Number((observed * 100).toFixed(2)), cohensKappa: expected === 1 ? null : (observed - expected) / (1 - expected) };
}

export function compareReviewerRows(first, second) {
  if (first.size !== second.size || [...first.keys()].some((id) => !second.has(id)))
    throw new Error("Reviewer case_ids do not match");
  const ids = [...first.keys()];
  const appA = ids.map((id) => first.get(id).reviewer_application_id);
  const appB = ids.map((id) => second.get(id).reviewer_application_id);
  const events = Object.fromEntries(allowedEvents.map((event) => {
    const a = ids.map((id) => first.get(id)._events.includes(event));
    const b = ids.map((id) => second.get(id)._events.includes(event));
    return [event, metric(a, b)];
  }));
  const linkDisagreements = ids.filter((_, index) => appA[index] !== appB[index]);
  const eventDisagreements = Object.fromEntries(allowedEvents.map((event) => [
    event,
    ids.filter((id) => first.get(id)._events.includes(event) !== second.get(id)._events.includes(event)),
  ]));
  return {
    cases: ids.length,
    applicationLink: metric(appA, appB),
    events,
    linkDisagreeingCaseIds: linkDisagreements,
    eventDisagreements,
    disagreeingCaseIds: ids.filter((id) =>
      linkDisagreements.includes(id) || allowedEvents.some((event) => eventDisagreements[event].includes(id)),
    ),
  };
}

export function compareFiles(firstPath, secondPath) {
  return compareReviewerRows(readReviewer(firstPath), readReviewer(secondPath));
}

export function evaluateAdjudicatedFile(adjudicatedPath, predictions) {
  const rows = readReviewer(adjudicatedPath);
  const examples = [...rows.values()].map((row, index) => ({
    id: row.case_id,
    split: "held-out",
    family: `agreement-${index}`,
    input: {
      subject: row.subject,
      body: row.body,
      receivedAt: row.received_at,
      applications: row._candidates,
    },
    expected: {
      applicationId: row.reviewer_application_id === "NONE" ? null : row.reviewer_application_id,
      events: row._events,
      rationale: "Adjudicated reviewer label.",
    },
  }));
  return evaluate(
    { version: 1, provenance: "synthetic; authored labels; not independently human validated", examples },
    predictions,
  );
}

function main() {
  try {
    if (![4, 6].includes(process.argv.length))
      throw new Error("Usage: npm run phase0:agreement -- REVIEWER_A.csv REVIEWER_B.csv [ADJUDICATED.csv PREDICTIONS.json]");
    const report = compareFiles(process.argv[2], process.argv[3]);
    if (process.argv.length === 6)
      report.adjudicatedEvaluation = evaluateAdjudicatedFile(process.argv[4], JSON.parse(readFileSync(process.argv[5], "utf8")));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
