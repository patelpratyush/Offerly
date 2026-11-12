import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createApp } from "../../server/app.js";
import { createStore } from "../helpers/store.js";
import { DISCOVERY_TABLES } from "../../server/discovery/schema.js";
import {
  classifySize,
  sizeMatches,
  describeSize,
} from "../../server/discovery/size.js";
import {
  fetchBoard,
  boardUrl,
  parsePosted,
  htmlToText,
  createRateLimiter,
  ConnectorError,
} from "../../server/discovery/connectors.js";
import {
  upsertCompany,
  upsertSource,
  setSourcePolicy,
  coverage,
} from "../../server/discovery/registry.js";
import { ingestSource } from "../../server/discovery/ingest.js";
import { saveProfile } from "../../server/discovery/profile.js";
import { scoreJob } from "../../server/discovery/scoring.js";
import { checkEligibility } from "../../server/discovery/eligibility.js";
import { listView } from "../../server/discovery/feed.js";
import {
  createRule,
  queueAlerts,
  deliverAlerts,
  processAlerts,
  listNotifications,
  updateRule,
} from "../../server/discovery/alerts.js";
import { saveJob, dismissJob } from "../../server/discovery/actions.js";

const fixture = (name) =>
  readFileSync(
    new URL(`../fixtures/discovery/${name}.json`, import.meta.url),
    "utf8",
  );
const ENV = { DISCOVERY_COLLECTION_ENABLED: "true" };
const NOW = Date.parse("2026-11-11T15:00:00Z");
const DAY = 864e5;
/** Fixture fetcher: no network. Records every requested URL. */
function fakeFetcher(responses) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const next = responses[url] ?? responses["*"];
    const value = typeof next === "function" ? next() : next;
    if (value instanceof Error) throw value;
    return {
      status: value.status ?? 200,
      ok: (value.status ?? 200) < 300,
      headers: new Headers(value.headers || {}),
      text: async () => value.body ?? "",
    };
  };
  return { fetcher, calls };
}
const noWait = createRateLimiter({ minIntervalMs: 0 });
async function addUser(store, id) {
  await store.db
    .prepare(
      "INSERT INTO users(id,email,password,name,timezone,stages) VALUES(?,?,?,?,?,?)",
    )
    .run(id, `${id}@example.com`, "x", id, "UTC", "[]");
}
async function board(store, platform, boardId, domain, name = "Acme") {
  const companyId = await upsertCompany(store, { name, domain });
  const sourceId = await upsertSource(store, { companyId, platform, boardId });
  await setSourcePolicy(store, sourceId, {
    permission: "confirmed",
    enabled: true,
  });
  return { companyId, sourceId };
}
const run = (store, sourceId, body, extra = {}) =>
  ingestSource(store, sourceId, {
    ...fakeFetcher({ "*": { body } }),
    limiter: noWait,
    now: NOW,
    env: ENV,
    ...extra,
  });
async function jobs(store) {
  return store.db
    .prepare("SELECT * FROM discovery_jobs ORDER BY title,requisition")
    .all();
}

test("company size categories use exact boundaries and never guess", () => {
  const cat = (min, max = min) => classifySize(min, max).category;
  assert.equal(cat(1), "Small");
  assert.equal(cat(199), "Small");
  assert.equal(cat(200), "Mid");
  assert.equal(cat(999), "Mid");
  assert.equal(cat(1000), "Large");
  assert.equal(cat(null, null), "Unknown");
  const range = classifySize(150, 500);
  assert.deepEqual([range.category, range.ambiguous], ["Unknown", true]);
  assert.deepEqual(range.categories, ["Small", "Mid"]);
  // Strict filters exclude ambiguity unless the user includes uncertain estimates.
  assert.equal(sizeMatches(range, { sizes: ["Small"] }), false);
  assert.equal(
    sizeMatches(range, { sizes: ["Small"], includeUnknown: true }),
    false,
  );
  assert.equal(
    sizeMatches(range, { sizes: ["Small"], includeUncertain: true }),
    true,
  );
  assert.equal(
    sizeMatches(range, { sizes: ["Large"], includeUncertain: true }),
    false,
  );
  const unknown = classifySize(null, null);
  assert.equal(sizeMatches(unknown, { sizes: ["Small"] }), false);
  assert.equal(
    sizeMatches(unknown, { sizes: ["Small"], includeUnknown: true }),
    true,
  );
  assert.equal(sizeMatches(unknown, {}), true);
  const d = describeSize({
    size_min: 120,
    size_max: 120,
    entity_label: "subsidiary",
    entity_name: "Acme Labs",
  });
  assert.equal(d.entity, "subsidiary");
  assert.equal(d.entityName, "Acme Labs");
});

test("company registry refuses uncited sizes and is idempotent", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await assert.rejects(
    upsertCompany(store, {
      name: "A",
      domain: "a.test",
      sizeMin: 10,
      sizeMax: 10,
    }),
    /source URL/,
  );
  const a = await upsertCompany(store, {
    name: "A",
    domain: "https://www.A.test/careers",
  });
  const b = await upsertCompany(store, { name: "A Inc", domain: "a.test" });
  assert.equal(a, b);
  const s1 = await upsertSource(store, {
    companyId: a,
    platform: "lever",
    boardId: "a",
  });
  assert.equal(
    s1,
    await upsertSource(store, {
      companyId: a,
      platform: "lever",
      boardId: "a",
    }),
  );
  await assert.rejects(
    upsertSource(store, { companyId: a, platform: "lever", boardId: "../x" }),
  );
  const view = await coverage(store, "nobody");
  assert.equal(view.summary.collectingSources, 0);
  assert.match(view.statement, /not the whole job market/);
});

test("connectors normalize each platform, keep date precision and refuse bad boards", async () => {
  const get = async (platform, name) =>
    (
      await fetchBoard(
        { platform, boardId: "x" },
        { ...fakeFetcher({ "*": { body: fixture(name) } }), limiter: noWait },
      )
    ).listings;
  const gh = await get("greenhouse", "greenhouse");
  assert.equal(gh.length, 3);
  assert.equal(gh[0].requisition, "REQ-100");
  assert.equal(gh[0].postedPrecision, "datetime");
  assert.equal(gh[0].postedAt, "2026-11-11T10:00:00.000Z");
  assert.equal(gh[0].postedTimezone, "-05:00");
  assert.match(gh[0].description, /payments systems/);
  assert.doesNotMatch(gh[0].description, /<|&lt;/);
  assert.deepEqual(
    [gh[1].postedAt, gh[1].postedPrecision],
    ["2026-10-20", "date"],
  );
  // updated_at is a modification time and must never become the posting date.
  assert.equal(gh[2].postedPrecision, "unknown");
  const lv = await get("lever", "lever");
  assert.equal(lv[0].workArrangement, "Hybrid");
  assert.deepEqual(
    [
      lv[0].compensation.min,
      lv[0].compensation.currency,
      lv[0].compensation.period,
    ],
    [180000, "USD", "Year"],
  );
  assert.equal(lv[1].compensation.min, null);
  const ab = await get("ashby", "ashby");
  assert.equal(ab.length, 1, "unlisted postings are excluded");
  assert.equal(ab[0].workArrangement, "Remote");
  assert.equal(ab[0].compensation.max, 190000);
  assert.deepEqual(parsePosted("2026-02-30"), {
    at: null,
    precision: "unknown",
    timezone: "",
  });
  assert.equal(parsePosted("2026-11-01T10:00:00").precision, "unknown");
  assert.equal(
    htmlToText("&lt;script&gt;alert(1)&lt;/script&gt;&lt;b&gt;Hi&lt;/b&gt;"),
    "Hi",
  );
  assert.throws(() => boardUrl("greenhouse", "a/../b"), ConnectorError);
  assert.throws(() => boardUrl("workday", "a"), ConnectorError);
});

test("connectors validate responses before returning and surface rate limits", async () => {
  const src = { platform: "greenhouse", boardId: "x" };
  const call = (response) =>
    fetchBoard(src, { ...fakeFetcher({ "*": response }), limiter: noWait });
  await assert.rejects(call({ body: "<html>" }), { code: "invalid_json" });
  await assert.rejects(call({ body: '{"jobs":"nope"}' }), {
    code: "invalid_shape",
  });
  await assert.rejects(call({ status: 404 }), { code: "board_not_found" });
  await assert.rejects(call({ status: 500 }), { code: "http_500" });
  await assert.rejects(
    call({ status: 429, headers: { "retry-after": "120" } }),
    (e) => e.code === "rate_limited" && e.retryAfterMs === 120000,
  );
  const bad = JSON.stringify({
    jobs: [
      { id: 1 },
      { id: 2 },
      { id: 3, title: "T", absolute_url: "https://x.test/3" },
    ],
  });
  await assert.rejects(call({ body: bad }), { code: "mostly_invalid" });
  await assert.rejects(
    fetchBoard(src, {
      fetcher: async () => {
        throw new Error("socket");
      },
      limiter: noWait,
    }),
    { code: "network_error" },
  );
  // Only provider hostnames are ever requested.
  const { fetcher, calls } = fakeFetcher({ "*": { body: '{"jobs":[]}' } });
  await fetchBoard(src, { fetcher, limiter: noWait });
  assert.equal(new URL(calls[0]).hostname, "boards-api.greenhouse.io");
});

test("rate limiter spaces requests per host", async () => {
  let clock = 0;
  const sleeps = [];
  const limiter = createRateLimiter({
    minIntervalMs: 1000,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  await limiter.wait("a");
  await limiter.wait("a");
  await limiter.wait("b");
  assert.deepEqual(sleeps, [1000]);
});

test("collection stays off until enabled, approved and permitted", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const companyId = await upsertCompany(store, {
    name: "Acme",
    domain: "acme.test",
  });
  const sourceId = await upsertSource(store, {
    companyId,
    platform: "greenhouse",
    boardId: "acme",
  });
  const { fetcher, calls } = fakeFetcher({
    "*": { body: fixture("greenhouse") },
  });
  const attempt = (env) =>
    ingestSource(store, sourceId, { fetcher, limiter: noWait, now: NOW, env });
  assert.equal((await attempt({})).reason, "collection_disabled");
  assert.equal((await attempt(ENV)).reason, "source_not_approved");
  await setSourcePolicy(store, sourceId, { enabled: true });
  assert.equal(
    (await attempt(ENV)).reason,
    "source_not_approved",
    "enabled without permission",
  );
  await setSourcePolicy(store, sourceId, {
    permission: "confirmed",
    enabled: true,
  });
  assert.equal((await attempt(ENV)).outcome, "success");
  await setSourcePolicy(store, sourceId, { permission: "revoked" });
  assert.equal((await attempt(ENV)).reason, "source_not_approved");
  assert.equal(calls.length, 1, "no request unless fully approved");
});

test("same opening from two sources is one job; distinct requisitions stay separate", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const gh = await board(store, "greenhouse", "acme", "acme.test");
  const lv = await board(store, "lever", "acme", "acme.test");
  assert.equal(
    (await run(store, gh.sourceId, fixture("greenhouse"))).outcome,
    "success",
  );
  assert.equal(
    (await run(store, lv.sourceId, fixture("lever"))).outcome,
    "success",
  );
  const all = await jobs(store);
  const backend = all.filter((j) => j.title === "Senior Backend Engineer");
  assert.equal(backend.length, 1, "cross-source duplicate grouped");
  const listings = await store.db
    .prepare("SELECT url FROM discovery_listings WHERE job_id=? ORDER BY url")
    .all(backend[0].id);
  assert.deepEqual(
    listings.map((l) => l.url),
    [
      "https://boards.greenhouse.io/acme/jobs/1001",
      "https://jobs.lever.co/acme/lv-aaa-1",
    ],
  );
  const analysts = all.filter((j) => j.title === "Data Analyst");
  assert.equal(analysts.length, 2, "distinct requisitions never merge");
  // The earlier source's posting date is kept; the second source adds none.
  assert.equal(backend[0].employer_posted_at, "2026-11-11T10:00:00.000Z");
  assert.equal(all.length, 4);
});

test("two postings inside one source never collapse by title", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const lv = await board(store, "lever", "acme", "acme.test");
  const twin = (id) => ({
    id,
    text: "Support Engineer",
    hostedUrl: "https://jobs.lever.co/acme/" + id,
    categories: { location: "Austin" },
  });
  await run(store, lv.sourceId, JSON.stringify([twin("a"), twin("b")]));
  assert.equal((await jobs(store)).length, 2);
});

test("re-ingesting is idempotent; changes keep posting and discovery history", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const gh = await board(store, "greenhouse", "acme", "acme.test");
  await run(store, gh.sourceId, fixture("greenhouse"));
  const before = await jobs(store);
  await run(store, gh.sourceId, fixture("greenhouse"), {
    now: NOW + DAY,
    force: true,
  });
  const same = await jobs(store);
  assert.deepEqual(
    same.map((j) => [j.id, j.first_discovered_at, j.last_changed_at]),
    before.map((j) => [j.id, j.first_discovered_at, j.last_changed_at]),
    "unchanged content does not move last_changed_at",
  );
  assert.equal(same[0].last_checked_at, new Date(NOW + DAY).toISOString());
  assert.equal(
    (
      await store.db
        .prepare("SELECT COUNT(*) AS n FROM discovery_snapshots")
        .get()
    ).n,
    3,
  );
  const edited = JSON.parse(fixture("greenhouse"));
  edited.jobs[0].content = "&lt;p&gt;Updated description with Rust.&lt;/p&gt;";
  await run(store, gh.sourceId, JSON.stringify(edited), {
    now: NOW + 2 * DAY,
    force: true,
  });
  const job = (await jobs(store)).find((j) => j.requisition === "REQ-100");
  assert.equal(
    job.employer_posted_at,
    "2026-11-11T10:00:00.000Z",
    "description edit keeps posted date",
  );
  assert.equal(job.first_discovered_at, new Date(NOW).toISOString());
  assert.equal(job.last_changed_at, new Date(NOW + 2 * DAY).toISOString());
  assert.match(job.description, /Updated description/);
  assert.equal(
    (
      await store.db
        .prepare("SELECT COUNT(*) AS n FROM discovery_snapshots")
        .get()
    ).n,
    4,
    "a change adds one snapshot",
  );
});

test("failed or suspicious fetches never close jobs; verified absence does, and reopening is recorded", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const many = (n) =>
    JSON.stringify({
      jobs: Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        title: "Role " + i,
        absolute_url: "https://boards.greenhouse.io/acme/jobs/" + (i + 1),
        location: { name: "Remote" },
        requisition_id: "R" + i,
      })),
    });
  const gh = await board(store, "greenhouse", "acme", "acme.test");
  await run(store, gh.sourceId, many(6));
  const status = async () =>
    (
      await store.db
        .prepare(
          "SELECT status,COUNT(*) AS n FROM discovery_jobs GROUP BY status",
        )
        .all()
    ).map((r) => `${r.status}:${r.n}`);
  assert.deepEqual(await status(), ["listed:6"]);
  // Outage, garbage body, empty body and a >50% drop all leave jobs listed.
  for (const response of [
    { status: 503 },
    { body: "<html>oops" },
    { body: '{"jobs":[]}' },
    { body: many(2) },
  ]) {
    const r = await run(store, gh.sourceId, undefined, {
      ...fakeFetcher({ "*": response }),
      now: NOW + DAY,
      force: true,
    });
    assert.notEqual(r.outcome, "success");
  }
  assert.deepEqual(await status(), ["listed:6"], "no mass closure");
  const listing = await store.db
    .prepare("SELECT verification,status FROM discovery_listings LIMIT 1")
    .get();
  assert.deepEqual(
    [listing.verification, listing.status],
    ["could_not_verify", "listed"],
  );
  const source = await store.db
    .prepare("SELECT * FROM discovery_sources")
    .get();
  assert.equal(source.health, "failing");
  assert.ok(source.consecutive_failures >= 3);
  assert.ok(Date.parse(source.next_fetch_at) > NOW + DAY, "backoff scheduled");
  const cov = await coverage(store, "u", NOW + DAY);
  assert.equal(cov.companies[0].sources[0].verification, "could_not_verify");
  // A later verified fetch with 5 of 6 listings records one absence and one close.
  await run(store, gh.sourceId, many(5), { now: NOW + 2 * DAY, force: true });
  assert.deepEqual((await status()).sort(), ["listed:5", "not_listed:1"]);
  assert.equal(
    (
      await store.db
        .prepare(
          "SELECT verification FROM discovery_listings WHERE external_id='1'",
        )
        .get()
    ).verification,
    "verified",
  );
  // The role comes back: first discovery stays, reopened is recorded.
  await run(store, gh.sourceId, many(6), { now: NOW + 3 * DAY, force: true });
  const back = await store.db
    .prepare("SELECT * FROM discovery_jobs WHERE requisition='R5'")
    .get();
  assert.equal(back.status, "listed");
  assert.equal(back.reopened_count, 1);
  assert.equal(back.first_discovered_at, new Date(NOW).toISOString());
});

test("schema covers every discovery table and ships a hosted migration", async () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const sql = readdirSync(dir)
    .filter((n) => n.includes("discovery"))
    .map((n) => readFileSync(new URL(n, dir), "utf8"))
    .join("\n");
  for (const table of DISCOVERY_TABLES) {
    assert.match(sql, new RegExp(`CREATE TABLE offerly\\.${table}\\(`));
    assert.match(
      sql,
      new RegExp(`ALTER TABLE offerly\\.${table} ENABLE ROW LEVEL SECURITY`),
    );
  }
});

const profile = {
  facts: {
    targetRoles: ["backend engineer"],
    seniority: "senior",
    yearsExperience: 7,
    skills: [
      { name: "Python", approved: true },
      { name: "PostgreSQL", approved: true },
      { name: "Rust", approved: false },
      { name: "Kubernetes", approved: true },
    ],
    experienceTerms: ["payments"],
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
    salaryMin: 150000,
    salaryCurrency: "USD",
    salaryBasis: "Base",
  },
};
const approvedProfile = (over = {}) => ({
  facts: { ...profile.facts, ...(over.facts || {}) },
  eligibility: { ...profile.eligibility, ...(over.eligibility || {}) },
  preferences: { ...profile.preferences, ...(over.preferences || {}) },
  approved: true,
});
const jobRow = (over = {}) => ({
  title: "Senior Backend Engineer",
  location: "New York, NY",
  description: "",
  work_arrangement: "Unknown",
  comp_min: null,
  comp_max: null,
  comp_currency: "",
  comp_period: "Unknown",
  comp_basis: "Unknown",
  ...over,
});

test("fit scoring is explainable, versioned and never rewards unsupported skills", () => {
  const description =
    "Requirements\n5+ years with Python and PostgreSQL. Payments experience. Kafka.\nNice to have\nKubernetes, Terraform";
  const fit = scoreJob(jobRow({ description }), approvedProfile());
  assert.equal(fit.rubricVersion, "fit-2026-11-v1");
  assert.deepEqual(
    fit.components.map((c) => c.weight),
    [35, 30, 20, 10, 5],
  );
  assert.ok(fit.score > 0 && fit.score <= 100);
  const required = fit.components.find((c) => c.key === "requiredSkills");
  assert.match(required.gaps.join(" "), /kafka/i);
  assert.match(required.evidence.join(" "), /python/i);
  assert.match(fit.disclaimer, /not a probability/);
  // Listing a skill the person did not approve adds nothing.
  const rustLover = {
    facts: {
      skills: [...profile.facts.skills, { name: "Rust", approved: false }],
    },
  };
  const withRust = scoreJob(
    jobRow({ description: description + "\nRust" }),
    approvedProfile(rustLover),
  );
  const without = scoreJob(jobRow({ description }), approvedProfile());
  assert.ok(
    withRust.score <= without.score,
    "unapproved skill cannot raise the score",
  );
  // Approving an extra skill the listing does not ask for changes nothing.
  const extra = approvedProfile({
    facts: {
      skills: [...profile.facts.skills, { name: "Haskell", approved: true }],
    },
  });
  assert.equal(scoreJob(jobRow({ description }), extra).score, without.score);
});

test("missing compensation is unknown, never zero or invented", () => {
  const description = "Requirements: Python and PostgreSQL.";
  const unstated = scoreJob(jobRow({ description }), approvedProfile());
  const prefs = unstated.components.find((c) => c.key === "preferences");
  assert.equal(prefs.score === 0, false);
  assert.match(prefs.unknowns.join(" "), /not stated/);
  const total = scoreJob(
    jobRow({
      description,
      comp_min: 90000,
      comp_max: 100000,
      comp_currency: "USD",
      comp_period: "Year",
      comp_basis: "Total",
    }),
    approvedProfile(),
  );
  assert.match(
    total.components.find((c) => c.key === "preferences").unknowns.join(" "),
    /not compared/,
    "base and total compensation are not interchanged",
  );
  const insufficient = scoreJob(jobRow({ title: "Chef" }), {
    facts: {},
    eligibility: {},
    preferences: {},
    approved: true,
  });
  assert.equal(insufficient.score, null, "no evidence, no score");
});

test("eligibility is separate from fit and cites listing evidence", () => {
  const text =
    "You must be authorized to work in the United States. We are unable to provide visa sponsorship. Active TS/SCI clearance required.";
  const e = checkEligibility(jobRow({ description: text }), approvedProfile());
  const by = Object.fromEntries(e.checks.map((c) => [c.check, c]));
  assert.equal(by.work_authorization.status, "meets");
  assert.equal(by.sponsorship.status, "meets");
  assert.equal(by.clearance.status, "needs_verification");
  assert.match(by.sponsorship.evidence, /sponsorship/);
  assert.equal(e.status, "needs_verification");
  const needs = checkEligibility(
    jobRow({ description: text }),
    approvedProfile({ eligibility: { needsSponsorship: "yes" } }),
  );
  assert.equal(needs.status, "does_not_meet");
  const none = checkEligibility(
    jobRow({ description: "Build things." }),
    approvedProfile(),
  );
  assert.equal(none.status, "meets");
  assert.match(none.note, /not a guarantee/);
});

async function seeded(t) {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await addUser(store, "u1");
  await addUser(store, "u2");
  const gh = await board(store, "greenhouse", "acme", "acme.test");
  const ab = await board(store, "ashby", "globex", "globex.test", "Globex");
  await run(store, gh.sourceId, fixture("greenhouse"));
  await run(store, ab.sourceId, fixture("ashby"), { now: NOW + 3600e3 });
  return { store, gh, ab };
}

test("latest uses posting dates; new uses discovery dates; unknown dates never qualify", async (t) => {
  const { store } = await seeded(t);
  const now = NOW + 2 * 3600e3;
  const ids = async (view, filters) =>
    (
      await listView(
        store,
        "u1",
        view,
        {
          eligibility: ["meets", "needs_verification", "does_not_meet"],
          ...filters,
        },
        { now },
      )
    ).jobs.map((j) => j.title + (j.freshness.employerPostedAt ? "" : "?"));
  // Posted 2026-10-20 (date only) was first discovered today.
  assert.ok((await ids("new", { window: "24h" })).includes("Data Analyst"));
  assert.ok(!(await ids("latest", { window: "24h" })).includes("Data Analyst"));
  assert.deepEqual(await ids("latest", { window: "24h" }), [
    "Senior Backend Engineer",
  ]);
  assert.deepEqual(
    await ids("latest", { window: "3d" }).then((x) => x.sort()),
    ["Platform Engineer", "Senior Backend Engineer"],
  );
  const week = await ids("latest", { window: "7d" });
  assert.ok(!week.includes("Data Analyst"));
  const month = await ids("latest", { window: "30d" });
  assert.ok(month.includes("Data Analyst"));
  assert.ok(
    !month.includes("Data Analyst?"),
    "unknown posting date never counts as recent",
  );
  const custom = await ids("latest", {
    window: "custom",
    from: "2026-10-19",
    to: "2026-10-20",
  });
  assert.deepEqual(custom, ["Data Analyst"]);
  // Date-only posting is labelled date-only, never an exact hour.
  const list = await listView(
    store,
    "u1",
    "latest",
    { eligibility: ["meets", "needs_verification", "does_not_meet"] },
    { now },
  );
  const dated = list.jobs.find((j) => j.freshness.postedPrecision === "date");
  assert.match(dated.freshness.postedLabel, /date only/);
  const unknown = list.jobs.find(
    (j) => j.freshness.postedPrecision === "unknown",
  );
  assert.equal(unknown.freshness.postedLabel, "Posting date unknown");
  assert.ok(
    unknown.freshness.firstDiscoveredAt &&
      unknown.freshness.lastCheckedAt &&
      unknown.freshness.lastChangedAt,
  );
});

test("size and eligibility filters apply consistently; ambiguous size needs opt-in", async (t) => {
  const { store } = await seeded(t);
  const acme = await store.db
    .prepare("SELECT id FROM discovery_companies WHERE name='Acme'")
    .get();
  await upsertCompany(store, {
    name: "Acme",
    domain: "acme.test",
    sizeMin: 150,
    sizeMax: 500,
    sizeSourceUrl: "https://example.test/acme-size",
    sizeAsOf: "2026-10-01",
  });
  const all = { eligibility: ["meets", "needs_verification", "does_not_meet"] };
  const names = async (f) =>
    new Set(
      (
        await listView(store, "u1", "latest", { ...all, ...f }, { now: NOW })
      ).jobs.map((j) => j.company.name),
    );
  assert.deepEqual([...(await names({ sizes: ["Small"] }))], []);
  assert.deepEqual(
    [...(await names({ sizes: ["Small"], includeUnknownSize: true }))],
    ["Globex"],
  );
  assert.ok(
    (await names({ sizes: ["Small"], includeUncertainSize: true })).has("Acme"),
  );
  void acme;
});

test("per-user state is isolated: saves, dismissals, watchlists, searches, rules", async (t) => {
  const { store } = await seeded(t);
  const job = await store.db
    .prepare("SELECT id FROM discovery_jobs WHERE title='Platform Engineer'")
    .get();
  await saveJob(store, "u1", job.id);
  await saveJob(store, "u1", job.id);
  const names = async (user, view) =>
    (await listView(store, user, view, {}, { now: NOW })).jobs.map((j) => j.id);
  assert.deepEqual(await names("u1", "saved"), [job.id]);
  assert.deepEqual(await names("u2", "saved"), []);
  await dismissJob(store, "u2", job.id, "not_relevant");
  assert.ok(!(await names("u2", "latest")).includes(job.id));
  assert.ok(
    (await names("u1", "latest")).includes(job.id),
    "another user's dismissal does not hide it",
  );
  await assert.rejects(
    dismissJob(store, "u2", job.id, "bogus"),
    /listed reason/,
  );
  await assert.rejects(
    saveJob(store, "u2", "00000000-0000-4000-8000-000000000000"),
    /not found/,
  );
});

test("existing applications are detected by requisition and URL before applying again", async (t) => {
  const { store } = await seeded(t);
  await store.save("u1", "application", {
    company: "Acme",
    title: "Different words",
    stage: "Submitted",
    requisition: "req 100",
    url: "",
    archived: false,
  });
  await store.save("u1", "application", {
    company: "Globex",
    title: "x",
    stage: "Saved",
    url: "https://jobs.ashbyhq.com/globex/ab-1/?utm=1",
    requisition: "",
    archived: false,
  });
  const list = await listView(store, "u1", "applied", {}, { now: NOW });
  const byTitle = Object.fromEntries(
    list.jobs.map((j) => [j.title, j.applied.matchedBy]),
  );
  assert.deepEqual(byTitle, {
    "Senior Backend Engineer": "requisition",
    "Platform Engineer": "url",
  });
  assert.equal(
    (await listView(store, "u2", "applied", {}, { now: NOW })).jobs.length,
    0,
  );
  const latest = await listView(store, "u1", "latest", {}, { now: NOW });
  assert.ok(latest.jobs.find((j) => j.title === "Platform Engineer").applied);
});

test("best matches need an approved profile, order by fit, and re-evaluate on profile change", async (t) => {
  const { store } = await seeded(t);
  assert.equal(
    (await listView(store, "u1", "best", {}, { now: NOW })).profileApproved,
    false,
  );
  assert.equal(
    (await listView(store, "u1", "best", {}, { now: NOW })).jobs.length,
    0,
  );
  const saved = await saveProfile(store, "u1", profile);
  assert.equal(saved.version, 1);
  assert.equal(
    (await saveProfile(store, "u1", profile)).version,
    1,
    "unchanged resubmission is a no-op",
  );
  const best = await listView(store, "u1", "best", {}, { now: NOW });
  assert.ok(best.jobs.length > 0);
  const scores = best.jobs.map((j) => j.fit.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  );
  assert.equal(best.jobs[0].title, "Senior Backend Engineer");
  const before = best.jobs.map((j) => j.freshness.firstDiscoveredAt).join();
  const scoreOf = (view, title) =>
    view.jobs.find((j) => j.title === title).fit.score;
  const changed = await saveProfile(store, "u1", {
    ...profile,
    facts: { ...profile.facts, targetRoles: ["platform engineer"] },
  });
  assert.equal(changed.version, 2);
  const after = await listView(store, "u1", "best", {}, { now: NOW });
  assert.ok(
    scoreOf(after, "Platform Engineer") > scoreOf(best, "Platform Engineer"),
  );
  assert.ok(
    scoreOf(after, "Senior Backend Engineer") <
      scoreOf(best, "Senior Backend Engineer"),
  );
  assert.equal(
    before,
    [...best.jobs].map((j) => j.freshness.firstDiscoveredAt).join(),
    "re-scoring never resets discovery dates",
  );
  assert.equal(
    (await listView(store, "u2", "best", {}, { now: NOW })).jobs.length,
    0,
    "profiles are private",
  );
  await assert.rejects(
    saveProfile(store, "u1", {
      ...profile,
      facts: { ...profile.facts, skills: [{ name: "x" }] },
    }),
  );
});

test("alerts dedupe, skip history, honor pause, quiet hours and caps, and recheck at delivery", async (t) => {
  const { store, gh } = await seeded(t);
  await saveProfile(store, "u1", profile);
  const rule = (over = {}) => ({
    name: "Backend",
    filters: { q: "engineer", eligibility: ["meets"] },
    minFit: 0,
    includeUnknownEligibility: true,
    ...over,
  });
  // Created after the jobs were discovered: no historical backfill.
  const quiet = await createRule(store, "u1", rule(), NOW + 3 * 3600e3);
  assert.deepEqual(
    await processAlerts(store, { userId: "u1", now: NOW + 3 * 3600e3 }),
    { queued: 0, delivered: 0, suppressed: 0, deferred: 0 },
  );
  // Explicit backfill is bounded to seven days.
  const back = await createRule(
    store,
    "u1",
    rule({ name: "Backfill", backfill: true }),
    NOW + 3 * 3600e3,
  );
  const first = await processAlerts(store, {
    userId: "u1",
    now: NOW + 3 * 3600e3,
  });
  assert.ok(first.delivered >= 1);
  assert.equal(
    (await processAlerts(store, { userId: "u1", now: NOW + 4 * 3600e3 }))
      .queued,
    0,
    "deduped on rerun",
  );
  const inbox = await listNotifications(store, "u1");
  assert.equal(inbox.unread, first.delivered);
  assert.ok(inbox.notifications.every((n) => n.ruleName === "Backfill"));
  assert.equal((await listNotifications(store, "u2")).notifications.length, 0);
  assert.equal(
    new Set(inbox.notifications.map((n) => n.jobId)).size,
    inbox.notifications.length,
  );
  // New job later: only it is alerted.
  const more = JSON.parse(fixture("greenhouse"));
  more.jobs.push({
    id: 1004,
    title: "Staff Backend Engineer",
    absolute_url: "https://boards.greenhouse.io/acme/jobs/1004",
    location: { name: "Remote" },
    requisition_id: "REQ-300",
    content: "&lt;p&gt;Python&lt;/p&gt;",
  });
  await run(store, gh.sourceId, JSON.stringify(more), {
    now: NOW + 5 * 3600e3,
    force: true,
  });
  const next = await processAlerts(store, {
    userId: "u1",
    now: NOW + 5 * 3600e3,
  });
  assert.equal(
    next.queued,
    2,
    "one new job for each of the two rules' interest",
  );
  void quiet;
  void back;
});

test("alert delivery honors pause, quiet hours, volume cap and rechecks eligibility and recency", async (t) => {
  const { store, gh } = await seeded(t);
  await saveProfile(store, "u1", profile);
  const base = {
    name: "R",
    filters: { eligibility: ["meets", "needs_verification"] },
    includeUnknownEligibility: true,
    backfill: true,
  };
  const at = NOW + 3600e3;
  // Paused rules queue and deliver nothing.
  const paused = await createRule(store, "u1", { ...base, paused: true }, at);
  assert.deepEqual(await processAlerts(store, { userId: "u1", now: at }), {
    queued: 0,
    delivered: 0,
    suppressed: 0,
    deferred: 0,
  });
  await updateRule(
    store,
    "u1",
    paused.id,
    { ...base, paused: false, quietStart: "14:00", quietEnd: "18:00" },
    at,
  );
  // 16:00 UTC is inside quiet hours: queued but held.
  const held = await processAlerts(store, {
    userId: "u1",
    now: Date.parse("2026-11-11T16:00:00Z"),
  });
  assert.equal(held.delivered, 0);
  assert.ok(held.deferred > 0);
  const pending = await store.db
    .prepare(
      "SELECT deliver_after FROM discovery_notifications WHERE status='pending' LIMIT 1",
    )
    .get();
  assert.ok(
    Date.parse(pending.deliver_after) >= Date.parse("2026-11-11T18:00:00Z"),
  );
  // After quiet hours the held alerts deliver, up to the daily cap.
  await updateRule(
    store,
    "u1",
    paused.id,
    { ...base, quietStart: "14:00", quietEnd: "18:00", dailyCap: 2 },
    at,
  );
  const later = await processAlerts(store, {
    userId: "u1",
    now: Date.parse("2026-11-11T18:30:00Z"),
  });
  assert.equal(later.delivered, 2);
  const capped = await store.db
    .prepare(
      "SELECT suppress_reason r FROM discovery_notifications WHERE status='suppressed'",
    )
    .all();
  assert.ok(capped.length >= 1 && capped.every((c) => c.r === "volume_cap"));
  // Recheck at delivery: dismissed and applied jobs are suppressed, not delivered.
  const more = JSON.parse(fixture("greenhouse"));
  more.jobs.push({
    id: 2001,
    title: "Backend Engineer",
    absolute_url: "https://boards.greenhouse.io/acme/jobs/2001",
    location: { name: "Remote" },
    requisition_id: "REQ-900",
    content: "&lt;p&gt;Python&lt;/p&gt;",
  });
  await run(store, gh.sourceId, JSON.stringify(more), {
    now: Date.parse("2026-11-12T01:00:00Z"),
    force: true,
  });
  await updateRule(store, "u1", paused.id, { ...base, dailyCap: 50 }, at);
  const nextDay = Date.parse("2026-11-12T10:00:00Z");
  assert.ok(
    (await queueAlerts(store, { userId: "u1", now: nextDay - 1 })).queued > 0,
  );
  await store.atomic(async () => {
    await store.db
      .prepare(
        "INSERT INTO discovery_user_jobs(user_id,job_id,dismissed_at,dismiss_reason) SELECT 'u1',id,'x','other' FROM discovery_jobs WHERE requisition='REQ-900'",
      )
      .run();
  });
  const rechecked = await deliverAlerts(store, { userId: "u1", now: nextDay });
  assert.equal(rechecked.delivered, 0);
  const why = await store.db
    .prepare(
      "SELECT suppress_reason r FROM discovery_notifications WHERE job_id=(SELECT id FROM discovery_jobs WHERE requisition='REQ-900')",
    )
    .get();
  assert.equal(why.r, "dismissed");
  // A posting-window rule suppresses stale items at delivery time.
  const windowRule = await createRule(
    store,
    "u1",
    {
      ...base,
      name: "Fresh",
      filters: { window: "24h", eligibility: ["meets", "needs_verification"] },
    },
    at,
  );
  await processAlerts(store, { userId: "u1", now: at });
  const stale = await processAlerts(store, {
    userId: "u1",
    now: NOW + 10 * DAY,
  });
  assert.equal(stale.delivered, 0);
  void windowRule;
});

test("API enforces ownership across users and requires authentication", async (t) => {
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
  assert.equal((await call("/discovery/coverage")).status, 401);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  const gh = await board(store, "greenhouse", "acme", "acme.test");
  await run(store, gh.sourceId, fixture("greenhouse"));
  const cov = await call("/discovery/coverage", "GET", undefined, a);
  assert.equal(cov.data.summary.companies, 1);
  const feed = await call(
    "/discovery/feed?view=new&filters=" +
      encodeURIComponent(JSON.stringify({ window: "30d" })),
    "GET",
    undefined,
    a,
  );
  assert.equal(feed.status, 200);
  const jobId = feed.data.jobs[0].id;
  assert.equal(
    (await call(`/discovery/jobs/${jobId}/save`, "PUT", {}, a)).status,
    200,
  );
  assert.equal(
    (await call("/discovery/feed?view=saved", "GET", undefined, b)).data.jobs
      .length,
    0,
  );
  assert.equal(
    (await call("/discovery/feed?view=saved", "GET", undefined, a)).data.jobs
      .length,
    1,
  );
  assert.equal(
    (await call("/discovery/feed?view=bogus", "GET", undefined, a)).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/discovery/feed?view=best&filters=not-json",
        "GET",
        undefined,
        a,
      )
    ).status,
    400,
  );
  // Saved searches and rules cannot be read or changed across accounts.
  const search = await call(
    "/discovery/searches",
    "POST",
    { name: "S", filters: { q: "data" } },
    a,
  );
  assert.equal(search.status, 201);
  assert.equal(
    (await call("/discovery/searches", "GET", undefined, b)).data.length,
    0,
  );
  assert.equal(
    (
      await call(
        `/discovery/searches/${search.data.id}`,
        "PUT",
        { name: "x", filters: {} },
        b,
      )
    ).status,
    404,
  );
  await call(`/discovery/searches/${search.data.id}`, "DELETE", {}, b);
  assert.equal(
    (await call("/discovery/searches", "GET", undefined, a)).data.length,
    1,
  );
  const rule = await call(
    "/discovery/alerts",
    "POST",
    { name: "R", filters: {} },
    a,
  );
  assert.equal(rule.status, 201);
  assert.equal(
    (
      await call(
        `/discovery/alerts/${rule.data.id}`,
        "PUT",
        { name: "x", filters: {} },
        b,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        "/discovery/alerts",
        "POST",
        { name: "R", filters: {}, quietStart: "22:00" },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/discovery/alerts",
        "POST",
        { name: "R", filters: { evil: 1 } },
        a,
      )
    ).status,
    400,
  );
  // Profile approval is explicit and private.
  assert.equal(
    (await call("/discovery/profile", "PUT", profile, a)).data.profile.version,
    1,
  );
  assert.equal(
    (await call("/discovery/profile", "GET", undefined, b)).data.profile
      .approved,
    false,
  );
  assert.equal(
    (
      await call(
        "/discovery/notifications/read",
        "POST",
        { id: "00000000-0000-4000-8000-000000000000" },
        b,
      )
    ).status,
    200,
  );
  // Deleting the account removes that user's discovery data only.
  const counts = async (user) =>
    Object.fromEntries(
      await Promise.all(
        [
          "discovery_profiles",
          "discovery_user_jobs",
          "discovery_saved_searches",
          "discovery_alert_rules",
        ].map(async (t) => [
          t,
          Number(
            (
              await store.db
                .prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id=?`)
                .get(user)
            ).n,
          ),
        ]),
      ),
    );
  const userA = (
    await store.db
      .prepare("SELECT id FROM users WHERE email='a@example.com'")
      .get()
  ).id;
  const userB = (
    await store.db
      .prepare("SELECT id FROM users WHERE email='b@example.com'")
      .get()
  ).id;
  assert.ok(Object.values(await counts(userA)).every((n) => n === 1));
  await store.db.prepare("DELETE FROM users WHERE id=?").run(userA);
  assert.ok(
    Object.values(await counts(userA)).every((n) => n === 0),
    "cascade removes discovery rows",
  );
  assert.equal(
    Number(
      (await store.db.prepare("SELECT COUNT(*) AS n FROM discovery_jobs").get())
        .n,
    ),
    3,
    "shared catalog survives",
  );
  void userB;
});
