import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCallback,
  authorizeLocal,
  boundedJson,
  inspectBody,
  scanAllMail,
  revokeLocal,
  SCOPE,
} from "../server/integrations/gmail-local.js";
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
    scanAllMail({ fetchImpl: async () => json({ nextPageToken: "same" }) }),
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
  });
});

test("deleted and oversized messages yield partial scan with complete pagination; progress keeps counts before later fatal failure", async () => {
  const progress = [];
  const counts = await scanAllMail({
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
