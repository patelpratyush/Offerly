import test from "node:test";
import assert from "node:assert/strict";
import { createKeychainStore } from "../../server/integrations/gmail-keychain.js";
const clientId = "123-example.apps.googleusercontent.com";
test("refresh credential persists through transport, hashed account hides client ID", async () => {
  const calls = [];
  let saved = null;
  const store = createKeychainStore(async (request) => {
    calls.push(request);
    if (request.operation === "store") saved = request.token;
    if (request.operation === "delete") saved = null;
    return request.operation === "load"
      ? { ok: true, token: saved }
      : { ok: true };
  });
  assert.equal(await store.loadRefreshToken(clientId), null);
  await store.saveRefreshToken(clientId, "synthetic-refresh-token");
  assert.equal(
    await store.loadRefreshToken(clientId),
    "synthetic-refresh-token",
  );
  await store.deleteRefreshToken(clientId);
  assert.equal(await store.loadRefreshToken(clientId), null);
  assert.match(calls[0].account, /^[a-f0-9]{64}$/u);
  assert.equal(
    calls.every((call) => call.account === calls[0].account),
    true,
  );
  assert.equal(JSON.stringify(calls).includes(clientId), false);
});
test("locked Keychain fails closed with fixed errors and no credential leakage", async () => {
  const store = createKeychainStore(async () => ({
    ok: false,
    code: "keychain_access_denied",
  }));
  await assert.rejects(store.loadRefreshToken(clientId), {
    message: "keychain_access_denied",
  });
  const leaking = createKeychainStore(async () => {
    throw new Error("secret-provider-error");
  });
  await assert.rejects(leaking.saveRefreshToken(clientId, "secret-token"), {
    message: "keychain_operation_failed",
  });
  const unknown = createKeychainStore(async () => ({
    ok: false,
    code: "secret-token",
  }));
  await assert.rejects(unknown.loadRefreshToken(clientId), {
    message: "keychain_operation_failed",
  });
});
test("malformed credentials and responses rejected before use", async () => {
  let called = false;
  const store = createKeychainStore(async () => {
    called = true;
    return { ok: true };
  });
  for (const token of ["", "bad\nvalue", "x".repeat(16385), null]) {
    await assert.rejects(store.saveRefreshToken(clientId, token), {
      message: "keychain_input_invalid",
    });
  }
  await assert.rejects(store.loadRefreshToken("invalid"), {
    message: "keychain_input_invalid",
  });
  assert.equal(called, false);
  for (const token of [
    undefined,
    123,
    "",
    "x".repeat(16385),
    "bad\u0000value",
  ]) {
    const malformed = createKeychainStore(async () => ({ ok: true, token }));
    await assert.rejects(malformed.loadRefreshToken(clientId), {
      message: "keychain_response_invalid",
    });
  }
});
