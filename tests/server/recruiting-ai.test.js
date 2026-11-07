import test from "node:test";
import assert from "node:assert/strict";
import { extractRecruitingWithAi } from "../../server/integrations/recruiting-ai.js";
const message = {
  id: "abc",
  threadId: "def",
  internalDate: "1791000000000",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "subject", value: "Acme Engineer application" },
      { name: "from", value: "Person <person@example.com>" },
    ],
    body: {
      data: Buffer.from(
        "We have reviewed your application and invite you to take our evaluation.",
      ).toString("base64url"),
    },
  },
};
const applications = [
  { id: "a", company: "Acme", title: "Engineer", requisition: "" },
];
const reserve = async () => ({
  reservationId: "r",
  maxInputCharacters: 12000,
  maxOutputTokens: 512,
});
const prediction = {
  applicationId: "a",
  event: "assessment",
  quote: "invite you to take our evaluation.",
  owner: "You",
};
const response = (value) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
    }),
  );
test("disabled production extractor never reads credentials or sends messages", async () => {
  let calls = 0;
  const result = await extractRecruitingWithAi(
    null,
    "u",
    message,
    applications,
    {
      policy: { enabled: false },
      fetchImpl: async () => {
        calls++;
        throw new Error("unexpected");
      },
    },
  );
  assert.equal(result.status, "policy_denied");
  assert.equal(calls, 0);
});
test("strict bounded request and source-grounded review proposal", async () => {
  let request;
  const result = await extractRecruitingWithAi(
    null,
    "u",
    message,
    applications,
    {
      reserve,
      validate: async () => true,
      apiKey: "synthetic",
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        request = JSON.parse(options.body);
        return response(prediction);
      },
    },
  );
  assert.equal(request.store, false);
  assert.deepEqual(request.tools, []);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.max_output_tokens, 512);
  assert.equal(result.evidence.applicationId, "a");
  assert.equal(result.evidence.requiresReview, true);
  assert.equal(result.evidence.contacts[0].email, "person@example.com");
  assert.equal(result.evidence.excerpt, prediction.quote);
});
test("invented quotes fail closed and ambiguous application never links", async () => {
  await assert.rejects(
    () =>
      extractRecruitingWithAi(null, "u", message, applications, {
        reserve,
        validate: async () => true,
        apiKey: "synthetic",
        fetchImpl: async () => response({ ...prediction, quote: "invented" }),
      }),
    /retry required/,
  );
  const result = await extractRecruitingWithAi(
    null,
    "u",
    message,
    [...applications, { ...applications[0], id: "b" }],
    {
      reserve,
      validate: async () => true,
      apiKey: "synthetic",
      fetchImpl: async () => response(prediction),
    },
  );
  assert.equal(result.evidence.applicationId, undefined);
});
test("policy denial makes no provider call; raw provider errors never escape", async () => {
  let calls = 0;
  const denied = await extractRecruitingWithAi(
    null,
    "u",
    message,
    applications,
    {
      reserve: async () => {
        const e = new Error("denied");
        e.code = "AI_POLICY_DENIED";
        throw e;
      },
      fetchImpl: async () => {
        calls++;
      },
    },
  );
  assert.equal(denied.status, "policy_denied");
  assert.equal(calls, 0);
  await assert.rejects(
    () =>
      extractRecruitingWithAi(null, "u", message, applications, {
        reserve,
        validate: async () => true,
        apiKey: "synthetic",
        fetchImpl: async () => {
          throw new Error("private provider payload");
        },
      }),
    (e) =>
      !e.message.includes("private provider payload") &&
      e.message.includes("retry required"),
  );
});

test("withdrawn consent after reservation prevents network", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      extractRecruitingWithAi(null, "u", message, applications, {
        reserve,
        apiKey: "synthetic",
        validate: async () => {
          const e = new Error("Consent withdrawn");
          e.code = "AI_POLICY_DENIED";
          throw e;
        },
        fetchImpl: async () => {
          calls++;
        },
      }),
    /Consent withdrawn/,
  );
  assert.equal(calls, 0);
});
