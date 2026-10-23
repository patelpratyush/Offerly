import test from "node:test";
import assert from "node:assert/strict";
import {
  selectArm,
  guardedPrediction,
  localRequest,
} from "../scripts/phase0-reasoning.js";

test("reasoning selection needs all four exact valid dev outputs within median deadline", () => {
  const good = [90000, 100000, 110000, 170000].map((durationMs) => ({
    valid: true,
    exact: true,
    durationMs,
  }));
  assert.equal(selectArm(good).arm, "reasoning-with-source-guard");
  for (const rows of [
    good.slice(0, 2),
    good.map((row, index) => (index ? row : { ...row, valid: false })),
    good.map((row, index) => (index ? row : { ...row, exact: false })),
    good.map((row) => ({ ...row, durationMs: 121000 })),
  ])
    assert.equal(selectArm(rows).arm, "nonthinking-v3-with-source-guard");
});
test("guard only vetoes application link and never changes raw predictions or events", () => {
  const raw = { applicationId: "app", events: ["confirmation"] };
  const result = guardedPrediction(
    {
      subject: "An update",
      body: "Company news",
      applications: [
        {
          id: "app",
          company: "Example",
          title: "Engineer",
          requisition: "EX-1",
        },
      ],
    },
    raw,
  );
  assert.equal(result.prediction.applicationId, null);
  assert.deepEqual(result.prediction.events, ["confirmation"]);
  assert.equal(raw.applicationId, "app");
});
test("thinking request preserves fixed endpoint/caps and modifies only declared options", async () => {
  let seen;
  const request = localRequest(true, async (url, options) => {
    seen = { url, options, payload: JSON.parse(options.body) };
    return new Response('{"done":true}', { status: 200 });
  });
  await request("/api/chat", {
    model: "qwen3:4b",
    think: false,
    messages: [{ role: "user", content: "Synthetic input" }],
    options: { seed: 0, temperature: 0, num_ctx: 4096, num_predict: 512 },
  });
  assert.equal(seen.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(seen.payload.think, true);
  assert.equal(seen.payload.options.num_predict, 1024);
  assert.equal(seen.payload.options.num_ctx, 4096);
  assert.equal(seen.options.redirect, "error");
  await assert.rejects(request("/api/tags", {}), /Fixed chat endpoint/);
  const capped = localRequest(
    false,
    async () => new Response("x".repeat(262145)),
  );
  await assert.rejects(capped("/api/chat", { options: {} }), /exceeds limit/);
});
