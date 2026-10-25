import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStageMapping } from "../../scripts/phase0-stage-evaluate.js";

const gold = {
  version: 1,
  provenance: "synthetic; authored labels; not independently human validated",
  examples: [
    { id: "safe-interview", beforeStage: "Assessment", expectedStage: "Interviewing", safeToAutoApply: true, manualLock: false, applicationLinkCorrect: true, chronologyValid: true },
    { id: "locked-offer", beforeStage: "Interviewing", expectedStage: "Offer", safeToAutoApply: false, manualLock: true, applicationLinkCorrect: true, chronologyValid: true },
    { id: "availability", beforeStage: "Submitted", expectedStage: null, safeToAutoApply: false, manualLock: false, applicationLinkCorrect: true, chronologyValid: true },
  ],
};

test("stage evaluation scores only safe, correctly linked, chronological automatic transitions", () => {
  const predictions = {
    version: 1,
    system: "synthetic-test",
    predictions: [
      { id: "safe-interview", proposedStage: "Interviewing", automatic: true, applicationMatched: true, chronologyValid: true },
      { id: "locked-offer", proposedStage: "Offer", automatic: true, applicationMatched: false, chronologyValid: false },
      { id: "availability", proposedStage: "Interviewing", automatic: true, applicationMatched: true, chronologyValid: true },
    ],
  };
  const report = evaluateStageMapping(gold, predictions);
  assert.deepEqual(report.automaticStatusPrecision, {
    numerator: 1,
    denominator: 3,
    value: 1 / 3,
    wilson95: report.automaticStatusPrecision.wilson95,
  });
  assert.equal(report.falseTransitions, 2);
  assert.equal(report.chronologyFailures, 1);
  assert.equal(report.applicationLinkFailures, 1);
  assert.equal(report.automaticCoverage.value, 1);
  assert.equal(report.perStage.Interviewing.precision.numerator, 1);
  assert.equal(report.perStage.Offer.precision.numerator, 0);
});

test("stage evaluation rejects missing, duplicate, and mismatched prediction IDs", () => {
  const base = { version: 1, system: "test", predictions: [] };
  assert.throws(() => evaluateStageMapping(gold, base), /case IDs/);
  assert.throws(() => evaluateStageMapping(gold, { ...base, predictions: [
    { id: "safe-interview", proposedStage: null, automatic: false, applicationMatched: false, chronologyValid: true },
    { id: "safe-interview", proposedStage: null, automatic: false, applicationMatched: false, chronologyValid: true },
    { id: "locked-offer", proposedStage: null, automatic: false, applicationMatched: false, chronologyValid: true },
    { id: "availability", proposedStage: null, automatic: false, applicationMatched: false, chronologyValid: true },
  ] }), /Duplicate prediction ID/);
});

test("stage evaluation reports null precision and recall with zero denominators", () => {
  const none = {
    version: 1,
    provenance: "synthetic; authored labels; not independently human validated",
    examples: [{ id: "none", beforeStage: "Saved", expectedStage: null, safeToAutoApply: false, manualLock: false, applicationLinkCorrect: true, chronologyValid: true }],
  };
  const predictions = { version: 1, system: "test", predictions: [
    { id: "none", proposedStage: null, automatic: false, applicationMatched: false, chronologyValid: true },
  ] };
  const report = evaluateStageMapping(none, predictions);
  assert.equal(report.automaticStatusPrecision.value, null);
  assert.equal(report.safeTransitionRecall.value, null);
  assert.equal(report.automaticCoverage.value, 0);
});
