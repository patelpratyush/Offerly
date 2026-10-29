import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import { createStore } from "../helpers/store.js";
async function setup(t) {
  const store = await createStore(":memory:");
  const server = (await createApp(store)).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, method = "GET", body, cookie) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Offerly-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body:
        body === undefined
          ? ["GET", "HEAD"].includes(method)
            ? undefined
            : "{}"
          : JSON.stringify(body),
    });
    return {
      status: res.status,
      cookie: res.headers.get("set-cookie")?.split(";")[0],
      data: await res.json().catch(() => null),
    };
  };
  const register = async (email) => {
    const r = await request("/auth/register", "POST", {
      name: "Test User",
      email,
      password: "a-secure-test-password",
      timezone: "America/New_York",
    });
    assert.equal(r.status, 200);
    return r.cookie;
  };
  return { request, register, store };
}
test("private records, histories, files and edits enforce ownership", async (t) => {
  const { request, register } = await setup(t);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  assert.equal((await request("/workspace")).status, 401);
  const application = (
    await request(
      "/records/application",
      "POST",
      { company: "Acme", title: "Engineer", stage: "Saved" },
      a,
    )
  ).data;
  assert.equal(
    (await request("/workspace", "GET", undefined, b)).data.applications.length,
    0,
  );
  assert.equal(
    (
      await request(
        "/records/application/" + application.id,
        "PUT",
        { ...application, stage: "Offer" },
        b,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request("/events/" + application.id, "GET", undefined, b)).status,
    404,
  );
  const f = (
    await request(
      "/files",
      "POST",
      {
        name: "resume.pdf",
        body: Buffer.from(
          "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
        ).toString("base64"),
      },
      a,
    )
  ).data;
  assert.ok(f.id);
  assert.equal(
    (await request("/files/" + f.id, "GET", undefined, b)).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/records/document",
        "POST",
        { title: "Stolen", fileId: f.id },
        b,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/records/task",
        "POST",
        { title: "Bad link", applicationId: application.id },
        b,
      )
    ).status,
    400,
  );
});
test("stale writes conflict; multiple roles stay separate; notes retain revisions", async (t) => {
  const { request, register } = await setup(t);
  const cookie = await register("a@example.com");
  const a = (
    await request(
      "/records/application",
      "POST",
      { company: "Acme", title: "Engineer", stage: "Submitted" },
      cookie,
    )
  ).data;
  await request(
    "/records/application",
    "POST",
    { company: "Acme", title: "Analyst", stage: "Saved" },
    cookie,
  );
  assert.equal(
    (
      await request(
        "/records/application/" + a.id,
        "PUT",
        { ...a, stage: "Interviewing", notes: "First note" },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/records/application/" + a.id,
        "PUT",
        { ...a, stage: "Rejected" },
        cookie,
      )
    ).status,
    409,
  );
  const w = (await request("/workspace", "GET", undefined, cookie)).data;
  assert.equal(w.applications.length, 2);
  assert.equal(w.applications[0].stage, "Interviewing");
  const events = (await request("/events/" + a.id, "GET", undefined, cookie))
    .data;
  const applicationEvents = events.filter(
    (event) => event.kind === "application",
  );
  assert.equal(applicationEvents.length, 2);
  assert.equal(JSON.parse(applicationEvents[0].before_data).stage, "Submitted");
  assert.equal(events.filter((event) => event.kind === "field_lock").length, 1);
});
test("CSV preview validates dates and replay does not duplicate applications", async (t) => {
  const { request, register } = await setup(t);
  const cookie = await register("a@example.com");
  const preview = (
    await request(
      "/import/preview",
      "POST",
      {
        csv: "company,title,stage,appliedDate\nAcme,Engineer,Submitted,2026-10-01\nAcme,Analyst,Saved,2026-02-30",
      },
      cookie,
    )
  ).data;
  assert.ok(preview.rows[1].error);
  const body = { id: preview.id };
  assert.equal(
    (await request("/import/commit", "POST", body, cookie)).data.count,
    1,
  );
  assert.equal(
    (await request("/import/commit", "POST", body, cookie)).data.replayed,
    true,
  );
  assert.equal(
    (
      await request(
        "/import/preview",
        "POST",
        { csv: "company,title\nAcme,Engineer" },
        cookie,
      )
    ).data.rows[0].duplicate,
    true,
  );
});
test("documents immutable; deletion invalidates sessions and removes private data", async (t) => {
  const { request, register, store } = await setup(t);
  const cookie = await register("a@example.com");
  const f = (
    await request(
      "/files",
      "POST",
      {
        name: "resume.pdf",
        body: Buffer.from(
          "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
        ).toString("base64"),
      },
      cookie,
    )
  ).data;
  const doc = (
    await request(
      "/records/document",
      "POST",
      { title: "Resume v1", fileId: f.id },
      cookie,
    )
  ).data;
  assert.equal(
    (
      await request(
        "/records/document/" + doc.id,
        "PUT",
        { ...doc, title: "Overwritten" },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/account", "DELETE", { confirm: "wrong" }, cookie)).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/account",
        "DELETE",
        { confirm: "a@example.com", password: "a-secure-test-password" },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/workspace", "GET", undefined, cookie)).status,
    401,
  );
  for (const table of [
    "users",
    "sessions",
    "records",
    "events",
    "files",
    "import_batches",
  ])
    assert.equal(
      (await store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n,
      0,
    );
});
test("scheduled rounds need dates; stage removal and untrusted links rejected", async (t) => {
  const { request, register } = await setup(t);
  const c = await register("a@example.com");
  const a = (
    await request(
      "/records/application",
      "POST",
      { company: "Acme", title: "Engineer", stage: "Saved" },
      c,
    )
  ).data;
  assert.equal(
    (
      await request(
        "/records/round",
        "POST",
        {
          title: "Round 1",
          applicationId: a.id,
          status: "Scheduled",
          timezone: "UTC",
        },
        c,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/records/application",
        "POST",
        {
          company: "Acme",
          title: "Engineer",
          stage: "Saved",
          url: "javascript:alert(1)",
        },
        c,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/settings",
        "PUT",
        { timezone: "UTC", stages: ["Submitted"] },
        c,
      )
    ).status,
    400,
  );
  const round = (
    await request(
      "/records/round",
      "POST",
      {
        title: "Round 1",
        applicationId: a.id,
        status: "Scheduled",
        date: "2020-01-01",
        timezone: "UTC",
      },
      c,
    )
  ).data;
  assert.equal(round.status, "Scheduled");
  assert.equal(
    (await request("/workspace", "GET", undefined, c)).data.applications[0]
      .stage,
    "Saved",
  );
});
test("mapped CSV dates are explicit; within-file duplicates need decisions and commits replay safely", async (t) => {
  const { request, register } = await setup(t);
  const c = await register("import@example.com");
  const csv =
    "Employer,Position,When,Req\nAcme,Engineer,03/04/2026,R1\nAcme,Engineer,03/04/2026,R1\nAcme,Engineer,04/04/2026,R2\nOther,Analyst,31/02/2026,R3";
  const mapping = {
    company: "Employer",
    title: "Position",
    appliedDate: "When",
    requisition: "Req",
  };
  const r = await request(
    "/import/preview",
    "POST",
    { csv, mapping, dateFormat: "DMY" },
    c,
  );
  assert.equal(r.status, 200);
  const p = r.data;
  assert.equal(p.rows[0].data.appliedDate, "2026-04-03");
  assert.equal(p.rows[1].duplicate, true);
  assert.equal(p.rows[2].duplicate, false);
  assert.ok(p.rows[3].error);
  const body = { id: p.id, decisions: { 2: "import", 3: "keep", 4: "import" } };
  const imported = await request("/import/commit", "POST", body, c);
  assert.equal(imported.data.count, 3);
  const replay = await request("/import/commit", "POST", body, c);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.ids, imported.data.ids);
  assert.equal(
    (await request("/workspace", "GET", undefined, c)).data.applications.length,
    3,
  );
  const b = await register("other@example.com");
  assert.equal((await request("/import/commit", "POST", body, b)).status, 404);
  assert.equal(
    (
      await request(
        "/import/preview",
        "POST",
        { csv, mapping: { company: "Employer", title: "Missing" } },
        c,
      )
    ).status,
    400,
  );
});
test("CSV commit is atomic when a preview becomes stale or validation changes", async (t) => {
  const { request, register, store } = await setup(t);
  const c = await register("atomic@example.com");
  const p = (
    await request(
      "/import/preview",
      "POST",
      { csv: "company,title\nFresh,Developer\nAcme,Engineer" },
      c,
    )
  ).data;
  await request(
    "/records/application",
    "POST",
    { company: "Acme", title: "Engineer", stage: "Saved" },
    c,
  );
  const result = await request("/import/commit", "POST", { id: p.id }, c);
  assert.equal(result.status, 409);
  assert.equal(
    (await request("/workspace", "GET", undefined, c)).data.applications.length,
    1,
  );
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM events").get()).n,
    1,
  );
  assert.equal(
    (
      await store.db
        .prepare("SELECT result FROM import_batches WHERE id=?")
        .get(p.id)
    ).result,
    null,
  );
});
test("unified timeline retains child updates and unlink evidence without cross-user access", async (t) => {
  const { request, register } = await setup(t);
  const c = await register("timeline@example.com"),
    other = await register("other@example.com");
  const a = (
    await request(
      "/records/application",
      "POST",
      { company: "Acme", title: "Engineer", stage: "Submitted" },
      c,
    )
  ).data;
  const b = (
    await request(
      "/records/application",
      "POST",
      { company: "Beta", title: "Analyst", stage: "Saved" },
      c,
    )
  ).data;
  const task = (
    await request(
      "/records/task",
      "POST",
      { title: "Follow up", applicationId: a.id },
      c,
    )
  ).data;
  await request(
    "/records/task/" + task.id,
    "PUT",
    { ...task, done: true, applicationId: b.id },
    c,
  );
  const person = (
    await request(
      "/records/contact",
      "POST",
      { name: "Recruiter", applicationIds: [a.id] },
      c,
    )
  ).data;
  await request(
    "/records/contact/" + person.id,
    "PUT",
    { ...person, applicationIds: [] },
    c,
  );
  const history = (await request("/events/" + a.id, "GET", undefined, c)).data;
  assert.equal(history.filter((e) => e.kind === "task").length, 2);
  assert.equal(history.filter((e) => e.kind === "contact").length, 2);
  const bHistory = (await request("/events/" + b.id, "GET", undefined, c)).data;
  assert.equal(bHistory.filter((e) => e.kind === "task").length, 1);
  assert.equal(
    (await request("/events/" + a.id, "GET", undefined, other)).status,
    404,
  );
});
test("assessment completion is explicit, validated and independent of application stage", async (t) => {
  const { request, register } = await setup(t);
  const c = await register("assessment@example.com");
  const a = (
    await request(
      "/records/application",
      "POST",
      { company: "Acme", title: "Engineer", stage: "Submitted" },
      c,
    )
  ).data;
  const assessment = (
    await request(
      "/records/assessment",
      "POST",
      { title: "Take home", applicationId: a.id, due: "2020-01-01" },
      c,
    )
  ).data;
  assert.equal(assessment.status, "Not started");
  assert.equal(
    (
      await request(
        "/records/assessment/" + assessment.id,
        "PUT",
        { ...assessment, status: "Completed" },
        c,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/records/assessment/" + assessment.id,
        "PUT",
        { ...assessment, score: "90%" },
        c,
      )
    ).status,
    400,
  );
  const completed = (
    await request(
      "/records/assessment/" + assessment.id,
      "PUT",
      {
        ...assessment,
        status: "Completed",
        completedDate: "2026-10-19",
        score: "90%",
      },
      c,
    )
  ).data;
  assert.equal(completed.score, "90%");
  assert.equal(
    (await request("/workspace", "GET", undefined, c)).data.applications[0]
      .stage,
    "Submitted",
  );
  assert.equal(
    (await request("/events/" + a.id, "GET", undefined, c)).data.filter(
      (e) => e.kind === "assessment",
    ).length,
    2,
  );
});
test("duplicate review keeps distinct requisitions separate; archive and undo retain child records", async (t) => {
  const { request, register } = await setup(t);
  const c = await register("duplicates@example.com");
  const create = async (data) =>
    (
      await request(
        "/records/application",
        "POST",
        { company: "Acme", title: "Engineer", stage: "Saved", ...data },
        c,
      )
    ).data;
  const a = await create({ requisition: "R1" }),
    b = await create({ requisition: "R1" }),
    different = await create({ requisition: "R2" });
  await request(
    "/records/task",
    "POST",
    { title: "Notes to keep", applicationId: b.id },
    c,
  );
  let w = (await request("/workspace", "GET", undefined, c)).data;
  assert.equal(w.duplicates.length, 1);
  assert.ok(!w.duplicates[0].key.includes(different.id));
  const body = {
    leftId: a.id,
    rightId: b.id,
    leftVersion: a.version,
    rightVersion: b.version,
    decision: "archive",
    targetId: b.id,
  };
  const review = (await request("/duplicates/review", "POST", body, c)).data;
  assert.ok(review.id);
  w = (await request("/workspace", "GET", undefined, c)).data;
  assert.equal(w.duplicates.length, 0);
  assert.equal(w.applications.find((v) => v.id === b.id).archived, true);
  assert.equal(w.tasks.length, 1);
  assert.equal(
    (await request("/duplicates/" + review.id + "/undo", "POST", {}, c)).status,
    200,
  );
  w = (await request("/workspace", "GET", undefined, c)).data;
  assert.equal(w.applications.find((v) => v.id === b.id).archived, false);
  assert.equal(w.duplicates.length, 1);
  const bNow = w.applications.find((v) => v.id === b.id);
  const keep = (
    await request(
      "/duplicates/review",
      "POST",
      { ...body, rightVersion: bNow.version, decision: "keep" },
      c,
    )
  ).data;
  assert.ok(keep.id);
  assert.equal(
    (await request("/workspace", "GET", undefined, c)).data.duplicates.length,
    0,
  );
  const other = await register("other@example.com");
  assert.equal(
    (await request("/duplicates/" + keep.id + "/undo", "POST", {}, other))
      .status,
    404,
  );
  await request("/duplicates/" + keep.id + "/undo", "POST", {}, c);
  assert.equal(
    (await request("/workspace", "GET", undefined, c)).data.duplicates.length,
    1,
  );
});
test("duplicate undo refuses to overwrite a later application edit", async (t) => {
  const { request, register } = await setup(t);
  const c = await register("conflict@example.com");
  const create = async () =>
    (
      await request(
        "/records/application",
        "POST",
        { company: "Acme", title: "Engineer", stage: "Saved" },
        c,
      )
    ).data;
  const a = await create(),
    b = await create();
  const review = (
    await request(
      "/duplicates/review",
      "POST",
      {
        leftId: a.id,
        rightId: b.id,
        leftVersion: 1,
        rightVersion: 1,
        decision: "archive",
        targetId: b.id,
      },
      c,
    )
  ).data;
  const archived = (
    await request("/workspace", "GET", undefined, c)
  ).data.applications.find((v) => v.id === b.id);
  await request(
    "/records/application/" + b.id,
    "PUT",
    { ...archived, notes: "New note" },
    c,
  );
  assert.equal(
    (await request("/duplicates/" + review.id + "/undo", "POST", {}, c)).status,
    409,
  );
  assert.equal(
    (await request("/workspace", "GET", undefined, c)).data.applications.find(
      (v) => v.id === b.id,
    ).notes,
    "New note",
  );
});
test("saved views persist all filters and enforce ownership and versions", async (t) => {
  const { request, register } = await setup(t);
  const a = await register("views-a@example.com"),
    b = await register("views-b@example.com");
  const created = await request(
    "/records/saved_view",
    "POST",
    {
      name: "Remote priorities",
      filters: {
        arrangement: "Remote",
        priority: "High",
        board: true,
        dateFrom: "2026-10-01",
        dateTo: "2026-10-20",
      },
    },
    a,
  );
  assert.equal(created.status, 200);
  const view = created.data;
  assert.equal(
    (await request("/workspace", "GET", undefined, a)).data.savedViews[0]
      .filters.board,
    true,
  );
  assert.equal(
    (await request("/workspace", "GET", undefined, b)).data.savedViews.length,
    0,
  );
  assert.equal(
    (
      await request(
        `/records/saved_view/${view.id}`,
        "PUT",
        { ...view, name: "Stolen" },
        b,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/records/saved_view/${view.id}`,
        "PUT",
        { ...view, name: "Updated" },
        a,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/records/saved_view/${view.id}`, "PUT", view, a)).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/records/saved_view",
        "POST",
        {
          name: "Bad",
          filters: { dateFrom: "2026-10-20", dateTo: "2026-10-01" },
        },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/records/saved_view",
        "POST",
        { name: "Bad", filters: { dateFrom: "2026-02-30" } },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/records/saved_view/${view.id}`,
        "PUT",
        { ...view, version: 2, archived: true },
        a,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/workspace", "GET", undefined, a)).data.savedViews.length,
    0,
  );
});
test("bulk edits are atomic, owned, bounded and replay-safe with preserved history", async (t) => {
  const { request, register, store } = await setup(t);
  const a = await register("bulk-a@example.com"),
    b = await register("bulk-b@example.com");
  const create = async (cookie, title) =>
    (
      await request(
        "/records/application",
        "POST",
        { company: "Acme", title, stage: "Saved" },
        cookie,
      )
    ).data;
  const first = await create(a, "Backend"),
    second = await create(a, "Data"),
    foreign = await create(b, "Private");
  const body = {
    operationId: crypto.randomUUID(),
    applications: [first, second].map(({ id, version }) => ({ id, version })),
    changes: { priority: "High" },
  };
  const result = await request("/applications/bulk", "POST", body, a);
  assert.equal(result.status, 200);
  assert.equal(result.data.count, 2);
  assert.equal(
    (await request("/applications/bulk", "POST", body, a)).data.replayed,
    true,
  );
  let apps = (await request("/workspace", "GET", undefined, a)).data
    .applications;
  assert.ok(apps.every((v) => v.priority === "High" && v.version === 2));
  const history = (await request(`/events/${first.id}`, "GET", undefined, a))
    .data;
  assert.equal(history.length, 2);
  assert.ok(history.some((e) => e.actor === "manual_bulk"));
  assert.equal(
    (
      await request(
        "/applications/bulk",
        "POST",
        { ...body, changes: { stage: "Offer" } },
        a,
      )
    ).status,
    409,
  );
  const failed = await request(
    "/applications/bulk",
    "POST",
    {
      operationId: crypto.randomUUID(),
      applications: [
        { id: first.id, version: 2 },
        { id: second.id, version: 1 },
      ],
      changes: { stage: "Offer" },
    },
    a,
  );
  assert.equal(failed.status, 409);
  assert.equal(
    (
      await request(
        "/applications/bulk",
        "POST",
        {
          ...body,
          operationId: crypto.randomUUID(),
          applications: [
            { id: first.id, version: 2 },
            { id: foreign.id, version: 1 },
          ],
        },
        a,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/applications/bulk",
        "POST",
        {
          ...body,
          operationId: crypto.randomUUID(),
          applications: [{ id: first.id, version: 2 }],
          changes: { stage: "Invented" },
        },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/applications/bulk",
        "POST",
        { ...body, applications: [body.applications[0], body.applications[0]] },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/applications/bulk",
        "POST",
        { ...body, applications: Array(101).fill(body.applications[0]) },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/applications/bulk",
        "POST",
        { ...body, changes: { company: "Overwrite" } },
        a,
      )
    ).status,
    400,
  );
  apps = (await request("/workspace", "GET", undefined, a)).data.applications;
  assert.ok(apps.every((v) => v.stage === "Saved" && v.version === 2));
  const archived = await request(
    "/applications/bulk",
    "POST",
    {
      operationId: crypto.randomUUID(),
      applications: apps.map(({ id, version }) => ({ id, version })),
      changes: { archived: true },
    },
    a,
  );
  assert.equal(archived.status, 200);
  assert.ok(
    (await request("/workspace", "GET", undefined, a)).data.applications.every(
      (v) => v.archived,
    ),
  );
  assert.equal(
    (
      await request(
        "/account",
        "DELETE",
        { confirm: "bulk-a@example.com", password: "a-secure-test-password" },
        a,
      )
    ).status,
    200,
  );
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM mutation_receipts").get())
      .n,
    0,
  );
});
test("compensation preserves unknowns and explicit currency, period and basis across edits and CSV", async (t) => {
  const { request, register } = await setup(t);
  const cookie = await register("pay@example.com");
  const plain = { company: "Acme", title: "Engineer", stage: "Saved" };
  const unknown = (await request("/records/application", "POST", plain, cookie))
    .data;
  assert.equal(unknown.compensationMin, "");
  assert.equal(unknown.compensationBasis, "Unknown");
  for (const changes of [
    { compensationMin: "-1" },
    { compensationMin: "1e5" },
    { compensationMin: "90000", compensationMax: "80000" },
    { compensationMin: 90000 },
    { compensationCurrency: "US" },
    { compensationPeriod: "Annual" },
  ]) {
    assert.equal(
      (
        await request(
          "/records/application",
          "POST",
          { ...plain, ...changes },
          cookie,
        )
      ).status,
      400,
    );
  }
  const pay = {
    compensationMin: "90000",
    compensationMax: "120000.50",
    compensationCurrency: "USD",
    compensationPeriod: "Year",
    compensationBasis: "Base",
  };
  const app = (
    await request(
      `/records/application/${unknown.id}`,
      "PUT",
      { ...unknown, ...pay },
      cookie,
    )
  ).data;
  for (const key of Object.keys(pay)) assert.equal(app[key], pay[key]);
  const preview = (
    await request(
      "/import/preview",
      "POST",
      {
        csv: "company,title,compensationMin,compensationMax,compensationCurrency,compensationPeriod,compensationBasis\nBeta,Engineer,45,65.50,CAD,Hour,Total\nUnknown,Engineer,,,,,\nBad,Engineer,200,100,USD,Year,Base",
      },
      cookie,
    )
  ).data;
  assert.equal(preview.rows[0].data.compensationPeriod, "Hour");
  assert.equal(preview.rows[0].data.compensationBasis, "Total");
  assert.equal(preview.rows[1].data.compensationMin, "");
  assert.ok(preview.rows[2].error);
  const imported = await request(
    "/import/commit",
    "POST",
    { id: preview.id, decisions: { 2: "keep", 3: "keep", 4: "skip" } },
    cookie,
  );
  assert.equal(imported.status, 200);
  const workspace = (await request("/workspace", "GET", undefined, cookie))
    .data;
  assert.equal(
    workspace.applications.find((v) => v.company === "Beta")
      .compensationCurrency,
    "CAD",
  );
});
test("duplicate merge previews linked records, rejects stale previews and reverses atomically", async (t) => {
  const { request, register, store } = await setup(t);
  const cookie = await register("merge@example.com"),
    other = await register("merge-other@example.com");
  const create = async (kind, data, owner = cookie) =>
    (await request("/records/" + kind, "POST", data, owner)).data;
  const left = await create("application", {
    company: "Acme",
    title: "Engineer",
    stage: "Saved",
    notes: "Primary notes",
  });
  const right = await create("application", {
    company: "Acme",
    title: "Engineer",
    stage: "Submitted",
    notes: "Original notes",
  });
  const task = await create("task", {
    title: "Follow up",
    applicationId: right.id,
  });
  const contact = await create("contact", {
    name: "Recruiter",
    applicationIds: [left.id, right.id],
  });
  const file = (
    await request(
      "/files",
      "POST",
      {
        name: "merge.pdf",
        body: Buffer.from(
          "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
        ).toString("base64"),
      },
      cookie,
    )
  ).data;
  const document = await create("document", {
    title: "Original resume",
    fileId: file.id,
    applicationIds: [right.id],
  });
  const fileBefore = Buffer.from(
    (await store.db.prepare("SELECT body FROM files WHERE id=?").get(file.id))
      .body,
  );
  const args = { leftId: left.id, rightId: right.id, targetId: left.id };
  assert.equal(
    (await request("/duplicates/merge-preview", "POST", args, other)).status,
    404,
  );
  const preview = (
    await request("/duplicates/merge-preview", "POST", args, cookie)
  ).data;
  assert.equal(preview.affected.length, 3);
  const merge = {
    ...args,
    leftVersion: left.version,
    rightVersion: right.version,
    decision: "merge",
    fingerprint: preview.fingerprint,
  };
  const later = await create("assessment", {
    title: "Take-home",
    applicationId: right.id,
  });
  assert.equal(
    (await request("/duplicates/review", "POST", merge, cookie)).status,
    409,
  );
  const fresh = (
    await request("/duplicates/merge-preview", "POST", args, cookie)
  ).data;
  const result = await request(
    "/duplicates/review",
    "POST",
    { ...merge, fingerprint: fresh.fingerprint },
    cookie,
  );
  assert.equal(result.status, 200);
  let w = (await request("/workspace", "GET", undefined, cookie)).data;
  assert.equal(w.applications.find((a) => a.id === right.id).archived, true);
  assert.equal(
    w.applications.find((a) => a.id === left.id).notes,
    "Primary notes",
  );
  assert.equal(
    w.applications.find((a) => a.id === right.id).notes,
    "Original notes",
  );
  assert.equal(w.tasks.find((a) => a.id === task.id).applicationId, left.id);
  assert.deepEqual(
    w.documents.find((a) => a.id === document.id).applicationIds,
    [left.id],
  );
  assert.deepEqual(
    Buffer.from(
      (await store.db.prepare("SELECT body FROM files WHERE id=?").get(file.id))
        .body,
    ),
    fileBefore,
  );
  assert.equal(
    w.assessments.find((a) => a.id === later.id).applicationId,
    left.id,
  );
  assert.deepEqual(w.contacts.find((a) => a.id === contact.id).applicationIds, [
    left.id,
  ]);
  assert.equal(
    (await request(`/duplicates/${result.data.id}/undo`, "POST", {}, other))
      .status,
    404,
  );
  assert.equal(
    (await request(`/duplicates/${result.data.id}/undo`, "POST", {}, cookie))
      .status,
    200,
  );
  w = (await request("/workspace", "GET", undefined, cookie)).data;
  assert.equal(w.applications.find((a) => a.id === right.id).archived, false);
  assert.equal(w.tasks.find((a) => a.id === task.id).applicationId, right.id);
  assert.deepEqual(
    w.documents.find((a) => a.id === document.id).applicationIds,
    [right.id],
  );
  assert.deepEqual(w.contacts.find((a) => a.id === contact.id).applicationIds, [
    left.id,
    right.id,
  ]);
  assert.equal(
    (await request(`/duplicates/${result.data.id}/undo`, "POST", {}, cookie))
      .status,
    200,
  );
  const secondPreview = (
    await request("/duplicates/merge-preview", "POST", args, cookie)
  ).data;
  const second = (
    await request(
      "/duplicates/review",
      "POST",
      {
        ...merge,
        leftVersion: 3,
        rightVersion: 3,
        fingerprint: secondPreview.fingerprint,
      },
      cookie,
    )
  ).data;
  const changedTask = (
    await request("/workspace", "GET", undefined, cookie)
  ).data.tasks.find((a) => a.id === task.id);
  assert.equal(
    (
      await request(
        `/records/task/${task.id}`,
        "PUT",
        { ...changedTask, title: "Later edit" },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/duplicates/${second.id}/undo`, "POST", {}, cookie)).status,
    409,
  );
  w = (await request("/workspace", "GET", undefined, cookie)).data;
  assert.equal(w.tasks.find((a) => a.id === task.id).title, "Later edit");
  assert.equal(w.applications.find((a) => a.id === right.id).archived, true);
});
test("quota failures during bulk edits and merges roll back every earlier write", async (t) => {
  const { request, register, store } = await setup(t);
  const cookie = await register("atomic-quota@example.com");
  const create = async () =>
    (
      await request(
        "/records/application",
        "POST",
        { company: "AtomicCo", title: "Engineer", stage: "Saved" },
        cookie,
      )
    ).data;
  const left = await create(),
    right = await create();
  const user = (await store.db.prepare("SELECT id FROM users").get()).id;
  await store.db
    .prepare(
      `WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<49997)
    INSERT INTO events(id,user_id,record_id,at,before_data,after_data,actor)
    SELECT 'quota-'||n,?,?,?,NULL,'{}','test' FROM sequence`,
    )
    .run(user, left.id, new Date().toISOString());
  const body = {
    operationId: crypto.randomUUID(),
    applications: [left, right].map(({ id, version }) => ({ id, version })),
    changes: { priority: "High" },
  };
  assert.equal(
    (await request("/applications/bulk", "POST", body, cookie)).status,
    413,
  );
  const args = { leftId: left.id, rightId: right.id, targetId: left.id };
  const preview = (
    await request("/duplicates/merge-preview", "POST", args, cookie)
  ).data;
  assert.equal(
    (
      await request(
        "/duplicates/review",
        "POST",
        {
          ...args,
          leftVersion: 1,
          rightVersion: 1,
          decision: "merge",
          fingerprint: preview.fingerprint,
        },
        cookie,
      )
    ).status,
    413,
  );
  const workspace = (await request("/workspace", "GET", undefined, cookie))
    .data;
  assert.ok(
    workspace.applications.every(
      (a) => a.version === 1 && !a.archived && a.priority === "Medium",
    ),
  );
  assert.equal(workspace.duplicateReviews.length, 0);
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM events").get()).n,
    49999,
  );
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM mutation_receipts").get())
      .n,
    0,
  );
});
