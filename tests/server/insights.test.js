import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
import { computeInsights } from "../../server/insights.js";
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
  const request = async (path, cookie) => {
    const res = await fetch(base + path, {
      headers: {
        "X-Offerly-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    return {
      status: res.status,
      type: res.headers.get("content-type"),
      text: await res.text(),
    };
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
  return { store, request, register };
}
const app = (store, id, extra) =>
  store.save(id, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Submitted",
    ...extra,
  });
test("empty workspace reports zero denominators and null rates, never zero rates", async (t) => {
  const { store, register } = await setup(t);
  const u = await register("empty@example.test");
  const i = await computeInsights(store, u.id);
  assert.equal(i.totals.uniqueSubmittedApplications, 0);
  assert.equal(i.conversion.overall.interviewRate, null);
  assert.equal(i.timeToFirstResponse.median, null);
  assert.equal(i.timeToFirstResponse.sampleSize, 0);
  assert.deepEqual(i.submissionsPerWeek, []);
  assert.match(i.note, /small sample/);
});
test("cohort conversion uses verified rounds, unique apps, and explicit denominators", async (t) => {
  const { store, register } = await setup(t);
  const u = await register("cohort@example.test");
  const a = await app(store, u.id, {
    appliedDate: "2026-10-05",
    source: "LinkedIn",
  });
  const b = await app(store, u.id, {
    appliedDate: "2026-10-06",
    source: "LinkedIn",
  });
  const c = await app(store, u.id, {
    appliedDate: "2026-10-14",
    source: "Referral",
    offerOutcome: "Pending",
  });
  const unknown = await app(store, u.id, { stage: "Under review" }); // no date
  await app(store, u.id, { stage: "Saved" }); // not submitted
  const round = (applicationId, status) =>
    store.save(u.id, "round", {
      title: "R",
      applicationId,
      status,
      date: "2026-10-20",
      time: "10:00",
      timezone: "UTC",
    });
  await round(a.id, "Completed");
  await round(a.id, "Scheduled"); // two rounds, one application
  await round(b.id, "Invited"); // unverified
  await round(c.id, "Canceled"); // canceled, not verified
  const i = await computeInsights(store, u.id);
  assert.equal(i.totals.uniqueSubmittedApplications, 3);
  assert.equal(i.totals.excluded.unknownSubmissionDate, 1);
  assert.equal(i.conversion.overall.submitted, 3);
  assert.equal(i.conversion.overall.interview, 1);
  assert.equal(i.conversion.overall.offer, 1);
  assert.equal(i.conversion.overall.smallSample, true);
  assert.deepEqual(
    i.submissionsPerWeek.map((w) => [w.weekStart, w.count]),
    [
      ["2026-10-05", 2],
      ["2026-10-12", 1],
    ],
  );
  const li = i.bySource.find((s) => s.source === "LinkedIn");
  assert.equal(li.submitted, 2);
  assert.equal(li.interview, 1);
  assert.ok(unknown.id);
  const ranged = await computeInsights(store, u.id, { from: "2026-10-12" });
  assert.equal(ranged.totals.uniqueSubmittedApplications, 1);
  assert.equal(ranged.totals.excluded.outsideRange, 2);
});
test("time to first response and time in stage exclude unknown dates and open stages", async (t) => {
  const { store, register } = await setup(t);
  const u = await register("time@example.test");
  const known = await app(store, u.id, {
    appliedDate: "2026-10-01",
    stage: "Submitted",
  });
  const noDate = await app(store, u.id, { stage: "Submitted" });
  const noResponse = await app(store, u.id, { appliedDate: "2026-10-01" });
  const r1 = await store.save(u.id, "round", {
    title: "R",
    applicationId: known.id,
    status: "Scheduled",
    date: "2026-11-01",
    time: "10:00",
    timezone: "UTC",
  });
  await store.save(u.id, "round", {
    title: "R",
    applicationId: noDate.id,
    status: "Scheduled",
    date: "2026-11-01",
    time: "10:00",
    timezone: "UTC",
  });
  // Stage history: Submitted -> Interviewing (10 days later), still open.
  const row = (id) => store.get(u.id, id);
  const v = (await row(known.id)).version;
  await store.save(
    u.id,
    "application",
    { ...known, id: undefined, version: undefined, stage: "Interviewing" },
    known.id,
    v,
  );
  await store.db
    .prepare(
      "UPDATE events SET at=? WHERE record_id=? AND after_data LIKE '%\"Submitted\"%'",
    )
    .run("2026-10-02T00:00:00.000Z", known.id);
  await store.db
    .prepare(
      "UPDATE events SET at=? WHERE record_id=? AND after_data LIKE '%\"Interviewing\"%'",
    )
    .run("2026-10-12T00:00:00.000Z", known.id);
  await store.db
    .prepare("UPDATE events SET at=? WHERE record_id=?")
    .run("2026-10-11T00:00:00.000Z", r1.id);
  const i = await computeInsights(store, u.id);
  assert.equal(i.timeToFirstResponse.sampleSize, 1);
  assert.equal(i.timeToFirstResponse.median, 10);
  assert.equal(i.timeToFirstResponse.excluded.unknownSubmissionDate, 1);
  assert.equal(i.timeToFirstResponse.excluded.noResponseRecorded, 1);
  const submitted = i.timeInStage.stages.find((s) => s.stage === "Submitted");
  assert.equal(submitted.sampleSize, 1);
  assert.equal(submitted.median, 10);
  assert.equal(
    i.timeInStage.stages.find((s) => s.stage === "Interviewing"),
    undefined,
  );
  assert.ok(i.timeInStage.excluded.stillInStage >= 1);
  assert.ok(noResponse.id);
});
test("insights by resume version and source use submitted evidence", async (t) => {
  const { store, register } = await setup(t);
  const u = await register("version@example.test");
  const a = await app(store, u.id, { source: "Referral" });
  const fileId = randomUUID();
  await store.db
    .prepare(
      "INSERT INTO files(id,user_id,name,mime,hash,body,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      fileId,
      u.id,
      "r.pdf",
      "application/pdf",
      "h",
      Buffer.from("x"),
      "2026-01-01T00:00:00.000Z",
    );
  const doc = await store.save(u.id, "document", { title: "Resume", fileId });
  await store.save(u.id, "document_usage", {
    applicationId: a.id,
    documentVersionId: doc.id,
    submittedDate: "2026-10-05",
    purpose: "Resume",
    title: "Resume",
    documentVersionNumber: 1,
    retracted: false,
  });
  await store.save(u.id, "document_usage", {
    applicationId: a.id,
    documentVersionId: doc.id,
    submittedDate: "2026-10-05",
    purpose: "Cover letter",
    title: "Resume",
    documentVersionNumber: 1,
    retracted: false,
  });
  const i = await computeInsights(store, u.id);
  assert.equal(
    i.totals.submissionEvents,
    1,
    "same application and date counted once",
  );
  assert.deepEqual(
    i.byDocumentVersion.map((v) => [v.version, v.submitted]),
    [["Resume v1", 1]],
  );
});
test("insights endpoints are owner scoped and CSV is escaped with sample sizes", async (t) => {
  const { store, request, register } = await setup(t);
  const a = await register("a@example.test"),
    b = await register("b@example.test");
  assert.equal((await request("/insights")).status, 401);
  await app(store, a.id, {
    appliedDate: "2026-10-05",
    source: '=HYPERLINK("x")',
  });
  const mine = JSON.parse((await request("/insights", a.cookie)).text);
  const theirs = JSON.parse((await request("/insights", b.cookie)).text);
  assert.equal(mine.totals.uniqueSubmittedApplications, 1);
  assert.equal(theirs.totals.uniqueSubmittedApplications, 0);
  assert.equal(
    (await request("/insights?from=2026-12-01&to=2026-01-01", a.cookie)).status,
    400,
  );
  assert.equal((await request("/insights?x=1", a.cookie)).status, 400);
  const csv = await request("/insights.csv", a.cookie);
  assert.match(csv.type, /text\/csv/);
  assert.match(
    csv.text,
    /^section,group,metric,numerator,denominator,rate,sampleSize,note/,
  );
  assert.match(csv.text, /descriptive only, small sample/);
  assert.doesNotMatch(csv.text, /(^|,)=HYPERLINK/m);
  const other = (await request("/insights.csv", b.cookie)).text;
  assert.doesNotMatch(other, /HYPERLINK/);
});
