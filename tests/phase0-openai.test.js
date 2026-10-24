import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluationPlan,
  estimatedRunCostUsd,
  requestStructuredOutput,
  parseStructuredOutput,
} from "../scripts/phase0-openai.js";
import { readFile } from "node:fs/promises";
import { analyzeHeldOut } from "../scripts/phase0-openai-analysis.js";

test("GPT Phase 0 exposes only one fixed synthetic full evaluation run", () => {
  assert.deepEqual(evaluationPlan(), {
    model: "gpt-6-luna",
    runId: "gpt-6-luna-phase0-v1",
    promptVersion: "phase0-gpt-v1",
    maxCalls: 42,
    maxRunCostUsd: 0.1,
  });
  assert.throws(() => evaluationPlan("../../.env"), /Unsupported evaluation/);
});

test("preflight cost estimate includes max output and rejects over-budget runs", () => {
  assert.ok(estimatedRunCostUsd({ requestBytes: 1000, calls: 1 }) > 0);
  assert.throws(
    () => estimatedRunCostUsd({ requestBytes: 16_384, calls: 42 }),
    /budget/,
  );
});

test("Responses API call pins host, model, schema, storage, tools, and timeout", async () => {
  let call;
  const response = await requestStructuredOutput(
    { kind: "mail", input: { subject: "synthetic only" } },
    {
      apiKey: "test-secret",
      fetcher: async (url, options) => {
        call = { url, options };
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: '{"applicationId":null,"events":[]}',
                  },
                ],
              },
            ],
            usage: { input_tokens: 100, output_tokens: 20 },
          }),
          { status: 200 },
        );
      },
    },
  );
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.headers.Authorization, "Bearer test-secret");
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.store, false);
  assert.deepEqual(body.tools, []);
  assert.equal(body.max_output_tokens, 384);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(response.value.applicationId, null);
  assert.deepEqual(response.usage, { inputTokens: 100, outputTokens: 20 });
});

test("missing keys and oversized requests stop before network access", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(
    requestStructuredOutput({ kind: "mail", input: {} }, { apiKey: "", fetcher }),
    /OPENAI_API_KEY is required/,
  );
  await assert.rejects(
    requestStructuredOutput(
      { kind: "mail", input: { body: "x".repeat(20_000) } },
      { apiKey: "test-secret", fetcher },
    ),
    /request exceeds input limit/,
  );
  assert.equal(calls, 0);
});

test("API failures are sanitized and do not expose provider response bodies", async () => {
  await assert.rejects(
    requestStructuredOutput(
      { kind: "mail", input: {} },
      {
        apiKey: "test-secret",
        fetcher: async () => new Response("private error payload", { status: 429 }),
      },
    ),
    (error) => {
      assert.equal(error.message, "OpenAI API HTTP 429");
      assert.equal(error.message.includes("private error payload"), false);
      return true;
    },
  );
});

test("output parser rejects refusals, truncation, duplicate events, and invented app IDs", () => {
  assert.throws(
    () => parseStructuredOutput({ status: "incomplete", output: [] }, "mail", []),
    /not completed/,
  );
  assert.throws(
    () =>
      parseStructuredOutput(
        {
          status: "completed",
          output: [{ type: "message", content: [{ type: "refusal" }] }],
        },
        "mail",
        [],
      ),
    /refused/,
  );
  assert.throws(
    () =>
      parseStructuredOutput(
        {
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: '{"applicationId":"invented","events":[]}',
                },
              ],
            },
          ],
        },
        "mail",
        [],
      ),
    /Invalid model link/,
  );
  assert.throws(
    () =>
      parseStructuredOutput(
        {
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: '{"applicationId":null,"events":["offer","offer"]}',
                },
              ],
            },
          ],
        },
        "mail",
        [],
      ),
    /Invalid model link or duplicate event/,
  );
});

test("frozen GPT held-out analysis reproduces raw and source-guarded outcomes", async () => {
  const [oldGold, oldPredictions, freshGold, freshPredictions] = await Promise.all(
    [
      "../eval/phase0/recruiting.json",
      "../eval/phase0/predictions-mail-gpt-6-luna-held-out-v1.json",
      "../eval/phase0/recruiting-fresh.json",
      "../eval/phase0/predictions-mail-gpt-6-luna-fresh-held-out-v1.json",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8").then(JSON.parse)),
  );
  const analysis = analyzeHeldOut({ oldGold, oldPredictions, freshGold, freshPredictions });
  assert.deepEqual(analysis.raw.applicationLinkPrecision, {
    numerator: 22,
    denominator: 23,
    value: 22 / 23,
  });
  assert.deepEqual(analysis.guarded.applicationLinkPrecision, {
    numerator: 22,
    denominator: 22,
    value: 1,
  });
  assert.deepEqual(analysis.guarded.applicationLinkCoverage, {
    numerator: 22,
    denominator: 32,
    value: 22 / 32,
  });
  assert.deepEqual(analysis.guardVetoes, [
    { id: "fresh-23", reason: "no_source_evidence" },
  ]);
  assert.deepEqual(analysis.raw.eventRecall, {
    numerator: 24,
    denominator: 25,
    value: 24 / 25,
  });
});
