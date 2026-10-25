import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_MAIL_PROMPT,
  runLiveEmailEvaluation,
} from "../scripts/phase0-openai-live-mail.js";

const part = (text) => ({
  mimeType: "text/plain",
  body: { data: Buffer.from(text).toString("base64url") },
});

test("live mail evaluation sends minimized current text to non-storing GPT and returns aggregates only", async () => {
  let observed;
  const report = await runLiveEmailEvaluation({
    apiKey: "test-key",
    read: async ({ onMessage }) => {
      await onMessage({
        id: "deadbeef",
        payload: {
          ...part("We have received your application. Contact recruiter@example.test.\n> Old quoted message."),
          headers: [
            { name: "Subject", value: "Synthetic update" },
            { name: "From", value: "sender@example.test" },
          ],
        },
      });
      return { selectedMessages: 1, selectionLimit: 20, fullMailboxScanned: false };
    },
    fetcher: async (url, options) => {
      observed = { url, body: JSON.parse(options.body), authorization: options.headers.Authorization };
      return new Response(JSON.stringify({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: '{"applicationId":null,"events":["confirmation"]}' }] }],
        usage: { input_tokens: 120, output_tokens: 12 },
      }), { status: 200 });
    },
  });
  assert.equal(observed.url, "https://api.openai.com/v1/responses");
  assert.equal(observed.authorization, "Bearer test-key");
  assert.equal(observed.body.store, false);
  assert.deepEqual(observed.body.tools, []);
  assert.equal(observed.body.instructions, LIVE_MAIL_PROMPT);
  assert.doesNotMatch(observed.body.instructions, /fictional test data/i);
  assert.equal(observed.body.input.includes("deadbeef"), false);
  assert.equal(observed.body.input.includes("sender@example.test"), false);
  assert.equal(observed.body.input.includes("recruiter@example.test"), false);
  assert.equal(observed.body.input.includes("Old quoted message"), false);
  assert.deepEqual(report.eventCounts, { confirmation: 1, assessment: 0, interview: 0, rejection: 0, offer: 0 });
  assert.equal(report.calls, 1);
  assert.equal(report.inputTokens, 120);
  assert.equal(report.outputTokens, 12);
  assert.equal(report.localContentPersisted, false);
  assert.equal(report.workspaceMutations, false);
  assert.equal(report.productionReady, false);
  const output = JSON.stringify(report);
  for (const privateValue of ["deadbeef", "Synthetic update", "sender@example.test", "application."])
    assert.equal(output.includes(privateValue), false);
});

test("live mail evaluation refuses missing API key before Gmail access", async () => {
  let reads = 0;
  await assert.rejects(
    runLiveEmailEvaluation({ apiKey: "", read: async () => { reads++; } }),
    /OPENAI_API_KEY is required/,
  );
  assert.equal(reads, 0);
});
