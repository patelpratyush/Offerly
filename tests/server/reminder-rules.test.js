import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
import {
  planDeliveries,
  dispatchDeliveries,
  processDeliveries,
  loadSettings,
  MAX_ATTEMPTS,
} from "../../server/reminder-rules.js";
import {
  createEmailProvider,
  createDisabledEmailProvider,
} from "../../server/notification-provider.js";
import { zonedToUtc } from "../../server/zoned-time.js";
import { createStore } from "../helpers/store.js";
const NOW = new Date("2026-11-18T00:00:00Z");
function fakeProvider(failures = 0, permanent = false) {
  const sent = [];
  let calls = 0;
  const provider = createEmailProvider({
    enabled: true,
    transport: async (m) => {
      calls++;
      if (calls <= failures)
        throw Object.assign(new Error("secret provider detail"), { permanent });
      sent.push(m);
    },
  });
  return { provider, sent, calls: () => calls };
}
async function fixture(t, timezone = "America/New_York") {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const user = randomUUID();
  await store.db
    .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
    .run(user, `${user}@example.test`, "x", "T", timezone, "[]");
  const application = await store.save(user, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Interviewing",
    owner: "Employer",
  });
  return { store, user, application };
}
const round = (store, user, applicationId, extra = {}) =>
  store.save(user, "round", {
    title: "Panel",
    applicationId,
    status: "Scheduled",
    date: "2026-11-20",
    time: "10:00",
    timezone: "America/New_York",
    ...extra,
  });
const deliveries = async (store, user) =>
  (await store.list(user, "reminder_delivery")).sort((a, b) =>
    a.fireAt.localeCompare(b.fireAt),
  );
async function enableEmail(store, user) {
  const s = await loadSettings(store, user);
  const [row] = await store.list(user, "reminder_settings");
  const data = {
    emailOptIn: true,
    emailOptInAt: NOW.toISOString(),
    rules: s.rules.map((r) => ({ ...r, email: true })),
  };
  await store.save(
    user,
    "reminder_settings",
    data,
    row?.id,
    row?.version,
    "reminder_settings",
  );
}
test("zoned conversion is DST-correct and refuses ambiguous or nonexistent local times", () => {
  assert.equal(
    new Date(
      zonedToUtc("2026-11-20", "10:00", "America/New_York"),
    ).toISOString(),
    "2026-11-20T15:00:00.000Z",
  );
  assert.equal(
    new Date(
      zonedToUtc("2026-07-20", "10:00", "America/New_York"),
    ).toISOString(),
    "2026-07-20T14:00:00.000Z",
  );
  assert.equal(zonedToUtc("2026-03-08", "02:30", "America/New_York"), null);
  assert.equal(zonedToUtc("2026-11-01", "01:30", "America/New_York"), null);
  assert.equal(zonedToUtc("2026-11-01", "10:00", "Not/AZone"), null);
});
test("default rules plan 24h/1h interview and 48h/24h date-only assessment reminders without duplicates", async (t) => {
  const { store, user, application } = await fixture(t);
  await round(store, user, application.id);
  await store.save(user, "assessment", {
    title: "Take-home",
    applicationId: application.id,
    status: "Not started",
    due: "2026-11-25",
  });
  const first = await planDeliveries(store, user, NOW);
  const list = await deliveries(store, user);
  assert.equal(first.created, 4);
  assert.deepEqual(
    list.map((d) => [d.ruleId, d.fireAt, d.precision]),
    [
      ["interview_24h", "2026-11-19T15:00:00.000Z", "time"],
      ["interview_1h", "2026-11-20T14:00:00.000Z", "time"],
      ["assessment_48h", "2026-11-23T14:00:00.000Z", "date"],
      ["assessment_24h", "2026-11-24T14:00:00.000Z", "date"],
    ].sort((a, b) => a[1].localeCompare(b[1])),
  );
  const dateOnly = list.filter((d) => d.sourceKind === "assessment");
  assert.ok(
    dateOnly.every((d) => d.when === "2026-11-25" || d.when === "2026-11-25"),
  );
  assert.equal((await planDeliveries(store, user, NOW)).created, 0);
  assert.equal((await deliveries(store, user)).length, 4);
});
test("date-only deadlines never receive hour-based reminders", async (t) => {
  const { store, user, application } = await fixture(t);
  await round(store, user, application.id, { time: "" });
  await planDeliveries(store, user, NOW);
  const list = await deliveries(store, user);
  assert.deepEqual(
    list.map((d) => d.ruleId),
    ["interview_24h"],
  );
  assert.equal(list[0].precision, "date");
  assert.equal(list[0].when, "2026-11-20");
});
test("rescheduling or cancelling cancels pending reminders immediately and replans only the new occurrence", async (t) => {
  const { store, user, application } = await fixture(t);
  const r = await round(store, user, application.id);
  await planDeliveries(store, user, NOW);
  const moved = await store.save(
    user,
    "round",
    { ...r, id: undefined, version: undefined, date: "2026-11-22" },
    r.id,
    r.version,
  );
  assert.ok(
    (await deliveries(store, user)).every((d) => d.state === "canceled"),
  );
  await planDeliveries(store, user, NOW);
  const pending = (await deliveries(store, user)).filter(
    (d) => d.state === "pending",
  );
  assert.equal(pending.length, 2);
  assert.ok(pending.every((d) => d.fireAt >= "2026-11-21"));
  await store.save(
    user,
    "round",
    { ...moved, id: undefined, version: undefined, status: "Canceled" },
    moved.id,
    moved.version,
  );
  assert.equal(
    (await deliveries(store, user)).filter((d) => d.state === "pending").length,
    0,
  );
  await planDeliveries(store, user, NOW);
  assert.equal(
    (await deliveries(store, user)).filter((d) => d.state === "pending").length,
    0,
  );
});
test("follow-up rule applies only to waiting, unanswered, open applications", async (t) => {
  const { store, user, application } = await fixture(t);
  const open = await store.save(user, "application", {
    company: "B",
    title: "T",
    stage: "Submitted",
    owner: "Employer",
    appliedDate: "2026-11-12",
  });
  await store.save(user, "application", {
    company: "C",
    title: "T",
    stage: "Rejected",
    owner: "Employer",
    appliedDate: "2026-11-12",
  });
  await store.save(user, "application", {
    company: "D",
    title: "T",
    stage: "Submitted",
    owner: "You",
    appliedDate: "2026-11-12",
  });
  assert.ok(application.id);
  await planDeliveries(store, user, NOW);
  const list = await deliveries(store, user);
  assert.equal(list.length, 1);
  assert.equal(list[0].applicationId, open.id);
  assert.equal(list[0].ruleId, "followup_7d");
  assert.equal(list[0].fireAt, "2026-11-19T14:00:00.000Z");
});
test("in-app delivery marks sent once; email is suppressed while the provider is disabled", async (t) => {
  const { store, user, application } = await fixture(t);
  await round(store, user, application.id);
  await enableEmail(store, user);
  await planDeliveries(store, user, NOW);
  assert.equal((await deliveries(store, user)).length, 4);
  const later = new Date("2026-11-20T15:00:00Z");
  const result = await dispatchDeliveries(store, {
    now: later,
    provider: createDisabledEmailProvider(),
  });
  assert.equal(result.sent, 2);
  assert.equal(result.suppressed, 2);
  const states = (await deliveries(store, user)).map(
    (d) => `${d.channel}:${d.state}`,
  );
  assert.deepEqual(states.sort(), [
    "email:suppressed",
    "email:suppressed",
    "in_app:sent",
    "in_app:sent",
  ]);
  const again = await dispatchDeliveries(store, { now: later });
  assert.equal(again.processed, 0);
});
test("email dispatch is idempotent, rechecks opt-in, and retries are bounded", async (t) => {
  const { store, user, application } = await fixture(t);
  await round(store, user, application.id);
  await enableEmail(store, user);
  await planDeliveries(store, user, NOW);
  const fake = fakeProvider();
  const at = new Date("2026-11-20T15:00:00Z");
  await dispatchDeliveries(store, { now: at, provider: fake.provider });
  await dispatchDeliveries(store, { now: at, provider: fake.provider });
  assert.equal(fake.sent.length, 2);
  assert.equal(new Set(fake.sent.map((m) => m.idempotencyKey)).size, 2);
  assert.match(fake.sent[0].to, /@example\.test$/);
  assert.doesNotMatch(JSON.stringify(fake.sent), /password/i);
  // Opt-in withdrawn between planning and dispatch.
  const { store: s2, user: u2, application: a2 } = await fixture(t);
  await round(s2, u2, a2.id);
  await enableEmail(s2, u2);
  await planDeliveries(s2, u2, NOW);
  const [settings] = await s2.list(u2, "reminder_settings");
  await s2.save(
    u2,
    "reminder_settings",
    { ...settings, id: undefined, version: undefined, emailOptIn: false },
    settings.id,
    settings.version,
  );
  const f2 = fakeProvider();
  await dispatchDeliveries(s2, { now: at, provider: f2.provider });
  assert.equal(f2.calls(), 0);
  assert.ok(
    (await deliveries(s2, u2)).some(
      (d) => d.channel === "email" && d.state === "suppressed",
    ),
  );
  // Transient failures retry with backoff, then succeed; permanent stop at once.
  const { store: s3, user: u3, application: a3 } = await fixture(t);
  await round(s3, u3, a3.id);
  await enableEmail(s3, u3);
  await planDeliveries(s3, u3, NOW);
  const flaky = fakeProvider(1);
  await dispatchDeliveries(s3, { now: at, provider: flaky.provider });
  let email = (await deliveries(s3, u3)).filter((d) => d.channel === "email");
  assert.ok(email.some((d) => d.state === "pending" && d.attempts === 1));
  assert.ok(email.every((d) => !JSON.stringify(d).includes("secret")));
  await dispatchDeliveries(s3, { now: at, provider: flaky.provider });
  assert.equal(flaky.sent.length, 1, "not retried before backoff elapses");
  await dispatchDeliveries(s3, {
    now: new Date(at.getTime() + 10 * 60000),
    provider: flaky.provider,
  });
  email = (await deliveries(s3, u3)).filter((d) => d.channel === "email");
  assert.equal(flaky.sent.length, 2);
  assert.ok(email.every((d) => d.state === "sent"));
  const { store: s4, user: u4, application: a4 } = await fixture(t);
  await round(s4, u4, a4.id);
  await enableEmail(s4, u4);
  await planDeliveries(s4, u4, NOW);
  const broken = fakeProvider(99);
  let clock = at.getTime();
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    await dispatchDeliveries(s4, {
      now: new Date(clock),
      provider: broken.provider,
    });
    clock += 3 * 3600000;
  }
  const failed = (await deliveries(s4, u4)).filter(
    (d) => d.channel === "email",
  );
  assert.ok(
    failed.every((d) => d.state === "failed" && d.attempts === MAX_ATTEMPTS),
  );
  assert.equal(broken.calls(), 2 * MAX_ATTEMPTS);
  const { store: s5, user: u5, application: a5 } = await fixture(t);
  await round(s5, u5, a5.id);
  await enableEmail(s5, u5);
  await planDeliveries(s5, u5, NOW);
  const hard = fakeProvider(99, true);
  await dispatchDeliveries(s5, { now: at, provider: hard.provider });
  assert.equal(hard.calls(), 2);
});
test("dispatch skips sources that changed or closed, and account deletion cascades", async (t) => {
  const { store, user, application } = await fixture(t);
  await round(store, user, application.id);
  await planDeliveries(store, user, NOW);
  // Closing the application cancels pending reminders through the source hook.
  const fresh = await store.get(user, application.id);
  await store.save(
    user,
    "application",
    { ...JSON.parse(fresh.data), stage: "Withdrawn" },
    application.id,
    fresh.version,
  );
  assert.equal(
    (await deliveries(store, user)).filter((d) => d.state === "pending").length,
    0,
  );
  await store.save(user, "reminder_settings", { emailOptIn: false, rules: [] });
  const worker = await processDeliveries(store, { now: NOW });
  assert.equal(typeof worker.planned, "number");
  await store.db.prepare("DELETE FROM users WHERE id=?").run(user);
  assert.equal(
    (
      await store.db
        .prepare(
          "SELECT count(*) n FROM records WHERE user_id=? AND kind IN ('reminder_delivery','reminder_settings')",
        )
        .get(user)
    ).n,
    0,
  );
});
test("settings API validates, scopes to owner, and disabling a rule cancels its pending deliveries", async (t) => {
  const store = await createStore(":memory:");
  const server = (await createApp(store)).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = "GET", body, cookie) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Offerly-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const register = async (email) => {
    const res = await fetch(base + "/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Offerly-Request": "1" },
      body: JSON.stringify({
        name: "T",
        email,
        password: "a-secure-test-password",
        timezone: "UTC",
      }),
    });
    const id = (
      await store.db.prepare("SELECT id FROM users WHERE email=?").get(email)
    ).id;
    return { cookie: res.headers.get("set-cookie").split(";")[0], id };
  };
  assert.equal((await call("/reminder-settings")).status, 401);
  const a = await register("a@example.test"),
    b = await register("b@example.test");
  const initial = (await call("/reminder-settings", "GET", undefined, a.cookie))
    .data;
  assert.equal(initial.settings.version, 0);
  assert.equal(initial.settings.rules.length, 5);
  assert.ok(initial.settings.rules.every((r) => r.enabled && !r.email));
  assert.equal(initial.email.available, false);
  const application = await store.save(a.id, "application", {
    company: "Acme",
    title: "E",
    stage: "Interviewing",
  });
  const future = new Date(Date.now() + 10 * 86400000)
    .toISOString()
    .slice(0, 10);
  await store.save(a.id, "round", {
    title: "R",
    applicationId: application.id,
    status: "Scheduled",
    date: future,
    time: "10:00",
    timezone: "UTC",
  });
  let view = (await call("/reminder-settings", "GET", undefined, a.cookie))
    .data;
  assert.equal(view.deliveries.filter((d) => d.state === "pending").length, 2);
  const rules = view.settings.rules.map((r) =>
    r.id === "interview_1h" ? { ...r, enabled: false } : r,
  );
  assert.equal(
    (
      await call(
        "/reminder-settings",
        "PUT",
        { emailOptIn: false, rules: rules.slice(1) },
        a.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/reminder-settings",
        "PUT",
        {
          emailOptIn: false,
          rules: rules.map((r) =>
            r.id === "interview_24h" ? { ...r, value: 1 } : r,
          ),
        },
        a.cookie,
      )
    ).status,
    400,
  );
  const saved = await call(
    "/reminder-settings",
    "PUT",
    { emailOptIn: false, rules: rules.map((r) => ({ ...r, email: true })) },
    a.cookie,
  );
  assert.equal(saved.status, 200);
  assert.ok(saved.data.settings.rules.every((r) => r.email === false));
  assert.deepEqual(
    saved.data.deliveries
      .filter((d) => d.state === "pending")
      .map((d) => d.ruleId),
    ["interview_24h"],
  );
  const stale = await call(
    "/reminder-settings",
    "PUT",
    { emailOptIn: false, rules },
    a.cookie,
  );
  assert.equal(stale.status, 409);
  const optIn = await call(
    "/reminder-settings",
    "PUT",
    {
      version: saved.data.settings.version,
      emailOptIn: true,
      rules: saved.data.settings.rules.map((r) => ({ ...r, email: true })),
    },
    a.cookie,
  );
  assert.equal(optIn.data.settings.emailOptIn, true);
  assert.ok(optIn.data.settings.emailOptInAt);
  assert.match(optIn.data.email.note, /not enabled/);
  const other = (await call("/reminder-settings", "GET", undefined, b.cookie))
    .data;
  assert.equal(other.settings.version, 0);
  assert.equal(other.deliveries.length, 0);
});
