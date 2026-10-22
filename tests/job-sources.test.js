import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFeed,
  probeSource,
  sourceUrl,
} from "../server/integrations/job-sources.js";
const checked = "2026-10-22T10:00:00.000Z";
const gh = {
  id: 1,
  title: "Engineer",
  absolute_url: "https://example.com/jobs/1",
  updated_at: "2026-10-21T10:00:00Z",
};
test("only fixed board identifiers can cause network requests", async () => {
  for (const board of [
    "../../metadata",
    "stripe?x=1",
    "unknown",
    "https://localhost",
  ]) {
    assert.throws(() => sourceUrl("greenhouse", board), /Unsupported/);
  }
  let calls = 0;
  await assert.rejects(
    probeSource("lever", "unknown", {
      fetchImpl: () => {
        calls++;
      },
    }),
    /Unsupported/,
  );
  assert.equal(calls, 0);
});
test("update and last-publication dates never become original posting dates", () => {
  const a = normalizeFeed(
    "greenhouse",
    "stripe",
    { jobs: [gh], meta: { total: 1 } },
    checked,
  ).jobs[0];
  assert.equal(a.employer_posted_at, null);
  assert.equal(a.provider_updated_at, "2026-10-21T10:00:00.000Z");
  assert.equal(a.first_discovered_at, checked);
  assert.equal(a.last_changed_at, null);
  const b = normalizeFeed(
    "ashby",
    "linear",
    {
      apiVersion: "1",
      jobs: [
        {
          title: "Engineer",
          jobUrl: "https://jobs.ashbyhq.com/linear/1",
          isListed: true,
          publishedAt: "2026-10-21T10:00:00Z",
        },
      ],
    },
    checked,
  ).jobs[0];
  assert.equal(b.employer_posted_at, null);
  assert.equal(b.provider_last_published_at, "2026-10-21T10:00:00.000Z");
});
test("partial, duplicate, invalid and unlisted feeds cannot authorize closure", () => {
  assert.throws(
    () =>
      normalizeFeed("greenhouse", "stripe", { jobs: [gh], meta: { total: 2 } }),
    /Incomplete/,
  );
  assert.throws(
    () => normalizeFeed("lever", "palantir", { jobs: [] }),
    /envelope/,
  );
  const result = normalizeFeed("greenhouse", "stripe", {
    jobs: [gh, gh, null, { ...gh, id: 2, absolute_url: "javascript:alert(1)" }],
    meta: { total: 4 },
  });
  assert.equal(result.rejected, 3);
  assert.equal(result.complete, false);
  assert.equal(result.closure_safe, false);
  const hidden = normalizeFeed("ashby", "linear", {
    apiVersion: "1",
    jobs: [{ isListed: false }],
  });
  assert.equal(hidden.unlisted, 1);
  assert.equal(hidden.jobs.length, 0);
});
test("invalid source dates remain unknown", () => {
  for (const value of [
    "yesterday",
    "2026-02-30T10:00:00Z",
    "2026-02-30T10:00:00+05:00",
    "2026-10-21",
    null,
  ]) {
    const result = normalizeFeed("greenhouse", "stripe", {
      jobs: [{ ...gh, updated_at: value }],
      meta: { total: 1 },
    });
    assert.equal(result.jobs[0].provider_updated_at, null);
  }
});
test("bounded fetch uses GET and rejects redirects, large, malformed, non-JSON responses", async () => {
  let options;
  const response =
    (body, headers = { "content-type": "application/json" }) =>
    async (_url, opts) => {
      options = opts;
      return new Response(body, { headers });
    };
  const good = await probeSource("lever", "palantir", {
    fetchImpl: response("[]"),
    now: () => checked,
  });
  assert.equal(good.complete, true);
  assert.equal(options.method, "GET");
  assert.equal(options.redirect, "error");
  for (const fetchImpl of [
    response("{}"),
    response("bad"),
    response("[]", { "content-type": "text/html" }),
    response("[]", {
      "content-type": "application/json",
      "content-length": "999999999",
    }),
    async () => new Response("", { status: 429 }),
  ]) {
    await assert.rejects(probeSource("lever", "palantir", { fetchImpl }));
  }
});
test("descriptions available only on explicit memory-only request", () => {
  const payload = {
    jobs: [{ ...gh, content: "&lt;p&gt;Backend role&lt;/p&gt;" }],
    meta: { total: 1 },
  };
  assert.equal(
    normalizeFeed("greenhouse", "stripe", payload).jobs[0].description,
    undefined,
  );
  assert.equal(
    normalizeFeed("greenhouse", "stripe", payload, checked, {
      includeDescriptions: true,
    }).jobs[0].description_format,
    "html-entities",
  );
  assert.match(
    sourceUrl("greenhouse", "stripe", { includeDescriptions: true }),
    /content=true$/,
  );
  const invalid = normalizeFeed("greenhouse", "stripe", {
    jobs: [{ ...gh, id: {} }],
    meta: { total: 1 },
  });
  assert.equal(invalid.rejected, 1);
});
