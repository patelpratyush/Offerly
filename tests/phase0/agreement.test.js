import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareFiles, evaluateAdjudicatedFile } from "../../scripts/phase0-agreement.js";

const header = "case_id,subject,body,received_at,candidate_applications,reviewer_application_id,reviewer_events,confidence,reviewer_notes\n";
const row = (id, app, events = "NONE", confidence = "high") =>
  `${id},synthetic subject,synthetic body,2026-10-23T14:00:00Z,"[{""id"":""app-${id}"",""company"":""Example"",""title"":""Engineer"",""requisition"":""X-1""}]",${app},${events},${confidence},\n`;
const csvCell = (value) => `"${value.replaceAll('"', '""')}"`;
const freeMatchRow = (id, app, events = "NONE", confidence = "high", subject = "synthetic subject") =>
  `${id},${subject},synthetic body,2026-10-23T14:00:00Z,[],${csvCell(app)},${csvCell(events)},${confidence},\n`;
function fixtures(t, csvA, csvB) {
  const dir = mkdtempSync(join(tmpdir(), "offerly-phase0-agreement-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = join(dir, "a.csv"), b = join(dir, "b.csv");
  writeFileSync(a, header + csvA);
  writeFileSync(b, header + csvB);
  return { a, b };
}

test("review agreement reports link and event agreement plus case disagreements", (t) => {
  const files = fixtures(
    t,
    row("one", "app-one", "confirmation") + row("two", "NONE"),
    row("one", "app-one", "NONE") + row("two", "app-two", "confirmation"),
  );
  const result = compareFiles(files.a, files.b);
  assert.equal(result.cases, 2);
  assert.equal(result.applicationLink.percentAgreement, 50);
  assert.equal(result.events.confirmation.percentAgreement, 0);
  assert.deepEqual(result.disagreeingCaseIds, ["one", "two"]);
});

test("review agreement rejects incomplete labels, invalid classes and mismatched case IDs", (t) => {
  const files = fixtures(t, row("one", ""), row("two", "NONE"));
  assert.throws(() => compareFiles(files.a, files.b), /incomplete/);
  const invalid = fixtures(t, row("one", "app-one", "unsupported"), row("one", "NONE"));
  assert.throws(() => compareFiles(invalid.a, invalid.b), /Invalid reviewer event/);
});

test("review agreement accepts human-readable matches without candidate catalog and full event taxonomy", (t) => {
  const files = fixtures(
    t,
    freeMatchRow("one", "Acme — Product Designer", "review-update,scheduled-interview") +
      freeMatchRow("two", "NONE", "NONE"),
    freeMatchRow("one", " acme — product designer ", "review-update,scheduled-interview") +
      freeMatchRow("two", "NONE", "NONE"),
  );
  const result = compareFiles(files.a, files.b);
  assert.equal(result.applicationLink.percentAgreement, 100);
  assert.equal(result.events["review-update"].percentAgreement, 100);
  assert.equal(result.events["scheduled-interview"].percentAgreement, 100);
  assert.equal(Object.keys(result.events).length, 12);
});

test("review agreement reports raw agreement for optional stage and safety fields", (t) => {
  const extendedHeader = `${header.trimEnd()},application_stage_before,expected_stage_after,safe_to_auto_apply\n`;
  const extendedRow = (stageAfter, safe) =>
    `${row("one", "app-one", "confirmation").trimEnd()},NONE,${stageAfter},${safe}\n`;
  const files = fixtures(
    t,
    extendedRow("Submitted", "false"),
    extendedRow("Under review", "false"),
  );
  writeFileSync(files.a, extendedHeader + extendedRow("Submitted", "false"));
  writeFileSync(files.b, extendedHeader + extendedRow("Under review", "false"));
  const result = compareFiles(files.a, files.b);
  assert.equal(result.fieldAgreement.expected_stage_after.percentAgreement, 0);
  assert.equal(result.fieldAgreement.safe_to_auto_apply.percentAgreement, 100);
});

test("review agreement rejects changed packet content across reviewers", (t) => {
  const files = fixtures(
    t,
    freeMatchRow("one", "Acme — Product Designer"),
    freeMatchRow("one", "Acme — Product Designer", "NONE", "high", "edited subject"),
  );
  assert.throws(() => compareFiles(files.a, files.b), /packet content does not match/);
});

test("adjudicated labels pass through existing evaluation metrics", (t) => {
  const files = fixtures(t, row("one", "app-one", "confirmation"), row("one", "app-one", "confirmation"));
  const result = evaluateAdjudicatedFile(files.a, {
    version: 1,
    split: "held-out",
    system: "synthetic-test",
    predictions: [{ id: "one", applicationId: "app-one", events: ["confirmation"] }],
  });
  assert.equal(result.applicationLinkPrecision.value, 1);
  assert.equal(result.eventRecall.value, 1);
});

test("prediction evaluation refuses human-readable matches without candidate catalog", (t) => {
  const files = fixtures(
    t,
    freeMatchRow("one", "Acme — Product Designer", "confirmation"),
    freeMatchRow("one", "Acme — Product Designer", "confirmation"),
  );
  assert.throws(() => evaluateAdjudicatedFile(files.a, {}), /requires candidate applications/);
});
