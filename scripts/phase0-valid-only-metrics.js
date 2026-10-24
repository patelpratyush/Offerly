import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluate } from "./phase0-evaluate.js";

const reportPath = "reference/phase0/model-reasoning-fresh.json";
const fixturePath = "eval/phase0/recruiting-fresh.json";
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const fixtureBytes = readFileSync(fixturePath);
const fixtureHash = createHash("sha256").update(fixtureBytes).digest("hex");
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const validIds = new Set(
  report.diagnostics.filter((item) => item.valid).map((item) => item.id),
);
const excluded = report.diagnostics
  .filter((item) => !item.valid)
  .map(({ id, category, durationMs }) => ({ id, category, durationMs }));

if (
  report.complete ||
  validIds.size === 0 ||
  report.fixtureSha256 !== fixtureHash
) {
  throw new Error("Expected an incomplete run with valid predictions");
}
const validFixture = {
  ...fixture,
  examples: fixture.examples.filter((item) => validIds.has(item.id)),
};
const score = (key) =>
  evaluate(validFixture, {
    ...report[key],
    predictions: report[key].predictions.filter((item) =>
      validIds.has(item.id),
    ),
  });
const output = {
  version: 1,
  provenance: "Secondary valid-only slice; incomplete run; not launch-grade",
  sourceReport: reportPath,
  fixture: fixturePath,
  fixtureSha256: report.fixtureSha256,
  completeRun: false,
  validExamples: validIds.size,
  plannedExamples: report.coverage.denominator,
  excluded,
  rawMetrics: score("raw"),
  guardedMetrics: score("guarded"),
  limitations: [
    "Excludes invalid, timed-out, or failed outputs; these remain failures in full-run coverage.",
    "Synthetic authored labels are not independently human validated.",
    "Small valid-only slice cannot establish production accuracy or safe automatic stage changes.",
  ],
};
console.log(JSON.stringify(output, null, 2));
