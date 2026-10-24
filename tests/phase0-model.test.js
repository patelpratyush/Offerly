import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as modelRunner from "../scripts/phase0-model.js";
import { modelInput, boundedJson, predict } from "../scripts/phase0-model.js";

test("upgrade plans separate development and held-out artifacts and reject arbitrary modes", () => {
  assert.equal(typeof modelRunner.evaluationPlan, "function");
  const evaluationPlan = modelRunner.evaluationPlan;
  const dev = evaluationPlan("upgrade-dev");
  const held = evaluationPlan("upgrade-held-out-v3");
  assert.equal(dev.model, "qwen3:4b");
  assert.equal(dev.split, "dev");
  assert.equal(held.split, "held-out");
  assert.equal(held.promptVersion, "phase0-local-v3");
  assert.equal(dev.requestTimeoutMs, 60000);
  assert.equal(held.requestTimeoutMs, 180000);
  assert.notEqual(dev.reportFile, held.reportFile);
  assert.notEqual(held.reportFile, "model-report.json");
  assert.notEqual(held.predictionFiles.mail, "predictions-mail.json");
  assert.throws(
    () => evaluationPlan("../../private"),
    /Unsupported evaluation/,
  );
  assert.throws(
    () => evaluationPlan("upgrade-held-out-v2"),
    /Unsupported evaluation/,
  );
});

test("any prior upgraded held-out artifact blocks cross-prompt reuse", () => {
  modelRunner.assertFreshHeldOut([
    "model-report.json",
    "model-report-qwen3-4b-dev-v3.json",
  ]);
  for (const name of [
    "model-report-qwen3-4b-held-out-v2.json",
    "predictions-mail-qwen3-4b-held-out-v3.json",
    "predictions-fit-qwen3-4b-held-out-v3-pipeline.json",
  ])
    assert.throws(
      () => modelRunner.assertFreshHeldOut([name]),
      /repeated evaluation prohibited/,
    );
});

test("original prompt hashes remain frozen and clarified prompts have distinct provenance", async () => {
  const baseline = JSON.parse(
    await readFile(
      new URL("../reference/phase0/model-report.json", import.meta.url),
      "utf8",
    ),
  );
  const original = await modelRunner.provenance();
  const clarified = await modelRunner.provenance({
    model: "qwen3:4b",
    promptVersion: "phase0-local-v2",
  });
  assert.deepEqual(original.systemPromptSha256, baseline.systemPromptSha256);
  assert.deepEqual(clarified.fixtureSha256, original.fixtureSha256);
  assert.notDeepEqual(
    clarified.systemPromptSha256,
    original.systemPromptSha256,
  );
});

test("listing facts derive explicit pay and recency from input without model or labels", () => {
  assert.equal(typeof modelRunner.listingFacts, "function");
  const facts = modelRunner.listingFacts({
    description:
      "Base USD 87,654; total compensation USD 103,210 including equity.",
    asOf: "2026-10-23T12:00:00Z",
    postedAt: { value: "2026-10-22T12:00:00Z", precision: "instant" },
  });
  assert.deepEqual(facts, {
    compensation: { base: 87654, total: 103210, currency: "USD" },
    confirmedLast24Hours: true,
  });
  for (const value of [
    "2026-10-22T11:59:59Z",
    "2026-10-24T12:00:00Z",
    "2026-02-30T12:00:00Z",
  ])
    assert.equal(
      modelRunner.listingFacts({
        asOf: "2026-10-23T12:00:00Z",
        postedAt: { value, precision: "instant" },
      }).confirmedLast24Hours,
      false,
    );
  assert.deepEqual(
    modelRunner.listingFacts({
      description:
        "Base USD 100000-120000; total CAD 140000 and total USD 150000.",
    }).compensation,
    { base: null, total: null, currency: null },
  );
});

test("prediction rejects an unapproved model before any local request", async () => {
  let calls = 0;
  await assert.rejects(
    predict(
      "mail",
      { applications: [] },
      async () => {
        calls++;
      },
      { model: "unapproved" },
    ),
    /Unsupported model/,
  );
  assert.equal(calls, 0);
});

test("recorded baseline cannot be overwritten or implicitly re-evaluated", async () => {
  await assert.rejects(modelRunner.run("baseline"), /artifact already exists/);
});

test("model input excludes labels, gold IDs and hidden metadata", () => {
  const mail = modelInput(
    "mail",
    {},
    {
      expected: "SECRET_LABEL",
      split: "held-out",
      input: {
        subject: "S",
        body: "B",
        receivedAt: "2026-10-22T12:00:00Z",
        expected: "SECRET_NESTED",
        applications: [
          {
            id: "a",
            company: "C",
            title: "T",
            requisition: "R",
            expected: "SECRET_APPLICATION",
          },
        ],
      },
    },
  );
  assert.equal(JSON.stringify(mail).includes("SECRET"), false);
  const fit = modelInput(
    "fit",
    {
      asOf: "2026-10-22T12:00:00Z",
      profile: {
        approved: true,
        skills: [],
        yearsExperience: 1,
        workAuthorization: "unknown",
        location: "NY",
        remote: true,
        expected: "SECRET_PROFILE",
      },
    },
    { title: "T", description: "D", postedAt: null, expected: "SECRET_GOLD" },
  );
  assert.equal(JSON.stringify(fit).includes("SECRET"), false);
  assert.equal(fit.postedAt, null);
});
test("local evaluator blocks nonloopback endpoints before sending data and caps responses", async () => {
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(
    boundedJson("/api/chat", {}, { host: "https://example.com", fetcher }),
    /fixed local/,
  );
  await assert.rejects(
    boundedJson("/api/pull", {}, { fetcher }),
    /fixed local/,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    boundedJson("/api/chat", {}, { fetcher, requestTimeoutMs: Infinity }),
    /approved request deadlines/,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    boundedJson("/api/tags", undefined, {
      fetcher: async () => new Response("x".repeat(262145)),
    }),
    /exceeds limit/,
  );
  await assert.rejects(
    boundedJson("/api/tags", undefined, {
      fetcher: async () => new Response("{}", { status: 503 }),
    }),
    /HTTP 503/,
  );
});
test("model output validation rejects invented links, malformed schema and truncated completion", async () => {
  const input = { applications: [{ id: "a" }] };
  const response =
    (content, overrides = {}) =>
    async () => ({
      message: { content: JSON.stringify(content) },
      done: true,
      ...overrides,
    });
  await assert.rejects(
    predict("mail", input, response({ applicationId: "invented", events: [] })),
    /Invalid model link/,
  );
  await assert.rejects(
    predict(
      "mail",
      input,
      response({ applicationId: null, events: [], injected: true }),
    ),
  );
  await assert.rejects(
    predict(
      "mail",
      input,
      response({ applicationId: null, events: [] }, { done_reason: "length" }),
    ),
    /Incomplete/,
  );
  await assert.rejects(
    predict("mail", input, async () => {
      throw new Error("network unavailable");
    }),
    /network unavailable/,
  );
});
