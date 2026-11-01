import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EVENT_TYPES,
  mergeAdjudicatedLabels,
  redactForExternalEvaluation,
  runAdjudicatedMailEvaluation,
  scoreEventPredictions,
} from "../../scripts/phase0-openai-adjudicated-mail.js";

const review = (caseId, events, app = "NONE") => ({
  case_id: caseId,
  subject: "Interview update",
  body: "We are reviewing your application.",
  received_at: "2026-10-30T12:00:00Z",
  candidate_applications: "[]",
  reviewer_application_id: app,
  reviewer_events: events,
  confidence: "high",
});

test("external evaluation redacts contact details, greetings, signatures, and quoted history", () => {
  const result = redactForExternalEvaluation({
    subject: "Hello Alex Smith, interview at acme.test",
    body: "Dear Pratyush Patel, your interview is confirmed. Call (212) 555-0199 or email alex@example.test.\n\nBest,\nTaylor Morgan\nFrom: old@example.test\n> Old rejection",
  });
  assert.doesNotMatch(`${result.subject}\n${result.body}`, /Alex Smith|Pratyush Patel|Taylor Morgan|555-0199|alex@example\.test|old@example\.test|Old rejection|https?:\/\//i);
  assert.match(result.body, /interview is confirmed/i);
  assert.ok(result.redactions.emails >= 1);
  assert.ok(result.redactions.phones >= 1);
  assert.equal(result.redactions.quotedHistory, true);
  assert.equal(result.redactions.signature, true);
});

test("gold merge uses owner adjudication for disputed rows and reviewer consensus for others", () => {
  const reviewer1 = [review("disputed", "review-update", "Acme — Designer"), review("consensus", "confirmation")];
  const reviewer2 = [review("disputed", "cancellation", "NONE"), review("consensus", "confirmation")];
  const adjudication = [{
    case_id: "disputed",
    subject: "Interview update",
    body: "We are reviewing your application.",
    received_at: "2026-10-30T12:00:00Z",
    adjudicated_events: "review-update",
    reviewer1_events: "review-update",
    reviewer2_events: "cancellation",
    reviewer1_application_match: "Acme — Designer",
    reviewer2_application_match: "NONE",
    adjudication_notes: "Evidence supports current review update.",
  }];
  const result = mergeAdjudicatedLabels(reviewer1, reviewer2, adjudication);
  assert.deepEqual(result.map((row) => row.expectedEvents), [["review-update"], ["confirmation"]]);
  assert.deepEqual(result.map((row) => row.caseId), ["disputed", "consensus"]);
  assert.equal(result[0].candidate_applications, undefined);
});

test("gold merge refuses unresolved reviewer disagreements and altered packet text", () => {
  assert.throws(
    () => mergeAdjudicatedLabels([review("one", "confirmation")], [review("one", "offer")], []),
    /Adjudication missing/,
  );
  const altered = { ...review("one", "confirmation"), body: "edited" };
  assert.throws(
    () => mergeAdjudicatedLabels([review("one", "confirmation")], [altered], []),
    /packet content does not match/,
  );
});

test("event scoring reports multi-label precision, recall, exact match, and null denominators", () => {
  assert.equal(EVENT_TYPES.length, 12);
  const report = scoreEventPredictions(
    [
      { caseId: "one", expectedEvents: ["confirmation"] },
      { caseId: "two", expectedEvents: [] },
    ],
    [
      { caseId: "one", predictedEvents: ["confirmation", "offer"], success: true },
      { caseId: "two", predictedEvents: [], success: true },
    ],
  );
  assert.equal(report.eventPrecision.numerator, 1);
  assert.equal(report.eventPrecision.denominator, 2);
  assert.equal(report.eventRecall.value, 1);
  assert.equal(report.exactEventSetAgreement.value, 0.5);
  assert.equal(report.perEvent.offer.precision.value, 0);
  assert.equal(report.perEvent.offer.recall.wilson95, null);
});

test("private run sends only redacted subject/body, scores ten cases, and prevents repeat spend", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "offerly-private-mail-eval-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const reviewerHeader = "case_id,subject,body,received_at,candidate_applications,reviewer_application_id,reviewer_events,confidence\n";
  const adjudicationHeader = "case_id,subject,body,received_at,reviewer1_application_match,reviewer2_application_match,reviewer1_events,reviewer2_events,adjudicated_events,adjudication_notes\n";
  const cell = (value) => `"${value.replaceAll('"', '""')}"`;
  const reviewers = [[], []];
  const adjudications = [];
  for (let index = 1; index <= 10; index++) {
    const id = `mail-${String(index).padStart(2, "0")}`;
    const app1 = index <= 6 ? "Acme — Designer" : "NONE";
    const app2 = index <= 6 ? "NONE" : app1;
    const event1 = index === 1 ? "offer" : "confirmation";
    const event2 = "confirmation";
    const subject = "Interview update for Alex Example";
    const body = "We received your application. Contact test.user@example.test or call 212-555-0188 at https://example.test/private";
    for (const [reviewer, app, event] of [[0, app1, event1], [1, app2, event2]])
      reviewers[reviewer].push([id, subject, body, "2026-10-30T12:00:00Z", "[]", app, event, "high"].map(cell).join(","));
    if (index <= 6)
      adjudications.push([id, subject, body, "2026-10-30T12:00:00Z", app1, app2, event1, event2, "confirmation", "Adjudicated from current email evidence."].map(cell).join(","));
  }
  const paths = {
    reviewer1Path: join(directory, "reviewer1.csv"),
    reviewer2Path: join(directory, "reviewer2.csv"),
    adjudicationPath: join(directory, "adjudication.csv"),
    outputPath: join(directory, "evaluation.json"),
  };
  writeFileSync(paths.reviewer1Path, reviewerHeader + reviewers[0].join("\n") + "\n", { mode: 0o600 });
  writeFileSync(paths.reviewer2Path, reviewerHeader + reviewers[1].join("\n") + "\n", { mode: 0o600 });
  writeFileSync(paths.adjudicationPath, adjudicationHeader + adjudications.join("\n") + "\n", { mode: 0o600 });
  chmodSync(directory, 0o700);
  const sent = [];
  let calls = 0;
  const request = async ({ input }) => {
    calls++;
    sent.push(JSON.stringify(input));
    return { value: { events: ["confirmation"] }, usage: { inputTokens: 100, outputTokens: 10 } };
  };
  const report = await runAdjudicatedMailEvaluation({ apiKey: "test-only", request, paths });
  assert.equal(report.status, "completed");
  assert.equal(report.privacy.eventLabelSources.ownerAdjudicatedCases, 6);
  assert.equal(report.privacy.eventLabelSources.reviewerConsensusCases, 4);
  assert.equal(report.metrics.eventPrecision.value, 1);
  assert.equal(report.metrics.eventRecall.value, 1);
  assert.equal(report.usageCostEstimateUsd, 0.00015);
  assert.equal(Object.hasOwn(report, "actualCostUsd"), false);
  assert.equal(calls, 10);
  assert.ok(sent.every((input) => !input.includes("mail-01") && !input.includes("confirmation")));
  assert.ok(sent.every((input) => !/test\.user@example\.test|212-555-0188|https?:\/\//u.test(input)));
  assert.doesNotMatch(sent.join(" "), /Alex Example/u);
  const stored = readFileSync(paths.outputPath, "utf8");
  assert.equal(stored.includes("test.user@example.test"), false);
  assert.equal(stored.includes("Interview update for Alex Example"), false);
  assert.equal(stored.includes("We received your application"), false);
  assert.equal(statSync(paths.outputPath).mode & 0o777, 0o600);
  await assert.rejects(runAdjudicatedMailEvaluation({ apiKey: "test-only", request, paths }));
  assert.equal(calls, 10);
});
