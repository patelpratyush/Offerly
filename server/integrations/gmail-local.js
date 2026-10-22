// Local-only proof. Never persist or return mailbox content.
import {
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  constants,
} from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { OAuth2Client } from "google-auth-library";

const FAILURE_CODES = new Set([
  "keychain_access_denied",
  "keychain_operation_failed",
  "keychain_input_invalid",
  "keychain_response_invalid",
  "keychain_unavailable",
  "configuration_invalid",
  "authorization_cancelled",
  "authorization_timeout",
  "authorization_scope_missing",
  "authorization_refresh_failed",
  "authorization_revocation_failed",
  "request_rejected",
  "gmail_request_failed",
  "response_rejected",
  "response_too_large",
  "response_json_invalid",
  "message_shape_invalid",
  "list_shape_invalid",
  "message_id_invalid",
  "pagination_invalid",
  "gmail_network_failed",
  "gmail_request_timeout",
  "cancelled",
  "browser_unavailable",
]);
const PROVIDER_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "forbidden",
  "domainPolicy",
  "insufficientPermissions",
  "accessNotConfigured",
  "authError",
  "badRequest",
  "backendError",
  "notFound",
  "quotaExceeded",
  "unrecognized",
]);
const TRANSIENT_403 = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

// Read at most 64 KiB. Return fixed taxonomy only, never Google's message/details.
export async function providerReason(response) {
  if (
    !response.headers.get("content-type")?.includes("application/json") ||
    Number(response.headers.get("content-length") || 0) > 65536 ||
    !response.body
  ) {
    await response.body?.cancel();
    return "unrecognized";
  }
  const reader = response.body.getReader(),
    chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 65536) return "unrecognized";
      chunks.push(Buffer.from(value));
    }
    const errors = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error
      ?.errors;
    if (!Array.isArray(errors) || errors.length < 1 || errors.length > 20)
      return "unrecognized";
    const reasons = errors.map((error) =>
      PROVIDER_REASONS.has(error?.reason) ? error.reason : "unrecognized",
    );
    return reasons.find((reason) => !TRANSIENT_403.has(reason)) || reasons[0];
  } catch {
    return "unrecognized";
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function retryDelay(response, attempt) {
  const header = response.headers.get("retry-after") || "";
  const seconds = /^\d+(?:\.\d+)?$/.test(header)
    ? Number(header)
    : Number.isFinite(Date.parse(header))
      ? Math.max(0, (Date.parse(header) - Date.now()) / 1000)
      : 0;
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Infinity;
  if (milliseconds > 60000) return null;
  return Math.max(1000 * 2 ** attempt, milliseconds);
}

function proofError(code, httpStatus) {
  const error = new Error(code);
  error.code = code;
  if (Number.isInteger(httpStatus)) error.httpStatus = httpStatus;
  return error;
}
export function safeFailure(error) {
  const code = FAILURE_CODES.has(error?.code)
    ? error.code
    : error?.name === "TimeoutError"
      ? "gmail_request_timeout"
      : error?.name === "AbortError"
        ? "cancelled"
        : "local_proof_failed";
  const result = { failure: code };
  if (
    code === "gmail_request_failed" &&
    Number.isInteger(error.httpStatus) &&
    error.httpStatus >= 400 &&
    error.httpStatus <= 599
  )
    result.httpStatus = error.httpStatus;
  if (
    code === "gmail_request_failed" &&
    PROVIDER_REASONS.has(error.providerReason)
  )
    result.providerReason = error.providerReason;
  return result;
}

export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export function loadDesktopClient(file) {
  if (
    !file ||
    Object.keys(process.env).some((n) =>
      /^VITE_.*(?:GOOGLE.*(?:SECRET|CLIENT_FILE)|GMAIL.*(?:TOKEN|KEY))/i.test(
        n,
      ),
    )
  )
    throw proofError("configuration_invalid");
  const path = resolve(file),
    rel = relative(process.cwd(), path);
  const outside = rel === ".." || rel.startsWith("../") || isAbsolute(rel);
  if (
    !outside &&
    spawnSync("git", ["check-ignore", "--quiet", "--", path], {
      stdio: "ignore",
    }).status !== 0
  )
    throw proofError("configuration_invalid");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o077) !== 0)
      throw proofError("configuration_invalid");
    const json = JSON.parse(readFileSync(fd, "utf8")),
      c = json.installed;
    if (
      json.web ||
      !c ||
      !/^[\w-]+\.apps\.googleusercontent\.com$/.test(c.client_id) ||
      typeof c.client_secret !== "string" ||
      !c.client_secret ||
      ![
        "https://accounts.google.com/o/oauth2/auth",
        "https://accounts.google.com/o/oauth2/v2/auth",
      ].includes(c.auth_uri) ||
      c.token_uri !== "https://oauth2.googleapis.com/token" ||
      !Array.isArray(c.redirect_uris) ||
      !c.redirect_uris.some((uri) =>
        ["http://localhost", "http://127.0.0.1"].includes(uri),
      )
    )
      throw proofError("configuration_invalid");
    return { clientId: c.client_id, clientSecret: c.client_secret };
  } finally {
    closeSync(fd);
  }
}

export function validateCallback(url, expectedState) {
  if (
    url.pathname !== "/oauth2/callback" ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.getAll("code").length !== 1 ||
    url.searchParams.has("error")
  )
    return null;
  const state = Buffer.from(url.searchParams.get("state") || ""),
    expected = Buffer.from(expectedState);
  if (state.length !== expected.length || !timingSafeEqual(state, expected))
    return null;
  const code = url.searchParams.get("code");
  return code && code.length <= 4096 ? code : null;
}

export function createLocalClient(clientConfig, { signal, redirectUri } = {}) {
  const client = new OAuth2Client({ ...clientConfig, redirectUri });
  const request = client.transporter.request.bind(client.transporter);
  client.transporter.request = (options) =>
    request({
      ...options,
      timeout: 20000,
      retry: false,
      maxContentLength: 65536,
      maxRedirects: 0,
      signal,
    });
  return client;
}

export async function authorizeLocal(
  clientConfig,
  { openBrowser, signal, timeoutMs = 180000, persistent = false } = {},
) {
  const state = randomBytes(32).toString("base64url");
  let finish,
    fail,
    used = false;
  const codePromise = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Prevent early abort from becoming an unhandled rejection while opening browser.
  codePromise.catch(() => {});
  const server = createServer((req, res) => {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    let code = null;
    try {
      if (req.method === "GET" && req.headers.host === expectedHost && !used)
        code = validateCallback(
          new URL(req.url, `http://${expectedHost}`),
          state,
        );
    } catch {
      /* Malformed local request must not crash OAuth process. */
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!code) {
      res.writeHead(400);
      res.end("Authorization callback rejected.");
      return;
    }
    used = true;
    res.end("Authorization received. You may close this window.");
    finish(code);
  });
  server.maxHeadersCount = 30;
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  const abort = () => fail(proofError("authorization_cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => fail(proofError("authorization_timeout")),
    timeoutMs,
  );
  try {
    if (signal?.aborted) throw proofError("authorization_cancelled");
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2/callback`;
    const client = createLocalClient(clientConfig, { signal, redirectUri });
    const pkce = await client.generateCodeVerifierAsync();
    const authUrl = client.generateAuthUrl({
      scope: [SCOPE],
      access_type: persistent ? "offline" : "online",
      prompt: "consent",
      state,
      code_challenge_method: "S256",
      code_challenge: pkce.codeChallenge,
      include_granted_scopes: false,
    });
    await openBrowser(authUrl);
    const code = await codePromise;
    const { tokens } = await client.getToken({
      code,
      codeVerifier: pkce.codeVerifier,
      redirect_uri: redirectUri,
    });
    if (
      !tokens.access_token ||
      !tokens.scope?.split(" ").includes(SCOPE) ||
      signal?.aborted
    ) {
      if (tokens.access_token) {
        let revoked = false;
        try {
          revoked = await revokeLocal(tokens.access_token);
        } catch {
          /* No token output. */
        }
        if (!revoked) throw proofError("authorization_revocation_failed");
      }
      throw proofError("authorization_scope_missing");
    }
    client.setCredentials(tokens);
    return client;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function boundedJson(
  url,
  {
    token,
    getAccessToken,
    beforeRequest = async () => {},
    onRetry = () => {},
    fetchImpl = fetch,
    signal,
    cap = 16 * 1024 * 1024,
    sleep = delay,
  } = {},
) {
  const parsed = new URL(url);
  if (
    parsed.origin !== "https://gmail.googleapis.com" ||
    !/^\/gmail\/v1\/users\/me\/messages(?:\/[a-fA-F0-9]+)?$/.test(
      parsed.pathname,
    )
  )
    throw proofError("request_rejected");
  for (let attempt = 0; attempt <= 6; attempt++) {
    let response;
    try {
      await beforeRequest();
      let accessToken = token;
      if (getAccessToken) {
        try {
          accessToken = await getAccessToken();
        } catch {
          throw proofError("authorization_refresh_failed");
        }
      }
      if (typeof accessToken !== "string" || !accessToken)
        throw proofError("authorization_scope_missing");
      response = await fetchImpl(parsed, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(20000),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch (error) {
      if (FAILURE_CODES.has(error?.code)) throw error;
      throw proofError(
        signal?.aborted
          ? "cancelled"
          : error?.name === "TimeoutError"
            ? "gmail_request_timeout"
            : "gmail_network_failed",
      );
    }
    if (!response.ok) {
      const reason = await providerReason(response);
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        (response.status === 403 && TRANSIENT_403.has(reason));
      const maximumRetries =
        response.status === 403 && TRANSIENT_403.has(reason) ? 6 : 2;
      const waitMs = retryDelay(response, attempt);
      if (retryable && attempt < maximumRetries && waitMs !== null) {
        onRetry({
          attempt: attempt + 1,
          delayMs: waitMs,
          providerReason: reason,
        });
        await sleep(waitMs, undefined, { signal });
        continue;
      }
      const error = proofError("gmail_request_failed", response.status);
      error.providerReason = reason;
      throw error;
    }
    if (Number(response.headers.get("content-length") || 0) > cap) {
      await response.body?.cancel();
      throw proofError("response_too_large");
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      await response.body?.cancel();
      throw proofError("response_rejected");
    }
    const reader = response.body.getReader(),
      chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > cap) throw proofError("response_too_large");
        chunks.push(Buffer.from(value));
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw proofError("response_json_invalid");
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}

export function inspectBody(payload) {
  let textParts = 0,
    textBytes = 0,
    attachmentPartsSkipped = 0,
    inlineAttachmentBytesDiscarded = 0;
  const stack = [payload];
  let visited = 0;
  while (stack.length) {
    const part = stack.pop();
    if (!part || typeof part !== "object" || ++visited > 10000)
      throw proofError("message_shape_invalid");
    if (part.filename || part.body?.attachmentId) {
      attachmentPartsSkipped++;
      if (typeof part.body?.data === "string")
        inlineAttachmentBytesDiscarded += Math.floor(
          (part.body.data.replace(/=+$/, "").length * 3) / 4,
        );
      continue;
    }
    if (
      ["text/plain", "text/html"].includes(part.mimeType) &&
      typeof part.body?.data === "string"
    ) {
      const body = Buffer.from(part.body.data, "base64url");
      textParts++;
      textBytes += body.length;
      // Decode locally only. No rendering, link/image fetching, execution, storage, or AI.
      body.toString("utf8");
      body.fill(0);
    }
    if (Array.isArray(part.parts)) stack.push(...part.parts);
  }
  return {
    textParts,
    textBytes,
    attachmentPartsSkipped,
    inlineAttachmentBytesDiscarded,
  };
}

export async function scanAllMail({
  token,
  query,
  getAccessToken,
  signal,
  fetchImpl,
  progress = () => {},
  sleep = delay,
  requestIntervalMs = 1000,
  now = Date.now,
} = {}) {
  if (query !== undefined && query !== "newer_than:7d")
    throw proofError("request_rejected");
  const counts = {
    pages: 0,
    requestRetries: 0,
    lastRetryDelayMs: 0,
    messagesRead: 0,
    messagesSkippedDeleted: 0,
    messagesSkippedOversized: 0,
    paginationCompleted: false,
    textParts: 0,
    textBytes: 0,
    attachmentPartsSkipped: 0,
    inlineAttachmentBytesDiscarded: 0,
    completed: false,
  };
  progress({ ...counts });
  let lastRequestAt = -Infinity;
  const beforeRequest = async () => {
    const waitMs = Math.max(0, lastRequestAt + requestIntervalMs - now());
    if (waitMs > 0) await sleep(waitMs, undefined, { signal });
    if (signal?.aborted) throw proofError("cancelled");
    lastRequestAt = now();
  };
  const onRetry = (info) => {
    counts.requestRetries++;
    counts.lastRetryDelayMs = info.delayMs;
    progress({ ...counts });
  };
  let pageToken;
  const pageTokens = new Set();
  do {
    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    url.searchParams.set("maxResults", "100");
    url.searchParams.set("includeSpamTrash", "true");
    if (query) url.searchParams.set("q", query);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await boundedJson(url, {
      token,
      getAccessToken,
      beforeRequest,
      onRetry,
      signal,
      fetchImpl,
      sleep,
      cap: 1024 * 1024,
    });
    if (page.messages !== undefined && !Array.isArray(page.messages))
      throw proofError("list_shape_invalid");
    counts.pages++;
    progress({ ...counts });
    for (const entry of page.messages || []) {
      if (!entry || !/^[a-fA-F0-9]+$/.test(entry.id))
        throw proofError("message_id_invalid");
      const messageUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${entry.id}`,
      );
      messageUrl.searchParams.set("format", "full");
      // Exclude top-level headers and snippet. Nested MIME metadata may arrive; never print or persist it.
      messageUrl.searchParams.set(
        "fields",
        "payload(mimeType,filename,body(data,attachmentId),parts)",
      );
      try {
        const message = await boundedJson(messageUrl, {
          token,
          getAccessToken,
          beforeRequest,
          onRetry,
          signal,
          fetchImpl,
          sleep,
        });
        const inspected = inspectBody(message.payload);
        counts.messagesRead++;
        for (const key of Object.keys(inspected)) counts[key] += inspected[key];
      } catch (error) {
        if (error.code === "gmail_request_failed" && error.httpStatus === 404)
          counts.messagesSkippedDeleted++;
        else if (error.code === "response_too_large")
          counts.messagesSkippedOversized++;
        else throw error;
      }
      progress({ ...counts });
    }
    pageToken = page.nextPageToken;
    if (
      pageToken !== undefined &&
      (typeof pageToken !== "string" ||
        !pageToken ||
        pageToken.length > 4096 ||
        pageTokens.has(pageToken))
    )
      throw proofError("pagination_invalid");
    if (pageToken) pageTokens.add(pageToken);
  } while (pageToken);
  counts.paginationCompleted = true;
  counts.completed =
    counts.messagesSkippedDeleted === 0 &&
    counts.messagesSkippedOversized === 0;
  progress({ ...counts });
  return counts;
}

export async function revokeLocal(token, fetchImpl = fetch) {
  const response = await fetchImpl("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  await response.body?.cancel();
  return response.ok;
}
