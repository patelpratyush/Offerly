import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, wilson95, validateExtendedFixtures } from "../scripts/phase0-evaluate.js";
const gold = JSON.parse(
  readFileSync(new URL("../eval/phase0/recruiting.json", import.meta.url)),
);
const dev = () => ({
  version: 1,
  split: "dev",
  system: "deliberately-imperfect-fixture-not-model",
  predictions: gold.examples
    .filter((x) => x.split === "dev")
    .map((x) => ({ id: x.id, applicationId: null, events: [] })),
});
test("evaluation counts false positives, abstentions and zero denominators", () => {
  const input = dev();
  input.predictions[0] = {
    id: "mail-confirmation",
    applicationId: "atlas-backend",
    events: ["confirmation"],
  };
  input.predictions[2] = {
    id: "mail-newsletter",
    applicationId: "atlas-data",
    events: ["offer"],
  };
  const result = evaluate(gold, input);
  assert.deepEqual(result.applicationLinkPrecision, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
    wilson95: { lower: 0.09453120573423074, upper: 0.9054687942657693 },
  });
  assert.equal(result.applicationLinkRecall.denominator, 3);
  assert.equal(result.eventPrecision.value, 0.5);
  assert.equal(result.eventRecall.value, 0.5);
  assert.equal(result.fullAbstentionRate.value, 0.5);
  assert.equal(result.perEvent.rejection.precision.value, null);
  const none = evaluate(gold, dev());
  assert.equal(none.eventPrecision.value, null);
  assert.equal(none.eventRecall.value, 0);
});
test("Wilson 95 percent intervals use bounded proportions and null zero denominators", () => {
  const interval = wilson95(1, 2);
  assert.ok(Math.abs(interval.lower - 0.09453120573423074) < 1e-12);
  assert.ok(Math.abs(interval.upper - 0.9054687942657693) < 1e-12);
  assert.deepEqual(wilson95(0, 0), null);
  assert.deepEqual(wilson95(0, 10), { lower: 0, upper: 0.2775327998628892 });
});
test("extended synthetic fixtures validate added event taxonomy and multiple applications", () => {
  const extended = JSON.parse(readFileSync(new URL("../eval/phase0/recruiting-extended.json", import.meta.url)));
  assert.deepEqual(validateExtendedFixtures(extended), { valid: true, examples: 9, eventTypes: 12 });
  assert.equal(extended.examples.find((item) => item.id === "extended-multi-app-message").input.applications.length, 2);
  const invalid = structuredClone(extended);
  invalid.examples[0].expected.events = ["unknown-event"];
  assert.throws(() => validateExtendedFixtures(invalid));
});
test("evaluation rejects missing IDs, duplicate IDs and held-out leakage", () => {
  const input = dev();
  input.predictions.pop();
  assert.throws(() => evaluate(gold, input), /Every split/);
  const duplicate = dev();
  duplicate.predictions[1] = duplicate.predictions[0];
  assert.throws(() => evaluate(gold, duplicate), /Duplicate prediction/);
  const leak = dev();
  leak.predictions[0].id = "mail-offer";
  assert.throws(() => evaluate(gold, leak), /wrong-split/);
  const leakedGold = structuredClone(gold);
  leakedGold.examples.at(-1).family = gold.examples[0].family;
  assert.throws(() => evaluate(leakedGold, dev()), /Family leaks/);
});
test("evaluation rejects unknown fields, applications and repeated events", () => {
  const input = dev();
  input.predictions[0].applicationId = "invented";
  assert.throws(() => evaluate(gold, input), /Unknown predicted application/);
  const events = dev();
  events.predictions[0].events = ["offer", "offer"];
  assert.throws(() => evaluate(gold, events), /Duplicate predicted event/);
  const bad = dev();
  bad.predictions[0].confidence = 1;
  assert.throws(() => evaluate(gold, bad));
});

test("fit metrics reject invented precision and preserve unknown eligibility and currency", async () => {
  const { evaluateFit } = await import("../scripts/phase0-evaluate.js");
  const fit = JSON.parse(
    readFileSync(new URL("../eval/phase0/job-fit.json", import.meta.url)),
  );
  const input = {
    version: 1,
    split: "dev",
    system: "imperfect-test-fixture",
    predictions: [
      {
        id: "fit-backend",
        score: 80,
        eligibility: "unknown",
        evidence: ["Authorization unknown"],
        compensation: { base: 120000, total: null, currency: "USD" },
        confirmedLast24Hours: true,
      },
      {
        id: "fit-senior",
        score: null,
        eligibility: "eligible",
        evidence: ["Deliberate wrong fixture"],
        compensation: { base: null, total: null, currency: null },
        confirmedLast24Hours: false,
      },
    ],
  };
  const result = evaluateFit(fit, input);
  assert.equal(result.eligibilityAccuracy.value, 0.5);
  assert.equal(result.recencyAccuracy.value, 0.5);
  assert.equal(result.scoreCoverage.value, 0.5);
  assert.equal(result.provisionalRangeAgreement.denominator, 1);
  input.predictions[0].compensation.currency = "CAD";
  assert.equal(evaluateFit(fit, input).compensationExactAccuracy.value, 0.5);
  input.predictions[0].id = "fit-visa";
  assert.throws(() => evaluateFit(fit, input), /wrong-split/);
});

test("fit gold rejects impossible ranges, family leakage and unsupported labels", async () => {
  const { evaluateFit } = await import("../scripts/phase0-evaluate.js");
  const fit = JSON.parse(
    readFileSync(new URL("../eval/phase0/job-fit.json", import.meta.url)),
  );
  const predictions = {
    version: 1,
    split: "dev",
    system: "abstaining-fixture",
    predictions: fit.examples
      .filter((x) => x.split === "dev")
      .map((x) => ({
        id: x.id,
        score: null,
        eligibility: "unknown",
        evidence: ["Insufficient evidence"],
        compensation: { base: null, total: null, currency: null },
        confirmedLast24Hours: false,
      })),
  };
  const range = structuredClone(fit);
  range.examples[0].expected.provisionalFitRange = { minimum: 90, maximum: 20 };
  assert.throws(() => evaluateFit(range, predictions), /Invalid fit range/);
  const leak = structuredClone(fit);
  leak.examples[2].family = leak.examples[0].family;
  assert.throws(() => evaluateFit(leak, predictions), /Family leaks/);
  const date = structuredClone(fit);
  date.examples[0].postedAt = null;
  assert.throws(() => evaluateFit(date, predictions), /Posting date label/);
  const amount = structuredClone(fit);
  amount.examples[0].description = "Requires Node.js and PostgreSQL.";
  assert.throws(() => evaluateFit(amount, predictions), /Compensation label/);
  const recency = structuredClone(fit);
  recency.examples[0].expected.confirmedLast24Hours = false;
  assert.throws(() => evaluateFit(recency, predictions), /Recency label/);
});
