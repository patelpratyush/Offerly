import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import {
  buildIcs,
  dedupeEvents,
  markConflicts,
} from "../../server/calendar.js";
import { createStore } from "../helpers/store.js";
test("ics export is explicit, owner scoped, timezone-correct and keeps date-only events all-day", async (t) => {
  const store = await createStore(":memory:");
  const server = (await createApp(store)).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const register = async (email) => {
    const res = await fetch(base + "/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Offerly-Request": "1" },
      body: JSON.stringify({
        name: "T",
        email,
        password: "a-secure-test-password",
        timezone: "America/New_York",
      }),
    });
    const id = (
      await store.db.prepare("SELECT id FROM users WHERE email=?").get(email)
    ).id;
    return { cookie: res.headers.get("set-cookie").split(";")[0], id };
  };
  const get = (cookie, query = "") =>
    fetch(base + "/calendar.ics" + query, {
      headers: {
        "X-Offerly-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
  assert.equal((await get()).status, 401);
  const a = await register("a@example.test"),
    b = await register("b@example.test");
  const application = await store.save(a.id, "application", {
    company: "Acme; Inc, LLC",
    title: "Engineer",
    stage: "Interviewing",
  });
  const closedApp = await store.save(a.id, "application", {
    company: "Gone",
    title: "T",
    stage: "Rejected",
  });
  const round = (extra) =>
    store.save(a.id, "round", {
      title: "Panel",
      applicationId: application.id,
      status: "Scheduled",
      date: "2026-11-20",
      time: "10:00",
      timezone: "America/New_York",
      url: "https://meet.example.test/x",
      ...extra,
    });
  await round({});
  await round({ title: "Dateonly", time: "" });
  await round({ title: "Canceled", status: "Canceled" });
  await round({ title: "Ambiguous", date: "2026-11-01", time: "01:30" });
  await round({ title: "Closed", applicationId: closedApp.id });
  await store.save(a.id, "assessment", {
    title: "Take-home",
    applicationId: application.id,
    status: "Not started",
    due: "2026-11-25",
  });
  await store.save(a.id, "assessment", {
    title: "Done",
    applicationId: application.id,
    status: "Completed",
    due: "2026-11-26",
    completedDate: "2026-11-26",
  });
  const res = await get(a.cookie);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/calendar/);
  assert.match(res.headers.get("content-disposition"), /attachment/);
  assert.equal(res.headers.get("x-offerly-event-count"), "4");
  assert.equal(res.headers.get("x-offerly-skipped-count"), "1");
  const raw = await res.text();
  assert.ok(raw.endsWith("\r\n"));
  assert.ok(raw.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
  const text = raw.replace(/\r\n /g, "");
  assert.match(text, /DTSTART:20261120T150000Z/);
  assert.match(text, /DTSTART;VALUE=DATE:20261120\r\n/);
  assert.match(text, /DTEND;VALUE=DATE:20261121/);
  assert.match(text, /DTSTART;VALUE=DATE:20261125/);
  assert.match(text, /Acme\\; Inc\\, LLC/);
  assert.match(text, /Local time: 2026-11-20 10:00 America\/New_York/);
  assert.doesNotMatch(text, /Ambiguous|Closed|Done/);
  assert.match(text, /STATUS:CANCELLED/);
  assert.match(text, /Canceled interview: Canceled/);
  assert.match(text, /LOCATION:https/);
  assert.match(text, /Conferencing link: https/);
  assert.equal((text.match(/STATUS:CANCELLED/g) || []).length, 1);
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.equal(
    (text.match(/DTSTART:/g) || []).length,
    2,
    "no invented time for date-only",
  );
  const other = await (await get(b.cookie)).text();
  assert.equal((other.match(/BEGIN:VEVENT/g) || []).length, 0);
  assert.equal((await get(a.cookie, "?bogus=1")).status, 400);
  assert.equal(
    (await get(b.cookie, `?applicationId=${application.id}`)).status,
    200,
  );
  const scoped = await (
    await get(a.cookie, `?applicationId=${closedApp.id}`)
  ).text();
  assert.equal((scoped.match(/BEGIN:VEVENT/g) || []).length, 0);
});
test("buildIcs escapes control characters and folds long lines", () => {
  const out = buildIcs([
    {
      uid: "x@y",
      sequence: 0,
      summary: "Line\nBREAK END:VEVENT " + "é".repeat(80),
      description: "d",
      allDay: "2026-01-02",
    },
  ]);
  assert.equal((out.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(out.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
});

test("agenda shows conflicts, original and local timezone, links and cancellations; duplicates collapse", async (t) => {
  const store = await createStore(":memory:");
  const server = (await createApp(store)).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const register = async (email) => {
    const res = await fetch(base + "/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Offerly-Request": "1" },
      body: JSON.stringify({
        name: "T",
        email,
        password: "a-secure-test-password",
        timezone: "America/Los_Angeles",
      }),
    });
    const id = (
      await store.db.prepare("SELECT id FROM users WHERE email=?").get(email)
    ).id;
    return { cookie: res.headers.get("set-cookie").split(";")[0], id };
  };
  const a = await register("a@example.test"),
    b = await register("b@example.test");
  const app = await store.save(a.id, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Interviewing",
  });
  const round = (extra) =>
    store.save(a.id, "round", {
      title: "Round",
      applicationId: app.id,
      status: "Scheduled",
      date: "2026-11-20",
      time: "10:00",
      timezone: "America/New_York",
      url: "",
      ...extra,
    });
  await round({ title: "First", url: "https://meet.example.test/a" });
  await round({ title: "Overlap", time: "10:30" });
  await round({ title: "Later", time: "13:00" });
  await round({ title: "Dropped", time: "10:15", status: "Canceled" });
  const get = (user) =>
    fetch(base + "/calendar/agenda", {
      headers: { "X-Offerly-Request": "1", Cookie: user.cookie },
    });
  const res = await get(a);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.timezone, "America/Los_Angeles");
  const by = Object.fromEntries(data.events.map((e) => [e.title, e]));
  assert.equal(by.First.conflictWith.length, 1);
  assert.equal(by.Overlap.conflictWith.length, 1);
  assert.deepEqual(by.Later.conflictWith, []);
  assert.deepEqual(by.Dropped.conflictWith, [], "canceled never conflicts");
  assert.equal(by.Dropped.cancelled, true);
  assert.deepEqual(by.First.original, {
    date: "2026-11-20",
    time: "10:00",
    timezone: "America/New_York",
  });
  assert.equal(by.First.local.dateTime, "2026-11-20 07:00");
  assert.equal(by.First.url, "https://meet.example.test/a");
  assert.equal(by.First.start, "2026-11-20T15:00:00.000Z");
  const ics = await (
    await fetch(base + "/calendar.ics", {
      headers: { "X-Offerly-Request": "1", Cookie: a.cookie },
    })
  ).text();
  assert.match(
    ics.replace(/\r\n /g, ""),
    /Possible conflict with: Interview: Overlap/,
  );
  assert.match(
    ics.replace(/\r\n /g, ""),
    /In your Offerly timezone \(America\/Los_Angeles\): 2026-11-20 07:00/,
  );
  const other = await (await get(b)).json();
  assert.deepEqual(other.events, []);
  assert.equal((await fetch(base + "/calendar/agenda")).status, 401);
});
test("the same interview represented twice collapses to one event", () => {
  const e = (sequence) => ({
    uid: "round-1@offerly.app",
    sequence,
    summary: "S",
    description: "d",
    allDay: "2026-01-02",
  });
  assert.equal(dedupeEvents([e(0), e(2), e(1)]).length, 1);
  assert.equal(dedupeEvents([e(0), e(2)])[0].sequence, 2);
  const out = buildIcs([e(0), e(0)]);
  assert.equal((out.match(/BEGIN:VEVENT/g) || []).length, 1);
  const timed = (uid, start) => ({ uid, kind: "round", start });
  const marked = markConflicts([
    timed("a", 0),
    timed("b", 59 * 60000),
    timed("c", 60 * 60000),
  ]);
  assert.deepEqual(marked[0].conflictWith, ["b"]);
  assert.deepEqual(marked[2].conflictWith, ["b"]);
});
