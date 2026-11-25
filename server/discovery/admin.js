// Operator CLI for the shared registry. Never run against production without
// recorded source permission (reference/phase0/access-decision.md).
//   node server/discovery/admin.js add-company <name> <domain> [sizeMin sizeMax sourceUrl asOf]
//   node server/discovery/admin.js add-source <domain> <platform> <boardId>
//     platform: greenhouse | lever | ashby | smartrecruiters | workable
//   node server/discovery/admin.js leads                      (pending review queue)
//   node server/discovery/admin.js promote <platform> <boardId> <name> <domain>
//   node server/discovery/admin.js reject <platform> <boardId>
//   node server/discovery/admin.js backfill-leads   (one-time scan of stored links)
//   node server/discovery/admin.js import-simplify  (board leads from Simplify's public lists)
//   node server/discovery/admin.js approve <platform> <boardId>   (records permission + enables)
//   node server/discovery/admin.js run         (needs DISCOVERY_COLLECTION_ENABLED=true)
import { resolve } from "node:path";
import { createStore } from "../store.js";
import { upsertCompany, upsertSource, setSourcePolicy } from "./registry.js";
import { ingestDue, collectionEnabled } from "./ingest.js";
import { createHttpFetcher, createRateLimiter } from "./connectors.js";
import { processAlerts } from "./alerts.js";
import { processDigests } from "./digests.js";
import { canonicalDomain } from "./normalize.js";
import {
  listLeads,
  promoteLead,
  rejectLead,
  backfillLeads,
  importSimplifyLists,
} from "./leads.js";
const [command, ...args] = process.argv.slice(2);
const path =
  process.env.DATABASE_URL ||
  resolve(process.env.DATABASE_PATH || "data/offerly.sqlite");
const store = await createStore(path);
try {
  if (command === "add-company") {
    const [name, domain, min, max, sizeSourceUrl, sizeAsOf] = args;
    const id = await upsertCompany(store, {
      name,
      domain,
      sizeMin: min ? Number(min) : null,
      sizeMax: max ? Number(max) : null,
      sizeSourceUrl: sizeSourceUrl || "",
      sizeAsOf: sizeAsOf || "",
    });
    console.log(id);
  } else if (command === "add-source") {
    const [domain, platform, boardId] = args;
    const company = await store.db
      .prepare("SELECT id FROM discovery_companies WHERE canonical_domain=?")
      .get(canonicalDomain(domain));
    if (!company) throw new Error("Add the company first");
    console.log(
      await upsertSource(store, { companyId: company.id, platform, boardId }),
    );
  } else if (command === "leads") {
    for (const l of await listLeads(store))
      console.log(
        [l.platform, l.board_id, l.url, l.origin, `seen ${l.seen_count}x`].join(
          "\t",
        ),
      );
  } else if (command === "promote") {
    const [platform, boardId, name, domain] = args;
    console.log(await promoteLead(store, { platform, boardId, name, domain }));
  } else if (command === "import-simplify") {
    console.log(JSON.stringify(await importSimplifyLists(store)));
  } else if (command === "backfill-leads") {
    console.log(JSON.stringify(await backfillLeads(store)));
  } else if (command === "reject") {
    const [platform, boardId] = args;
    await rejectLead(store, platform, boardId);
    console.log("rejected");
  } else if (command === "approve") {
    const [platform, boardId] = args;
    const source = await store.db
      .prepare(
        "SELECT id FROM discovery_sources WHERE platform=? AND board_id=?",
      )
      .get(platform, boardId);
    if (!source) throw new Error("Unknown source");
    await setSourcePolicy(store, source.id, {
      permission: "confirmed",
      enabled: true,
    });
    console.log("approved", source.id);
  } else if (command === "run") {
    if (!collectionEnabled())
      throw new Error("Set DISCOVERY_COLLECTION_ENABLED=true to collect");
    const results = await ingestDue(store, {
      fetcher: createHttpFetcher(),
      limiter: createRateLimiter({ minIntervalMs: 2000 }),
    });
    console.log(JSON.stringify(results));
    console.log(JSON.stringify(await processAlerts(store)));
    console.log(JSON.stringify(await processDigests(store)));
  } else {
    console.error("Unknown command");
    process.exitCode = 1;
  }
} finally {
  await store.db.close();
}
