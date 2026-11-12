# Phase 3 and 4 repository implementation (November 11–12, 2026)

Branch `integration/phase3-4`, built from `main` at `5935625`. Not pushed or deployed. Owner status documents are not edited here; fold this into `IMPLEMENTATION_STATUS.md` when ready.

All work is deterministic: no AI, no email sending, no automatic stage updates. Production AI and automatic stage updates remain disabled.

## Phase 3: discovery and recommendations

- Company/source registry, shared job catalog, per-source listings, snapshots and run history (`server/discovery/*`, migration `supabase/migrations/20261111000001_discovery.sql`).
- Greenhouse, Lever and Ashby connectors behind an injectable fetcher. Tests use synthetic fixtures only. Lever and Ashby field mappings follow documented shapes and are unverified against live responses.
- Collection is off by default: needs `DISCOVERY_COLLECTION_ENABLED=true`, an enabled source and a permission-confirmed source. Operator CLI: `npm run discovery:admin`. Nothing has run against real boards. Source redistribution permission remains open per `reference/phase0/access-decision.md`.
- Failed fetches mark listings "could not verify", never closed. Four freshness timestamps stored separately; posting-date precision preserved.
- Company size: Small 1–199, Mid 200–999, Large 1,000+, Unknown; spanning ranges flagged ambiguous.
- Profile, eligibility (meets / needs verification / does not meet, with evidence) and fit score (35/30/20/10/5, rubric `fit-2026-11-v1`). Missing salary is unknown, never zero. Not an interview probability.
- Views, saved searches, dismissals, watchlist, already-applied detection. In-app alerts with dedupe, quiet hours, cap and delivery-time recheck.
- Pages `/discover` and `/companies`.

Follow-ups built after this phase:
- Daily and weekly in-app digests (`server/discovery/digests.js`): one per user, cadence and local period, each job once with matched rules explained, rechecked at send time (aged-out, closed, dismissed, applied jobs are counted and left out; an empty digest says so). Honors user time zone, quiet hours, per-rule cap and pause. Pause or a change to matching or cadence cancels pending deliveries. The UI warns when a recency window is shorter than the digest interval.
- Scheduler/worker wiring (`server/discovery/runner.js`), all off by default: `DISCOVERY_COLLECTION_ENABLED=true` collects (bounded sources per tick, per-source backoff) and `DISCOVERY_ALERTS_ENABLED=true` processes alerts and digests (bounded users per tick, persisted cursor). Worker cadence: `DISCOVERY_TICK_INTERVAL_MS` (default 60000, minimum 10000).
- Scale: SQL pre-filtering and keyset/cursor paging for the feed (fit-ranked views scan a bounded set, `scanCap` 5000), alert queueing and delivery read only the rows they need. Snapshot retention keeps the newest `DISCOVERY_SNAPSHOT_KEEP` (default 20) per listing.

Open: email/browser channels and unsubscribe (not built; email must use `server/notification-provider.js`), rubric validation against human-reviewed examples (required by PRD), live-response verification of connectors.

## Phase 4: preparation and communication

- Reusable answers with provenance and confirmation rules; interview prep per round; template-based drafts (copy / `mailto:` only, no send route); resume-vs-listing coverage comparison with new immutable "Tailored" document versions; contact CSV import (verified-email matches only). Page `/prepare`.
- Not built: sending (COM 02), PDF export, PDF resume text extraction, draft tone selector, address-book imports, relationship tags.

## Insights, reminders, calendar

- `/api/insights` and CSV with numerators, denominators and sample sizes; unknown dates excluded and counted. Response and stage durations use the date recorded in Offerly, not real-world event time.
- Configurable reminder rules, delivery states, bounded retries, rechecks before dispatch. Email is a disabled provider abstraction with no transport.
- `.ics` export of scheduled rounds and open assessment deadlines. No external calendar OAuth.
- Open: reminders not surfaced in Today; no calendar duplicate matching.

## Verification (merged branch)

| Check | Result |
| --- | --- |
| ESLint | clean |
| TypeScript and Vite build | pass |
| Server tests | 271/271 |
| Playwright e2e | desktop 35/35, mobile 35/35 |
| Device suite | 18/18 |
| `npm audit` | 0 vulnerabilities (lockfile bump of `fast-xml-parser` via `npm audit fix`) |
| PostgreSQL 18 (local throwaway instance) | existing `test:postgres` suite 73/73; new discovery, preparation, insights, reminder-rule and calendar tests 45/45, run with all migrations applied |

Not run: hosted Supabase Postgres, any live provider, any production check. The new test files are now in the `test:postgres` script.

## Still owner-gated

Hosted Gmail drill, representative consented labeled mail and stage-safety evaluation, backup-restore drill, verified domain and Google restricted-scope review, independent security review, pilot feedback. See `reference/phase0/production-readiness.md`.
