// Bounded catalog reads. Nothing here loads the whole catalog: callers select
// candidate job rows with SQL (valid on SQLite and PostgreSQL), then hydrate
// only the companies, listings and sources those rows need.
export const CHUNK = 400;
const marks = (n) => Array(n).fill("?").join(",");
async function byIds(store, table, column, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    rows.push(
      ...(await store.db
        .prepare(
          `SELECT * FROM ${table} WHERE ${column} IN (${marks(part.length)})`,
        )
        .all(...part)),
    );
  }
  return rows;
}
/** Hydrates the shared structure evaluateJob expects for exactly these jobs. */
export async function loadCatalogFor(store, jobs) {
  const listings = await byIds(
    store,
    "discovery_listings",
    "job_id",
    jobs.map((j) => j.id),
  );
  const [companies, sources] = await Promise.all([
    byIds(store, "discovery_companies", "id", [
      ...new Set(jobs.map((j) => j.company_id)),
    ]),
    byIds(store, "discovery_sources", "id", [
      ...new Set(listings.map((l) => l.source_id)),
    ]),
  ]);
  const listingsByJob = new Map();
  for (const l of listings) {
    if (!listingsByJob.has(l.job_id)) listingsByJob.set(l.job_id, []);
    listingsByJob.get(l.job_id).push(l);
  }
  return {
    companies: new Map(companies.map((c) => [c.id, c])),
    sources: new Map(sources.map((s) => [s.id, s])),
    jobs,
    listingsByJob,
  };
}
export async function jobsByIds(store, ids) {
  return byIds(store, "discovery_jobs", "id", [...new Set(ids)]);
}
export const escapeLike = (text) => text.replace(/[\\%_]/g, "\\$&");
