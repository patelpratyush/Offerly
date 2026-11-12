import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateDataset,
  formatReport,
  labelsFromCsv,
  parseCsv,
  spearman,
  templateCsv,
  datasetSchema,
} from "../../scripts/discovery-evaluate.js";

const read = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../reference/phase1-discovery/${name}`, import.meta.url),
      "utf8",
    ),
  );

test("synthetic seed set runs and is flagged as not validation", () => {
  const report = evaluateDataset(read("synthetic-seed.json"));
  assert.equal(report.datasetKind, "synthetic");
  assert.match(report.validation, /NOT VALIDATION/);
  assert.ok(report.warnings.some((w) => /SYNTHETIC DATA/.test(w)));
  assert.equal(report.sizes.examples, 16);
  assert.equal(report.sizes.independentReviewers, 0);
  assert.equal(report.coverage.scored.denominator, 16);
  assert.equal(report.eligibility.agreement.denominator, 16);
  assert.ok(report.eligibility.agreement.wilson95.lower < 1);
  assert.equal(report.topTenRelevance.target, 0.7);
  assert.equal(report.topTenRelevance.pooledMeetsPointTarget, false);
  const text = formatReport(report);
  assert.match(text, /DATA: SYNTHETIC/);
  assert.match(text, /synthetic results are NOT validation/);
});

test("a blank human template evaluates to an empty, preliminary report", () => {
  const report = evaluateDataset({
    ...read("dataset-template.json"),
    examples: [],
  });
  assert.equal(report.sizes.examples, 0);
  assert.match(report.validation, /PRELIMINARY/);
  assert.equal(report.topTenRelevance.pooled.value, null);
  assert.ok(report.warnings.some((w) => /No reviewer labels/.test(w)));
});

test("human-labeled data below the sample minimum is reported as preliminary", () => {
  const data = read("synthetic-seed.json");
  const human = { ...data, datasetKind: "human" };
  const report = evaluateDataset(human);
  assert.match(report.validation, /PRELIMINARY/);
  assert.ok(report.warnings.some((w) => /Only 16 examples/.test(w)));
  assert.ok(report.warnings.some((w) => /independent reviewers/.test(w)));
});

test("labels merge from CSV, conflicts are excluded and adjudication wins", () => {
  const data = read("synthetic-seed.json");
  data.labels = [];
  data.reviewers = [
    { id: "r1", independent: true },
    { id: "r2", independent: true },
  ];
  const csv = [
    "example_id,reviewer_id,fit_label,eligibility_label,relevant_top10,notes",
    "a1,r1,3,meets,yes,",
    'a1,r2,2,does_not_meet,no,"quoted, note"',
    "a2,r1,3,meets,yes,",
    "a2,r2,3,meets,yes,",
    "a3,r1,,,,",
    "a1,adjudicated,3,meets,yes,tie broken",
  ].join("\n");
  const labels = labelsFromCsv(csv);
  assert.equal(labels.length, 5, "an all-blank row is skipped");
  assert.equal(labels[1].notes, "quoted, note");
  const report = evaluateDataset(data, labels);
  assert.equal(report.eligibility.agreement.denominator, 2);
  assert.equal(report.reviewerAgreement.eligibility.denominator, 2);
  assert.equal(report.reviewerAgreement.eligibility.numerator, 1);
  // Without adjudication the same labels leave a1 unresolved.
  const without = evaluateDataset(
    data,
    labels.filter((l) => l.reviewer !== "adjudicated"),
  );
  assert.equal(without.eligibility.agreement.denominator, 1);
  assert.ok(
    without.warnings.some((w) => /unresolved reviewer disagreement/.test(w)),
  );
});

test("bad label files and datasets fail closed", () => {
  assert.throws(() => labelsFromCsv("a,b\n1,2"), /missing column/);
  const head =
    "example_id,reviewer_id,fit_label,eligibility_label,relevant_top10,notes\n";
  assert.throws(
    () => labelsFromCsv(head + "a1,r1,7,,,"),
    /fit_label must be 0-3/,
  );
  assert.throws(
    () => labelsFromCsv(head + "a1,r1,2,maybe,,"),
    /eligibility_label/,
  );
  assert.throws(
    () => labelsFromCsv(head + "a1,r1,2,meets,perhaps,"),
    /relevant_top10/,
  );
  const data = read("synthetic-seed.json");
  assert.throws(
    () =>
      evaluateDataset(data, [
        {
          exampleId: "nope",
          reviewer: "r",
          fit: 1,
          eligibility: null,
          relevant: null,
        },
      ]),
    /unknown example/,
  );
  assert.throws(
    () =>
      evaluateDataset({
        ...data,
        examples: [data.examples[0], data.examples[0]],
      }),
    /Duplicate example/,
  );
  assert.throws(() => datasetSchema.parse({ ...data, datasetKind: "real" }));
});

test("spearman handles ties, reversals and undefined cases", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 2, 3], [5, 5, 5]), null);
  assert.equal(spearman([1, 2], [1, 2]), null);
  const tied = spearman([1, 2, 2, 4], [1, 2, 3, 4]);
  assert.ok(tied > 0.9 && tied < 1);
});

test("template CSV lists every example and round-trips through the parser", () => {
  const data = datasetSchema.parse(read("synthetic-seed.json"));
  const rows = parseCsv(templateCsv(data, "reviewer-a"));
  assert.equal(rows.length, data.examples.length + 1);
  assert.equal(rows[1][1], "reviewer-a");
  assert.deepEqual(labelsFromCsv(templateCsv(data)), []);
});
