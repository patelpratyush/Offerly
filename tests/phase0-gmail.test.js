import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCallback,
  authorizeLocal,
  boundedJson as boundedJsonImpl,
  inspectBody,
  scanAllMail as scanAllMailImpl,
  revokeLocal,
  SCOPE,
} from "../server/integrations/gmail-local.js";
const boundedJson = (url, options = {}) =>
  boundedJsonImpl(url, { token: "SYNTHETIC", ...options });
const scanAllMail = (options = {}) =>
  scanAllMailImpl({ token: "SYNTHETIC", ...options });
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
test("callback rejects missing, duplicate, mismatched state and wrong path", () => {
  const state = "secret-state";
  assert.equal(
    validateCallback(
      new URL(`http://localhost/oauth2/callback?state=${state}&code=code`),
      state,
    ),
    "code",
  );
  for (const query of [
    "state=wrong&code=code",
    "state=secret-state&state=secret-state&code=code",
    "state=secret-state",
    "state=secret-state&code=code&error=denied",
  ])
    assert.equal(
      validateCallback(
        new URL(`http://localhost/oauth2/callback?${query}`),
        state,
      ),
      null,
    );
  assert.equal(
    validateCallback(
      new URL("http://localhost/wrong?state=secret-state&code=code"),
      state,
    ),
    null,
  );
});
test("real OAuth authorization URL uses fresh state, S256 PKCE, read-only and ephemeral loopback; timeout closes listener without token request", async () => {
  let auth;
  await assert.rejects(
    authorizeLocal(
      { clientId: "fake.apps.googleusercontent.com", clientSecret: "not-real" },
      {
        timeoutMs: 40,
        openBrowser: (url) => {
          auth = new URL(url);
        },
      },
    ),
    /authorization_timeout/,
  );
  assert.equal(auth.searchParams.get("scope"), SCOPE);
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  assert.ok(auth.searchParams.get("state").length >= 43);
  assert.ok(auth.searchParams.get("code_challenge").length >= 43);
  assert.match(
    auth.searchParams.get("redirect_uri"),
    /^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/,
  );
  assert.equal(auth.searchParams.has("client_secret"), false);
});
test("all-mail pagination includes spam/trash, fetches bodies sequentially, never follows attachments or emits private data", async () => {
  const calls = [],
    progress = [];
  let active = 0;
  const fetchImpl = async (url) => {
    assert.equal(active++, 0);
    calls.push(new URL(url));
    active--;
    if (url.pathname.endsWith("/messages"))
      return json(
        url.searchParams.has("pageToken")
          ? { messages: [{ id: "bb" }] }
          : { messages: [{ id: "aa" }], nextPageToken: "page2" },
      );
    return json({
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("PERSONAL SECRET").toString("base64url"),
            },
          },
          { filename: "secret.pdf", body: { attachmentId: "never-fetch" } },
        ],
      },
    });
  };
  const counts = await scanAllMail({
    requestIntervalMs: 0,
    token: "TOKEN",
    fetchImpl,
    progress: (value) => progress.push(value),
  });
  assert.equal(counts.messagesRead, 2);
  assert.equal(counts.attachmentPartsSkipped, 2);
  assert.equal(counts.completed, true);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].searchParams.get("includeSpamTrash"), "true");
  assert.equal(calls[2].searchParams.get("pageToken"), "page2");
  assert.equal(JSON.stringify(progress).includes("PERSONAL"), false);
  assert.equal(JSON.stringify(counts).includes("TOKEN"), false);
});

test("seven-day scan uses fixed Gmail search query and still includes spam/trash", async () => {
  let requested;
  const result = await scanAllMail({
    query: "newer_than:7d",
    fetchImpl: async (url) => {
      requested = new URL(url);
      return json({ messages: [] });
    },
  });
  assert.equal(requested.searchParams.get("q"), "newer_than:7d");
  assert.equal(requested.searchParams.get("includeSpamTrash"), "true");
  assert.equal(result.completed, true);
});

test("Gmail scan rejects arbitrary search queries before network access", async () => {
  let requests = 0;
  await assert.rejects(
    scanAllMail({
      query: "from:someone@example.com",
      fetchImpl: async () => {
        requests++;
        return json({ messages: [] });
      },
    }),
    /request_rejected/,
  );
  assert.equal(requests, 0);
});
test("network caps, redirect rejection, fixed host, bounded retries and pagination cycle fail closed", async () => {
  await assert.rejects(
    boundedJson("https://attacker.invalid/gmail/v1/users/me/messages"),
    /request_rejected/,
  );
  await assert.rejects(
    boundedJson("https://gmail.googleapis.com/gmail/v1/users/me/messages", {
      cap: 1,
      fetchImpl: async (_url, options) => {
        assert.equal(options.redirect, "error");
        return json({ secret: "hidden" });
      },
    }),
    /response_too_large/,
  );
  let tries = 0;
  await assert.rejects(
    boundedJson("https://gmail.googleapis.com/gmail/v1/users/me/messages", {
      fetchImpl: async () => {
        tries++;
        return new Response("", { status: 429 });
      },
      sleep: async () => {},
    }),
    /gmail_request_failed/,
  );
  assert.equal(tries, 3);
  await assert.rejects(
    scanAllMail({
      requestIntervalMs: 0,
      fetchImpl: async () => json({ nextPageToken: "same" }),
    }),
    /pagination_invalid/,
  );
});
test("attachments excluded even inline body; revoke token sent in POST body only", async () => {
  assert.deepEqual(
    inspectBody({
      filename: "attachment.txt",
      mimeType: "text/plain",
      body: { data: "c2VjcmV0" },
    }),
    {
      textParts: 0,
      textBytes: 0,
      attachmentPartsSkipped: 1,
      inlineAttachmentBytesDiscarded: 6,
    },
  );
  assert.equal(
    await revokeLocal("SECRET", async (url, options) => {
      assert.equal(url.includes("SECRET"), false);
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("token"), "SECRET");
      return new Response("");
    }),
    true,
  );
});

test("safe diagnostics retain HTTP category but never raw error messages, URLs or tokens", async () => {
  const { safeFailure } = await import("../server/integrations/gmail-local.js");
  assert.deepEqual(
    safeFailure(new Error("private@example.com TOKEN https://private.invalid")),
    { failure: "local_proof_failed" },
  );
  let caught;
  try {
    await boundedJson(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      {
        fetchImpl: async () =>
          new Response("PRIVATE RESPONSE BODY", { status: 403 }),
      },
    );
  } catch (error) {
    caught = error;
  }
  assert.deepEqual(safeFailure(caught), {
    failure: "gmail_request_failed",
    httpStatus: 403,
    providerReason: "unrecognized",
  });
});

test("deleted and oversized messages yield partial scan with complete pagination; progress keeps counts before later fatal failure", async () => {
  const progress = [];
  const counts = await scanAllMail({
    requestIntervalMs: 0,
    progress: (c) => progress.push(c),
    fetchImpl: async (url) => {
      if (url.pathname.endsWith("/messages"))
        return json({ messages: [{ id: "aa" }, { id: "bb" }, { id: "cc" }] });
      if (url.pathname.endsWith("/aa"))
        return new Response("", { status: 404 });
      if (url.pathname.endsWith("/bb"))
        return new Response("", {
          headers: {
            "content-type": "application/json",
            "content-length": String(17 * 1024 * 1024),
          },
        });
      return json({
        payload: { mimeType: "text/plain", body: { data: "aGk" } },
      });
    },
  });
  assert.equal(counts.messagesRead, 1);
  assert.equal(counts.messagesSkippedDeleted, 1);
  assert.equal(counts.messagesSkippedOversized, 1);
  assert.equal(counts.completed, false);
  assert.equal(counts.paginationCompleted, true);
  assert.equal(progress.at(-1).messagesRead, 1);
  const failedProgress = [];
  await assert.rejects(
    scanAllMail({
      requestIntervalMs: 0,
      progress: (c) => failedProgress.push(c),
      fetchImpl: async (url) => {
        if (url.pathname.endsWith("/messages"))
          return json({ messages: [{ id: "aa" }, { id: "bb" }] });
        if (url.pathname.endsWith("/aa"))
          return json({
            payload: { mimeType: "text/plain", body: { data: "aGk" } },
          });
        return new Response("", { status: 403 });
      },
    }),
    /gmail_request_failed/,
  );
  assert.equal(failedProgress.at(-1).messagesRead, 1);
  assert.equal(failedProgress.at(-1).completed, false);
});

test("403 retries only documented transient reasons, honors bounded Retry-After, and redacts arbitrary provider fields", async () => {
  const { safeFailure, providerReason } =
    await import("../server/integrations/gmail-local.js");
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
    let tries = 0;
    const delays = [];
    const result = await boundedJson(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      {
        sleep: async (ms) => delays.push(ms),
        fetchImpl: async () => {
          if (++tries === 3) return json({ messages: [] });
          return new Response(
            JSON.stringify({
              error: {
                message: "PRIVATE TOKEN EMAIL",
                errors: [{ reason, message: "PRIVATE BODY" }],
              },
            }),
            {
              status: 403,
              headers: {
                "content-type": "application/json",
                "retry-after": "5",
              },
            },
          );
        },
      },
    );
    assert.deepEqual(result, { messages: [] });
    assert.equal(tries, 3);
    assert.deepEqual(delays, [5000, 5000]);
  }
  for (const reason of [
    "domainPolicy",
    "dailyLimitExceeded",
    "forbidden",
    "insufficientPermissions",
    "accessNotConfigured",
    "PRIVATE MESSAGE",
  ]) {
    let tries = 0,
      caught;
    try {
      await boundedJson(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        {
          fetchImpl: async () => {
            tries++;
            return new Response(
              JSON.stringify({
                error: {
                  message: "PRIVATE TOKEN",
                  errors: [
                    {
                      reason,
                      location: "PRIVATE ID",
                      message: "PRIVATE ADDRESS",
                    },
                  ],
                },
              }),
              { status: 403, headers: { "content-type": "application/json" } },
            );
          },
        },
      );
    } catch (error) {
      caught = error;
    }
    assert.equal(tries, 1);
    assert.deepEqual(safeFailure(caught), {
      failure: "gmail_request_failed",
      httpStatus: 403,
      providerReason: reason === "PRIVATE MESSAGE" ? "unrecognized" : reason,
    });
    assert.equal(
      JSON.stringify(safeFailure(caught)).includes("PRIVATE"),
      false,
    );
  }
  assert.equal(
    await providerReason(
      new Response(
        JSON.stringify({
          error: {
            errors: [
              { reason: "rateLimitExceeded" },
              { reason: "domainPolicy" },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    ),
    "domainPolicy",
  );
  assert.equal(
    await providerReason(
      new Response("x".repeat(65537), {
        headers: { "content-type": "application/json" },
      }),
    ),
    "unrecognized",
  );
  assert.equal(
    await providerReason(
      new Response("{invalid", {
        headers: { "content-type": "application/json" },
      }),
    ),
    "unrecognized",
  );
});

test("persistent authorization requests offline access; reusable client preserves safe transport defaults", async () => {
  const { createLocalClient } =
    await import("../server/integrations/gmail-local.js");
  const client = createLocalClient({
    clientId: "fake.apps.googleusercontent.com",
    clientSecret: "synthetic",
  });
  assert.equal(client.credentials.access_token, undefined);
  let auth;
  await assert.rejects(
    authorizeLocal(
      {
        clientId: "fake.apps.googleusercontent.com",
        clientSecret: "synthetic",
      },
      {
        persistent: true,
        timeoutMs: 50,
        openBrowser: (url) => {
          auth = new URL(url);
        },
      },
    ),
    /authorization_timeout/,
  );
  assert.equal(auth.searchParams.get("access_type"), "offline");
  assert.equal(auth.searchParams.get("scope"), SCOPE);
});

test("rate-limit retry ceiling, long Retry-After stop, refresh callback and one-second scan throttle", async () => {
  const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  let attempts = 0,
    tokenRequests = 0;
  const delays = [];
  await assert.rejects(
    boundedJson(url, {
      getAccessToken: async () => `synthetic-${++tokenRequests}`,
      sleep: async (ms) => delays.push(ms),
      fetchImpl: async (_url, options) => {
        attempts++;
        assert.equal(
          options.headers.Authorization,
          `Bearer synthetic-${attempts}`,
        );
        return new Response(
          JSON.stringify({
            error: { errors: [{ reason: "rateLimitExceeded" }] },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      },
    }),
    /gmail_request_failed/,
  );
  assert.equal(attempts, 7);
  assert.equal(tokenRequests, 7);
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 32000]);
  attempts = 0;
  await assert.rejects(
    boundedJson(url, {
      sleep: async () => assert.fail("must not retry before requested time"),
      fetchImpl: async () => {
        attempts++;
        return new Response(
          JSON.stringify({
            error: { errors: [{ reason: "userRateLimitExceeded" }] },
          }),
          {
            status: 403,
            headers: {
              "content-type": "application/json",
              "retry-after": "61",
            },
          },
        );
      },
    }),
    /gmail_request_failed/,
  );
  assert.equal(attempts, 1);
  let clock = 0,
    reads = 0;
  const requestTimes = [];
  const counts = await scanAllMail({
    getAccessToken: async () => `read-${++reads}`,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetchImpl: async (url) => {
      requestTimes.push(clock);
      if (url.pathname.endsWith("/messages"))
        return json({ messages: [{ id: "aa" }, { id: "bb" }] });
      return json({
        payload: { mimeType: "text/plain", body: { data: "aGk" } },
      });
    },
  });
  assert.equal(counts.completed, true);
  assert.deepEqual(requestTimes, [0, 1000, 2000]);
  assert.equal(reads, 3);
});
