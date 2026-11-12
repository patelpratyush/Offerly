// Robustness tests for the deterministic discovery scorer, eligibility checks,
// size categories, recency windows and duplicate grouping. These are regression
// tests for edge cases; they do not validate that the rubric ranks jobs the way
// people would (see reference/phase1-discovery/ for the evaluation harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreJob, jobLevel } from "../../server/discovery/scoring.js";
import { checkEligibility } from "../../server/discovery/eligibility.js";
import { classifySize, sizeMatches } from "../../server/discovery/size.js";
import { inWindow } from "../../server/discovery/feed.js";
import { groupKey, normRequisition } from "../../server/discovery/normalize.js";

const profile = (over = {}) => ({
  facts: {
    targetRoles: ["Backend Engineer"],
    seniority: "senior",
    yearsExperience: 6,
    skills: [
      { name: "Python", approved: true },
      { name: "PostgreSQL", approved: true },
      { name: "Rust", approved: false },
    ],
    experienceTerms: ["payments"],
    ...(over.facts || {}),
  },
  eligibility: {
    workAuthorization: { US: "yes" },
    needsSponsorship: "no",
    usCitizen: "unknown",
    securityClearance: "unknown",
    graduationYear: null,
    ...(over.eligibility || {}),
  },
  preferences: {
    locations: [],
    arrangements: [],
    salaryMin: null,
    salaryCurrency: "",
    salaryBasis: "Base",
    ...(over.preferences || {}),
  },
  approved: true,
});
const job = (over = {}) => ({
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
const part = (fit, key) => fit.components.find((c) => c.key === key);

test("unsupported skills never raise the score, however they are phrased", () => {
  const description =
    "Requirements\nPython and PostgreSQL.\nNice to have\nKubernetes";
  const base = scoreJob(job({ description }), profile()).score;
  const stuffed = scoreJob(
    job({ description: description + "\nRust Rust Rust rust" }),
    profile(),
  ).score;
  assert.ok(stuffed <= base, "unapproved listed skill cannot add points");
  const extra = profile({
    facts: {
      skills: [
        { name: "Python", approved: true },
        { name: "PostgreSQL", approved: true },
        { name: "Haskell", approved: true },
        { name: "Kubernetes ", approved: false },
      ],
    },
  });
  assert.equal(scoreJob(job({ description }), extra).score, base);
  const nothing = scoreJob(
    job({ description: "Requirements\nGo-getter attitude and Kafka." }),
    profile(),
  );
  assert.equal(part(nothing, "requiredSkills").score, 0);
  const kafkaOnly = job({ description: "Requirements\nKafka." });
  const unapproved = scoreJob(
    kafkaOnly,
    profile({ facts: { skills: [{ name: "Kafka", approved: false }] } }),
  );
  const approved = scoreJob(
    kafkaOnly,
    profile({ facts: { skills: [{ name: "Kafka", approved: true }] } }),
  );
  assert.equal(part(unapproved, "requiredSkills").score, 0);
  assert.equal(part(approved, "requiredSkills").score, 1);
});

test("ordinary words are not mistaken for skills", () => {
  const description =
    "Requirements\nYou will excel in a swift, fast-paced spring release cycle and sketch out ideas. Python.";
  const fit = scoreJob(job({ description }), profile());
  const names = part(fit, "requiredSkills");
  assert.equal(names.score, 1, "only Python counts as a required skill");
  assert.equal(names.gaps.length, 0);
  const real = scoreJob(
    job({ description: "Requirements\nExcel, Swift and Python." }),
    profile(),
  );
  assert.equal(part(real, "requiredSkills").gaps.length, 2);
  const alias = scoreJob(
    job({ description: "Requirements\nPostgres and Python." }),
    profile(),
  );
  assert.equal(part(alias, "requiredSkills").score, 1);
});

test("a bonus or compensation sentence does not turn requirements into preferences", () => {
  const description =
    "Requirements\nPython and PostgreSQL.\nThis role is eligible for a performance bonus.\nKafka experience.";
  const fit = scoreJob(job({ description }), profile());
  assert.match(
    part(fit, "requiredSkills").gaps.join(" "),
    /kafka/i,
    "Kafka stays required",
  );
  const pref = scoreJob(
    job({
      description:
        "Requirements\nPython.\nPreferred qualifications\nKafka\nPostgreSQL",
    }),
    profile(),
  );
  assert.equal(part(pref, "requiredSkills").score, 1);
  assert.equal(part(pref, "preferredSkills").score, 0.5);
});

test("target role words must match whole words, not fragments", () => {
  const javaDev = profile({ facts: { targetRoles: ["Java Developer"] } });
  const wrong = scoreJob(
    job({ title: "JavaScript Developer", description: "Requirements\nReact." }),
    javaDev,
  );
  assert.match(
    part(wrong, "experience").gaps.join(" "),
    /does not match your approved target roles/,
  );
  const right = scoreJob(
    job({ title: "Java Developers", description: "Requirements\nJava." }),
    javaDev,
  );
  assert.match(part(right, "experience").evidence.join(" "), /target role/);
});

test("years-of-experience ranges use the lower bound; fewer years only lowers fit", () => {
  const ranged = scoreJob(
    job({ description: "Requirements\n5-7 years of Python experience." }),
    profile({ facts: { yearsExperience: 5 } }),
  );
  assert.ok(
    !part(ranged, "experience").gaps.some((g) => /years/.test(g)),
    "5 years satisfies a 5-7 year requirement",
  );
  const short = scoreJob(
    job({ description: "Requirements\n8+ years of Python." }),
    profile({ facts: { yearsExperience: 2 } }),
  );
  assert.ok(part(short, "experience").gaps.some((g) => /8\+ years/.test(g)));
  const longer = scoreJob(
    job({ description: "Requirements\n2+ years of Python." }),
    profile({ facts: { yearsExperience: 20 } }),
  );
  assert.ok(!part(longer, "experience").gaps.some((g) => /years/.test(g)));
});

test("missing salary is unknown; base and total pay are never interchanged", () => {
  const prefs = {
    preferences: {
      salaryMin: 150000,
      salaryCurrency: "USD",
      salaryBasis: "Base",
    },
  };
  const description = "Requirements\nPython.";
  const pay = (over) =>
    part(
      scoreJob(
        job({
          description,
          comp_min: 160000,
          comp_max: 200000,
          comp_currency: "USD",
          comp_period: "Year",
          ...over,
        }),
        profile(prefs),
      ),
      "preferences",
    );
  assert.equal(pay({ comp_basis: "Base" }).score, 1);
  assert.equal(
    pay({ comp_basis: "Base", comp_max: 100000, comp_min: 90000 }).score,
    0,
  );
  for (const comp_basis of ["Total", "Unknown"]) {
    const p = pay({ comp_basis });
    assert.equal(p.score, null, `${comp_basis} pay is not compared to base`);
    assert.match(p.unknowns.join(" "), /not compared|not stated/);
  }
  const total = part(
    scoreJob(
      job({
        description,
        comp_min: 160000,
        comp_max: 200000,
        comp_currency: "USD",
        comp_period: "Year",
        comp_basis: "Base",
      }),
      profile({ preferences: { ...prefs.preferences, salaryBasis: "Total" } }),
    ),
    "preferences",
  );
  assert.equal(total.score, null);
  assert.equal(pay({ comp_basis: "Base", comp_currency: "EUR" }).score, null);
  assert.equal(pay({ comp_basis: "Base", comp_currency: "" }).score, null);
  assert.equal(pay({ comp_basis: "Base", comp_period: "Hour" }).score, null);
  const none = part(
    scoreJob(job({ description }), profile(prefs)),
    "preferences",
  );
  assert.equal(none.score, null);
  assert.match(none.unknowns.join(" "), /not stated/);
});

test("location preferences match whole words and do not trust loose remote roles", () => {
  const loc = (location, locations, work_arrangement = "Unknown") =>
    part(
      scoreJob(
        job({
          location,
          work_arrangement,
          description: "Requirements\nPython.",
        }),
        profile({ preferences: { locations } }),
      ),
      "preferences",
    );
  assert.equal(loc("Moscow, Russia", ["US"]).score, 0);
  assert.equal(loc("Scranton, PA", ["CA"]).score, 0);
  assert.equal(loc("Austin, TX, US", ["US"]).score, 1);
  assert.equal(loc("New York, NY", ["new york"]).score, 1);
  assert.equal(loc("Remote", ["Berlin"], "Remote").score, 1);
  assert.equal(loc("Remote - Canada", ["Berlin"], "Remote").score, null);
});

test("seniority titles resolve conservatively and unknown stays unknown", () => {
  assert.equal(jobLevel("Software Engineer"), null);
  assert.equal(jobLevel("Sr. Software Engineer"), "senior");
  assert.equal(jobLevel("Senior Engineering Manager"), "manager");
  assert.equal(jobLevel("International Sales Rep"), null);
  const fit = scoreJob(
    job({ title: "Software Engineer", description: "Requirements\nPython." }),
    profile(),
  );
  assert.equal(part(fit, "seniority").score, null);
});

test("size boundaries: 199/200, 999/1000 and the 150-500 range", () => {
  const cat = (a, b = a) => {
    const s = classifySize(a, b);
    return s.ambiguous ? `ambiguous:${s.categories.join("+")}` : s.category;
  };
  assert.equal(cat(199), "Small");
  assert.equal(cat(200), "Mid");
  assert.equal(cat(999), "Mid");
  assert.equal(cat(1000), "Large");
  assert.equal(cat(199, 200), "ambiguous:Small+Mid");
  assert.equal(cat(999, 1000), "ambiguous:Mid+Large");
  assert.equal(cat(150, 500), "ambiguous:Small+Mid");
  assert.equal(cat(200, 999), "Mid");
  assert.equal(cat(1, 199), "Small");
  assert.equal(cat(1, 1000), "ambiguous:Small+Mid+Large");
  assert.equal(cat(1000, 5000), "Large");
  assert.equal(cat(500, 200), "Unknown");
  assert.equal(cat(0), "Unknown");
  assert.equal(cat(199.5), "Unknown");
  assert.equal(cat(NaN), "Unknown");
  const range = classifySize(150, 500);
  assert.equal(sizeMatches(range, { sizes: ["Mid"] }), false);
  assert.equal(
    sizeMatches(range, { sizes: ["Mid"], includeUncertain: true }),
    true,
  );
  assert.equal(sizeMatches(range, {}), true);
});

const posted = (employer_posted_at, posted_precision = "datetime") => ({
  employer_posted_at,
  posted_precision,
  first_discovered_at: null,
});
const NOW = Date.parse("2026-11-11T15:00:00Z");

test("recency windows: edges, date-only postings, future and unknown dates", () => {
  const win = (window, extra = {}) => ({ window, from: "", to: "", ...extra });
  const ago = (h) => new Date(NOW - h * 3600e3).toISOString();
  const yes = (job, w, basis = "posted") => inWindow(job, w, basis, NOW);
  assert.equal(yes(posted(ago(24)), win("24h")), true, "exactly 24h is inside");
  assert.equal(yes(posted(ago(24.01)), win("24h")), false);
  assert.equal(yes(posted(ago(0)), win("24h")), true);
  assert.equal(yes(posted(ago(-1)), win("24h")), false, "future is not recent");
  assert.equal(yes(posted("2026-11-04", "date"), win("7d")), true);
  assert.equal(yes(posted("2026-11-03", "date"), win("7d")), false);
  assert.equal(yes(posted("2026-11-11", "date"), win("24h")), true);
  assert.equal(yes(posted("2026-11-12", "date"), win("24h")), false);
  assert.equal(yes(posted(null, "unknown"), win("30d")), false);
  assert.equal(yes(posted("2026-11-10", "unknown"), win("30d")), false);
  assert.equal(yes(posted(null, "unknown"), win("")), true);
  const day = (from, to) => win("custom", { from, to });
  const one = day("2026-11-01", "2026-11-01");
  assert.equal(yes(posted("2026-11-01T23:59:59Z"), one), true);
  assert.equal(yes(posted("2026-11-02T00:00:00Z"), one), false);
  assert.equal(yes(posted("2026-10-31T23:59:59Z"), one), false);
  assert.equal(
    yes(posted("2026-11-05", "date"), day("2026-11-06", "2026-11-01")),
    false,
  );
  assert.equal(yes(posted("2026-11-05", "date"), day("", "2026-11-05")), true);
  assert.equal(yes(posted("2026-11-05", "date"), day("2026-11-05", "")), true);
});

test("old-posted jobs discovered today are new to the feed but not latest", () => {
  const old = {
    employer_posted_at: "2026-09-01",
    posted_precision: "date",
    first_discovered_at: new Date(NOW - 3600e3).toISOString(),
  };
  const win = { window: "24h", from: "", to: "" };
  assert.equal(inWindow(old, win, "discovered", NOW), true);
  assert.equal(inWindow(old, win, "posted", NOW), false);
  const fresh = {
    employer_posted_at: new Date(NOW - 3600e3).toISOString(),
    posted_precision: "datetime",
    first_discovered_at: new Date(NOW - 20 * 864e5).toISOString(),
  };
  assert.equal(inWindow(fresh, win, "posted", NOW), true);
  assert.equal(inWindow(fresh, win, "discovered", NOW), false);
  assert.equal(
    inWindow({ ...old, first_discovered_at: null }, win, "discovered", NOW),
    false,
  );
});

test("requisition grouping: same requisition groups, distinct or placeholder ones do not", () => {
  const key = (requisition, title = "Data Analyst", location = "NYC") =>
    groupKey("c1", { requisition, title, location });
  assert.equal(key("REQ-100"), key("req 100"));
  assert.notEqual(key("REQ-100"), key("REQ-101"));
  assert.equal(key("", "Data Analyst"), key("", "data  analyst"));
  assert.notEqual(key("", "Data Analyst"), key("REQ-1", "Data Analyst"));
  for (const placeholder of [
    "N/A",
    "none",
    "TBD",
    "-",
    "0",
    "null",
    "unknown",
    "---",
  ])
    assert.equal(
      normRequisition(placeholder),
      "",
      `placeholder ${placeholder}`,
    );
  assert.equal(normRequisition("A-0"), "a0");
  assert.notEqual(
    key("N/A", "Designer", "Austin"),
    key("N/A", "Engineer", "Austin"),
  );
});

test("eligibility catches common phrasings of work-authorization and sponsorship limits", () => {
  const check = (text, eligibility) =>
    checkEligibility(job({ description: text }), profile({ eligibility }));
  const by = (e, name) => e.checks.find((c) => c.check === name);
  for (const text of [
    "Applicants must be authorized to work in the US.",
    "You must be legally authorized to work in the U.S.",
    "Must be eligible to work in the United States.",
  ]) {
    const e = check(text, { workAuthorization: { US: "no" } });
    assert.equal(by(e, "work_authorization")?.status, "does_not_meet", text);
  }
  const unknown = check("Authorized to work in the US required.", {
    workAuthorization: {},
  });
  assert.equal(by(unknown, "work_authorization").status, "needs_verification");
  for (const text of [
    "Visa sponsorship is not available for this role.",
    "We are not able to sponsor work visas.",
    "Candidates must not require sponsorship.",
    "Sponsorship is unavailable.",
    "We do not sponsor visas.",
    "Unable to provide visa sponsorship.",
    "No visa sponsorship.",
  ]) {
    const e = check(text, { needsSponsorship: "yes" });
    assert.equal(by(e, "sponsorship")?.status, "does_not_meet", text);
  }
  assert.equal(
    by(
      check("We will sponsor visas for the right candidate.", {
        needsSponsorship: "yes",
      }),
      "sponsorship",
    ),
    undefined,
  );
  const grad = (years, given) =>
    by(
      check(`Open to students graduating ${years}.`, { graduationYear: given }),
      "graduation",
    )?.status;
  assert.equal(grad("between 2026 and 2027", 2027), "meets");
  assert.equal(grad("between 2026 and 2027", 2026), "meets");
  assert.equal(grad("between 2026 and 2027", 2028), "does_not_meet");
  assert.equal(grad("in 2026", 2026), "meets");
  assert.equal(grad("in 2026", 2027), "does_not_meet");
  assert.equal(grad("in 2026", null), "needs_verification");
});

test("Ashby isRemote (true for Remote or Hybrid) never overrides workplaceType", async () => {
  const { fetchBoard, createRateLimiter } =
    await import("../../server/discovery/connectors.js");
  const item = (id, extra) => ({
    id,
    title: "Engineer " + id,
    jobUrl: "https://jobs.ashbyhq.com/x/" + id,
    isListed: true,
    ...extra,
  });
  const body = JSON.stringify({
    jobs: [
      item("h", { isRemote: true, workplaceType: "Hybrid" }),
      item("r", { isRemote: true, workplaceType: "Remote" }),
      item("o", { isRemote: false, workplaceType: "OnSite" }),
      item("u", { isRemote: true }),
    ],
  });
  const fetcher = async () => ({
    status: 200,
    headers: new Headers(),
    text: async () => body,
  });
  const { listings } = await fetchBoard(
    { platform: "ashby", boardId: "x" },
    { fetcher, limiter: createRateLimiter({ minIntervalMs: 0 }) },
  );
  const arr = Object.fromEntries(
    listings.map((l) => [l.externalId, l.workArrangement]),
  );
  assert.deepEqual(arr, {
    h: "Hybrid",
    r: "Remote",
    o: "On-site",
    u: "Unknown",
  });
});
