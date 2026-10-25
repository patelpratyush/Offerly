import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareFiles, evaluateAdjudicatedFile } from "../scripts/phase0-agreement.js";

const header = "case_id,subject,body,received_at,candidate_applications,reviewer_application_id,reviewer_events,confidence,reviewer_notes\n";
const row = (id, app, events = "NONE", confidence = "high") =>
  `${id},synthetic subject,synthetic body,2026-10-23T14:00:00Z,"[{""id"":""app-${id}"",""company"":""Example"",""title"":""Engineer"",""requisition"":""X-1""}]",${app},${events},${confidence},\n`;
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
