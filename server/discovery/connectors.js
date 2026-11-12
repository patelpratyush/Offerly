// Public job-board connectors (Greenhouse, Lever, Ashby). They are pure
// "fetch and normalize" functions: no database access, and the network client
// is injected so tests use recorded or synthetic fixtures only. Collection of
// real boards remains disabled until source permissions are confirmed
// (reference/phase0/access-decision.md).
export class ConnectorError extends Error {
  constructor(code, message, { retryAfterMs = 0 } = {}) {
    super(message || code);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_LISTINGS = 5000;
const MAX_DESCRIPTION = 20000;
const BOARD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HOSTS = {
  greenhouse: "boards-api.greenhouse.io",
  lever: "api.lever.co",
  ashby: "api.ashbyhq.com",
};
export function boardUrl(platform, boardId) {
  if (!HOSTS[platform]) throw new ConnectorError("unsupported_platform");
  if (!BOARD_ID.test(String(boardId)))
    throw new ConnectorError("invalid_board_id");
  const id = encodeURIComponent(boardId);
  return platform === "greenhouse"
    ? `https://${HOSTS.greenhouse}/v1/boards/${id}/jobs?content=true`
    : platform === "lever"
      ? `https://${HOSTS.lever}/v0/postings/${id}?mode=json`
      : `https://${HOSTS.ashby}/posting-api/job-board/${id}?includeCompensation=true`;
}
/** Default network client: HTTPS only, no redirects, bounded time. */
export function createHttpFetcher({
  timeoutMs = 10000,
  userAgent = process.env.DISCOVERY_USER_AGENT || "OfferlyDiscovery/0.1",
} = {}) {
  return async (url) => {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !Object.values(HOSTS).includes(parsed.hostname)
    )
      throw new ConnectorError("blocked_url");
    return fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });
  };
}
/** Per-host spacing so one run never bursts at a provider. */
export function createRateLimiter({
  minIntervalMs = 1000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const next = new Map();
  return {
    async wait(host) {
      const at = Math.max(now(), next.get(host) || 0);
      next.set(host, at + minIntervalMs);
      if (at > now()) await sleep(at - now());
    },
  };
}
function retryAfter(res) {
  const value = Number(res.headers?.get?.("retry-after"));
  return Number.isFinite(value) && value > 0
    ? Math.min(value, 86400) * 1000
    : 0;
}
async function readJson(res) {
  const declared = Number(res.headers?.get?.("content-length"));
  if (declared > MAX_BODY_BYTES) throw new ConnectorError("response_too_large");
  const body = await (res.text ? res.text() : JSON.stringify(await res.json()));
  if (body.length > MAX_BODY_BYTES)
    throw new ConnectorError("response_too_large");
  try {
    return JSON.parse(body);
  } catch {
    throw new ConnectorError("invalid_json");
  }
}
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d{1,6});/g, (_, n) =>
      Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : "",
    )
    .replace(/&amp;/g, "&");
}
/** Convert listing HTML to inert plain text. Never rendered as HTML. */
export function htmlToText(value) {
  let text = String(value || "");
  for (let pass = 0; pass < 2; pass++)
    text = decodeEntities(
      text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<\/(p|div|li|h[1-6]|ul|ol|br)>|<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, " "),
    );
  return text
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION);
}
const str = (value, max = 300) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function httpUrl(value) {
  try {
    const url = new URL(String(value));
    return /^https?:$/.test(url.protocol) && url.hostname ? url.href : "";
  } catch {
    return "";
  }
}
/**
 * Preserve what the source actually stated. Date-only values stay date-only;
 * offset-bearing values record their original offset as timezone evidence;
 * anything else is unknown rather than guessed.
 */
export function parsePosted(value) {
  const unknown = { at: null, precision: "unknown", timezone: "" };
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? unknown
      : {
          at: date.toISOString(),
          precision: "datetime",
          timezone: "epoch-ms-utc",
        };
  }
  if (typeof value !== "string") return unknown;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const ok =
      new Date(text + "T00:00:00Z").toISOString().slice(0, 10) === text;
    return ok ? { at: text, precision: "date", timezone: "" } : unknown;
  }
  const match =
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.exec(
      text,
    );
  if (!match) return unknown;
  const date = new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime())
    ? unknown
    : {
        at: date.toISOString(),
        precision: "datetime",
        timezone: match[1].toUpperCase(),
      };
}
const arrangement = (value) => {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return text === "remote"
    ? "Remote"
    : text === "hybrid"
      ? "Hybrid"
      : text === "onsite" || text === "inoffice"
        ? "On-site"
        : "Unknown";
};
const employment = (value) => {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return (
    {
      fulltime: "Full-time",
      parttime: "Part-time",
      contract: "Contract",
      contractor: "Contract",
      intern: "Internship",
      internship: "Internship",
      temporary: "Temporary",
    }[text] || "Unknown"
  );
};
const period = (value) => {
  const text = String(value || "").toLowerCase();
  return /year|annual/.test(text)
    ? "Year"
    : /month/.test(text)
      ? "Month"
      : /week/.test(text)
        ? "Week"
        : /day/.test(text)
          ? "Day"
          : /hour/.test(text)
            ? "Hour"
            : "Unknown";
};
const money = (value) =>
  Number.isFinite(value) && value > 0 && value < 1e10
    ? Math.round(value)
    : null;
const noComp = {
  min: null,
  max: null,
  currency: "",
  period: "Unknown",
  basis: "Unknown",
};
function base(fields) {
  return {
    requisition: "",
    location: "",
    postedAt: null,
    postedPrecision: "unknown",
    postedTimezone: "",
    description: "",
    workArrangement: "Unknown",
    employmentType: "Unknown",
    compensation: noComp,
    ...fields,
  };
}
const PARSERS = {
  greenhouse(body) {
    if (!body || !Array.isArray(body.jobs))
      throw new ConnectorError("invalid_shape");
    return body.jobs.map((job) => {
      if (!job || typeof job !== "object") return null;
      const id = job.id ?? job.internal_job_id;
      // updated_at is a modification time, never a posting date.
      const posted = parsePosted(job.first_published);
      return base({
        externalId:
          id === undefined || id === null ? "" : String(id).slice(0, 100),
        title: str(job.title),
        url: httpUrl(job.absolute_url),
        location: str(job.location?.name, 200),
        requisition: str(job.requisition_id, 100),
        postedAt: posted.at,
        postedPrecision: posted.precision,
        postedTimezone: posted.timezone,
        description: htmlToText(job.content),
      });
    });
  },
  lever(body) {
    if (!Array.isArray(body)) throw new ConnectorError("invalid_shape");
    return body.map((job) => {
      if (!job || typeof job !== "object") return null;
      const posted = parsePosted(job.createdAt);
      const range = job.salaryRange;
      const text = [
        job.descriptionPlain,
        ...(Array.isArray(job.lists)
          ? job.lists.map((l) => `${l?.text || ""}\n${htmlToText(l?.content)}`)
          : []),
        job.additionalPlain,
      ]
        .filter((part) => typeof part === "string" && part)
        .join("\n\n");
      return base({
        externalId: str(job.id, 100),
        title: str(job.text),
        url: httpUrl(job.hostedUrl),
        location: str(job.categories?.location, 200),
        postedAt: posted.at,
        postedPrecision: posted.precision,
        postedTimezone: posted.timezone,
        description: text.slice(0, MAX_DESCRIPTION),
        workArrangement: arrangement(job.workplaceType),
        employmentType: employment(job.categories?.commitment),
        compensation: range
          ? {
              min: money(range.min),
              max: money(range.max),
              currency: /^[A-Z]{3}$/.test(range.currency || "")
                ? range.currency
                : "",
              period: period(range.interval),
              // Lever labels this a salary range; total compensation is not stated.
              basis: /salary/i.test(String(range.interval || ""))
                ? "Base"
                : "Unknown",
            }
          : noComp,
      });
    });
  },
  ashby(body) {
    if (!body || !Array.isArray(body.jobs))
      throw new ConnectorError("invalid_shape");
    return body.jobs
      .filter((job) => job && job.isListed !== false)
      .map((job) => {
        const posted = parsePosted(job.publishedAt);
        const salary = job.compensation?.summaryComponents?.find?.(
          (c) => c?.compensationType === "Salary",
        );
        return base({
          externalId: str(job.id, 100),
          title: str(job.title),
          url: httpUrl(job.jobUrl),
          location: str(job.location, 200),
          requisition: str(job.requisitionId, 100),
          postedAt: posted.at,
          postedPrecision: posted.precision,
          postedTimezone: posted.timezone,
          description: str(job.descriptionPlain, MAX_DESCRIPTION),
          workArrangement: job.isRemote
            ? "Remote"
            : arrangement(job.workplaceType),
          employmentType: employment(job.employmentType),
          compensation: salary
            ? {
                min: money(salary.minValue),
                max: money(salary.maxValue),
                currency: /^[A-Z]{3}$/.test(salary.currencyCode || "")
                  ? salary.currencyCode
                  : "",
                period: period(salary.interval),
                basis: "Base",
              }
            : noComp,
        });
      });
  },
};
/**
 * Fetch and validate one board. Throws ConnectorError for any outcome that must
 * not mutate the catalog (HTTP failure, malformed body, mostly-invalid items).
 */
export async function fetchBoard(
  source,
  { fetcher, limiter = createRateLimiter() } = {},
) {
  if (typeof fetcher !== "function") throw new ConnectorError("no_fetcher");
  const url = boardUrl(source.platform, source.boardId ?? source.board_id);
  await limiter.wait(new URL(url).hostname);
  let res;
  try {
    res = await fetcher(url);
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError("network_error");
  }
  if (res.status === 429 || res.status === 503)
    throw new ConnectorError("rate_limited", "", {
      retryAfterMs: retryAfter(res),
    });
  if (res.status === 404) throw new ConnectorError("board_not_found");
  if (res.status < 200 || res.status >= 300)
    throw new ConnectorError("http_" + res.status);
  const parsed = PARSERS[source.platform](await readJson(res));
  if (parsed.length > MAX_LISTINGS)
    throw new ConnectorError("too_many_listings");
  const seen = new Set();
  const listings = [];
  let invalid = 0;
  for (const item of parsed) {
    if (
      !item ||
      !item.externalId ||
      !item.title ||
      !item.url ||
      seen.has(item.externalId)
    ) {
      invalid++;
      continue;
    }
    seen.add(item.externalId);
    listings.push(item);
  }
  // A body where many entries are unusable is treated as a changed contract.
  if (parsed.length && invalid / parsed.length > 0.2)
    throw new ConnectorError("mostly_invalid");
  return { listings, invalid, total: parsed.length };
}
