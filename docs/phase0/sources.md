# Phase 0: job-source feasibility

Verified 2026-10-22 with six board requests plus one in-memory description probe. Re-run `node scripts/phase0-sources.js`; exact endpoints, collection timestamps, byte counts and two metadata samples per nonempty board appear in [source-probe.json](./source-probe.json). No listing descriptions, candidate data, credentials or submissions are retained. An additional Greenhouse Stripe `content=true` request returned 727 descriptions in 5,653,730 bytes; descriptions remained in process memory and were discarded. Optional `includeDescriptions:true` supports later extraction evaluation; Greenhouse content is HTML-entity encoded and must be converted safely, never rendered as trusted markup. This is a read-only technical spike, not a discovery service.

| Provider   | Boards                 | Live result                | Date treatment                                                                                             |
| ---------- | ---------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Greenhouse | stripe, cloudflare     | 727 and 444 valid listings | `updated_at` is provider update time; original posting date stays unknown                                  |
| Lever      | palantir, wealthsimple | 306 and 0 valid listings   | Original posting date stays unknown; a valid empty response proves endpoint access, not historical closure |
| Ashby      | linear, notion         | 34 and 138 listed jobs     | `publishedAt` means last published, not guaranteed original publication; kept separately                   |

Counts are point-in-time evidence, not stable expectations. No application POST endpoints were called. Public response containing zero jobs is not treated as employer disappearance. `first_discovered_at` here means this probe's observation, not a durable catalog history; future ingestion must preserve existing discovery timestamps.

## Official interface evidence

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): published job GETs require no authentication. Complete list has `jobs` and `meta.total`; optional `content=true` adds full descriptions. Probe omits descriptions. Documentation supports employer careers-page use, not blanket third-party republication rights.
- [Lever Postings API](https://github.com/lever/postings-api): public employer-scoped postings endpoint supports JSON and hosted application links. No published API key required for listing reads. Documented POST application throttling is not a GET polling allowance. Preserve hosted apply link; never submit applications from probe.
- [Ashby Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api): employer board endpoint lists published jobs, optional compensation, `isListed`, and last-publication timestamp. Hidden (`isListed:false`) jobs are omitted. Missing listing properties remain unknown. Compensation response may contain salary/equity/bonus and tier-specific figures; this metadata-only adapter does not collapse those into guessed salary ranges.

## Access and redistribution decision

Technical access validated for all three providers. Approval for a shared third-party catalog **has not been established**. API docs focus on organizations' own careers pages. [Lever terms](https://www.lever.co/legal/terms-of-service) govern customer/service use and include access restrictions; [Ashby customer terms](https://www.ashbyhq.com/resources/terms) govern customer service use. Neither is treated here as a license to republish every employer's listing. Greenhouse general terms URL could not be retrieved through research tooling; no claim about permission inferred from that failure.

Before public discovery rollout: confirm current provider and employer conditions for each board, permitted caching/retention/redistribution, attribution, and polling frequency; obtain required permission. Keep authorization status in future source registry. No LinkedIn scraping, login bypass or application automation is part of this validation. Readability and HTTP 200 are not redistribution approval.

## Boundaries and failure handling

Adapter supports six static board/provider pairs only. Request URL constructed from fixed configuration; no arbitrary user URL, host, board token or redirects. GET only, 15-second whole-response abort, 12 MiB streaming response cap, JSON content type, maximum 10,000 rows, bounded metadata strings and HTTPS links. Seven sequential requests, no automatic retries. 429/non-200/malformed/oversized responses fail rather than implying closure. `closure_safe:false` always: Phase 0 cannot mutate a catalog or close saved jobs.

Greenhouse totals must equal received row count. Lever/Ashby documented list responses have no completeness checksum; partial/malformed rows make `complete:false`, duplicates rejected, successful empty results retained as observations. Network or schema errors never produce mass closures. No description HTML rendered, link fetched, jobs persisted, source scheduler enabled or recommendation made.

Six offline tests cover fixed allowlist, malformed/partial feeds, duplicates/hidden jobs, unsafe links, invalid dates, freshness separation, HTTP/type/size failures and GET/redirect policy. Future production collection needs persisted source health, conditional fetch/backoff under agreed limits, idempotent history and deduplication; those belong to Phase 3.
