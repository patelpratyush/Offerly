// Operator-managed company and source registry. Users can read coverage but
// never write to the shared catalog, so one account cannot poison another's feed.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../security.js";
import { canonicalDomain } from "./normalize.js";
import { describeSize } from "./size.js";
const iso = () => new Date().toISOString();
const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(3).max(253),
  entityLabel: z.enum(["employer", "subsidiary", "parent"]).default("employer"),
  entityName: z.string().trim().max(200).default(""),
  sizeMin: z.number().int().min(1).max(10000000).nullable().default(null),
  sizeMax: z.number().int().min(1).max(10000000).nullable().default(null),
  sizeSourceUrl: z.union([z.literal(""), z.url()]).default(""),
  sizeAsOf: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
    .default(""),
});
const sourceSchema = z.object({
  companyId: z.string().min(1),
  platform: z.enum(["greenhouse", "lever", "ashby"]),
  boardId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
  careerUrl: z.union([z.literal(""), z.url()]).default(""),
});
export async function upsertCompany(store, input) {
  const v = companySchema.parse(input);
  const domain = canonicalDomain(v.domain);
  if (!domain) throw new HttpError(400, "A valid company domain is required");
  if (v.sizeMin && v.sizeMax && v.sizeMin > v.sizeMax)
    throw new HttpError(400, "Size range is inverted");
  // A size estimate without a citation and date is a guess; refuse to store it.
  if ((v.sizeMin || v.sizeMax) && (!v.sizeSourceUrl || !v.sizeAsOf))
    throw new HttpError(400, "Company size needs a source URL and as-of date");
  const now = iso();
  const existing = await store.db
    .prepare("SELECT id FROM discovery_companies WHERE canonical_domain=?")
    .get(domain);
  if (existing) {
    await store.db
      .prepare(
        "UPDATE discovery_companies SET name=?,entity_label=?,entity_name=?,size_min=?,size_max=?,size_source_url=?,size_as_of=?,updated_at=? WHERE id=?",
      )
      .run(
        v.name,
        v.entityLabel,
        v.entityName,
        v.sizeMin,
        v.sizeMax,
        v.sizeSourceUrl,
        v.sizeAsOf,
        now,
        existing.id,
      );
    return existing.id;
  }
  const id = randomUUID();
  await store.db
    .prepare(
      "INSERT INTO discovery_companies(id,canonical_domain,name,entity_label,entity_name,size_min,size_max,size_source_url,size_as_of,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      domain,
      v.name,
      v.entityLabel,
      v.entityName,
      v.sizeMin,
      v.sizeMax,
      v.sizeSourceUrl,
      v.sizeAsOf,
      now,
      now,
    );
  return id;
}
export async function upsertSource(store, input) {
  const v = sourceSchema.parse(input);
  const company = await store.db
    .prepare("SELECT id FROM discovery_companies WHERE id=?")
    .get(v.companyId);
  if (!company) throw new HttpError(404, "Company not found");
  const existing = await store.db
    .prepare("SELECT id FROM discovery_sources WHERE platform=? AND board_id=?")
    .get(v.platform, v.boardId);
  if (existing) return existing.id;
  const id = randomUUID();
  await store.db
    .prepare(
      "INSERT INTO discovery_sources(id,company_id,platform,board_id,career_url) VALUES(?,?,?,?,?)",
    )
    .run(id, v.companyId, v.platform, v.boardId, v.careerUrl);
  return id;
}
/** Collection needs both operator enablement and recorded source permission. */
export async function setSourcePolicy(
  store,
  sourceId,
  { enabled, permission },
) {
  const source = await store.db
    .prepare("SELECT id FROM discovery_sources WHERE id=?")
    .get(sourceId);
  if (!source) throw new HttpError(404, "Source not found");
  if (permission !== undefined) {
    if (!["unconfirmed", "confirmed", "revoked"].includes(permission))
      throw new HttpError(400, "Invalid permission status");
    await store.db
      .prepare("UPDATE discovery_sources SET permission_status=? WHERE id=?")
      .run(permission, sourceId);
    if (permission !== "confirmed")
      await store.db
        .prepare("UPDATE discovery_sources SET enabled=0 WHERE id=?")
        .run(sourceId);
  }
  if (enabled !== undefined)
    await store.db
      .prepare("UPDATE discovery_sources SET enabled=? WHERE id=?")
      .run(enabled ? 1 : 0, sourceId);
}
const STALE_AFTER_MS = 48 * 3600 * 1000;
export function sourceStatus(source, now = Date.now()) {
  const collecting =
    !!source.enabled && source.permission_status === "confirmed";
  const fresh =
    source.last_success_at &&
    now - Date.parse(source.last_success_at) < STALE_AFTER_MS;
  return {
    id: source.id,
    platform: source.platform,
    boardId: source.board_id,
    careerUrl: source.career_url,
    collecting,
    health: source.health,
    lastSuccessAt: source.last_success_at || null,
    lastAttemptAt: source.last_attempt_at || null,
    nextFetchAt: source.next_fetch_at || null,
    listedCount: source.listed_count,
    verification: !collecting
      ? "not_collecting"
      : fresh && source.consecutive_failures === 0
        ? "verified"
        : "could_not_verify",
  };
}
/** Public coverage view: honest about what is and is not being collected. */
export async function coverage(store, userId, now = Date.now()) {
  const companies = await store.db
    .prepare("SELECT * FROM discovery_companies ORDER BY name,id")
    .all();
  const sources = await store.db
    .prepare("SELECT * FROM discovery_sources ORDER BY platform,board_id")
    .all();
  const watched = new Set(
    (
      await store.db
        .prepare("SELECT company_id FROM discovery_watchlist WHERE user_id=?")
        .all(userId)
    ).map((r) => r.company_id),
  );
  const counts = new Map(
    (
      await store.db
        .prepare(
          "SELECT company_id,COUNT(*) AS n FROM discovery_jobs WHERE status='listed' GROUP BY company_id",
        )
        .all()
    ).map((r) => [r.company_id, Number(r.n)]),
  );
  const rows = companies.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.canonical_domain,
    size: describeSize(c),
    openJobs: counts.get(c.id) || 0,
    watched: watched.has(c.id),
    sources: sources
      .filter((s) => s.company_id === c.id)
      .map((s) => sourceStatus(s, now)),
  }));
  const collecting = rows.flatMap((c) => c.sources).filter((s) => s.collecting);
  return {
    companies: rows,
    summary: {
      companies: rows.length,
      sources: sources.length,
      collectingSources: collecting.length,
      unverifiedSources: collecting.filter((s) => s.verification !== "verified")
        .length,
    },
    statement:
      "Coverage is limited to the employer boards listed here that are being collected. It is not the whole job market.",
  };
}
