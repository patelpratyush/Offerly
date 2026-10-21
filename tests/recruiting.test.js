import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createStore } from "./helpers/store.js";
import { createApp } from "../server/app.js";
import { processRecruitingJobs } from "../server/recruiting.js";
import { processReminders } from "../server/reminders.js";
async function setup(t, path = ":memory:") {
  const store = await createStore(path),
    server = (await createApp(store)).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.db.close();
  });
  async function request(path, method = "GET", body, cookie) {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Offerly-Request": "1",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: method === "GET" ? undefined : JSON.stringify(body || {}),
      },
    );
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function register(name = "review") {
    const result = await request("/auth/register", "POST", {
      name: "Review",
      email: `${name}@example.com`,
      password: "review-testing-password",
    });
    assert.equal(result.status, 200);
    return result.cookie;
  }
  const cookie = await register();
  async function create(kind, data) {
    const result = await request(`/records/${kind}`, "POST", data, cookie);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  }
  const app = await create("application", {
    company: "Acme",
    title: "Engineer",
    stage: "Saved",
  });
  const user = (
    await store.get(
      (
        await store.db
          .prepare("SELECT id FROM users WHERE email=?")
          .get("review@example.com")
      ).id,
      app.id,
    )
  ).user_id;
  const workspace = async () =>
    (await request("/workspace", "GET", undefined, cookie)).data;
  async function evidence(extra = {}) {
    const body = {
      operationId: randomUUID(),
      sourceId: randomUUID(),
      excerpt: "Recruiter proposed an interview",
      effectiveAt: "2026-10-20T12:00:00Z",
      company: "Acme",
      title: "Engineer",
      changes: { stage: "Interviewing" },
      ...extra,
    };
    const result = await request("/recruiting/evidence", "POST", body, cookie);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { body, ...result.data };
  }
  const decide = async (review, application, extra = {}) =>
    await request(
      `/recruiting/reviews/${review.id}/decide`,
      "POST",
      {
        operationId: randomUUID(),
        version: review.version,
        decision: "accept",
        applicationId: application.id,
        applicationVersion: application.version,
        ...extra,
      },
      cookie,
    );
  return {
    store,
    request,
    register,
    cookie,
    create,
    app,
    user,
    workspace,
    evidence,
    decide,
  };
}
test("review ingestion is replay-safe, owner isolated, immutable, and never applies ambiguous evidence", async (t) => {
  const x = await setup(t);
  await x.create("application", {
    company: "Acme",
    title: "Engineer",
    stage: "Submitted",
  });
  const item = await x.evidence();
  assert.equal(
    (await x.request("/recruiting/evidence", "POST", item.body, x.cookie)).data
      .evidence.id,
    item.evidence.id,
  );
  assert.equal(
    (
      await x.request(
        "/recruiting/evidence",
        "POST",
        { ...item.body, excerpt: "Different" },
        x.cookie,
      )
    ).status,
    409,
  );
  const other = await x.register("other");
  assert.equal(
    (
      await x.request(
        "/recruiting/evidence",
        "POST",
        { ...item.body, operationId: randomUUID(), applicationId: x.app.id },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await x.request(
        `/records/recruiting_evidence/${item.evidence.id}`,
        "PUT",
        { ...item.evidence, excerpt: "Forged" },
        x.cookie,
      )
    ).status,
    400,
  );
  await processRecruitingJobs(x.store);
  await processRecruitingJobs(x.store);
  const w = await x.workspace();
  assert.equal(w.reviews.length, 1);
  assert.equal(w.reviews[0].candidateApplicationIds.length, 2);
  assert.equal(w.applications[0].stage, "Saved");
  assert.equal(
    (await x.decide(w.reviews[0], x.app, { applicationId: undefined })).status,
    400,
  );
  assert.equal(
    (
      await x.request(
        `/recruiting/reviews/${w.reviews[0].id}/decide`,
        "POST",
        { operationId: randomUUID(), version: 1, decision: "reject" },
        other,
      )
    ).status,
    404,
  );
  const exported = await x.request("/export.json", "GET", undefined, x.cookie);
  assert.equal(exported.status, 200);
  assert.match(
    JSON.stringify(exported.data),
    /Recruiter proposed an interview/,
  );
});
test("manual locks, review corrections, replay and undo preserve later application edits", async (t) => {
  const x = await setup(t);
  const edit = await x.request(
    `/records/application/${x.app.id}`,
    "PUT",
    { ...x.app, stage: "Preparing" },
    x.cookie,
  );
  assert.equal(edit.status, 200);
  await x.evidence();
  await processRecruitingJobs(x.store);
  let w = await x.workspace();
  const review = w.reviews[0];
  assert.equal(w.fieldLocks[0].locked, true);
  assert.equal((await x.decide(review, edit.data)).status, 409);
  const body = {
    operationId: randomUUID(),
    version: review.version,
    decision: "correct",
    applicationId: x.app.id,
    applicationVersion: edit.data.version,
    changes: { stage: "Under review" },
    override: true,
  };
  const accepted = await x.request(
    `/recruiting/reviews/${review.id}/decide`,
    "POST",
    body,
    x.cookie,
  );
  assert.equal(accepted.status, 200);
  assert.equal(
    (
      await x.request(
        `/recruiting/reviews/${review.id}/decide`,
        "POST",
        body,
        x.cookie,
      )
    ).data.application.version,
    accepted.data.application.version,
  );
  const undo = await x.request(
    `/recruiting/reviews/${review.id}/undo`,
    "POST",
    { operationId: randomUUID(), version: accepted.data.review.version },
    x.cookie,
  );
  assert.equal(undo.status, 200);
  w = await x.workspace();
  assert.equal(w.applications[0].stage, "Preparing");
  assert.equal(w.fieldLocks[0].locked, true);
  await x.evidence({ sourceId: "later" });
  await processRecruitingJobs(x.store);
  w = await x.workspace();
  const next = w.reviews.find((r) => r.status === "pending");
  const accept2 = await x.decide(next, w.applications[0], { override: true });
  assert.equal(accept2.status, 200);
  assert.equal(
    (
      await x.request(
        `/records/application/${x.app.id}`,
        "PUT",
        { ...accept2.data.application, notes: "Keep this later manual note" },
        x.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await x.request(
        `/recruiting/reviews/${next.id}/undo`,
        "POST",
        { operationId: randomUUID(), version: accept2.data.review.version },
        x.cookie,
      )
    ).status,
    409,
  );
});
test("out-of-order evidence and terminal reopen require explicit review override", async (t) => {
  const x = await setup(t);
  await x.evidence({ changes: { stage: "Rejected" } });
  await processRecruitingJobs(x.store);
  let w = await x.workspace();
  assert.equal((await x.decide(w.reviews[0], w.applications[0])).status, 200);
  await x.evidence({ effectiveAt: "2026-10-19T12:00:00Z" });
  await processRecruitingJobs(x.store);
  w = await x.workspace();
  const pending = w.reviews.find((r) => r.status === "pending");
  assert.equal((await x.decide(pending, w.applications[0])).status, 409);
  assert.equal(
    (await x.decide(pending, w.applications[0], { override: true })).status,
    200,
  );
});
test("canceled jobs cannot generate reviews; expired leases recover and deletion prevents resurrection", async (t) => {
  const x = await setup(t);
  const first = await x.evidence();
  const cancel = await x.request(
    `/recruiting/jobs/${first.job.id}/cancel`,
    "POST",
    { operationId: randomUUID(), version: first.job.version },
    x.cookie,
  );
  assert.equal(cancel.status, 200);
  await processRecruitingJobs(x.store);
  assert.equal((await x.workspace()).reviews.length, 0);
  const second = await x.evidence({ sourceId: "recover" });
  await x.store.save(
    x.user,
    "recruiting_job",
    {
      ...second.job,
      status: "running",
      leaseUntil: Date.now() - 1,
      attempts: 1,
    },
    second.job.id,
    second.job.version,
    "recruiting_test",
  );
  await processRecruitingJobs(x.store);
  assert.equal((await x.workspace()).reviews.length, 1);
  await x.evidence({ sourceId: "delete-pending" });
  await x.store.db.prepare("DELETE FROM users WHERE id=?").run(x.user);
  await processRecruitingJobs(x.store);
  await processReminders(x.store);
  assert.equal(
    (await x.store.db.prepare("SELECT count(*) n FROM records").get()).n,
    0,
  );
});
test("review decision rolls back application and locks when audit quota is exhausted", async (t) => {
  const x = await setup(t);
  await x.evidence();
  await processRecruitingJobs(x.store);
  const w = await x.workspace();
  const count = (
    await x.store.db.prepare("SELECT count(*) n FROM events").get()
  ).n;
  await x.store.atomic(async () => {
    const insert = x.store.db.prepare(
      "INSERT INTO events VALUES(?,?,?,?,?,?,?)",
    );
    for (let i = count; i < 49999; i++)
      await insert.run(
        `quota-${i}`,
        x.user,
        x.app.id,
        "2026-10-20",
        null,
        "{}",
        "manual",
      );
  });
  assert.equal((await x.decide(w.reviews[0], x.app)).status, 413);
  const after = await x.workspace();
  assert.equal(after.applications[0].stage, "Saved");
  assert.equal(after.reviews[0].status, "pending");
  assert.equal(after.fieldLocks.length, 0);
  assert.equal(
    (await x.store.db.prepare("SELECT count(*) n FROM events").get()).n,
    49999,
  );
});
test("date-only reminders honor timezone and source changes with replay-safe actions", async (t) => {
  const x = await setup(t);
  await x.store.db
    .prepare("UPDATE users SET timezone=? WHERE id=?")
    .run("America/Los_Angeles", x.user);
  const round = await x.create("round", {
    applicationId: x.app.id,
    title: "Interview",
    status: "Scheduled",
    date: "2099-01-02",
    time: "10:00",
    timezone: "America/Los_Angeles",
  });
  const body = {
    operationId: randomUUID(),
    title: "Prepare",
    applicationId: x.app.id,
    sourceKind: "round",
    sourceId: round.id,
    dueDate: "2099-01-01",
  };
  const reminder = await x.request("/reminders", "POST", body, x.cookie);
  assert.equal(reminder.status, 201);
  assert.equal(
    (await x.request("/reminders", "POST", body, x.cookie)).data.id,
    reminder.data.id,
  );
  assert.equal(
    (
      await x.request(
        "/reminders",
        "POST",
        { ...body, title: "Changed" },
        x.cookie,
      )
    ).status,
    409,
  );
  await processReminders(x.store, { now: new Date("2099-01-01T07:00:00Z") });
  assert.equal((await x.workspace()).reminders[0].state, "scheduled");
  await processReminders(x.store, { now: new Date("2099-01-01T09:00:00Z") });
  assert.equal((await x.workspace()).reminders[0].state, "due");
  const edited = await x.request(
    `/records/round/${round.id}`,
    "PUT",
    { ...round, date: "2099-01-03", status: "Rescheduled" },
    x.cookie,
  );
  assert.equal(edited.status, 200);
  assert.equal((await x.workspace()).reminders[0].state, "canceled");
  assert.equal(
    (
      await x.request(
        `/reminders/${reminder.data.id}/action`,
        "POST",
        {
          operationId: randomUUID(),
          version: reminder.data.version,
          action: "dismiss",
        },
        x.cookie,
      )
    ).status,
    409,
  );
  const other = await x.register("reminder-other");
  assert.equal(
    (
      await x.request(
        "/reminders",
        "POST",
        { ...body, operationId: randomUUID() },
        other,
      )
    ).status,
    404,
  );
});
test("closed applications cancel general reminders but preserve explicit tasks until completion", async (t) => {
  const x = await setup(t);
  const task = await x.create("task", {
    title: "Retain task",
    applicationId: x.app.id,
    due: "2099-01-01",
  });
  for (const [sourceKind, sourceId] of [
    ["application", x.app.id],
    ["task", task.id],
  ])
    assert.equal(
      (
        await x.request(
          "/reminders",
          "POST",
          {
            operationId: randomUUID(),
            title: sourceKind,
            applicationId: x.app.id,
            sourceKind,
            sourceId,
            dueDate: "2099-01-01",
          },
          x.cookie,
        )
      ).status,
      201,
    );
  assert.equal(
    (
      await x.request(
        `/records/application/${x.app.id}`,
        "PUT",
        { ...x.app, stage: "Withdrawn" },
        x.cookie,
      )
    ).status,
    200,
  );
  let reminders = (await x.workspace()).reminders;
  assert.equal(
    reminders.find((r) => r.sourceKind === "application").state,
    "canceled",
  );
  assert.equal(
    reminders.find((r) => r.sourceKind === "task").state,
    "scheduled",
  );
  assert.equal(
    (
      await x.request(
        `/records/task/${task.id}`,
        "PUT",
        { ...task, done: true },
        x.cookie,
      )
    ).status,
    200,
  );
  reminders = (await x.workspace()).reminders;
  assert.ok(reminders.every((r) => r.state === "canceled"));
});
test("a separate worker recovers durable queued work after restart without duplicating reviews", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "offerly-worker-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, "test.sqlite");
  const x = await setup(t, database);
  await x.evidence();
  for (let attempt = 0; attempt < 2; attempt++) {
    const worker = fork(new URL("../server/worker.js", import.meta.url), [], {
      env: { ...process.env, DATABASE_PATH: database },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    try {
      await once(worker, "message");
      for (let i = 0; i < 50; i++) {
        if ((await x.store.list(x.user, "recruiting_review")).length === 1)
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal((await x.store.list(x.user, "recruiting_review")).length, 1);
    } finally {
      const exited = once(worker, "exit");
      worker.kill("SIGTERM");
      await exited;
    }
  }
});
test("failed jobs back off, stop at retry limit, and retry explicitly without duplicate reviews", async (t) => {
  const x = await setup(t);
  const { job } = await x.evidence();
  const original = x.store.save;
  x.store.save = (user, kind, ...args) => {
    if (kind === "recruiting_review")
      throw new Error("Synthetic parser failure");
    return original(user, kind, ...args);
  };
  let now = Date.now();
  for (let i = 0; i < 3; i++) {
    await processRecruitingJobs(x.store, { now });
    now += 60000;
  }
  const failed = (await x.store.list(x.user, "recruiting_job"))[0];
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 3);
  assert.equal((await x.store.list(x.user, "recruiting_review")).length, 0);
  x.store.save = original;
  const retried = await x.request(
    `/recruiting/jobs/${job.id}/retry`,
    "POST",
    { operationId: randomUUID(), version: failed.version },
    x.cookie,
  );
  assert.equal(retried.status, 200);
  await processRecruitingJobs(x.store);
  await processRecruitingJobs(x.store);
  assert.equal((await x.store.list(x.user, "recruiting_review")).length, 1);
});
test("reminder failure isolation and mutation rollback preserve other accounts and source history", async (t) => {
  const x = await setup(t);
  const due = await x.request(
    "/reminders",
    "POST",
    {
      operationId: randomUUID(),
      title: "Follow up",
      applicationId: x.app.id,
      sourceKind: "application",
      sourceId: x.app.id,
      dueDate: "2099-01-01",
    },
    x.cookie,
  );
  assert.equal(due.status, 201);
  const otherCookie = await x.register("scheduler-other");
  const otherApp = await x.request(
    "/records/application",
    "POST",
    { company: "Other", title: "Engineer", stage: "Saved" },
    otherCookie,
  );
  assert.equal(otherApp.status, 200);
  const otherReminder = await x.request(
    "/reminders",
    "POST",
    {
      operationId: randomUUID(),
      title: "Other follow-up",
      applicationId: otherApp.data.id,
      sourceKind: "application",
      sourceId: otherApp.data.id,
      dueDate: "2099-01-01",
    },
    otherCookie,
  );
  assert.equal(otherReminder.status, 201);
  const original = x.store.save;
  x.store.save = (user, kind, ...args) => {
    if (kind === "reminder" && user === x.user)
      throw new Error("Synthetic history quota");
    return original(user, kind, ...args);
  };
  const result = await processReminders(x.store, {
    now: new Date("2099-01-02T12:00:00Z"),
  });
  assert.equal(result.failed, 1);
  assert.equal(result.changed, 1);
  assert.equal(
    (await x.request("/workspace", "GET", undefined, otherCookie)).data
      .reminders[0].state,
    "due",
  );
  assert.equal((await x.store.list(x.user, "reminder"))[0].state, "scheduled");
  const edit = await x.request(
    `/records/application/${x.app.id}`,
    "PUT",
    { ...x.app, stage: "Withdrawn" },
    x.cookie,
  );
  assert.equal(edit.status, 500);
  assert.equal(
    JSON.parse((await x.store.get(x.user, x.app.id)).data).stage,
    "Saved",
  );
  assert.equal((await x.store.list(x.user, "field_lock")).length, 0);
  x.store.save = original;
  await processReminders(x.store, { now: new Date("2099-01-02T12:00:00Z") });
  assert.equal((await x.store.list(x.user, "reminder"))[0].state, "due");
});
