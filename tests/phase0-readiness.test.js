import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const script = new URL("../scripts/phase0-gmail-readiness.js", import.meta.url);
function run(extra = {}) {
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...extra },
  });
  assert.equal(result.stderr, "");
  return {
    status: result.status,
    data: JSON.parse(result.stdout),
    output: result.stdout,
  };
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "offerly-oauth-readiness-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "client.json");
  const secret = "private-test-client-credential-938174";
  writeFileSync(
    file,
    JSON.stringify({
      installed: {
        client_id: "123456-local.apps.googleusercontent.com",
        client_secret: secret,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        redirect_uris: ["http://localhost"],
      },
    }),
    { mode: 0o600 },
  );
  return { directory, file, secret };
}
test("missing Gmail credentials cannot claim authorization or mailbox success", () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.equal(result.data.configurationReady, false);
  assert.equal(result.data.phase0GmailComplete, false);
  assert.equal(result.data.mailboxAccessPerformed, false);
});
test("private installed-client file passes shape readiness without revealing secrets or claiming OAuth", (t) => {
  const { file, secret } = fixture(t);
  const result = run({ GOOGLE_OAUTH_CLIENT_FILE: file });
  assert.equal(result.status, 0);
  assert.equal(result.data.configurationReady, true);
  assert.equal(result.data.liveAuthorizationValidated, false);
  assert.equal(result.data.consentedHistoricalImportValidated, false);
  assert.ok(!result.output.includes(secret));
  assert.ok(!result.output.includes(file));
});
test("readiness rejects symlinks and credentials readable by other users", (t) => {
  const { file, directory } = fixture(t);
  chmodSync(file, 0o644);
  assert.equal(run({ GOOGLE_OAUTH_CLIENT_FILE: file }).status, 2);
  chmodSync(file, 0o600);
  const link = join(directory, "link.json");
  symlinkSync(file, link);
  assert.equal(run({ GOOGLE_OAUTH_CLIENT_FILE: link }).status, 2);
});
test("readiness fails closed for browser-exposed credentials and oversized malformed files", (t) => {
  const { file, secret } = fixture(t);
  const exposed = run({
    GOOGLE_OAUTH_CLIENT_FILE: file,
    VITE_GOOGLE_CLIENT_SECRET: secret,
  });
  assert.equal(exposed.status, 2);
  assert.ok(!exposed.output.includes(secret));
  writeFileSync(file, "{".repeat(65537));
  assert.equal(run({ GOOGLE_OAUTH_CLIENT_FILE: file }).status, 2);
});
