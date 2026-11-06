import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createStore } from "../helpers/store.js";
import {
  initializeGmail,
  encryptGmailSecret,
  decryptGmailSecret,
  gmailConfig,
  gmailAccessToken,
  gmailAccount,
  disconnectGmail,
} from "../../server/gmail-account.js";
const encryptionKey = randomBytes(32).toString("base64");
const options = {
  enabled: true,
  clientId: "test",
  clientSecret: "secret",
  redirectUri: "https://example.com/api/gmail/callback",
  encryptionKey,
};
test("Gmail encrypted secrets reject owner/generation substitution and tampering", () => {
  const sealed = encryptGmailSecret(
    "refresh-secret",
    "user",
    "generation",
    encryptionKey,
  );
  assert.equal(sealed.includes("refresh-secret"), false);
  assert.equal(
    decryptGmailSecret(sealed, "user", "generation", encryptionKey),
    "refresh-secret",
  );
  assert.throws(() =>
    decryptGmailSecret(sealed, "other", "generation", encryptionKey),
  );
  assert.throws(() =>
    decryptGmailSecret(sealed, "user", "other", encryptionKey),
  );
  assert.throws(() =>
    decryptGmailSecret(
      sealed.slice(0, -5) + "AAAAA",
      "user",
      "generation",
      encryptionKey,
    ),
  );
});
test("Gmail configuration requires explicit enablement and HTTPS callback", () => {
  assert.equal(gmailConfig(options).configured, true);
  assert.equal(gmailConfig({ ...options, enabled: false }).configured, false);
  assert.equal(
    gmailConfig({
      ...options,
      redirectUri: "http://example.com/api/gmail/callback",
    }).configured,
    false,
  );
});
async function fixture(t) {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await initializeGmail(store);
  await store.db
    .prepare(
      "INSERT INTO users(id,email,password,name,timezone,stages) VALUES(?,?,?,?,?,?)",
    )
    .run("u", "u@example.com", "x", "U", "UTC", "[]");
  await store.db
    .prepare(
      "INSERT INTO gmail_accounts(user_id,generation,credentials,status,connected_at) VALUES(?,?,?,'connected',?)",
    )
    .run(
      "u",
      "g",
      encryptGmailSecret("refresh", "u", "g", encryptionKey),
      Date.now(),
    );
  return store;
}
test("revoked refresh credentials are erased and reconnect required", async (t) => {
  const store = await fixture(t);
  const clientFactory = () => ({
    setCredentials() {},
    async getAccessToken() {
      throw { response: { data: { error: "invalid_grant" } } };
    },
  });
  await assert.rejects(
    gmailAccessToken(store, "u", "g", { ...options, clientFactory }),
    /Reconnect Gmail/,
  );
  const account = await gmailAccount(store, "u");
  assert.equal(account.credentials, "");
  assert.equal(account.status, "reconnect_required");
});
test("disconnect fences workers before revocation and clears credentials despite provider failure", async (t) => {
  const store = await fixture(t);
  const result = await disconnectGmail(store, "u", {
    ...options,
    clientFactory: () => ({
      async revokeToken() {
        const row = await gmailAccount(store, "u");
        assert.equal(row.credentials, "");
        assert.notEqual(row.generation, "g");
        throw Error("provider secret must not escape");
      },
    }),
  });
  assert.deepEqual(result, { ok: true, revoked: false });
  await assert.rejects(
    gmailAccessToken(store, "u", "g", options),
    /connection changed/,
  );
  await store.db.prepare("DELETE FROM users WHERE id=?").run("u");
  assert.equal(await gmailAccount(store, "u"), undefined);
});

test("OAuth callback is session bound, single use, and fenced by first disconnect", async (t) => {
  const { default: express } = await import("express");
  const { mountGmail } = await import("../../server/gmail-account.js");
  const store = await fixture(t);
  await store.db.prepare("DELETE FROM gmail_accounts WHERE user_id=?").run("u");
  await store.db
    .prepare(
      "INSERT INTO sessions(token,user_id,expires,last_seen) VALUES(?,?,?,?)",
    )
    .run("session", "u", Date.now() + 60000, Date.now());
  let state,
    exchange = 0,
    revoked = 0;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: "u" };
    req.sessionHash = req.headers["x-session"] || "session";
    next();
  });
  mountGmail(app, store, {
    ...options,
    clientFactory: () => ({
      async generateCodeVerifierAsync() {
        return { codeVerifier: "verifier", codeChallenge: "challenge" };
      },
      generateAuthUrl(input) {
        state = input.state;
        assert.deepEqual(input.scope, [
          "https://www.googleapis.com/auth/gmail.readonly",
        ]);
        return "https://accounts.google.com/authorize";
      },
      async getToken() {
        exchange++;
        await disconnectGmail(store, "u", options);
        return {
          tokens: {
            refresh_token: "new-refresh",
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          },
        };
      },
      async revokeToken() {
        revoked++;
      },
    }),
  });
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ error: err.message });
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(
    (
      await fetch(base + "/api/gmail/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionAccepted: true }),
      })
    ).status,
    200,
  );
  const path = `/api/gmail/callback?state=${state}&code=code`;
  assert.equal(
    (await fetch(base + path, { headers: { "x-session": "other" } })).status,
    400,
  );
  assert.equal(exchange, 0);
  assert.equal((await fetch(base + path)).status, 409);
  assert.equal(exchange, 1);
  assert.equal(revoked, 1);
  assert.equal((await gmailAccount(store, "u")).status, "disconnected");
  assert.equal((await fetch(base + path)).status, 400);
  assert.equal(exchange, 1);
});

test("token refresh completing after disconnect cannot return an access token", async (t) => {
  const store = await fixture(t);
  let requested;
  const clientFactory = () => ({
    setCredentials(value) {
      requested = value;
    },
    async getAccessToken() {
      await disconnectGmail(store, "u", {
        ...options,
        clientFactory: () => ({ async revokeToken() {} }),
      });
      return { token: "access-must-not-escape" };
    },
  });
  await assert.rejects(
    gmailAccessToken(store, "u", "g", { ...options, clientFactory }),
    /connection changed/,
  );
  assert.deepEqual(requested, { refresh_token: "refresh" });
});
