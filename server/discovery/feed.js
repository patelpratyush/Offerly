// Personalized views over the shared catalog. All user-specific state is read
// by user id; the catalog itself is shared and read-only here.
import { z } from "zod";
import { HttpError } from "../security.js";
import { describeSize, sizeMatches } from "./size.js";
import { getProfile } from "./profile.js";
import { checkEligibility } from "./eligibility.js";
import { scoreJob, jobLevel } from "./scoring.js";
import { normRequisition, normText, normalizeUrl } from "./normalize.js";
import { CHUNK, loadCatalogFor, escapeLike } from "./catalog.js";
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
const iso = (ms) => new Date(ms).toISOString();
const NOT_DISMISSED =
  "NOT EXISTS (SELECT 1 FROM discovery_user_jobs u WHERE u.user_id=? AND u.job_id=j.id AND u.dismissed_at IS NOT NULL AND u.dismissed_at<>'')";
/**
 * SQL pre-filter over discovery_jobs (alias j, discovery_companies alias c).
 * It only encodes conditions that are exact or strictly wider than the
 * in-memory evaluation (eligibility, fit, size, seniority and existing-
 * application matching stay in evaluateJob), so it can shrink the candidate
 * set but never drops a job the full evaluation would show.
 */
export function prefilter({
  userId,
  filters,
  now,
  basis = "posted",
  listedOnly = true,
  excludeDismissed = true,
  saved = false,
  watched = false,
}) {
  const where = [],
    params = [];
  if (listedOnly) where.push("j.status='listed'");
  if (excludeDismissed) {
    where.push(NOT_DISMISSED);
    params.push(userId);
  }
  if (saved) {
    where.push(
      "EXISTS (SELECT 1 FROM discovery_user_jobs u WHERE u.user_id=? AND u.job_id=j.id AND u.saved_at IS NOT NULL AND u.saved_at<>'')",
    );
    params.push(userId);
  }
  if (watched) {
    where.push(
      "EXISTS (SELECT 1 FROM discovery_watchlist w WHERE w.user_id=? AND w.company_id=j.company_id)",
    );
    params.push(userId);
  }
  if (filters.q) {
    where.push("LOWER(j.title || ' ' || c.name) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filters.q.toLowerCase())}%`);
  }
  if (filters.location) {
    where.push("LOWER(j.location) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filters.location.toLowerCase())}%`);
  }
  if (filters.arrangements.length) {
    where.push(
      `j.work_arrangement IN (${filters.arrangements.map(() => "?").join(",")})`,
    );
    params.push(...filters.arrangements);
  }
  if (filters.salaryMin !== null) {
    where.push("COALESCE(NULLIF(j.comp_max,0),NULLIF(j.comp_min,0))>=?");
    params.push(filters.salaryMin);
  }
  if (filters.platforms.length) {
    where.push(
      `EXISTS (SELECT 1 FROM discovery_listings l JOIN discovery_sources s ON s.id=l.source_id WHERE l.job_id=j.id AND s.platform IN (${filters.platforms.map(() => "?").join(",")}))`,
    );
    params.push(...filters.platforms);
  }
  if (filters.window) {
    const clock = filters.basis || basis;
    const custom = filters.window === "custom";
    const from =
      custom && filters.from ? Date.parse(filters.from + "T00:00:00Z") : null;
    const to =
      custom && filters.to
        ? Date.parse(filters.to + "T00:00:00Z") + 864e5
        : null;
    const lower = custom ? from : now - WINDOW_MS[filters.window];
    if (clock === "discovered") {
      where.push("j.first_discovered_at IS NOT NULL");
      if (lower !== null) {
        where.push("j.first_discovered_at>=?");
        params.push(iso(lower));
      }
      if (to !== null) {
        where.push("j.first_discovered_at<?");
        params.push(iso(to));
      }
    } else {
      where.push(
        "j.employer_posted_at IS NOT NULL AND j.posted_precision<>'unknown'",
      );
      // Posting times may carry an offset, so compare on the date prefix with
      // a two-day margin; the exact window is still applied in evaluateJob.
      if (lower !== null) {
        where.push("j.employer_posted_at>=?");
        params.push(iso(lower - 2 * 864e5).slice(0, 10));
      }
    }
  }
  return { where, params };
}
const SORTS = {
  posted: {
    order:
      "COALESCE(j.employer_posted_at,'') DESC,j.first_discovered_at DESC,j.id ASC",
    after:
      "(COALESCE(j.employer_posted_at,'')<? OR (COALESCE(j.employer_posted_at,'')=? AND (j.first_discovered_at<? OR (j.first_discovered_at=? AND j.id>?))))",
    args: (k) => [k[0], k[0], k[1], k[1], k[2]],
    key: (r) => [r.employer_posted_at || "", r.first_discovered_at, r.id],
  },
  disc: {
    order: "j.first_discovered_at DESC,j.id ASC",
    after: "(j.first_discovered_at<? OR (j.first_discovered_at=? AND j.id>?))",
    args: (k) => [k[0], k[0], k[1]],
    key: (r) => [r.first_discovered_at, r.id],
  },
};
export const SCAN_CAP = 5000;
const encodeCursor = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function decodeCursor(text, kind) {
  if (!text) return null;
  try {
    const v = JSON.parse(Buffer.from(String(text), "base64url").toString());
    if (
      v?.k === kind &&
      Array.isArray(v.p) &&
      v.p.length <= 4 &&
      v.p.every((x) => typeof x === "string" || typeof x === "number")
    )
      return v.p;
  } catch {
    /* Fall through to the shared error. */
  }
  throw new HttpError(400, "Invalid page cursor");
}
export async function selectJobs(store, { where, params, order, limit }) {
  return store.db
    .prepare(
      `SELECT j.* FROM discovery_jobs j JOIN discovery_companies c ON c.id=j.company_id${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT ?`,
    )
    .all(...params, limit);
}
const fitKey = (j) => [
  j.fit?.score ?? -1,
  j.freshness.employerPostedAt || "",
  j.id,
];
function afterFit(a, cursor) {
  // True when key a sorts strictly after the cursor (fit desc, posted desc, id asc).
  if (a[0] !== cursor[0]) return a[0] < cursor[0];
  if (a[1] !== cursor[1]) return a[1] < cursor[1];
  return a[2] > cursor[2];
}
export async function listView(
  store,
  userId,
  view,
  rawFilters = {},
  { now = Date.now(), limit = 50, cursor = "", scanCap = SCAN_CAP } = {},
) {
  const filters = filterSchema.parse(rawFilters);
  const ctx = await loadContext(store, userId);
  const basis = view === "new" ? "discovered" : "posted";
  const lookup = ["saved", "applied"].includes(view);
  const base = prefilter({
    userId,
    filters,
    now,
    basis,
    listedOnly: !lookup,
    excludeDismissed: !lookup,
    saved: view === "saved",
    watched: view === "watchlist",
  });
  const accept = (job, catalog) => {
    const evaluated = evaluateJob(ctx, catalog, job, filters, now, basis);
    if (!evaluated) return null;
    const j = evaluated.view;
    const ignored = lookup ? ["eligibility"] : [];
    if (evaluated.reasons.some((r) => !ignored.includes(r))) return null;
    if (j.dismissed && !lookup) return null;
    if (view === "saved" && !j.saved) return null;
    if (view === "applied" && !j.applied) return null;
    if (view === "watchlist" && !j.watched) return null;
    if (
      view === "stretch" &&
      !(j.fit?.stretch && j.eligibility.status !== "does_not_meet")
    )
      return null;
    if (view === "best" && (j.fit?.score ?? null) === null) return null;
    if (!lookup && j.status === "not_listed") return null;
    if (!["saved", "applied", "latest", "new"].includes(view) && j.applied)
      return null;
    return j;
  };
  const out = { view, filters, profileApproved: ctx.profile.approved };
  const meta = { generatedAt: new Date(now).toISOString(), scanCap };
  if (["best", "stretch"].includes(view)) {
    // Fit is computed per user, so it cannot be a SQL sort key. Evaluate the
    // pre-filtered candidates (newest first, bounded) and page the sorted result.
    const after = decodeCursor(cursor, "fit");
    const rows = [];
    let scanned = 0,
      truncated = false;
    for (let at = null; ;) {
      const where = [...base.where],
        params = [...base.params];
      if (at) {
        where.push(SORTS.posted.after);
        params.push(...SORTS.posted.args(at));
      }
      const chunk = await selectJobs(store, {
        where,
        params,
        order: SORTS.posted.order,
        limit: CHUNK,
      });
      if (!chunk.length) break;
      const catalog = await loadCatalogFor(store, chunk);
      for (const job of chunk) {
        const j = accept(job, catalog);
        if (j) rows.push(j);
      }
      scanned += chunk.length;
      at = SORTS.posted.key(chunk[chunk.length - 1]);
      if (chunk.length < CHUNK) break;
      if (scanned >= scanCap) {
        truncated = true;
        break;
      }
    }
    rows.sort((a, b) => {
      const x = fitKey(a),
        y = fitKey(b);
      if (x[0] !== y[0]) return y[0] - x[0];
      if (x[1] !== y[1]) return y[1] > x[1] ? 1 : -1;
      return x[2] < y[2] ? -1 : 1;
    });
    const rest = after ? rows.filter((r) => afterFit(fitKey(r), after)) : rows;
    const page = rest.slice(0, limit);
    return {
      ...out,
      total: truncated ? null : rows.length,
      jobs: page,
      hasMore: rest.length > page.length || truncated,
      nextCursor:
        rest.length > page.length
          ? encodeCursor({ k: "fit", p: fitKey(page[page.length - 1]) })
          : null,
      truncated,
      ...meta,
    };
  }
  // Date-ordered views use keyset paging directly in SQL.
  const sortName = view === "new" ? "disc" : "posted";
  const sort = SORTS[sortName];
  let at = decodeCursor(cursor, sortName);
  const found = [];
  let scanned = 0,
    exhausted = false,
    lastScanned = at;
  while (found.length <= limit && scanned < scanCap) {
    const where = [...base.where],
      params = [...base.params];
    if (at) {
      where.push(sort.after);
      params.push(...sort.args(at));
    }
    const chunk = await selectJobs(store, {
      where,
      params,
      order: sort.order,
      limit: CHUNK,
    });
    if (!chunk.length) {
      exhausted = true;
      break;
    }
    const catalog = await loadCatalogFor(store, chunk);
    for (const job of chunk) {
      scanned++;
      lastScanned = sort.key(job);
      const j = accept(job, catalog);
      if (j) found.push({ j, key: sort.key(job) });
      if (found.length > limit) break;
    }
    if (found.length > limit) break;
    at = sort.key(chunk[chunk.length - 1]);
    if (chunk.length < CHUNK) {
      exhausted = true;
      break;
    }
  }
  const page = found.slice(0, limit);
  const more = found.length > limit;
  return {
    ...out,
    total: null,
    jobs: page.map((f) => f.j),
    hasMore: more || !exhausted,
    // Resume after the last returned job, or after the last scanned row when the
    // per-request scan bound was reached before a full page was found.
    nextCursor: more
      ? encodeCursor({ k: sortName, p: page[page.length - 1].key })
      : !exhausted
        ? encodeCursor({ k: sortName, p: lastScanned })
        : null,
    truncated: !exhausted && !more,
    ...meta,
  };
}
export async function jobDetail(store, userId, jobId, now = Date.now()) {
  const job = await store.db
    .prepare("SELECT * FROM discovery_jobs WHERE id=?")
    .get(jobId);
  if (!job) return null;
  const ctx = await loadContext(store, userId);
  const catalog = await loadCatalogFor(store, [job]);
  const evaluated = evaluateJob(ctx, catalog, job, emptyFilters(), now);
  if (!evaluated) return null;
  return {
    ...evaluated.view,
    description: job.description,
    requisition: job.requisition,
  };
}
