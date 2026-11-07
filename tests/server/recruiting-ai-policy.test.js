import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../helpers/store.js";
import {
  initializeAiPolicy,
  aiPolicy,
  reserveAiRequest,
  validateAiReservation,
  revokeAiConsent,
  AI_CONSENT_VERSION,
} from "../../server/recruiting-ai-policy.js";
const options = {
  enabled: true,
  qualityApproved: true,
  qualityEvidenceVersion: "synthetic-test-only-not-production-evidence",
  estimatedMicroDollars: 10000,
  now: Date.UTC(2026, 10, 5),
  dailyRequestLimit: 2,
  dailySpendLimitMicroDollars: 20000,
  projectDailyRequestLimit: 3,
  projectDailySpendLimitMicroDollars: 30000,
};
async function setup(t) {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await initializeAiPolicy(store);
  for (const user of ["u", "other"]) {
    await store.db
      .prepare(
        "INSERT INTO users(id,email,password,name,timezone,stages) VALUES(?,?,?,?,?,?)",
      )
      .run(user, `${user}@example.com`, "x", "Test", "UTC", "[]");
    await store.db
      .prepare(
        "INSERT INTO recruiting_ai_consent(user_id,version,generation,accepted_at,withdrawn_at) VALUES(?,?,?,?,0)",
      )
      .run(user, AI_CONSENT_VERSION, user, options.now);
  }
  return store;
}
test("AI gates fail closed despite consent and no budget is spent", async (t) => {
  const store = await setup(t);
  for (const overrides of [
    { enabled: false },
    { qualityApproved: false },
    { qualityEvidenceVersion: "" },
  ])
    await assert.rejects(
      reserveAiRequest(store, "u", { ...options, ...overrides }),
      (e) => e.code === "AI_POLICY_DENIED",
    );
  assert.equal((await aiPolicy(store, "u", options)).requestsUsed, 0);
  await assert.rejects(
    reserveAiRequest(store, "u", { ...options, estimatedMicroDollars: 10001 }),
    /estimate exceeds/,
  );
});
test("concurrent reservations enforce per-user and project budgets atomically", async (t) => {
  const store = await setup(t);
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => reserveAiRequest(store, "u", options)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  await reserveAiRequest(store, "other", options);
  await assert.rejects(
    reserveAiRequest(store, "other", options),
    (e) => e.status === 429,
  );
  const policy = await aiPolicy(store, "other", options);
  assert.equal(policy.projectRequestsUsed, 3);
  assert.equal(policy.projectReservedMicroDollars, 30000);
  await store.db.prepare("DELETE FROM users WHERE id=?").run("u");
  assert.equal(
    (await aiPolicy(store, "other", options)).projectReservedMicroDollars,
    30000,
  );
  const nextDay = { ...options, now: options.now + 86400000 };
  assert.equal((await aiPolicy(store, "other", nextDay)).requestsUsed, 0);
  await reserveAiRequest(store, "other", nextDay);
});
test("withdrawal, re-consent, owner and evidence-version changes invalidate reservations", async (t) => {
  const store = await setup(t),
    reservation = await reserveAiRequest(store, "u", options);
  assert.equal(
    await validateAiReservation(store, "u", reservation, options),
    true,
  );
  await assert.rejects(
    validateAiReservation(store, "other", reservation, options),
    (e) => e.code === "AI_POLICY_DENIED",
  );
  await assert.rejects(
    validateAiReservation(store, "u", reservation, {
      ...options,
      qualityEvidenceVersion: "different",
    }),
    (e) => e.code === "AI_POLICY_DENIED",
  );
  await revokeAiConsent(store, "u", options);
  await assert.rejects(
    validateAiReservation(store, "u", reservation, options),
    (e) => e.code === "AI_POLICY_DENIED",
  );
  await store.db
    .prepare("UPDATE recruiting_ai_consent SET withdrawn_at=0 WHERE user_id=?")
    .run("u");
  await assert.rejects(
    validateAiReservation(store, "u", reservation, options),
    (e) => e.code === "AI_POLICY_DENIED",
  );
  assert.equal((await aiPolicy(store, "u", options)).requestsUsed, 1);
});

test("consent endpoint requires current version and cannot enable production gates", async (t) => {
  const { default: express } = await import("express");
  const { mountAiPolicy } =
    await import("../../server/recruiting-ai-policy.js");
  const store = await setup(t),
    app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: "u" };
    next();
  });
  mountAiPolicy(app, store, {
    ...options,
    enabled: false,
    qualityApproved: false,
  });
  app.use((error, req, res, next) => {
    void next;
    res.status(error.status || 400).json({ error: error.message });
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/recruiting/ai-policy`;
  const post = (body) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ consent: true, version: "old" })).status, 409);
  assert.equal(
    (await post({ consent: true, version: AI_CONSENT_VERSION, enabled: true }))
      .status,
    400,
  );
  const accepted = await (
    await post({ consent: true, version: AI_CONSENT_VERSION })
  ).json();
  assert.equal(accepted.consented, true);
  assert.equal(accepted.available, false);
  assert.equal(accepted.enabled, false);
  const withdrawn = await (await post({ consent: false })).json();
  assert.equal(withdrawn.consented, false);
});
