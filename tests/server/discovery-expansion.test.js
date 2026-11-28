import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import { createStore } from "../helpers/store.js";
import {
  fetchBoard,
  createRateLimiter,
} from "../../server/discovery/connectors.js";
import {
  detectBoards,
  recordLeads,
  listLeads,
  promoteLead,
  rejectLead,
  backfillLeads,
  importSimplifyLists,
} from "../../server/discovery/leads.js";
import { coverage } from "../../server/discovery/registry.js";
import { initializeDiscovery } from "../../server/discovery/schema.js";

const noWait = createRateLimiter({ minIntervalMs: 0 });
const respond = (body, status = 200) => ({
  status,
  ok: status < 300,
  headers: new Headers(),
  text: async () => JSON.stringify(body),
});
// Shapes follow the public SmartRecruiters Posting API and Workable widget API
// responses observed on 2026-11-21; values are synthetic.
const srJob = (id) => ({
  id: String(id),
  name: `Engineer ${id}`,
  refNumber: `REF${id}`,
  company: { identifier: "Acme", name: "Acme" },
  releasedDate: "2026-11-20T23:50:08.839Z",
  location: { fullLocation: "Austin, TX, United States", remote: id === 1 },
  typeOfEmployment: { id: "permanent", label: "Full-time" },
});

test("SmartRecruiters pages through the whole board and normalizes postings", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const offset = Number(new URL(url).searchParams.get("offset"));
    const all = Array.from({ length: 150 }, (_, i) => srJob(i + 1));
    return respond({
      totalFound: 150,
      content: all.slice(offset, offset + 100),
    });
  };
  const { listings } = await fetchBoard(
    { platform: "smartrecruiters", boardId: "Acme" },
    { fetcher, limiter: noWait },
  );
  assert.equal(listings.length, 150);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]).hostname, "api.smartrecruiters.com");
  const first = listings[0];
  assert.equal(first.url, "https://jobs.smartrecruiters.com/Acme/1");
  assert.equal(first.requisition, "REF1");
  assert.equal(first.workArrangement, "Remote");
  assert.equal(first.employmentType, "Full-time");
  assert.equal(first.postedPrecision, "datetime");
  assert.equal(first.description, "");
});

test("SmartRecruiters never returns a partial board", async () => {
  let page = 0;
  const shortThenEmpty = async () =>
    respond(
      page++ === 0
        ? {
            totalFound: 150,
            content: Array.from({ length: 100 }, (_, i) => srJob(i)),
          }
        : { totalFound: 150, content: [] },
    );
  await assert.rejects(
    fetchBoard(
      { platform: "smartrecruiters", boardId: "Acme" },
      { fetcher: shortThenEmpty, limiter: noWait },
    ),
    { code: "incomplete_board" },
  );
  await assert.rejects(
    fetchBoard(
      { platform: "smartrecruiters", boardId: "Acme" },
      {
        fetcher: async () => respond({ totalFound: 6000, content: [] }),
        limiter: noWait,
      },
    ),
    { code: "too_many_listings" },
  );
});

test("Workable widget postings keep date-only precision and inert text", async () => {
  const body = {
    name: "Acme",
    jobs: [
      {
        title: "Data Engineer",
        shortcode: "81B46579FE",
        code: "R-9",
        employment_type: "Full-time",
        telecommuting: true,
        url: "https://apply.workable.com/j/81B46579FE",
        published_on: "2026-05-29",
        city: "Paris",
        state: "Île-de-France",
        country: "France",
        description: "<p>Build <b>pipelines</b></p><script>x()</script>",
      },
      {
        title: "Analyst",
        shortcode: "AB12",
        telecommuting: false,
        url: "https://apply.workable.com/j/AB12",
        published_on: "2026-02-30",
      },
    ],
  };
  const { listings } = await fetchBoard(
    { platform: "workable", boardId: "acme" },
    { fetcher: async () => respond(body), limiter: noWait },
  );
  const [a, b] = listings;
  assert.equal(a.externalId, "81B46579FE");
  assert.equal(a.location, "Paris, Île-de-France, France");
  assert.equal(a.postedAt, "2026-05-29");
  assert.equal(a.postedPrecision, "date");
  assert.equal(a.workArrangement, "Remote");
  assert.match(a.description, /Build pipelines/);
  assert.doesNotMatch(a.description, /<|x\(\)/);
  // An impossible date is unknown, and telecommuting=false is not "On-site".
  assert.equal(b.postedPrecision, "unknown");
  assert.equal(b.workArrangement, "Unknown");
});

test("board detection keeps only employer boards and canonical URLs", () => {
  const found = detectBoards(`
    Apply: https://job-boards.greenhouse.io/stripe/jobs/123?gh_src=abc&token=SECRET
    https://boards.greenhouse.io/embed/job_board?for=airbnb
    https://jobs.lever.co/netflix/abc-def?lever-source=x
    https://jobs.ashbyhq.com/openai/123
    https://jobs.smartrecruiters.com/ServiceNow/744000
    https://jobs.smartrecruiters.com/my-applications/WesternDigital/2f4dd691?dcr_ci=WesternDigital
    https://apply.workable.com/huggingface/j/81B46579FE
    https://apply.workable.com/j/81B46579FE
    https://jobs.lever.co/netflix/other
    https://example.com/careers
  `);
  assert.deepEqual(
    found.map((b) => `${b.platform}:${b.boardId}`),
    [
      "greenhouse:stripe",
      "greenhouse:airbnb",
      "lever:netflix",
      "ashby:openai",
      "smartrecruiters:ServiceNow",
      "smartrecruiters:WesternDigital",
      "workable:huggingface",
    ],
  );
});

test("leads queue, promote into a disabled source, and stay out of the way", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await recordLeads(
    store,
    "https://jobs.lever.co/netflix/1?token=SECRET",
    "gmail",
  );
  await recordLeads(
    store,
    "see https://jobs.lever.co/netflix/2",
    "application",
  );
  await recordLeads(store, "https://jobs.ashbyhq.com/openai/9", "gmail");
  let leads = await listLeads(store);
  assert.deepEqual(
    leads.map((l) => [l.board_id, l.seen_count]),
    [
      ["netflix", 2],
      ["openai", 1],
    ],
  );
  // Raw links (and any token in them) are never stored.
  assert.equal(leads[0].url, "https://jobs.lever.co/netflix");
  const sourceId = await promoteLead(store, {
    platform: "lever",
    boardId: "netflix",
    name: "Netflix",
    domain: "netflix.com",
  });
  const source = await store.db
    .prepare("SELECT * FROM discovery_sources WHERE id=?")
    .get(sourceId);
  assert.equal(source.enabled, 0);
  assert.equal(source.permission_status, "unconfirmed");
  await rejectLead(store, "ashby", "openai");
  assert.deepEqual(await listLeads(store), []);
  // Lead activity comes from every user, so user-facing coverage never shows it.
  assert.equal(
    "pendingLeads" in (await coverage(store, "nobody")).summary,
    false,
  );
  // A missing table (hosted database not migrated yet) never throws.
  await store.db.exec("DROP TABLE discovery_leads");
  assert.equal(await recordLeads(store, "https://jobs.lever.co/x", "gmail"), 0);
});

test("saving an application with a board link queues a lead", async (t) => {
  const store = await createStore(":memory:");
  const server = (await createApp(store)).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headers = {
    "Content-Type": "application/json",
    "X-Offerly-Request": "1",
  };
  const reg = await fetch(base + "/auth/register", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Lead",
      email: "lead@example.com",
      password: "a-secure-test-password",
      timezone: "UTC",
    }),
  });
  const cookie = reg.headers.get("set-cookie").split(";")[0];
  const res = await fetch(base + "/records/application", {
    method: "POST",
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({
      company: "Stripe",
      title: "Engineer",
      stage: "Saved",
      url: "https://job-boards.greenhouse.io/stripe/jobs/42",
    }),
  });
  assert.equal(res.status, 200);
  const [lead] = await listLeads(store);
  assert.equal(lead.board_id, "stripe");
  assert.equal(lead.origin, "application");
  // Editing other fields is not a new sighting of the board.
  const app = await res.json();
  await fetch(base + "/records/application/" + app.id, {
    method: "PUT",
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({ ...app, title: "Senior Engineer" }),
  });
  assert.equal((await listLeads(store))[0].seen_count, 1);
});

test("older SQLite databases gain the new platforms without losing sources", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await store.db.exec(`PRAGMA foreign_keys=OFF;
    DROP TABLE discovery_sources;
    CREATE TABLE discovery_sources(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES discovery_companies(id) ON DELETE CASCADE,platform TEXT NOT NULL CHECK(platform IN ('greenhouse','lever','ashby')),board_id TEXT NOT NULL,career_url TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 0,permission_status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK(permission_status IN ('unconfirmed','confirmed','revoked')),health TEXT NOT NULL DEFAULT 'unknown' CHECK(health IN ('unknown','healthy','degraded','failing')),last_success_at TEXT,last_attempt_at TEXT,next_fetch_at TEXT,consecutive_failures INTEGER NOT NULL DEFAULT 0,last_error_code TEXT NOT NULL DEFAULT '',listed_count INTEGER NOT NULL DEFAULT 0,UNIQUE(platform,board_id));
    PRAGMA foreign_keys=ON;
    INSERT INTO discovery_companies(id,canonical_domain,name,created_at,updated_at) VALUES('c','acme.com','Acme','x','x');
    INSERT INTO discovery_sources(id,company_id,platform,board_id) VALUES('s','c','lever','acme');`);
  await initializeDiscovery(store);
  await store.db
    .prepare(
      "INSERT INTO discovery_sources(id,company_id,platform,board_id) VALUES('w','c','workable','acme')",
    )
    .run();
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM discovery_sources").get())
      .n,
    2,
  );
  // Listings still reference the rebuilt table.
  const fk = await store.db
    .prepare(
      "SELECT \"table\" FROM pragma_foreign_key_list('discovery_listings')",
    )
    .all();
  assert.ok(fk.some((r) => r.table === "discovery_sources"));
});

test("paged boards stop at the run deadline instead of overrunning", async () => {
  let pages = 0;
  const fetcher = async () => {
    pages++;
    return respond({
      totalFound: 3000,
      content: Array.from({ length: 100 }, (_, i) => srJob(pages * 100 + i)),
    });
  };
  const slow = {
    async wait() {
      await new Promise((r) => setTimeout(r, 15));
    },
  };
  await assert.rejects(
    fetchBoard(
      { platform: "smartrecruiters", boardId: "Acme" },
      { fetcher, limiter: slow, deadline: Date.now() + 40 },
    ),
    { code: "deadline" },
  );
  assert.ok(pages < 30);
});

test("promoting another board keeps the company's recorded size", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const { upsertCompany } = await import("../../server/discovery/registry.js");
  await upsertCompany(store, {
    name: "Netflix",
    domain: "netflix.com",
    sizeMin: 10000,
    sizeMax: 20000,
    sizeSourceUrl: "https://example.com/size",
    sizeAsOf: "2026-11-01",
  });
  await promoteLead(store, {
    platform: "lever",
    boardId: "netflix",
    name: "Netflix",
    domain: "netflix.com",
  });
  const company = await store.db
    .prepare(
      "SELECT * FROM discovery_companies WHERE canonical_domain='netflix.com'",
    )
    .get();
  assert.equal(company.size_min, 10000);
  assert.equal(company.size_as_of, "2026-11-01");
});

test("backfill scans stored application links and Gmail evidence once", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await store.db
    .prepare(
      "INSERT INTO users(id,email,password,name,timezone,stages) VALUES('u','u@example.com','x','U','UTC','[]')",
    )
    .run();
  const insert = (id, kind, data) =>
    store.db
      .prepare("INSERT INTO records(id,user_id,kind,data) VALUES(?,?,?,?)")
      .run(id, "u", kind, JSON.stringify(data));
  await insert("a", "application", { url: "https://jobs.lever.co/netflix/1" });
  await insert("e", "recruiting_evidence", {
    sourceType: "gmail",
    excerpt: "Apply https://jobs.ashbyhq.com/openai/2",
  });
  await insert("m", "recruiting_evidence", {
    sourceType: "manual",
    excerpt: "https://jobs.lever.co/ignored",
  });
  assert.deepEqual(await backfillLeads(store), { scanned: 3, recorded: 2 });
  assert.deepEqual((await listLeads(store)).map((l) => l.board_id).sort(), [
    "netflix",
    "openai",
  ]);
});

test("Simplify import keeps only active listings on supported boards, once each", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const rows = [
    { active: true, url: "https://job-boards.greenhouse.io/stripe/jobs/1" },
    { active: true, url: "https://job-boards.greenhouse.io/stripe/jobs/2" },
    { active: true, is_visible: false, url: "https://jobs.lever.co/hidden/1" },
    { active: false, url: "https://jobs.lever.co/closed/1" },
    { active: true, url: "https://jobs.apple.com/en-us/details/1" },
  ];
  const fetcher = async () => ({ ok: true, json: async () => rows });
  assert.deepEqual(
    await importSimplifyLists(store, { fetcher, lists: ["x"] }),
    {
      active: 3,
      boards: 1,
      recorded: 1,
    },
  );
  const [lead] = await listLeads(store);
  assert.equal(lead.url, "https://job-boards.greenhouse.io/stripe");
  await assert.rejects(
    importSimplifyLists(store, {
      fetcher: async () => ({ ok: false, status: 404 }),
      lists: ["x"],
    }),
    /unavailable/,
  );
});

test("SmartRecruiters descriptions fill in later and survive board refreshes", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const { upsertCompany, upsertSource, setSourcePolicy } =
    await import("../../server/discovery/registry.js");
  const { ingestSource, fillMissingDescriptions } =
    await import("../../server/discovery/ingest.js");
  const companyId = await upsertCompany(store, {
    name: "Acme",
    domain: "acme.test",
  });
  const sourceId = await upsertSource(store, {
    companyId,
    platform: "smartrecruiters",
    boardId: "Acme",
  });
  await setSourcePolicy(store, sourceId, {
    permission: "confirmed",
    enabled: true,
  });
  const board = async () =>
    respond({ totalFound: 2, content: [srJob(1), srJob(2)] });
  const env = { DISCOVERY_COLLECTION_ENABLED: "true" };
  await ingestSource(store, sourceId, { fetcher: board, limiter: noWait, env });
  const calls = [];
  const detail = async (url) => {
    calls.push(url);
    if (url.endsWith("/2")) return respond({}, 404);
    return respond({
      jobAd: {
        sections: {
          companyDescription: { text: "<p>About Acme</p>" },
          jobDescription: { text: "<p>Build <b>Python</b> pipelines</p>" },
          qualifications: { text: "<ul><li>SQL</li></ul>" },
        },
      },
    });
  };
  assert.deepEqual(
    await fillMissingDescriptions(store, { fetcher: detail, limiter: noWait }),
    { candidates: 2, filled: 1 },
  );
  assert.ok(
    calls.every((u) => new URL(u).hostname === "api.smartrecruiters.com"),
  );
  const described = () =>
    store.db
      .prepare("SELECT description FROM discovery_jobs WHERE description<>''")
      .all();
  const [job] = await described();
  assert.match(job.description, /Build Python pipelines/);
  assert.match(job.description, /SQL/);
  assert.doesNotMatch(job.description, /About Acme|</);
  // A refresh whose list has no description (and a changed title) keeps it.
  const changed = async () =>
    respond({
      totalFound: 2,
      content: [{ ...srJob(1), name: "Engineer 1 (renamed)" }, srJob(2)],
    });
  await ingestSource(store, sourceId, {
    fetcher: changed,
    limiter: noWait,
    env,
    force: true,
  });
  assert.equal((await described()).length, 1);
});

test("promote-file promotes good rows, reports bad ones, and can approve", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const { promoteLeadsCsv } = await import("../../server/discovery/leads.js");
  const results = await promoteLeadsCsv(
    store,
    'platform,boardId,name,domain\ngreenhouse,stripe,"Stripe, Inc.",stripe.com\nworkday,acme,Acme,acme.com\n',
    { approve: true },
  );
  assert.deepEqual(
    results.map((r) => [r.boardId, r.ok]),
    [
      ["stripe", true],
      ["acme", false],
    ],
  );
  const source = await store.db
    .prepare(
      "SELECT enabled,permission_status FROM discovery_sources WHERE board_id='stripe'",
    )
    .get();
  assert.deepEqual(
    { ...source },
    { enabled: 1, permission_status: "confirmed" },
  );
  const company = await store.db
    .prepare(
      "SELECT name FROM discovery_companies WHERE canonical_domain='stripe.com'",
    )
    .get();
  assert.equal(company.name, "Stripe, Inc.");
});

test("collect-simplify starts boards matching approved users' target roles", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await initializeDiscovery(store);
  const { collectSimplifyBoards, profileKeywords } =
    await import("../../server/discovery/leads.js");
  const { dailySimplifyBoards } =
    await import("../../server/discovery/runner.js");
  const addUser = async (id, roles, approved) => {
    await store.db
      .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
      .run(id, `${id}@example.test`, "hash", id, "UTC", "[]");
    await store.db
      .prepare(
        "INSERT INTO discovery_profiles(user_id,facts,approved_at,updated_at) VALUES(?,?,?,?)",
      )
      .run(
        id,
        JSON.stringify({ targetRoles: roles }),
        approved,
        "2026-11-27T00:00:00Z",
      );
  };
  await addUser("a", ["Data Engineer"], "2026-11-27T00:00:00Z");
  await addUser("b", ["Backend"], "2026-11-27T00:00:00Z");
  await addUser("c", ["Designer"], ""); // not approved: ignored
  assert.deepEqual((await profileKeywords(store)).sort(), [
    "backend",
    "data engineer",
  ]);
  const rows = [
    {
      active: true,
      title: "Data Engineer, New Grad",
      company_name: "Stripe",
      url: "https://boards.greenhouse.io/stripe/jobs/1",
    },
    {
      active: true,
      title: "Data Engineer II",
      company_name: "Stripe",
      url: "https://boards.greenhouse.io/stripe/jobs/2",
    },
    {
      active: true,
      title: "Backend Engineer",
      company_name: "Ramp",
      url: "https://jobs.ashbyhq.com/ramp/abc",
    },
    {
      active: true,
      title: "Product Designer",
      company_name: "Figma",
      url: "https://boards.greenhouse.io/figma/jobs/3",
    },
    {
      active: false,
      title: "Backend Engineer",
      company_name: "Old",
      url: "https://jobs.lever.co/old/x",
    },
  ];
  let fetched = 0;
  const fetcher = async () => {
    fetched++;
    return { ok: true, status: 200, json: async () => rows };
  };
  const keywords = await profileKeywords(store);
  const first = await collectSimplifyBoards(store, {
    fetcher,
    lists: ["L"],
    keywords,
    maxNew: 1,
  });
  assert.deepEqual(first, { matched: 3, boards: 2, created: 1, existing: 0 });
  // Busiest board first; enabled and approved; no invented domain.
  const sources = () =>
    store.db
      .prepare(
        "SELECT s.board_id,s.enabled,s.permission_status,c.name,c.canonical_domain FROM discovery_sources s JOIN discovery_companies c ON c.id=s.company_id ORDER BY s.board_id",
      )
      .all();
  assert.deepEqual(
    (await sources()).map((r) => ({ ...r })),
    [
      {
        board_id: "stripe",
        enabled: 1,
        permission_status: "confirmed",
        name: "Stripe",
        canonical_domain: "board:greenhouse:stripe",
      },
    ],
  );
  const second = await collectSimplifyBoards(store, {
    fetcher,
    lists: ["L"],
    keywords,
  });
  assert.deepEqual(second, { matched: 3, boards: 2, created: 1, existing: 1 });
  assert.deepEqual(
    (await sources()).map((r) => r.board_id),
    ["ramp", "stripe"],
  );
  const { coverage: summary } =
    await import("../../server/discovery/registry.js");
  const shown = (await summary(store, "a")).companies.map((c) => c.domain);
  assert.ok(
    shown.every((d) => d === ""),
    "board keys never shown as domains",
  );
  // Daily run: off by default, then at most once a day.
  const now = Date.parse("2026-11-27T12:00:00Z");
  assert.equal(
    await dailySimplifyBoards(store, { now, env: {}, fetcher }),
    undefined,
  );
  fetched = 0;
  const env = { DISCOVERY_SIMPLIFY_AUTO: "true" };
  assert.ok(await dailySimplifyBoards(store, { now, env, fetcher }));
  assert.equal(
    await dailySimplifyBoards(store, { now: now + 3600e3, env, fetcher }),
    undefined,
  );
  assert.equal(fetched, 2); // two default lists, fetched once
});
