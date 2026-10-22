/** Read-only Phase 0 probes. No user-controlled URLs or board identifiers. */
export const SOURCE_BOARDS = Object.freeze(
  [
    { provider: "greenhouse", board: "stripe", company: "Stripe" },
    { provider: "greenhouse", board: "cloudflare", company: "Cloudflare" },
    { provider: "lever", board: "palantir", company: "Palantir" },
    { provider: "lever", board: "wealthsimple", company: "Wealthsimple" },
    { provider: "ashby", board: "linear", company: "Linear" },
    { provider: "ashby", board: "notion", company: "Notion" },
  ].map(Object.freeze),
);
const MAX_BYTES = 12 * 1024 * 1024;
function sourceConfig(provider, board) {
  const source = SOURCE_BOARDS.find(
    (s) => s.provider === provider && s.board === board,
  );
  if (!source) throw new Error("Unsupported source board");
  return source;
}
export function sourceUrl(
  provider,
  board,
  { includeDescriptions = false } = {},
) {
  sourceConfig(provider, board);
  if (provider === "greenhouse")
    return `https://boards-api.greenhouse.io/v1/boards/${board}/jobs${includeDescriptions ? "?content=true" : ""}`;
  if (provider === "lever")
    return `https://api.lever.co/v0/postings/${board}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
}
function text(value) {
  return typeof value === "string" && value.trim() && value.length <= 4000
    ? value.trim()
    : null;
}
function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.href.length <= 4000
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function timestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  )
    return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  // Validate calendar components independently of offset normalization.
  const datePart = value.slice(0, 10);
  const calendar = new Date(`${datePart}T00:00:00.000Z`);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== datePart
  )
    return null;
  return new Date(parsed).toISOString();
}
export function normalizeFeed(
  provider,
  board,
  payload,
  checkedAt = new Date().toISOString(),
  { includeDescriptions = false } = {},
) {
  const source = sourceConfig(provider, board);
  const rows = provider === "lever" ? payload : payload?.jobs;
  if (
    !Array.isArray(rows) ||
    rows.length > 10000 ||
    (provider === "ashby" && payload.apiVersion !== "1")
  )
    throw new Error("Invalid feed envelope");
  if (
    provider === "greenhouse" &&
    (!Number.isSafeInteger(payload.meta?.total) ||
      payload.meta.total !== rows.length)
  )
    throw new Error("Incomplete feed");
  const jobs = [];
  const seen = new Set();
  let rejected = 0;
  let unlisted = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      rejected++;
      continue;
    }
    if (provider === "ashby" && row.isListed === false) {
      unlisted++;
      continue;
    }
    const title = text(provider === "lever" ? row.text : row.title);
    const url = httpsUrl(
      provider === "greenhouse"
        ? row.absolute_url
        : provider === "lever"
          ? row.hostedUrl
          : row.jobUrl,
    );
    const id =
      provider === "ashby"
        ? text(row.id) || url
        : typeof row.id === "string" || Number.isSafeInteger(row.id)
          ? text(String(row.id))
          : null;
    if (
      !title ||
      !url ||
      !id ||
      seen.has(id) ||
      (provider === "ashby" && row.isListed !== true)
    ) {
      rejected++;
      continue;
    }
    seen.add(id);
    jobs.push({
      provider,
      board,
      company: source.company,
      source_id: id,
      title,
      location: text(
        provider === "greenhouse"
          ? row.location?.name
          : provider === "lever"
            ? row.categories?.location
            : row.location,
      ),
      source_url: url,
      employer_posted_at: null,
      provider_updated_at:
        provider === "greenhouse" ? timestamp(row.updated_at) : null,
      provider_last_published_at:
        provider === "ashby" ? timestamp(row.publishedAt) : null,
      first_discovered_at: checkedAt,
      last_checked_at: checkedAt,
      last_changed_at: null,
      compensation: null,
      ...(includeDescriptions
        ? {
            description:
              typeof (provider === "greenhouse"
                ? row.content
                : provider === "lever"
                  ? row.descriptionPlain
                  : row.descriptionPlain) === "string"
                ? (provider === "greenhouse"
                    ? row.content
                    : row.descriptionPlain
                  ).slice(0, 100000)
                : null,
            description_format:
              provider === "greenhouse" ? "html-entities" : "plain",
          }
        : {}),
    });
  }
  return {
    jobs,
    received: rows.length,
    rejected,
    unlisted,
    complete: rejected === 0,
    closure_safe: false,
  };
}
export async function probeSource(
  provider,
  board,
  {
    fetchImpl = fetch,
    now = () => new Date().toISOString(),
    timeoutMs = 15000,
    includeDescriptions = false,
  } = {},
) {
  const url = sourceUrl(provider, board, { includeDescriptions });
  const checkedAt = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
    if (
      !/\bapplication\/json\b/i.test(response.headers.get("content-type") || "")
    )
      throw new Error("Non-JSON feed");
    if (Number(response.headers.get("content-length")) > MAX_BYTES)
      throw new Error("Feed exceeds byte limit");
    if (!response.body) throw new Error("Missing feed body");
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Feed exceeds byte limit");
      chunks.push(Buffer.from(value));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const feed = normalizeFeed(provider, board, payload, checkedAt, {
      includeDescriptions,
    });
    return {
      provider,
      board,
      url,
      checked_at: checkedAt,
      status: "ok",
      bytes,
      ...feed,
    };
  } finally {
    clearTimeout(timer);
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
