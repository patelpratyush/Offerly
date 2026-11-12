import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import { buildIcs } from "../../server/calendar.js";
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
  assert.equal(res.headers.get("x-offerly-event-count"), "3");
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
  assert.doesNotMatch(text, /Canceled|Ambiguous|Closed|Take-home.*Done|Done/);
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.equal(
    (text.match(/DTSTART:/g) || []).length,
    1,
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
