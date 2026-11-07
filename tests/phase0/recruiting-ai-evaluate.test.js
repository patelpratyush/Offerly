import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRecruitingAi } from "../../scripts/recruiting-ai-evaluate.js";
test("offline AI report counts wrong links, abstentions and event mistakes without claiming safety", () => {
  const gold = [
    { id: "1", applicationId: "a", events: ["offer"] },
    { id: "2", applicationId: null, events: [] },
  ];
  const predicted = [
    { id: "1", applicationId: "b", events: ["offer", "confirmation"] },
    { id: "2", applicationId: null, events: [] },
  ];
  const r = evaluateRecruitingAi(gold, predicted);
  assert.equal(r.applicationLinkPrecision.value, 0);
  assert.equal(r.linkCoverage.value, 0.5);
  assert.equal(r.eventPrecision.value, 0.5);
  assert.equal(r.eventRecall.value, 1);
  assert.equal(r.stageSafetyMeasured, false);
  assert.equal(r.productionQualityApproved, false);
  assert.throws(() => evaluateRecruitingAi(gold, predicted.slice(1)));
  assert.throws(() => evaluateRecruitingAi([...gold, gold[0]], predicted));
  assert.equal(evaluateRecruitingAi([], []).eventPrecision.value, null);
});
