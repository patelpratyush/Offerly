import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import { createStore } from "../helpers/store.js";
import { runScheduler } from "../../server/scheduler.js";
import {
  upsertCompany,
  upsertSource,
  setSourcePolicy,
} from "../../server/discovery/registry.js";
import {
  ingestSource,
  pruneSnapshots,
  snapshotKeep,
} from "../../server/discovery/ingest.js";
import { createRateLimiter } from "../../server/discovery/connectors.js";
import {
  listView,
  evaluateJob,
  loadContext,
} from "../../server/discovery/feed.js";
import { loadCatalogFor } from "../../server/discovery/catalog.js";
import { filterSchema } from "../../server/discovery/feed.js";
import {
  createRule,
  updateRule,
  deleteRule,
  queueAlerts,
  processAlerts,
  listNotifications,
} from "../../server/discovery/alerts.js";
import {
  processDigests,
  listDigests,
  saveDigestSettings,
  getDigestSettings,
} from "../../server/discovery/digests.js";
import {
  digestWindowWarning,
  latestSlot,
} from "../../server/discovery/digest-rules.js";
import {
  processDiscovery,
  processAlertBatch,
} from "../../server/discovery/runner.js";
import { dismissJob } from "../../server/discovery/actions.js";

const T = (text) => Date.parse(text);
const iso = (ms) => new Date(ms).toISOString();
const noWait = createRateLimiter({ minIntervalMs: 0 });
const ALL = ["meets", "needs_verification", "does_not_meet"];

async function addUser(store, id, timezone = "UTC") {
  await store.db
    .prepare(
      "INSERT INTO users(id,email,password,name,timezone,stages) VALUES(?,?,?,?,?,?)",
    )
    .run(id, `${id}@example.com`, "x", id, timezone, "[]");
}
async function company(store, name = "Acme", domain = "acme.test") {
  return upsertCompany(store, { name, domain });
}
let counter = 0;
/** Inserts catalog jobs directly (no network, no connector). */
async function seedJobs(store, companyId, rows) {
  await store.atomic(async () => {
    for (const r of rows) {
      const id =
        r.id ||
        `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
      const discovered = r.discovered;
      await store.db
        .prepare(
          "INSERT INTO discovery_jobs(id,company_id,title,location,requisition,group_key,description,work_arrangement,employment_type,comp_min,comp_max,comp_currency,comp_period,comp_basis,employer_posted_at,posted_precision,posted_timezone,first_discovered_at,last_checked_at,last_changed_at,reopened_at,status,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          companyId,
          r.title || "Backend Engineer",
          r.location || "New York, NY",
          r.requisition || "",
          id,
          "",
          r.arrangement || "Unknown",
          "Unknown",
          r.compMax ?? null,
          r.compMax ?? null,
          "",
          "Unknown",
          "Unknown",
          r.posted ?? null,
          r.posted ? (r.posted.length > 10 ? "datetime" : "date") : "unknown",
          "",
          discovered,
          discovered,
          discovered,
          r.reopened ?? null,
          r.status || "listed",
          "",
        );
      r.id = id;
    }
  });
  return rows.map((r) => r.id);
}
const rule = (over = {}) => ({
  name: "Rule",
  filters: {},
  includeUnknownEligibility: true,
  ...over,
});

// ---------------------------------------------------------------- scale

test("feed pages by cursor in date order without gaps or duplicates", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await addUser(store, "u1");
  const c = await company(store);
  const rows = [];
  for (let i = 0; i < 130; i++)
    rows.push({
      title: `Job ${i}`,
      posted: iso(T("2026-11-01T00:00:00Z") + i * 3600e3),
      discovered: iso(T("2026-11-02T00:00:00Z") + i * 60e3),
    });
  await seedJobs(store, c, rows);
  const now = T("2026-11-10T00:00:00Z");
  for (const view of ["latest", "new"]) {
    const seen = [];
    let cursor = "",
      pages = 0;
    do {
      const page = await listView(
        store,
        "u1",
        view,
        { eligibility: ALL },
        { now, limit: 50, cursor },
      );
      seen.push(...page.jobs.map((j) => j.title));
      cursor = page.nextCursor || "";
      pages++;
      assert.equal(page.hasMore, !!page.nextCursor || page.truncated);
    } while (cursor && pages < 10);
    assert.equal(seen.length, 130, view);
    assert.equal(new Set(seen).size, 130);
    assert.equal(seen[0], "Job 129", "newest first");
    assert.equal(pages, 3);
  }
  // A cursor from another ordering or a forged one is refused, not trusted.
  const first = await listView(
    store,
    "u1",
    "latest",
    { eligibility: ALL },
    { now, limit: 5 },
  );
  await assert.rejects(
    listView(
      store,
      "u1",
      "new",
      { eligibility: ALL },
      { now, cursor: first.nextCursor },
    ),
    /Invalid page cursor/,
  );
  await assert.rejects(
    listView(store, "u1", "latest", {}, { now, cursor: "not-a-cursor" }),
    /Invalid page cursor/,
  );
});

test("fit-ranked views page by cursor and agree with the full ranking", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await addUser(store, "u1");
  const c = await company(store);
  const { saveProfile } = await import("../../server/discovery/profile.js");
  await saveProfile(store, "u1", {
    facts: {
      targetRoles: ["backend engineer"],
      seniority: "senior",
      yearsExperience: 7,
      skills: [{ name: "Python", approved: true }],
      experienceTerms: [],
    },
    eligibility: {
      workAuthorization: { US: "yes" },
      needsSponsorship: "no",
      usCitizen: "unknown",
      securityClearance: "unknown",
      graduationYear: null,
    },
    preferences: {
      locations: ["New York"],
      arrangements: [],
      salaryMin: null,
      salaryCurrency: "USD",
      salaryBasis: "Base",
    },
  });
  const rows = [];
  const titles = [
    "Senior Backend Engineer",
    "Backend Engineer",
    "Account Manager",
    "Staff Backend Engineer",
  ];
  for (let i = 0; i < 40; i++)
    rows.push({
      title: titles[i % 4],
      posted: iso(T("2026-11-01T00:00:00Z") + i * 3600e3),
      discovered: iso(T("2026-11-02T00:00:00Z") + i * 60e3),
    });
  await seedJobs(store, c, rows);
  const now = T("2026-11-10T00:00:00Z");
  const full = await listView(
    store,
    "u1",
    "best",
    { eligibility: ALL },
    { now, limit: 100 },
  );
  assert.ok(full.jobs.length > 10);
  assert.equal(full.total, full.jobs.length);
  const paged = [];
  let cursor = "";
  do {
    const page = await listView(
      store,
      "u1",
      "best",
      { eligibility: ALL },
      { now, limit: 7, cursor },
    );
    paged.push(...page.jobs.map((j) => j.id));
    cursor = page.nextCursor || "";
  } while (cursor);
  assert.deepEqual(
    paged,
    full.jobs.map((j) => j.id),
  );
  const scores = full.jobs.map((j) => j.fit.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  );
});

test("SQL pre-filtering never changes what a user sees", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await addUser(store, "u1");
  const c = await company(store, "Acme 100% _Co");
  const d = await company(store, "Globex", "globex.test");
  const now = T("2026-11-10T12:00:00Z");
  const hours = (h) => iso(now - h * 3600e3);
  await seedJobs(store, c, [
    {
      title: "Senior Backend Engineer",
      posted: hours(2),
      discovered: hours(1),
      compMax: 200000,
      arrangement: "Remote",
    },
    {
      title: "Backend Engineer",
      posted: hours(30),
      discovered: hours(29),
      location: "Austin, TX",
      arrangement: "Hybrid",
    },
    {
      title: "Data Analyst",
      posted: "2026-11-09",
      discovered: hours(50),
      compMax: 90000,
    },
    { title: "Platform Engineer", discovered: hours(3) },
    {
      title: "Closed Role",
      posted: hours(2),
      discovered: hours(1),
      status: "not_listed",
    },
    { title: "100% match_title", posted: hours(5), discovered: hours(4) },
  ]);
  await seedJobs(store, d, [
    { title: "Senior Engineer", posted: hours(10), discovered: hours(9) },
  ]);
  const [dismissed] = await seedJobs(store, d, [
    { title: "Dismissed Engineer", posted: hours(1), discovered: hours(1) },
  ]);
  await dismissJob(store, "u1", dismissed, "other");
  const ctx = await loadContext(store, "u1");
  const jobs = await store.db.prepare("SELECT * FROM discovery_jobs").all();
  const catalog = await loadCatalogFor(store, jobs);
  const variants = [
    {},
    { q: "engineer" },
    { q: "acme 100% _co" },
    { q: "100%" },
    { q: "match_title" },
    { location: "austin" },
    { arrangements: ["Remote", "Hybrid"] },
    { salaryMin: 100000 },
    { window: "24h" },
    { window: "3d" },
    { window: "custom", from: "2026-11-09", to: "2026-11-09" },
    { seniority: ["senior"] },
  ];
  for (const view of ["latest", "new"]) {
    for (const variant of variants) {
      const filters = filterSchema.parse({ eligibility: ALL, ...variant });
      const basis = view === "new" ? "discovered" : "posted";
      const expected = jobs
        .filter((j) => {
          const e = evaluateJob(ctx, catalog, j, filters, now, basis);
          return (
            e && !e.reasons.length && !e.view.dismissed && j.status === "listed"
          );
        })
        .map((j) => j.id)
        .sort();
      const got = (
        await listView(
          store,
          "u1",
          view,
          { eligibility: ALL, ...variant },
          { now, limit: 100 },
        )
      ).jobs
        .map((j) => j.id)
        .sort();
      assert.deepEqual(got, expected, `${view} ${JSON.stringify(variant)}`);
    }
  }
});

test("a request scans a bounded number of rows and hands back a cursor to continue", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await addUser(store, "u1");
  const c = await company(store);
  const rows = [];
  // Newest 600 are junior roles that a JS-only filter (seniority) rejects.
  for (let i = 0; i < 600; i++)
    rows.push({
      title: "Junior Developer",
      posted: iso(T("2026-11-05T00:00:00Z") + i * 60e3),
      discovered: iso(T("2026-11-05T00:00:00Z") + i * 60e3),
    });
  rows.push({
    title: "Senior Backend Engineer",
    posted: "2026-11-01T00:00:00.000Z",
    discovered: "2026-11-01T00:00:00.000Z",
  });
  await seedJobs(store, c, rows);
  const opts = { now: T("2026-11-10T00:00:00Z"), limit: 5, scanCap: 400 };
  const filters = { eligibility: ALL, seniority: ["senior"] };
  const first = await listView(store, "u1", "latest", filters, opts);
  assert.equal(first.jobs.length, 0);
  assert.equal(first.hasMore, true);
  assert.equal(first.truncated, true);
  assert.ok(first.nextCursor);
  let cursor = first.nextCursor,
    found = [];
  for (let i = 0; i < 5 && cursor; i++) {
    const page = await listView(store, "u1", "latest", filters, {
      ...opts,
      cursor,
    });
    found.push(...page.jobs);
    cursor = page.nextCursor;
  }
  assert.deepEqual(
    found.map((j) => j.title),
    ["Senior Backend Engineer"],
  );
  assert.equal(cursor, null);
});

test("snapshot retention keeps only the newest per listing and is bounded and idempotent", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const companyId = await company(store);
  const sourceId = await upsertSource(store, {
    companyId,
    platform: "greenhouse",
    boardId: "acme",
  });
  await setSourcePolicy(store, sourceId, {
    permission: "confirmed",
    enabled: true,
  });
  const env = {
    DISCOVERY_COLLECTION_ENABLED: "true",
    DISCOVERY_SNAPSHOT_KEEP: "3",
  };
  assert.equal(snapshotKeep(env), 3);
  assert.equal(snapshotKeep({ DISCOVERY_SNAPSHOT_KEEP: "0" }), 20);
  assert.equal(snapshotKeep({}), 20);
  const body = (version) =>
    JSON.stringify({
      jobs: [
        {
          id: 1,
          title: "Backend Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          location: { name: "Remote" },
          requisition_id: "R1",
          content: `&lt;p&gt;Version ${version}&lt;/p&gt;`,
        },
        {
          id: 2,
          title: "Other",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
          location: { name: "Remote" },
          requisition_id: "R2",
          content: "&lt;p&gt;Stable&lt;/p&gt;",
        },
      ],
    });
  let now = T("2026-11-01T00:00:00Z");
  for (let v = 1; v <= 8; v++) {
    const r = await ingestSource(store, sourceId, {
      fetcher: async () => ({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => body(v),
      }),
      limiter: noWait,
      now,
      env,
      force: true,
    });
    assert.equal(r.outcome, "success");
    now += 3600e3;
  }
  const counts = await store.db
    .prepare(
      "SELECT l.external_id AS e,COUNT(s.id) AS n FROM discovery_listings l JOIN discovery_snapshots s ON s.listing_id=l.id GROUP BY l.external_id ORDER BY e",
    )
    .all();
  assert.deepEqual(
    counts.map((r) => [r.e, Number(r.n)]),
    [
      ["1", 3],
      ["2", 1],
    ],
  );
  const newest = await store.db
    .prepare(
      "SELECT fields FROM discovery_snapshots s JOIN discovery_listings l ON l.id=s.listing_id WHERE l.external_id='1' ORDER BY captured_at DESC LIMIT 1",
    )
    .get();
  assert.match(newest.fields, /Version 8/);
  // The job keeps its original discovery history regardless of pruning.
  const job = await store.db
    .prepare(
      "SELECT first_discovered_at FROM discovery_jobs WHERE requisition='R1'",
    )
    .get();
  assert.equal(job.first_discovered_at, iso(T("2026-11-01T00:00:00Z")));
  // Sweeping with a lower cap trims in bounded batches and is idempotent.
  const swept = await pruneSnapshots(store, { keep: 1, batch: 10 });
  assert.equal(swept.listings, 1);
  assert.equal(swept.pruned, 2);
  assert.deepEqual(await pruneSnapshots(store, { keep: 1 }), {
    listings: 0,
    pruned: 0,
  });
});

// -------------------------------------------------------------- digests

test("recency window warning appears only when the window is shorter than the digest interval", () => {
  assert.match(
    digestWindowWarning({ window: "24h" }, "weekly"),
    /shorter than its weekly/,
  );
  assert.match(digestWindowWarning({ window: "3d" }, "weekly"), /3d/);
  assert.equal(digestWindowWarning({ window: "7d" }, "weekly"), "");
  assert.equal(digestWindowWarning({ window: "24h" }, "daily"), "");
  assert.equal(digestWindowWarning({ window: "24h" }, "immediate"), "");
  assert.equal(digestWindowWarning({ window: "" }, "weekly"), "");
  assert.equal(digestWindowWarning({ window: "custom" }, "weekly"), "");
});

test("digest slots follow the user's time zone, daylight saving and weekday", () => {
  const s = { hour: 8, weekday: 1 };
  // New York is UTC-5 on 2026-11-12: 08:00 local is 13:00 UTC.
  const before = latestSlot(
    T("2026-11-12T12:59:00Z"),
    "America/New_York",
    "daily",
    s,
  );
  const after = latestSlot(
    T("2026-11-12T13:01:00Z"),
    "America/New_York",
    "daily",
    s,
  );
  assert.equal(before.key, "2026-11-11");
  assert.equal(after.key, "2026-11-12");
  assert.equal(iso(after.at), "2026-11-12T13:00:00.000Z");
  // Summer time: 08:00 in New York is 12:00 UTC.
  assert.equal(
    iso(
      latestSlot(T("2026-07-01T20:00:00Z"), "America/New_York", "daily", s).at,
    ),
    "2026-07-01T12:00:00.000Z",
  );
  // Weekly on Monday 2026-11-09, found from the following Thursday.
  const weekly = latestSlot(T("2026-11-12T20:00:00Z"), "UTC", "weekly", s);
  assert.equal(weekly.key, "2026-11-09");
  // Half-hour offset zones still land on local 08:00.
  assert.equal(
    iso(latestSlot(T("2026-11-12T12:00:00Z"), "Asia/Kolkata", "daily", s).at),
    "2026-11-12T02:30:00.000Z",
  );
});

async function digestFixture(t, timezone = "UTC") {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await addUser(store, "u1", timezone);
  await addUser(store, "u2", timezone);
  const c = await company(store);
  return { store, c };
}

test("a daily digest batches per user, shows each job once with every matching rule explained, and is idempotent", async (t) => {
  const { store, c } = await digestFixture(t);
  const created = T("2026-11-11T00:00:00Z");
  const a = await createRule(
    store,
    "u1",
    rule({ name: "Backend", cadence: "daily", filters: { q: "backend" } }),
    created,
  );
  await createRule(
    store,
    "u1",
    rule({ name: "Everything", cadence: "daily", filters: { window: "7d" } }),
    created,
  );
  await createRule(
    store,
    "u2",
    rule({ name: "Other user", cadence: "daily" }),
    created,
  );
  assert.equal(a.cadence, "daily");
  await seedJobs(store, c, [
    {
      title: "Backend Engineer",
      posted: "2026-11-11T07:00:00.000Z",
      discovered: "2026-11-11T07:30:00.000Z",
    },
    {
      title: "Designer",
      posted: "2026-11-11T06:00:00.000Z",
      discovered: "2026-11-11T06:30:00.000Z",
    },
  ]);
  const early = T("2026-11-11T07:45:00Z");
  // Nothing is delivered as an individual in-app alert for digest rules.
  const queued = await processAlerts(store, { userId: "u1", now: early });
  assert.equal(
    queued.queued,
    3,
    "two rules match backend, one matches designer",
  );
  assert.equal(queued.delivered, 0);
  assert.equal((await listNotifications(store, "u1")).notifications.length, 0);
  // 07:45 UTC is before the 08:00 slot and the slot of the day before has no events.
  assert.deepEqual(await processDigests(store, { userId: "u1", now: early }), {
    digests: 0,
    items: 0,
    excluded: 0,
  });
  const at = T("2026-11-11T08:05:00Z");
  const sent = await processDigests(store, { userId: "u1", now: at });
  assert.deepEqual(sent, { digests: 1, items: 2, excluded: 0 });
  const { digests, unread } = await listDigests(store, "u1");
  assert.equal(unread, 1);
  assert.equal(digests.length, 1);
  const [digest] = digests;
  assert.equal(digest.cadence, "daily");
  assert.equal(digest.items.length, 2, "each job once");
  const backend = digest.items.find((i) => i.title === "Backend Engineer");
  assert.deepEqual(backend.rules.map((r) => r.name).sort(), [
    "Backend",
    "Everything",
  ]);
  assert.ok(
    backend.rules
      .find((r) => r.name === "Backend")
      .why.some((w) => /contains "backend"/.test(w)),
  );
  assert.ok(
    backend.rules
      .find((r) => r.name === "Everything")
      .why.some((w) => /last 7d/.test(w)),
  );
  assert.match(backend.postedLabel, /^Posted 2026-11-11/);
  assert.equal(
    digest.items.find((i) => i.title === "Designer").rules.length,
    1,
  );
  // Re-running at any later time that day sends nothing more.
  for (const later of ["2026-11-11T08:10:00Z", "2026-11-11T20:00:00Z"])
    assert.equal(
      (await processDigests(store, { userId: "u1", now: T(later) })).digests,
      0,
    );
  assert.equal((await listDigests(store, "u1")).digests.length, 1);
  // The other user's rules, queue and digests are untouched and invisible.
  assert.equal((await listDigests(store, "u2")).digests.length, 0);
  assert.equal(
    Number(
      (
        await store.db
          .prepare(
            "SELECT COUNT(*) n FROM discovery_notifications WHERE user_id='u2' AND status='pending'",
          )
          .get()
      ).n,
    ),
    0,
    "u2 was never queued here",
  );
});

test("digests recheck at send time: aged-out, closed, dismissed and applied jobs are left out and counted, never shown as fresh", async (t) => {
  const { store, c } = await digestFixture(t);
  const created = T("2026-11-10T00:00:00Z");
  await createRule(
    store,
    "u1",
    rule({ name: "Fresh", cadence: "daily", filters: { window: "24h" } }),
    created,
  );
  const [aging, closing, dismissing, , staying] = await seedJobs(store, c, [
    {
      title: "Aging",
      posted: "2026-11-10T09:00:00.000Z",
      discovered: "2026-11-10T09:10:00.000Z",
    },
    {
      title: "Closing",
      posted: "2026-11-10T10:00:00.000Z",
      discovered: "2026-11-10T10:10:00.000Z",
    },
    {
      title: "Dismissing",
      posted: "2026-11-10T10:30:00.000Z",
      discovered: "2026-11-10T10:40:00.000Z",
    },
    {
      title: "Applying",
      posted: "2026-11-10T10:45:00.000Z",
      discovered: "2026-11-10T10:50:00.000Z",
      requisition: "REQ-A",
    },
    {
      title: "Staying",
      posted: "2026-11-11T07:00:00.000Z",
      discovered: "2026-11-11T07:10:00.000Z",
    },
  ]);
  void aging;
  await processAlerts(store, { userId: "u1", now: T("2026-11-11T07:30:00Z") });
  assert.equal(
    Number(
      (
        await store.db
          .prepare(
            "SELECT COUNT(*) n FROM discovery_notifications WHERE status='pending'",
          )
          .get()
      ).n,
    ),
    5,
  );
  await store.db
    .prepare("UPDATE discovery_jobs SET status='not_listed' WHERE id=?")
    .run(closing);
  await dismissJob(store, "u1", dismissing, "other");
  await store.save("u1", "application", {
    company: "Acme",
    title: "Applying",
    stage: "Submitted",
    requisition: "REQ-A",
    url: "",
    archived: false,
  });
  const sent = await processDigests(store, {
    userId: "u1",
    now: T("2026-11-11T10:00:00Z"),
  });
  assert.equal(sent.digests, 1);
  const [digest] = (await listDigests(store, "u1")).digests;
  assert.deepEqual(
    digest.items.map((i) => i.title),
    ["Staying"],
  );
  assert.equal(digest.excluded.total, 4);
  assert.deepEqual(digest.excluded.byReason, {
    aged_out: 1,
    job_not_listed: 1,
    dismissed: 1,
    already_applied: 1,
  });
  assert.match(digest.message, /1 current match/);
  const reasons = (
    await store.db
      .prepare(
        "SELECT suppress_reason r FROM discovery_notifications WHERE status='suppressed'",
      )
      .all()
  ).map((r) => r.r);
  assert.equal(reasons.length, 4);
  assert.ok(
    reasons.some(
      (r) => r.startsWith("no_longer_matches:") && r.includes("window"),
    ),
  );
  void staying;
});

test("a digest with no current matches says so plainly and does not resurface old jobs", async (t) => {
  const { store, c } = await digestFixture(t);
  const created = T("2026-11-01T00:00:00Z");
  await createRule(
    store,
    "u1",
    rule({ name: "Fresh", cadence: "weekly", filters: { window: "24h" } }),
    created,
  );
  await seedJobs(store, c, [
    {
      title: "Old news",
      posted: "2026-11-02T09:00:00.000Z",
      discovered: "2026-11-02T09:10:00.000Z",
    },
  ]);
  // Queue while it was still inside the 24h window...
  await processAlerts(store, { userId: "u1", now: T("2026-11-02T10:00:00Z") });
  // ...and send a week later, long after it aged out.
  const slot = T("2026-11-09T08:05:00Z"); // Monday 08:05 UTC
  assert.equal(
    (await processDigests(store, { userId: "u1", now: slot })).digests,
    1,
  );
  const [digest] = (await listDigests(store, "u1")).digests;
  assert.equal(digest.cadence, "weekly");
  assert.deepEqual(digest.items, []);
  assert.match(digest.message, /^No current matches/);
  assert.match(digest.message, /1 job matched earlier/);
  assert.match(digest.message, /aged out of the recency window/);
  assert.match(digest.message, /nothing is shown as new/);
  // Nothing left pending, so no repeated empty digests the next week.
  assert.equal(
    (
      await processDigests(store, {
        userId: "u1",
        now: T("2026-11-16T08:05:00Z"),
      })
    ).digests,
    0,
  );
});

test("digests honor the user's time zone, quiet hours, volume cap and pause", async (t) => {
  const { store, c } = await digestFixture(t, "America/New_York");
  await saveDigestSettings(store, "u1", { hour: 8, weekday: 1 });
  assert.deepEqual(await getDigestSettings(store, "u1"), {
    hour: 8,
    weekday: 1,
  });
  const created = T("2026-11-10T00:00:00Z");
  const quiet = await createRule(
    store,
    "u1",
    rule({
      name: "Quiet",
      cadence: "daily",
      quietStart: "07:00",
      quietEnd: "09:00",
      filters: { q: "alpha" },
    }),
    created,
  );
  await createRule(
    store,
    "u1",
    rule({
      name: "Capped",
      cadence: "daily",
      dailyCap: 2,
      filters: { q: "beta" },
    }),
    created,
  );
  await seedJobs(store, c, [
    { title: "Alpha 1", discovered: "2026-11-11T05:00:00.000Z" },
    ...[1, 2, 3].map((n) => ({
      title: `Beta ${n}`,
      discovered: `2026-11-11T05:0${n}:00.000Z`,
    })),
  ]);
  await processAlerts(store, { userId: "u1", now: T("2026-11-11T12:00:00Z") });
  // 12:30 UTC is 07:30 New York: before 08:00 local, so no slot for today yet,
  // and yesterday's slot predates these jobs.
  assert.equal(
    (
      await processDigests(store, {
        userId: "u1",
        now: T("2026-11-11T12:30:00Z"),
      })
    ).digests,
    0,
  );
  // 13:05 UTC is 08:05 local: due, but the Quiet rule is inside its 07:00-09:00
  // quiet hours, so only the Capped rule is delivered (2 of 3, the cap).
  const sent = await processDigests(store, {
    userId: "u1",
    now: T("2026-11-11T13:05:00Z"),
  });
  assert.equal(sent.digests, 1);
  assert.equal(sent.items, 2);
  assert.equal(sent.excluded, 1);
  const [digest] = (await listDigests(store, "u1")).digests;
  assert.deepEqual(
    digest.items.map((i) => i.rules[0].name),
    ["Capped", "Capped"],
  );
  assert.equal(digest.excluded.byReason.volume_cap, 1);
  assert.equal(
    (
      await store.db
        .prepare("SELECT status s FROM discovery_notifications WHERE rule_id=?")
        .get(quiet.id)
    ).s,
    "pending",
    "held by quiet hours, not dropped",
  );
  // Pausing cancels what is still pending for that rule.
  await updateRule(
    store,
    "u1",
    quiet.id,
    rule({
      name: "Quiet",
      cadence: "daily",
      paused: true,
      quietStart: "07:00",
      quietEnd: "09:00",
      filters: { q: "alpha" },
    }),
    T("2026-11-11T14:00:00Z"),
  );
  const note = await store.db
    .prepare(
      "SELECT status s,suppress_reason r FROM discovery_notifications WHERE rule_id=?",
    )
    .get(quiet.id);
  assert.deepEqual({ ...note }, { s: "suppressed", r: "paused" });
  assert.equal(
    (
      await processDigests(store, {
        userId: "u1",
        now: T("2026-11-12T13:05:00Z"),
      })
    ).digests,
    0,
  );
});

test("editing or pausing a rule cancels its pending deliveries; cosmetic edits keep them", async (t) => {
  const { store, c } = await digestFixture(t);
  const created = T("2026-11-11T00:00:00Z");
  const r = await createRule(
    store,
    "u1",
    rule({ name: "R", cadence: "daily", filters: { q: "alpha" } }),
    created,
  );
  await seedJobs(store, c, [
    { title: "Alpha", discovered: "2026-11-11T05:00:00.000Z" },
  ]);
  await processAlerts(store, { userId: "u1", now: T("2026-11-11T06:00:00Z") });
  const status = async () =>
    await store.db
      .prepare(
        "SELECT status s,suppress_reason r FROM discovery_notifications WHERE rule_id=?",
      )
      .get(r.id);
  assert.equal((await status()).s, "pending");
  // Name, quiet hours and cap changes apply at send time and keep the queue.
  await updateRule(
    store,
    "u1",
    r.id,
    rule({
      name: "Renamed",
      cadence: "daily",
      dailyCap: 3,
      filters: { q: "alpha" },
    }),
    T("2026-11-11T06:10:00Z"),
  );
  assert.equal((await status()).s, "pending");
  // Changing what it matches (or its cadence) cancels and resets the start, so
  // the old queue never reappears under new criteria.
  await updateRule(
    store,
    "u1",
    r.id,
    rule({ name: "Renamed", cadence: "daily", filters: { q: "beta" } }),
    T("2026-11-11T06:20:00Z"),
  );
  assert.deepEqual(
    { ...(await status()) },
    { s: "suppressed", r: "rule_changed" },
  );
  assert.equal(
    (
      await processDigests(store, {
        userId: "u1",
        now: T("2026-11-11T09:00:00Z"),
      })
    ).digests,
    0,
  );
  // Moving to immediate delivery cancels digest-queued items too.
  await seedJobs(store, c, [
    { title: "Beta", discovered: "2026-11-11T07:00:00.000Z" },
  ]);
  await processAlerts(store, { userId: "u1", now: T("2026-11-11T07:30:00Z") });
  await updateRule(
    store,
    "u1",
    r.id,
    rule({ name: "Renamed", cadence: "immediate", filters: { q: "beta" } }),
    T("2026-11-11T07:40:00Z"),
  );
  assert.equal(
    Number(
      (
        await store.db
          .prepare(
            "SELECT COUNT(*) n FROM discovery_notifications WHERE rule_id=? AND status='pending'",
          )
          .get(r.id)
      ).n,
    ),
    0,
  );
  // Deleting a rule removes its queue and cannot touch another user's rule.
  await assert.rejects(
    updateRule(store, "u2", r.id, rule(), T("2026-11-11T08:00:00Z")),
    /not found/,
  );
  await deleteRule(store, "u2", r.id);
  assert.equal(
    (
      await store.db
        .prepare("SELECT COUNT(*) n FROM discovery_alert_rules WHERE id=?")
        .get(r.id)
    ).n,
    1,
  );
  await deleteRule(store, "u1", r.id);
  assert.equal(
    Number(
      (
        await store.db
          .prepare("SELECT COUNT(*) n FROM discovery_notifications")
          .get()
      ).n,
    ),
    0,
  );
});

test("immediate rules are unchanged and rule views carry the digest warning", async (t) => {
  const { store, c } = await digestFixture(t);
  const created = T("2026-11-11T00:00:00Z");
  const warned = await createRule(
    store,
    "u1",
    rule({ name: "W", cadence: "weekly", filters: { window: "24h" } }),
    created,
  );
  assert.match(warned.warnings, /shorter than its weekly/);
  const fine = await createRule(
    store,
    "u1",
    rule({ name: "F", filters: { window: "24h" } }),
    created,
  );
  assert.equal(fine.cadence, "immediate");
  assert.equal(fine.warnings, "");
  await seedJobs(store, c, [
    {
      title: "Anything",
      posted: "2026-11-11T05:00:00.000Z",
      discovered: "2026-11-11T05:00:00.000Z",
    },
  ]);
  const out = await processAlerts(store, {
    userId: "u1",
    now: T("2026-11-11T06:00:00Z"),
  });
  assert.equal(out.delivered, 1, "only the immediate rule delivered");
  assert.equal((await listNotifications(store, "u1")).notifications.length, 1);
  assert.equal(
    Number(
      (
        await store.db
          .prepare(
            "SELECT COUNT(*) n FROM discovery_notifications WHERE rule_id=? AND status='pending'",
          )
          .get(warned.id)
      ).n,
    ),
    1,
  );
  void queueAlerts;
});

// ------------------------------------------------------------ scheduling

const fakeBoard = (n) => ({
  status: 200,
  ok: true,
  headers: new Headers(),
  text: async () =>
    JSON.stringify({
      jobs: [
        {
          id: n,
          title: `Role ${n}`,
          absolute_url: `https://boards.greenhouse.io/b${n}/jobs/${n}`,
          location: { name: "Remote" },
          requisition_id: `R${n}`,
          content: "&lt;p&gt;x&lt;/p&gt;",
        },
      ],
    }),
});
async function sources(store, count) {
  const ids = [];
  for (let i = 1; i <= count; i++) {
    const companyId = await company(store, `Co${i}`, `co${i}.test`);
    const sourceId = await upsertSource(store, {
      companyId,
      platform: "greenhouse",
      boardId: `b${i}`,
    });
    await setSourcePolicy(store, sourceId, {
      permission: "confirmed",
      enabled: true,
    });
    ids.push(sourceId);
  }
  return ids;
}

test("discovery work does nothing unless its env flags are set", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await sources(store, 1);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return fakeBoard(1);
  };
  assert.deepEqual(
    await processDiscovery(store, { env: {}, fetcher, limiter: noWait }),
    {
      skipped: true,
      reason: "discovery_disabled",
    },
  );
  assert.deepEqual(
    await processDiscovery(store, {
      env: {
        DISCOVERY_COLLECTION_ENABLED: "false",
        DISCOVERY_ALERTS_ENABLED: "1",
      },
      fetcher,
    }),
    { skipped: true, reason: "discovery_disabled" },
  );
  assert.equal(calls.length, 0, "no request was attempted");
  // The scheduler calls the step but adds nothing to its result when it is off.
  const result = await runScheduler(store, {});
  assert.equal(result.discovery, undefined);
});

test("collection ticks are bounded and back off per source without blocking others", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const [s1, s2, s3] = await sources(store, 3);
  const env = { DISCOVERY_COLLECTION_ENABLED: "true" };
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes("/b1/"))
      return {
        status: 500,
        ok: false,
        headers: new Headers(),
        text: async () => "",
      };
    return fakeBoard(url.includes("/b2") ? 2 : 3);
  };
  let now = T("2026-11-11T00:00:00Z");
  const tick = (extra = {}) =>
    processDiscovery(store, {
      now,
      env,
      fetcher,
      limiter: noWait,
      maxSources: 2,
      ...extra,
    });
  const first = await tick();
  assert.equal(first.collection.sources, 2, "bounded to two sources per tick");
  assert.equal(calls.length, 2);
  const second = await tick();
  assert.equal(
    second.collection.sources,
    1,
    "only the remaining due source runs",
  );
  assert.equal(calls.length, 3);
  const row = (id) =>
    store.db.prepare("SELECT * FROM discovery_sources WHERE id=?").get(id);
  const failing = await row(s1);
  assert.equal(failing.consecutive_failures, 1);
  assert.equal(failing.health, "degraded");
  assert.ok(Date.parse(failing.next_fetch_at) > now, "failed source backs off");
  // Within the backoff nothing refetches the failing source, and the healthy ones are not due.
  now += 60e3;
  assert.equal((await tick()).collection.sources, 0);
  // After the backoff only the failing source is retried; its delay doubles.
  now = Date.parse(failing.next_fetch_at) + 1000;
  const calls3 = calls.length;
  await tick({ maxSources: 5 });
  assert.equal(calls.length > calls3, true);
  const again = await row(s1);
  assert.equal(again.consecutive_failures, 2);
  assert.ok(Date.parse(again.next_fetch_at) - now >= 2 * 15 * 60e3 - 1);
  assert.equal((await row(s2)).consecutive_failures, 0);
  assert.equal((await row(s3)).health, "healthy");
  // A past deadline stops the batch before any request.
  const before = calls.length;
  const stopped = await processDiscovery(store, {
    now: now + 30 * 864e5,
    env,
    fetcher,
    limiter: noWait,
    deadline: 1,
  });
  assert.equal(stopped.collection.sources, 0);
  assert.equal(calls.length, before);
});

test("alert processing walks users in bounded batches using a persisted cursor", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const c = await company(store);
  const users = ["u1", "u2", "u3"];
  for (const u of users) {
    await addUser(store, u);
    await createRule(
      store,
      u,
      rule({ name: u, cadence: "daily" }),
      T("2026-11-11T00:00:00Z"),
    );
  }
  await seedJobs(store, c, [
    { title: "Anything", discovered: "2026-11-11T05:00:00.000Z" },
  ]);
  const now = T("2026-11-11T06:00:00Z");
  const queuedFor = async (u) =>
    Number(
      (
        await store.db
          .prepare(
            "SELECT COUNT(*) n FROM discovery_notifications WHERE user_id=?",
          )
          .get(u)
      ).n,
    );
  const env = { DISCOVERY_ALERTS_ENABLED: "true" };
  const run = () => processDiscovery(store, { now, env, maxUsers: 2 });
  const a = await run();
  assert.equal(a.alerts.users, 2);
  assert.deepEqual(await Promise.all(users.map(queuedFor)), [1, 1, 0]);
  const b = await run();
  assert.equal(b.alerts.users, 1);
  assert.deepEqual(await Promise.all(users.map(queuedFor)), [1, 1, 1]);
  const wrap = await run();
  assert.equal(wrap.alerts.users, 2, "wraps around to the first users again");
  assert.equal(wrap.collection, undefined, "collection flag is independent");
  // Idempotent: repeated runs never duplicate a queued alert.
  assert.deepEqual(await Promise.all(users.map(queuedFor)), [1, 1, 1]);
  const direct = await processAlertBatch(store, { now, maxUsers: 50 });
  assert.equal(direct.users, 1, "resumes after the last user reached");
  assert.equal(direct.queued, 0);
});

test("the scheduler runs the discovery step best-effort and keeps queue progress if it fails", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  let seen;
  const ok = await runScheduler(store, {
    discovery: async (s, options) => {
      seen = options;
      return { alerts: { users: 1 } };
    },
  });
  assert.deepEqual(ok.discovery, { alerts: { users: 1 } });
  assert.ok(seen.deadline > Date.now() - 1000 && seen.now);
  const quiet = console.error;
  console.error = () => {};
  try {
    const failed = await runScheduler(store, {
      discovery: async () => {
        throw new Error("boom with user@example.com");
      },
    });
    assert.equal(failed.discovery, undefined);
  } finally {
    console.error = quiet;
  }
  const state = await store.db
    .prepare("SELECT status,result FROM scheduler_state WHERE id=1")
    .get();
  assert.equal(state.status, "completed");
  assert.ok(!state.result.includes("boom"), "errors are not persisted");
});

// ------------------------------------------------------------------ API

test("the API pages the feed, validates cursors and keeps digests private per user", async (t) => {
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
      body:
        body === undefined
          ? method === "GET"
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
  const register = async (email) =>
    (
      await call("/auth/register", "POST", {
        name: "T",
        email,
        password: "a-secure-test-password",
        timezone: "UTC",
      })
    ).cookie;
  assert.equal((await call("/discovery/digests")).status, 401);
  assert.equal((await call("/discovery/digest-settings")).status, 401);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  const c = await company(store);
  const rows = [];
  for (let i = 0; i < 12; i++)
    rows.push({
      title: `Job ${i}`,
      posted: iso(Date.now() - i * 3600e3),
      discovered: iso(Date.now() - i * 3600e3),
    });
  await seedJobs(store, c, rows);
  const feed = (cursor, cookie = a) =>
    call(
      `/discovery/feed?view=latest&limit=5&filters=${encodeURIComponent(JSON.stringify({ eligibility: ALL }))}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "GET",
      undefined,
      cookie,
    );
  const p1 = await feed();
  assert.equal(p1.status, 200);
  assert.equal(p1.data.jobs.length, 5);
  assert.ok(p1.data.hasMore && p1.data.nextCursor);
  const p2 = await feed(p1.data.nextCursor);
  const p3 = await feed(p2.data.nextCursor);
  assert.equal(p3.data.jobs.length, 2);
  assert.equal(p3.data.hasMore, false);
  assert.equal(
    new Set(
      [...p1.data.jobs, ...p2.data.jobs, ...p3.data.jobs].map((j) => j.id),
    ).size,
    12,
  );
  assert.equal((await feed("garbage")).status, 400);
  assert.equal(
    (await call("/discovery/feed?view=latest&limit=1000", "GET", undefined, a))
      .status,
    400,
  );
  // Digest settings validate and are per user.
  assert.equal(
    (
      await call(
        "/discovery/digest-settings",
        "PUT",
        { hour: 25, weekday: 1 },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/discovery/digest-settings",
        "PUT",
        { hour: 6, weekday: 3 },
        a,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await call("/discovery/digest-settings", "GET", undefined, a)).data,
    { hour: 6, weekday: 3 },
  );
  assert.deepEqual(
    (await call("/discovery/digest-settings", "GET", undefined, b)).data,
    { hour: 8, weekday: 1 },
  );
  // Create a weekly rule over the API and see the warning plus empty digest list.
  const made = await call(
    "/discovery/alerts",
    "POST",
    { name: "W", filters: { window: "24h" }, cadence: "weekly" },
    a,
  );
  assert.equal(made.status, 201);
  assert.match(made.data.warnings, /shorter than its weekly/);
  assert.equal(
    (
      await call(
        "/discovery/alerts",
        "POST",
        { name: "X", filters: {}, cadence: "hourly" },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (await call("/discovery/digests", "GET", undefined, b)).data.digests.length,
    0,
  );
  assert.equal(
    (await call("/discovery/digests/read", "POST", {}, a)).status,
    200,
  );
  const proc = await call("/discovery/alerts/process", "POST", {}, a);
  assert.equal(proc.status, 200);
  assert.equal(proc.data.digests, 0);
});
