import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { digest, HttpError } from "./security.js";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_RETENTION_DAYS = 30;
export async function initializeGmail(store) {
  if (store.db.hosted) return;
  await store.db
    .exec(`CREATE TABLE IF NOT EXISTS gmail_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,generation TEXT NOT NULL,credentials TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,connected_at BIGINT NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS gmail_oauth_states(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,state_hash TEXT NOT NULL,session_hash TEXT NOT NULL,verifier TEXT NOT NULL,expires BIGINT NOT NULL,generation TEXT NOT NULL);`);
}
export function gmailConfig(options = {}) {
  const config = {
    enabled: options.enabled ?? process.env.GMAIL_ENABLED === "true",
    clientId: options.clientId ?? process.env.GOOGLE_CLIENT_ID,
    clientSecret: options.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: options.redirectUri ?? process.env.GMAIL_REDIRECT_URI,
    encryptionKey: options.encryptionKey ?? process.env.GMAIL_ENCRYPTION_KEY,
  };
  try {
    const url = new URL(config.redirectUri);
    config.configured = !!(
      config.enabled &&
      config.clientId &&
      config.clientSecret &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/api/gmail/callback" &&
      /^[A-Za-z0-9+/]{43}=$/.test(config.encryptionKey || "") &&
      Buffer.from(config.encryptionKey, "base64").length === 32
    );
  } catch {
    config.configured = false;
  }
  return config;
}
function requireConfig(options) {
  const config = gmailConfig(options);
  if (!config.configured)
    throw new HttpError(503, "Gmail connection is not configured");
  return config;
}
export function encryptGmailSecret(value, userId, generation, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(["gmail-v1", userId, generation])));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}
export function decryptGmailSecret(value, userId, generation, key) {
  try {
    const [version, iv, tag, data, extra] = value.split(".");
    if (version !== "v1" || extra !== undefined) throw new Error();
    const cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "base64"),
      Buffer.from(iv, "base64"),
    );
    cipher.setAAD(
      Buffer.from(JSON.stringify(["gmail-v1", userId, generation])),
    );
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      cipher.update(Buffer.from(data, "base64")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new HttpError(503, "Gmail credential unavailable");
  }
}
function clientFor(config, options) {
  if (options.clientFactory) return options.clientFactory(config);
  const client = new OAuth2Client(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
  const request = client.transporter.request.bind(client.transporter);
  client.transporter.request = (args) =>
    request({
      ...args,
      timeout: 15000,
      retry: false,
      maxContentLength: 65536,
      maxRedirects: 0,
    });
  return client;
}
export async function gmailAccount(store, userId) {
  return store.db
    .prepare("SELECT * FROM gmail_accounts WHERE user_id=?")
    .get(userId);
}
export async function markGmailRevoked(store, userId, generation) {
  await store.db
    .prepare(
      "UPDATE gmail_accounts SET credentials='',status='reconnect_required' WHERE user_id=? AND generation=?",
    )
    .run(userId, generation);
}
export async function gmailAccessToken(
  store,
  userId,
  generation,
  options = {},
) {
  const config = requireConfig(options),
    account = await gmailAccount(store, userId);
  if (
    !account ||
    account.generation !== generation ||
    account.status !== "connected"
  )
    throw new HttpError(409, "Gmail connection changed");
  const refresh = decryptGmailSecret(
    account.credentials,
    userId,
    generation,
    config.encryptionKey,
  );
  const client = clientFor(config, options);
  client.setCredentials({ refresh_token: refresh });
  try {
    const { token } = await client.getAccessToken();
    const current = await gmailAccount(store, userId);
    if (
      !token ||
      current?.generation !== generation ||
      current.status !== "connected"
    )
      throw new HttpError(409, "Gmail connection changed");
    return token;
  } catch (error) {
    if (
      error?.response?.data?.error === "invalid_grant" ||
      error?.response?.status === 401
    ) {
      await markGmailRevoked(store, userId, generation);
      throw new HttpError(401, "Reconnect Gmail to continue");
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "Gmail authorization temporarily unavailable");
  }
}
export async function disconnectGmail(store, userId, options = {}) {
  let account;
  await store.atomic(async () => {
    account = await gmailAccount(store, userId);
    await store.db
      .prepare("DELETE FROM gmail_oauth_states WHERE user_id=?")
      .run(userId);
    await store.db
      .prepare(
        "INSERT INTO gmail_accounts(generation,user_id,credentials,status,connected_at) VALUES(?,?,'','disconnected',0) ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,credentials='',status='disconnected'",
      )
      .run(randomUUID(), userId);
    if (options.cleanup) await options.cleanup(store, userId);
  });
  if (!account?.credentials) return { ok: true, revoked: true };
  try {
    const config = gmailConfig(options);
    const token = decryptGmailSecret(
      account.credentials,
      userId,
      account.generation,
      config.encryptionKey,
    );
    await clientFor(config, options).revokeToken(token);
    return { ok: true, revoked: true };
  } catch {
    return { ok: true, revoked: false };
  }
}
export function mountGmail(app, store, options = {}) {
  app.get("/api/gmail/status", async (req, res) => {
    const account = await gmailAccount(store, req.user.id);
    res.json({
      configured: gmailConfig(options).configured,
      status: account?.status || "disconnected",
      connectedAt: account?.connected_at || null,
      retentionDays: GMAIL_RETENTION_DAYS,
      aiEnabled: false,
      automaticStageUpdates: false,
    });
  });
  app.post("/api/gmail/connect", async (req, res) => {
    const config = requireConfig(options);
    if (req.body.retentionAccepted !== true)
      throw new HttpError(
        400,
        "Accept the 30-day Gmail evidence retention policy first",
      );
    const client = clientFor(config, options),
      pkce = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString("base64url"),
      generation = randomUUID();
    await store.db
      .prepare(
        "INSERT INTO gmail_oauth_states(user_id,state_hash,session_hash,verifier,expires,generation) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET state_hash=excluded.state_hash,session_hash=excluded.session_hash,verifier=excluded.verifier,expires=excluded.expires,generation=excluded.generation",
      )
      .run(
        req.user.id,
        digest(state),
        req.sessionHash,
        encryptGmailSecret(
          pkce.codeVerifier,
          req.user.id,
          generation,
          config.encryptionKey,
        ),
        Date.now() + 600000,
        generation,
      );
    res.json({
      url: client.generateAuthUrl({
        scope: [GMAIL_SCOPE],
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: false,
        state,
        code_challenge_method: "S256",
        code_challenge: pkce.codeChallenge,
      }),
    });
  });
  app.get("/api/gmail/callback", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    const config = requireConfig(options);
    if (
      typeof req.query.state !== "string" ||
      req.query.state.length > 200 ||
      typeof req.query.code !== "string" ||
      req.query.code.length > 4096 ||
      req.query.error
    )
      throw new HttpError(400, "Gmail authorization callback rejected");
    const { state, before } = await store.atomic(async () => ({
      state: await store.db
        .prepare(
          "DELETE FROM gmail_oauth_states WHERE user_id=? AND state_hash=? AND session_hash=? AND expires>? RETURNING *",
        )
        .get(req.user.id, digest(req.query.state), req.sessionHash, Date.now()),
      before: await gmailAccount(store, req.user.id),
    }));
    if (!state)
      throw new HttpError(400, "Gmail authorization expired or already used");
    const client = clientFor(config, options);
    let tokens;
    try {
      ({ tokens } = await client.getToken({
        code: req.query.code,
        codeVerifier: decryptGmailSecret(
          state.verifier,
          req.user.id,
          state.generation,
          config.encryptionKey,
        ),
        redirect_uri: config.redirectUri,
      }));
    } catch {
      throw new HttpError(
        400,
        "Gmail authorization failed; reconnect to retry",
      );
    }
    if (!tokens.refresh_token || tokens.scope?.trim() !== GMAIL_SCOPE) {
      if (tokens.refresh_token || tokens.access_token)
        await client
          .revokeToken(tokens.refresh_token || tokens.access_token)
          .catch(() => {});
      throw new HttpError(
        400,
        "Gmail read-only offline access was not granted",
      );
    }
    try {
      await store.atomic(async () => {
        const current = await gmailAccount(store, req.user.id);
        if (
          current?.generation !== before?.generation ||
          current?.status !== before?.status
        )
          throw new HttpError(
            409,
            "Gmail connection changed during authorization",
          );
        // A live session must still exist after the network exchange.
        const session = await store.db
          .prepare(
            "SELECT token FROM sessions WHERE token=? AND user_id=? AND expires>?",
          )
          .get(req.sessionHash, req.user.id, Date.now());
        if (!session) throw new HttpError(401, "Sign in to connect Gmail");
        await store.db
          .prepare(
            "INSERT INTO gmail_accounts(user_id,generation,credentials,status,connected_at) VALUES(?,?,?,'connected',?) ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,credentials=excluded.credentials,status=excluded.status,connected_at=excluded.connected_at",
          )
          .run(
            req.user.id,
            state.generation,
            encryptGmailSecret(
              tokens.refresh_token,
              req.user.id,
              state.generation,
              config.encryptionKey,
            ),
            Date.now(),
          );
      });
    } catch (error) {
      // Revocation can affect every token in the grant. Do not revoke a newer
      // successful connection; otherwise discard the unpersisted grant.
      const current = await gmailAccount(store, req.user.id);
      if (current?.status !== "connected")
        await client.revokeToken(tokens.refresh_token).catch(() => {});
      throw error;
    }
    res.redirect("/?gmail=connected");
  });
  app.post("/api/gmail/disconnect", async (req, res) =>
    res.json(await disconnectGmail(store, req.user.id, options)),
  );
}
