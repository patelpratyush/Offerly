// Board leads: job-board links seen in the user's own applications and Gmail
// evidence. A lead is only a suggestion for the operator review queue; nothing is
// collected until it is promoted to a source and its permission is confirmed.
// Only the canonical board URL is stored, never the raw link (it may carry
// candidate tokens), and no user id is kept with the lead.
import { upsertCompany, upsertSource } from "./registry.js";
import { PLATFORMS } from "./connectors.js";
import { canonicalDomain } from "./normalize.js";

const BOARD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HOSTS = {
  "boards.greenhouse.io": "greenhouse",
  "job-boards.greenhouse.io": "greenhouse",
  "jobs.lever.co": "lever",
  "jobs.ashbyhq.com": "ashby",
  "jobs.smartrecruiters.com": "smartrecruiters",
  "careers.smartrecruiters.com": "smartrecruiters",
  "apply.workable.com": "workable",
};
const BOARD_URL = {
  greenhouse: (id) => `https://job-boards.greenhouse.io/${id}`,
  lever: (id) => `https://jobs.lever.co/${id}`,
  ashby: (id) => `https://jobs.ashbyhq.com/${id}`,
  smartrecruiters: (id) => `https://jobs.smartrecruiters.com/${id}`,
  workable: (id) => `https://apply.workable.com/${id}`,
};
// Path segments that are product routes, not employer boards.
const RESERVED = new Set(["embed", "j", "api", "v1", "jobs", "oneclick-ui"]);

export function detectBoards(text) {
  const found = new Map();
  const urls = String(text || "").match(/https?:\/\/[^\s<>"'()[\]]+/gi) || [];
  for (const raw of urls.slice(0, 50)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const platform = HOSTS[url.hostname.toLowerCase()];
    if (!platform) continue;
    const boardId =
      url.searchParams.get("for") || url.pathname.split("/").filter(Boolean)[0];
    if (
      !boardId ||
      RESERVED.has(boardId.toLowerCase()) ||
      !BOARD_ID.test(boardId)
    )
      continue;
    found.set(`${platform}:${boardId}`, { platform, boardId });
  }
  return [...found.values()];
}

/** Best effort: a missing table or write failure never breaks the caller. */
export async function recordLeads(store, text, origin, now = Date.now()) {
  const at = new Date(now).toISOString();
  let recorded = 0;
  for (const { platform, boardId } of detectBoards(text)) {
    try {
      await store.db
        .prepare(
          "INSERT INTO discovery_leads(platform,board_id,url,origin,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?) ON CONFLICT(platform,board_id) DO UPDATE SET seen_count=discovery_leads.seen_count+1,last_seen_at=excluded.last_seen_at",
        )
        .run(platform, boardId, BOARD_URL[platform](boardId), origin, at, at);
      recorded++;
    } catch {
      console.error(JSON.stringify({ event: "discovery_lead_failed" }));
      return recorded;
    }
  }
  return recorded;
}

/** Pending leads that are not already a registered source, most seen first. */
export async function listLeads(store) {
  return store.db
    .prepare(
      "SELECT l.* FROM discovery_leads l LEFT JOIN discovery_sources s ON s.platform=l.platform AND s.board_id=l.board_id WHERE l.status='pending' AND s.id IS NULL ORDER BY l.seen_count DESC,l.last_seen_at DESC LIMIT 200",
    )
    .all();
}

/** Operator decision: register the employer and its board (still disabled). */
export async function promoteLead(store, { platform, boardId, name, domain }) {
  if (!PLATFORMS.includes(platform)) throw new Error("Unknown platform");
  // Reuse an existing company so its recorded size evidence is not overwritten.
  const existing = await store.db
    .prepare("SELECT id FROM discovery_companies WHERE canonical_domain=?")
    .get(canonicalDomain(domain) || "");
  const companyId =
    existing?.id || (await upsertCompany(store, { name, domain }));
  const sourceId = await upsertSource(store, {
    companyId,
    platform,
    boardId,
    careerUrl: BOARD_URL[platform](boardId),
  });
  await store.db
    .prepare(
      "UPDATE discovery_leads SET status='promoted' WHERE platform=? AND board_id=?",
    )
    .run(platform, boardId);
  return sourceId;
}

export async function rejectLead(store, platform, boardId) {
  await store.db
    .prepare(
      "UPDATE discovery_leads SET status='rejected' WHERE platform=? AND board_id=?",
    )
    .run(platform, boardId);
}

/** One-time catch-up: scan links already stored before lead recording existed. */
export async function backfillLeads(store) {
  const rows = await store.db
    .prepare(
      "SELECT kind,data FROM records WHERE kind IN ('application','recruiting_evidence')",
    )
    .all();
  let recorded = 0;
  for (const row of rows) {
    const data = JSON.parse(row.data);
    recorded +=
      row.kind === "application"
        ? await recordLeads(store, data.url, "application")
        : data.sourceType === "gmail"
          ? await recordLeads(store, data.excerpt, "gmail")
          : 0;
  }
  return { scanned: rows.length, recorded };
}
