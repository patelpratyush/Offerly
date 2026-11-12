# Connector shape review

Reviewed 2026-11-12 by reading public vendor documentation only. No job board or company API was requested. Fixtures in `tests/fixtures/discovery/` are synthetic and shaped from these documents; they are not recordings. Sources:

- Greenhouse Job Board API: https://docs.greenhouse.io/job-board.html
- Lever Postings API: https://github.com/lever/postings-api
- Ashby Job Postings API: https://developers.ashbyhq.com/docs/public-job-posting-api

Documentation summaries were produced by fetching those pages; wording below is paraphrased and each item should be rechecked against the live docs before a production decision.

## Mapping changed because it disagreed with documentation

| Platform | Was | Now | Why |
| --- | --- | --- | --- |
| Ashby | `isRemote: true` mapped to `Remote` | Arrangement comes from `workplaceType` (`OnSite`, `Remote`, `Hybrid`) only; `isRemote` alone gives `Unknown` | Docs say `isRemote` is true for Remote **or Hybrid**. Hybrid jobs were being labeled Remote and could match a Remote-only preference. Fixture and seed data now carry `workplaceType`. |

## Mappings that agree with documentation

- Greenhouse list: `id`, `internal_job_id`, `title`, `updated_at` (ISO with offset), `requisition_id` (string), `location.name`, `absolute_url`, `content` (HTML-entity-encoded, decoded then stripped by `htmlToText`), `meta.total`. `updated_at` is not used as a posting date.
- Lever: `id`, `text`, `hostedUrl`, `categories.location/commitment`, `descriptionPlain`, `lists[{text,content}]`, `additionalPlain`, `workplaceType` (`unspecified`, `on-site`, `remote`, `hybrid`: all handled by `arrangement()`), `salaryRange{currency,interval,min,max}`. Top-level body read as an array.
- Ashby: `jobs[]` with `title`, `location`, `employmentType` (`FullTime`, `PartTime`, `Intern`, `Contract`, `Temporary`), `isListed` (false = unlisted, skipped), `publishedAt`, `jobUrl`, `descriptionPlain`, `compensation.summaryComponents[{compensationType,interval,currencyCode,minValue,maxValue}]`, `includeCompensation=true`.

## Unverified assumptions (not confirmed by the documentation read)

1. **Greenhouse `first_published`.** Documented only in the single-job example, not in the list example. The list endpoint may omit it, in which case every Greenhouse posting date is `unknown` and none qualifies for "latest" windows. Needs a one-time recorded list response (with permission) or vendor confirmation.
2. **Greenhouse compensation.** `pay_input_ranges` is documented only for the single-job endpoint with `pay_transparency=true`, in cents, with no period field. The list connector therefore never reports Greenhouse pay (correct: unknown), and a future detail fetch must not assume a period.
3. **Lever `createdAt`.** Treated as epoch milliseconds. The docs page read did not state units.
4. **Lever `salaryRange.interval` values.** Docs do not list them. The code assumes strings like `per-year-salary`; "salary" in the string sets basis `Base`, a "wage"/other string leaves basis `Unknown`. Whether Lever pay can ever be total compensation is unstated.
5. **Lever response envelope and pagination.** The docs describe `skip`/`limit` but not the top-level shape or a total. The code assumes a bare array and fetches one page, so boards larger than the server default page may be truncated silently. This needs checking before real collection.
6. **Ashby `id`.** Not listed in the documented fields on the page read, but `externalId` requires it; listings without `id` are dropped as invalid. If `id` is absent the Ashby connector would reject every row (it would fail loudly as `mostly_invalid`).
7. **Ashby `requisitionId`.** No such field is documented. The code reads it if present; treat it as empty in practice, which means Ashby duplicates fall back to title and location matching.
8. **Ashby `compensation` placement.** The docs table puts it under `jobs[]` but the example shows it at the top level. The code reads `job.compensation`. If it is top-level, no Ashby pay is read (unknown, never guessed).
9. **Ashby `summaryComponents` values.** `compensationType` and `interval` lists are examples only (`Salary`, `Bonus`, `EquityPercentage`; `1 YEAR`, `NONE`). Only the first `Salary` component is used and is labeled `Base`; tiered or multi-location pay is not modeled.
10. **Ashby `publishedAt`.** Treated as a posting date. Earlier Phase 0 notes say it may mean last published; it is stored as the posting date only when present. Whether it resets on republish is unverified.
11. **Rate limits, caching headers, and permitted polling frequency** for all three are unverified and tied to the unresolved source-permission decision in `reference/phase0/access-decision.md`. Nothing here establishes permission to collect or republish.
12. **Real-world formats** (HTML structure inside `content`, whitespace, heading styles used by the required/preferred splitter, location strings) are known only from synthetic fixtures.
