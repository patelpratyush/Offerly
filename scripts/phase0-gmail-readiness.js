#!/usr/bin/env node
// Inspect local configuration only: no network, OAuth, mailbox access, or secret output.
import {
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  constants,
} from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

const present = (value) => typeof value === "string" && Boolean(value.trim());
const placeholder = (value = "") =>
  /(?:YOUR[-_ ]|REPLACE[-_ ]|EXAMPLE|\[SENSITIVE\]|CHANGEME)/i.test(value);
const validClientId = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
const cleanValue = (value) => present(value) && !placeholder(value);
const browserSecretVariablesAbsent = !Object.keys(process.env).some((name) =>
  /^VITE_.*(?:GOOGLE.*(?:SECRET|CLIENT_FILE)|GMAIL.*(?:TOKEN|KEY))/i.test(name),
);
const mode = process.argv[2] || "desktop";
const checks = { browserSecretVariablesAbsent };
if (mode === "desktop") {
  const configured = cleanValue(process.env.GOOGLE_OAUTH_CLIENT_FILE);
  Object.assign(checks, {
    clientFileConfigured: configured,
    clientFileOutsideRepositoryOrIgnored: false,
    clientFileReadableRegularSmall: false,
    clientFileOwnerOnly: false,
    desktopClientShapeValid: false,
    clientIdFormat: false,
    clientSecretPresent: false,
    googleAuthorizationEndpoint: false,
    googleTokenEndpoint: false,
    loopbackRedirectAvailable: false,
  });
  let fd;
  try {
    if (!configured) throw new Error("missing");
    const path = resolve(process.env.GOOGLE_OAUTH_CLIENT_FILE);
    const rel = relative(process.cwd(), path);
    const outside =
      rel === ".." ||
      rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(rel);
    const ignored =
      spawnSync("git", ["check-ignore", "--quiet", "--", path], {
        stdio: "ignore",
      }).status === 0;
    checks.clientFileOutsideRepositoryOrIgnored = outside || ignored;
    if (!checks.clientFileOutsideRepositoryOrIgnored)
      throw new Error("not ignored");
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    checks.clientFileReadableRegularSmall = stat.isFile() && stat.size <= 65536;
    checks.clientFileOwnerOnly = (stat.mode & 0o077) === 0;
    if (!checks.clientFileReadableRegularSmall)
      throw new Error("invalid size or type");
    const json = JSON.parse(readFileSync(fd, "utf8"));
    const client = json.installed;
    checks.desktopClientShapeValid = Boolean(
      client && typeof client === "object" && !json.web,
    );
    checks.clientIdFormat = validClientId(client?.client_id);
    checks.clientSecretPresent = cleanValue(client?.client_secret);
    checks.googleAuthorizationEndpoint =
      client?.auth_uri === "https://accounts.google.com/o/oauth2/auth" ||
      client?.auth_uri === "https://accounts.google.com/o/oauth2/v2/auth";
    checks.googleTokenEndpoint =
      client?.token_uri === "https://oauth2.googleapis.com/token";
    checks.loopbackRedirectAvailable =
      Array.isArray(client?.redirect_uris) &&
      client.redirect_uris.some((uri) => {
        try {
          const parsed = new URL(uri);
          return (
            parsed.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
            !parsed.username &&
            !parsed.password &&
            !parsed.search &&
            !parsed.hash
          );
        } catch {
          return false;
        }
      });
  } catch {
    // Never print paths, file contents, parser details, or credential values.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
} else if (mode === "web") {
  const configuredOrigin = process.env.APP_ORIGIN || "";
  let validAppOrigin = false;
  try {
    const parsed = new URL(configuredOrigin);
    validAppOrigin = parsed.protocol === "https:" && parsed.origin === configuredOrigin;
  } catch {
    // Invalid or absent origin remains a failed readiness check.
  }
  const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || "";
  Object.assign(checks, {
    canonicalProductionOrigin: validAppOrigin,
    callbackMatchesOrigin:
      process.env.GOOGLE_REDIRECT_URI ===
      `${configuredOrigin}/api/connections/gmail/callback`,
    clientIdFormat: validClientId(process.env.GOOGLE_CLIENT_ID),
    clientSecretPresent: cleanValue(process.env.GOOGLE_CLIENT_SECRET),
    encryptionKey32Bytes:
      /^[A-Za-z0-9+/]{43}=$/.test(key) &&
      Buffer.from(key, "base64").length === 32 &&
      Buffer.from(key, "base64").toString("base64") === key,
  });
} else {
  console.log(JSON.stringify({ validMode: false }));
  process.exit(2);
}
const configurationReady = Object.values(checks).every(Boolean);
console.log(
  JSON.stringify(
    {
      check: "gmail-phase0-local-readiness",
      mode,
      checks,
      configurationReady,
      liveAuthorizationValidated: false,
      consentedHistoricalImportValidated: false,
      mailboxAccessPerformed: false,
      oauthHandlerImplemented: false,
      phase0GmailComplete: false,
    },
    null,
    2,
  ),
);
if (!configurationReady) process.exitCode = 2;
