// Personalized views over the shared catalog. All user-specific state is read
// by user id; the catalog itself is shared and read-only here.
import { z } from "zod";
import { describeSize, sizeMatches } from "./size.js";
import { getProfile } from "./profile.js";
import { checkEligibility } from "./eligibility.js";
import { scoreJob, jobLevel } from "./scoring.js";
import { normRequisition, normText, normalizeUrl } from "./normalize.js";
export const VIEWS = [
  "best",
  "latest",
  "new",
  "watchlist",
  "stretch",
  "saved",
  "applied",
];
const WINDOW_MS = {
  "24h": 864e5,
  "3d": 3 * 864e5,
  "7d": 7 * 864e5,
  "30d": 30 * 864e5,
};
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const filterSchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    seniority: z.array(z.string().max(20)).max(8).default([]),
    location: z.string().trim().max(100).default(""),
    arrangements: z
      .array(z.enum(["Remote", "Hybrid", "On-site"]))
      .max(3)
      .default([]),
    salaryMin: z.number().int().min(0).max(100000000).nullable().default(null),
    eligibility: z
      .array(z.enum(["meets", "needs_verification", "does_not_meet"]))
      .max(3)
      .default(["meets", "needs_verification"]),
    platforms: z
      .array(z.enum(["greenhouse", "lever", "ashby"]))
      .max(3)
      .default([]),
    sizes: z
      .array(z.enum(["Small", "Mid", "Large"]))
      .max(3)
      .default([]),
    includeUnknownSize: z.boolean().default(false),
    includeUncertainSize: z.boolean().default(false),
    minFit: z.number().int().min(0).max(100).default(0),
    // Recency window and which clock it applies to.
    window: z
      .union([z.literal(""), z.enum(["24h", "3d", "7d", "30d", "custom"])])
      .default(""),
    from: z.union([z.literal(""), day]).default(""),
    to: z.union([z.literal(""), day]).default(""),
    basis: z.enum(["posted", "discovered"]).optional(),
  })
  .strict();
export const emptyFilters = () => filterSchema.parse({});
const STALE_MS = 48 * 3600 * 1000;
export function inWindow(job, filters, basis, now) {
  if (!filters.window) return true;
  let start, end;
  if (basis === "discovered") {
    if (!job.first_discovered_at) return false;
    start = Date.parse(job.first_discovered_at);
    end = start;
  } else {
    // Unknown posting dates never qualify as confirmed recently posted.
    if (!job.employer_posted_at || job.posted_precision === "unknown")
      return false;
    start = Date.parse(
      job.posted_precision === "date"
        ? job.employer_posted_at + "T00:00:00Z"
        : job.employer_posted_at,
    );
    // Date-only sources are treated as the whole day, never a false exact hour.
    end = job.posted_precision === "date" ? start + 864e5 - 1 : start;
  }
  if (filters.window === "custom") {
    const from = filters.from
      ? Date.parse(filters.from + "T00:00:00Z")
      : -Infinity;
    const to = filters.to
      ? Date.parse(filters.to + "T00:00:00Z") + 864e5
      : Infinity;
    return end >= from && start < to;
  }
  return end >= now - WINDOW_MS[filters.window] && start <= now;
}
function freshness(job) {
  const dateOnly = job.posted_precision === "date";
  return {
    employerPostedAt: job.employer_posted_at || null,
    postedPrecision: job.posted_precision,
    postedTimezone: job.posted_timezone || "",
    postedLabel:
      job.posted_precision === "unknown"
        ? "Posting date unknown"
        : dateOnly
          ? `Posted ${job.employer_posted_at} (date only)`
          : `Posted ${job.employer_posted_at}`,
    firstDiscoveredAt: job.first_discovered_at,
    lastCheckedAt: job.last_checked_at,
    lastChangedAt: job.last_changed_at,
    reopenedAt: job.reopened_at || null,
    reopenedCount: job.reopened_count,
  };
}
/** Loads everything user-specific once so scoring many jobs stays cheap. */
export async function loadContext(store, userId) {
  const [profile, userJobs, watch, applications] = await Promise.all([
    getProfile(store, userId),
    store.db
      .prepare("SELECT * FROM discovery_user_jobs WHERE user_id=?")
      .all(userId),
    store.db
      .prepare("SELECT company_id FROM discovery_watchlist WHERE user_id=?")
      .all(userId),
    store.list(userId, "application"),
  ]);
  return {
    userId,
    profile,
    userJobs: new Map(userJobs.map((r) => [r.job_id, r])),
    watched: new Set(watch.map((r) => r.company_id)),
    applications: applications.map((a) => ({
      id: a.id,
      company: normText(a.company),
      title: normText(a.title),
      requisition: normRequisition(a.requisition),
      url: normalizeUrl(a.url),
      stage: a.stage,
    })),
  };
}
/** Existing-application detection by requisition, URL, then company and title. */
export function findApplication(ctx, job, listings, company) {
  const req = normRequisition(job.requisition);
  const name = normText(company.name);
  for (const a of ctx.applications) {
    if (req && a.requisition === req && (a.company === name || !a.company))
      return { applicationId: a.id, stage: a.stage, matchedBy: "requisition" };
    if (a.url && listings.some((l) => normalizeUrl(l.url) === a.url))
      return { applicationId: a.id, stage: a.stage, matchedBy: "url" };
  }
  for (const a of ctx.applications)
    if (a.company === name && a.title === normText(job.title))
      return {
        applicationId: a.id,
        stage: a.stage,
        matchedBy: "company_and_title",
      };
  return null;
}
export async function loadCatalog(store, limit = 5000) {
  const [companies, jobs, listings, sources] = await Promise.all([
    store.db.prepare("SELECT * FROM discovery_companies").all(),
    store.db
      .prepare(
        "SELECT * FROM discovery_jobs ORDER BY first_discovered_at DESC,id LIMIT ?",
      )
      .all(limit),
    store.db.prepare("SELECT * FROM discovery_listings").all(),
    store.db.prepare("SELECT * FROM discovery_sources").all(),
  ]);
  const byJob = new Map();
  for (const l of listings) {
    if (!byJob.has(l.job_id)) byJob.set(l.job_id, []);
    byJob.get(l.job_id).push(l);
  }
  return {
    companies: new Map(companies.map((c) => [c.id, c])),
    sources: new Map(sources.map((s) => [s.id, s])),
    jobs,
    listingsByJob: byJob,
  };
}
function verification(listings, now) {
  const live = listings.filter((l) => l.status === "listed");
  if (!live.length) return "not_listed";
  return live.some(
    (l) =>
      l.verification === "verified" &&
      now - Date.parse(l.last_checked_at) < STALE_MS,
  )
    ? "verified"
    : "could_not_verify";
}
/** Evaluate one catalog job for one user. Shared by views and alert delivery. */
export function evaluateJob(ctx, catalog, job, filters, now, basis = "posted") {
  const company = catalog.companies.get(job.company_id);
  if (!company) return null;
  const listings = catalog.listingsByJob.get(job.id) || [];
  const sources = listings
    .map((l) => catalog.sources.get(l.source_id))
    .filter(Boolean);
  const size = describeSize(company);
  const eligibility = checkEligibility(job, ctx.profile);
  const fit = ctx.profile.approved ? scoreJob(job, ctx.profile) : null;
  const state = ctx.userJobs.get(job.id);
  const applied = findApplication(ctx, job, listings, company);
  const reasons = [];
  const text = `${job.title} ${company.name}`.toLowerCase();
  if (filters.q && !text.includes(filters.q.toLowerCase()))
    reasons.push("query");
  if (filters.seniority.length) {
    const level = jobLevel(job.title);
    if (!level || !filters.seniority.includes(level)) reasons.push("seniority");
  }
  if (
    filters.location &&
    !(job.location || "").toLowerCase().includes(filters.location.toLowerCase())
  )
    reasons.push("location");
  if (
    filters.arrangements.length &&
    !filters.arrangements.includes(job.work_arrangement)
  )
    reasons.push("arrangement");
  if (filters.salaryMin !== null) {
    const top = job.comp_max || job.comp_min;
    // Unknown pay is neither a match nor a zero; it is excluded from a salary floor.
    if (!top || top < filters.salaryMin) reasons.push("salary");
  }
  if (!filters.eligibility.includes(eligibility.status))
    reasons.push("eligibility");
  if (
    filters.platforms.length &&
    !sources.some((s) => filters.platforms.includes(s.platform))
  )
    reasons.push("source");
  if (
    !sizeMatches(size, {
      sizes: filters.sizes,
      includeUnknown: filters.includeUnknownSize,
      includeUncertain: filters.includeUncertainSize,
    })
  )
    reasons.push("size");
  if (
    filters.minFit &&
    (!fit || fit.score === null || fit.score < filters.minFit)
  )
    reasons.push("fit");
  if (!inWindow(job, filters, filters.basis || basis, now))
    reasons.push("window");
  return {
    reasons,
    view: {
      id: job.id,
      title: job.title,
      company: {
        id: company.id,
        name: company.name,
        domain: company.canonical_domain,
        size,
      },
      location: job.location,
      workArrangement: job.work_arrangement,
      employmentType: job.employment_type,
      compensation: {
        min: job.comp_min,
        max: job.comp_max,
        currency: job.comp_currency,
        period: job.comp_period,
        basis: job.comp_basis,
        stated: !!(job.comp_min || job.comp_max),
      },
      excerpt: (job.description || "").slice(0, 280),
      status: job.status,
      verification: verification(listings, now),
      freshness: freshness(job),
      sources: listings.map((l) => ({
        platform: catalog.sources.get(l.source_id)?.platform || "",
        url: l.url,
        status: l.status,
        verification: l.verification,
        lastCheckedAt: l.last_checked_at,
      })),
      eligibility,
      fit,
      applied,
      saved: !!state?.saved_at,
      dismissed: !!state?.dismissed_at,
      watched: ctx.watched.has(job.company_id),
    },
  };
}
export async function listView(
  store,
  userId,
  view,
  rawFilters = {},
  { now = Date.now(), limit = 50, offset = 0 } = {},
) {
  const filters = filterSchema.parse(rawFilters);
  const ctx = await loadContext(store, userId);
  const catalog = await loadCatalog(store);
  const basis = view === "new" ? "discovered" : "posted";
  const rows = [];
  for (const job of catalog.jobs) {
    const evaluated = evaluateJob(ctx, catalog, job, filters, now, basis);
    if (!evaluated) continue;
    const j = evaluated.view;
    const ignored = ["saved", "applied"].includes(view) ? ["eligibility"] : [];
    if (evaluated.reasons.some((r) => !ignored.includes(r))) continue;
    // Dismissed jobs leave every discovery view except Saved/Applied lookups.
    if (j.dismissed && !["saved", "applied"].includes(view)) continue;
    if (view === "saved" && !j.saved) continue;
    if (view === "applied" && !j.applied) continue;
    if (view === "watchlist" && !j.watched) continue;
    if (
      view === "stretch" &&
      !(j.fit?.stretch && j.eligibility.status !== "does_not_meet")
    )
      continue;
    if (view === "best" && (j.fit?.score ?? null) === null) continue;
    // Discovery views hide closed roles; saved/applied still show them, labelled.
    if (!["saved", "applied"].includes(view) && j.status === "not_listed")
      continue;
    if (!["saved", "applied", "latest", "new"].includes(view) && j.applied)
      continue;
    rows.push(j);
  }
  const posted = (j) => j.freshness.employerPostedAt || "";
  const fit = (j) => j.fit?.score ?? -1;
  const byFit = (a, b) => fit(b) - fit(a);
  const byPosted = (a, b) =>
    posted(b) > posted(a) ? 1 : posted(b) < posted(a) ? -1 : 0;
  const byDiscovered = (a, b) =>
    b.freshness.firstDiscoveredAt > a.freshness.firstDiscoveredAt ? 1 : -1;
  rows.sort(
    { best: byFit, stretch: byFit, new: byDiscovered }[view] || byPosted,
  );
  return {
    view,
    filters,
    profileApproved: ctx.profile.approved,
    total: rows.length,
    jobs: rows.slice(offset, offset + limit),
    generatedAt: new Date(now).toISOString(),
  };
}
export async function jobDetail(store, userId, jobId, now = Date.now()) {
  const ctx = await loadContext(store, userId);
  const catalog = await loadCatalog(store);
  const job = catalog.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const evaluated = evaluateJob(ctx, catalog, job, emptyFilters(), now);
  return {
    ...evaluated.view,
    description: job.description,
    requisition: job.requisition,
  };
}
