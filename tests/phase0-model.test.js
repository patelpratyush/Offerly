import test from "node:test";
import assert from "node:assert/strict";
import { modelInput, boundedJson, predict } from "../scripts/phase0-model.js";

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
