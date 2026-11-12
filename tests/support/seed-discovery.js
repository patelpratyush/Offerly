// Test-only catalog seed for browser specs. Uses the real connectors and
// ingestion with an in-process fixture fetcher: no network, and the seeded
// database is the throwaway temp file created by tests/support/serve.js.
import { createStore } from "../../server/store.js";
import {
  upsertCompany,
  upsertSource,
  setSourcePolicy,
} from "../../server/discovery/registry.js";
import { ingestSource } from "../../server/discovery/ingest.js";
import { createRateLimiter } from "../../server/discovery/connectors.js";

export async function seedDiscovery(path) {
  const store = await createStore(path);
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 3600e3).toISOString();
  const daysAgoDate = (d) =>
    new Date(now - d * 864e5).toISOString().slice(0, 10);
  const bodies = {
    "acme-gh": {
      jobs: [
        {
          id: 1,
          title: "Senior Backend Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          location: { name: "New York, NY" },
          requisition_id: "REQ-100",
          first_published: hoursAgo(2),
          content:
            "&lt;p&gt;Payments platform.&lt;/p&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;p&gt;Python and PostgreSQL.&lt;/p&gt;",
        },
        {
          id: 2,
          title: "Data Analyst",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
          location: { name: "New York, NY" },
          requisition_id: "REQ-200",
          first_published: daysAgoDate(14),
          content: "&lt;p&gt;SQL and Excel reporting.&lt;/p&gt;",
        },
      ],
    },
    "acme-lv": [
      {
        id: "lv-1",
        text: "Senior Backend Engineer",
        hostedUrl: "https://jobs.lever.co/acme/lv-1",
        createdAt: now - 2 * 3600e3,
        categories: { location: "New York, NY" },
        descriptionPlain: "Payments platform. Python.",
      },
    ],
    "globex-ab": {
      jobs: [
        {
          id: "ab-1",
          title: "Platform Engineer",
          location: "Remote",
          isRemote: true,
          workplaceType: "Remote",
          isListed: true,
          publishedAt: hoursAgo(30),
          jobUrl: "https://jobs.ashbyhq.com/globex/ab-1",
          descriptionPlain: "Kubernetes and Terraform.",
        },
      ],
    },
  };
  const fetcher = async (url) => {
    const key = url.includes("greenhouse")
      ? "acme-gh"
      : url.includes("lever")
        ? "acme-lv"
        : "globex-ab";
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => JSON.stringify(bodies[key]),
    };
  };
  const acme = await upsertCompany(store, {
    name: "Acme",
    domain: "acme.example",
    sizeMin: 150,
    sizeMax: 500,
    sizeSourceUrl: "https://example.test/acme-size",
    sizeAsOf: "2026-10-01",
  });
  const globex = await upsertCompany(store, {
    name: "Globex",
    domain: "globex.example",
  });
  for (const [companyId, platform, boardId] of [
    [acme, "greenhouse", "acme"],
    [acme, "lever", "acme"],
    [globex, "ashby", "globex"],
  ]) {
    const id = await upsertSource(store, { companyId, platform, boardId });
    await setSourcePolicy(store, id, {
      permission: "confirmed",
      enabled: true,
    });
    const result = await ingestSource(store, id, {
      fetcher,
      limiter: createRateLimiter({ minIntervalMs: 0 }),
      now,
      env: { DISCOVERY_COLLECTION_ENABLED: "true" },
    });
    if (result.outcome !== "success") throw new Error("Seed failed");
  }
  await store.db.close();
}
