#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { wilson95 } from "./phase0-evaluate.js";

const stages = [
  "Saved", "Preparing", "Submitted", "Under review", "Assessment",
  "Interviewing", "Offer", "Rejected", "Withdrawn",
];

function requireObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
}

function validateGold(input) {
  requireObject(input, "Invalid stage gold file");
  if (input.version !== 1 || typeof input.provenance !== "string" || !input.provenance.trim() || !Array.isArray(input.examples) || !input.examples.length)
    throw new Error("Invalid stage gold file");
  const ids = new Set();
  for (const row of input.examples) {
    requireObject(row, "Invalid stage gold example");
    if (typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)) throw new Error("Duplicate or invalid gold ID");
    if (row.beforeStage !== null && (typeof row.beforeStage !== "string" || !row.beforeStage.trim())) throw new Error("Invalid beforeStage");
    if (row.expectedStage !== null && (typeof row.expectedStage !== "string" || !row.expectedStage.trim())) throw new Error("Invalid expectedStage");
    if (
      typeof row.safeToAutoApply !== "boolean" || typeof row.manualLock !== "boolean" ||
      typeof row.applicationLinkCorrect !== "boolean" || typeof row.chronologyValid !== "boolean"
    ) throw new Error("Invalid stage safety labels");
    if (row.safeToAutoApply && (row.expectedStage === null || row.manualLock || !row.applicationLinkCorrect || !row.chronologyValid))
      throw new Error("Unsafe stage gold label");
    ids.add(row.id);
  }
  return ids;
}

function validatePredictions(input, goldIds) {
  requireObject(input, "Invalid stage predictions file");
  if (input.version !== 1 || typeof input.system !== "string" || !input.system.trim() || !Array.isArray(input.predictions))
    throw new Error("Invalid stage predictions file");
  const rows = new Map();
  for (const row of input.predictions) {
    requireObject(row, "Invalid stage prediction");
    if (typeof row.id !== "string" || rows.has(row.id)) throw new Error("Duplicate prediction ID");
    if (row.proposedStage !== null && (typeof row.proposedStage !== "string" || !row.proposedStage.trim())) throw new Error("Invalid proposed stage");
    if (typeof row.automatic !== "boolean" || typeof row.applicationMatched !== "boolean" || typeof row.chronologyValid !== "boolean")
      throw new Error("Invalid stage prediction flags");
    rows.set(row.id, row);
  }
  if (rows.size !== goldIds.size || [...goldIds].some((id) => !rows.has(id)) || [...rows.keys()].some((id) => !goldIds.has(id)))
    throw new Error("Gold and prediction case IDs must match");
  return rows;
}

function fraction(numerator, denominator) {
  return { numerator, denominator, value: denominator ? numerator / denominator : null, wilson95: wilson95(numerator, denominator) };
}

export function evaluateStageMapping(goldInput, predictionInput) {
  const ids = validateGold(goldInput);
  const predictions = validatePredictions(predictionInput, ids);
  let automatic = 0;
  let correctAutomatic = 0;
  let chronologyFailures = 0;
  let applicationLinkFailures = 0;
  let safeOpportunities = 0;
  const stageNames = new Set(stages);
  for (const row of goldInput.examples) {
    const prediction = predictions.get(row.id);
    if (row.expectedStage) stageNames.add(row.expectedStage);
    if (prediction.proposedStage) stageNames.add(prediction.proposedStage);
    if (row.safeToAutoApply) safeOpportunities++;
    if (!prediction.automatic) continue;
    automatic++;
    if (prediction.chronologyValid !== row.chronologyValid) chronologyFailures++;
    if (prediction.applicationMatched !== row.applicationLinkCorrect) applicationLinkFailures++;
    if (
      row.safeToAutoApply && !row.manualLock && row.expectedStage === prediction.proposedStage &&
      row.applicationLinkCorrect && row.chronologyValid && prediction.applicationMatched && prediction.chronologyValid
    ) correctAutomatic++;
  }
  const perStage = Object.fromEntries([...stageNames].sort().map((stage) => {
    let truePositive = 0;
    let autoPredicted = 0;
    let safeGold = 0;
    for (const row of goldInput.examples) {
      const prediction = predictions.get(row.id);
      if (prediction.automatic && prediction.proposedStage === stage) autoPredicted++;
      if (row.safeToAutoApply && !row.manualLock && row.expectedStage === stage) safeGold++;
      if (
        prediction.automatic && prediction.proposedStage === stage && row.safeToAutoApply &&
        !row.manualLock && row.expectedStage === stage && row.applicationLinkCorrect && row.chronologyValid &&
        prediction.applicationMatched && prediction.chronologyValid
      ) truePositive++;
    }
    return [stage, { precision: fraction(truePositive, autoPredicted), recall: fraction(truePositive, safeGold) }];
  }));
  return {
    check: "phase0-stage-mapping-evaluation",
    provenance: goldInput.provenance,
    system: predictionInput.system,
    cases: ids.size,
    automaticallyAppliedTransitions: automatic,
    correctAutomaticTransitions: correctAutomatic,
    falseTransitions: automatic - correctAutomatic,
    automaticStatusPrecision: fraction(correctAutomatic, automatic),
    safeTransitionRecall: fraction(correctAutomatic, safeOpportunities),
    automaticCoverage: fraction(automatic, ids.size),
    chronologyFailures,
    applicationLinkFailures,
    perStage,
    productionReady: false,
  };
}

function main() {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: npm run phase0:stage-evaluate -- GOLD.json PREDICTIONS.json");
    const gold = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const predictions = JSON.parse(readFileSync(process.argv[3], "utf8"));
    console.log(JSON.stringify(evaluateStageMapping(gold, predictions), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
