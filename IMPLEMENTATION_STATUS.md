# Implementation status

The PRD and build plan define scope; this file records implementation evidence and gaps. Milestone completion must follow the recorded acceptance results.

## Current checkpoint — October 23, 2026

This section supersedes older historical checkpoint descriptions below. The private manual tracker, hosted Supabase/Vercel deployment, private scanned Blob uploads, hosted scheduler, and recovery-code password reset are implemented. Recent CI fixes are on main.

Phase 0 has verified six public-board probes, real seven-day Gmail retrieval (612 messages), reusable local Keychain authorization, and a bounded historical recruiting import: 20 messages yielded one structured unresolved review candidate and 19 abstentions; replay created zero new candidates. No mailbox content or evidence was persisted or sent to AI. Eighteen fictional labeled cases and strict evaluation/provenance tooling exist. Current source access and Google dependencies are reviewed in [access decision](reference/phase0/access-decision.md); this is not public-catalog permission or hosted OAuth approval.

Phase 0 feasibility evidence is recorded, with a no-go on production AI matching. Fresh synthetic run returned 19/24 valid model outputs; raw link precision was 13/18 and event recall 14/18. A source-evidence guard raised valid-only link precision to 13/13 while reducing coverage to 13/19. These tiny, developer-authored synthetic results do not meet PRD quality gates. GPT API is a possible next synthetic-only comparison if free credits are verified; additional AI spend remains capped at $0 and real mail must not go to external AI without separate opt-in. Hosted OAuth/storage, two-hour incremental sync, workspace application import, representative release accuracy, and public discovery remain later release work. See [Phase 0 evidence](reference/phase0/README.md), [production blockers](reference/phase0/production-readiness.md), [import proof](reference/phase0/import-proof-report.json), and [evaluation](reference/phase0/evaluation.md).

The sections below retain prior implementation history and do not override this checkpoint.

## M0 — Integration validation: pending

No external credentials, model provider, source permission decisions, or labeled mailbox data were provided. Gmail consent/import, source connectors, source conditions, extraction evaluation, and production stack/budget decisions remain open. Local stack: React/TypeScript, Express, SQLite; no external AI processing.

## M1 — Manual tracker: step 1 implemented

| Requirement                       | Status                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and data isolation       | Implemented locally; ownership regression tests included                                                                                                                           |
| Application table and board       | Stage shortcut strip, shared search/company/source/date/work-arrangement/priority/response-owner filters, date/company/priority sorting                                            |
| Custom stages and ordering        | Implemented; occupied stages cannot be removed                                                                                                                                     |
| Rounds and manual scheduling      | Implemented independently of application stage; no inferred completion                                                                                                             |
| Contacts, notes and tasks         | Multiple emails, explicit identity confirmations, agency/hiring company, relationship, phone/LinkedIn, last interaction and field-level provenance; cross-account links rejected   |
| Document versions and submissions | Immutable private versions and explicit submission records with exact file/version/hash, date and purpose; corrections/retractions retain history; real scanner deployment pending |
| Offer outcomes                    | Pending/accepted/declined with validated received/decision dates, independent of stage; CSV support                                                                                |
| Listing evidence                  | Capture date/source, immutable description revisions and legacy unknowns; CSV and full JSON export                                                                                 |
| Timeline                          | Tabbed detail with unified child events, historical links/unlinks, note revisions, before/after changes, actor attribution                                                         |
| CSV import/export                 | Guided column mapping, explicit date formats, invalid rows and within-file duplicates, per-row decisions, atomic commits and replay protection; stable export IDs                  |
| Export/deletion                   | Full JSON with original files; cascade deletion and session invalidation                                                                                                           |
| Responsive layout                 | Desktop/mobile browser workflow checks included                                                                                                                                    |
| Optimistic concurrency            | Version checks on record edits                                                                                                                                                     |
| Advanced application fields       | Work arrangement, employment type and compensation amounts/currency/period/base-or-total basis implemented; unknowns remain explicit                                               |
| Assessments                       | Independent status, deadline, manual completion date/results, Today deadlines and timeline                                                                                         |
| Duplicate review                  | Compare, keep separate, archive, or preview and merge linked records; version-checked reversal preserves later edits and immutable file bytes                                      |
| Advanced tracking                 | Account-owned saved filters/layout/sort; atomic bulk stage/priority/response-owner/archive changes (up to 100 selections), seven-day replay receipts                               |
| Public release readiness          | Security hardening and CI added; public auth verification/recovery, live scanner/TLS/encrypted storage, generic mutation idempotency, load/security/restore validation pending     |

## M2–M5 — Not implemented

- M2: Gmail OAuth and durable sync, structured extraction, matching and evidence, review queue, corrections/undo, automatic field locks, reminder delivery, labeled precision evaluation.
- M3: company/source registry, permitted collection adapters, job catalog/freshness, verified profile, evidence-backed fit ranking, company-size and recency filters, notification rules and delivery.
- M4: truthful resume/cover-letter generation, reusable answers, calendar sync, reviewed drafts, optional sending, historical cohort analytics.
- M5: browser extension, supported form filling, Outlook, expanded source coverage.

## Recommended next implementation slice

Steps 1 and the scoped step 2 foundation are implemented. Follow step 3 in `reference/DELIVERY_STEPS.md`: configure Gmail OAuth and consented fixtures before provider ingestion. Deployment readiness remains a separate step.

For Gmail: provision a Gmail OAuth client and consented test mailbox; decide retained-content window and provider processing policy. Implement durable jobs and a review-only ingestion path before enabling automatic changes. Evaluate ambiguous same-company roles, duplicate replay, out-of-order events, disconnect/delete during import, and untrusted email content using synthetic/consented fixtures. Keep the manual workspace available during provider failures.

## UI refinement

Simplify, Teal, and Huntr informed stage visibility, tracker controls, and connected application details. Offerly retains its own forest-green identity. Guided import/review dialogs and tabbed details support desktop and mobile. Reference links and concrete design choices are in `reference/DESIGN_REFERENCES.md`.

## Verification for this increment

- 11 API regression tests cover ownership, optimistic concurrency, CSV date interpretation/atomicity/replay, historical child links, assessment completion, and duplicate review/undo.
- 6 desktop/mobile browser workflows cover manual tracking, guided imports, filters, duplicate decisions, assessments, and activity views.
- Automated WCAG 2 A/AA checks on the populated application table pass on desktop and mobile. This is a focused check, not a full accessibility certification.
- TypeScript checking and production build pass.
- Synthetic-data previews: `reference/screenshots/applications.png`, `reference/screenshots/today-mobile.png`, and `reference/screenshots/application-activity.png`.

## Security hardening increment

Implemented bounded asynchronous scrypt, persisted rate limits, idle/absolute session expiry, secure production cookies, password change/revocation, password-confirmed deletion, canonical request/origin/host checks, route-specific body limits, generic error handling, upload/archive/XML checks and fail-closed malware scanning, private file permissions, account quotas, bounded duplicate review, bounded-memory file export, pinned CI actions, and dependency-update configuration.

Security regressions cover authentication, authorization, forged requests, file and document isolation, disguised DOCX archives, scanner responses/outages, and error redaction. See `SECURITY.md` for exact guarantees and limits. This increment does **not** establish zero risk or approve public production launch. Real TLS, antivirus/signature updates, encrypted storage, backup restoration, public-account lifecycle and independent deployment security review remain external prerequisites.

### Paused checkpoint — 2026-10-19

Paused at the user's request after verification completed: 24 API/security tests and 8 desktop/mobile browser tests passed. Backend lint, TypeScript checking, production build and dependency audit passed; the audit reported zero known vulnerabilities. Changes remain local and uncommitted; no deployment was performed. Resume with the production prerequisites in `SECURITY.md` before public release.

### Recovery tooling increment — 2026-10-20

Added `npm run db:backup` and `npm run db:restore`: consistent online SQLite snapshots, integrity/schema/foreign-key checks, private staging and atomic publication to fresh paths, no overwrite of existing databases or symlinks, and session revocation on restoration. `reference/BACKUP_RESTORE.md` documents restoration, post-snapshot account deletion/password reconciliation, and deployment responsibilities. No live user database was backed up or restored during implementation.

Verification: all 27 API/security/recovery tests passed, along with backend lint, TypeScript checking, production build, and dependency audit (zero known vulnerabilities). Final destination-symlink tightening passed lint and all 3 focused recovery tests. Browser tests were not rerun for this backend CLI-only increment; the previous checkpoint's 8 browser tests passed. Encrypted storage, scheduled/off-host backups and a real deployment restoration drill remain pending.

### Staged build: tracker expansion — 2026-10-20

Added `reference/DELIVERY_STEPS.md` as the staged execution roadmap. This slice delivers:

- Private saved views with filters, sorting, archived visibility and table/board layout; create/update/remove persist across reloads.
- Table/board selection and atomic bulk priority, stage, response-owner and archive/restore edits. Selection clears when filters change; maximum 100 records. Ownership/version validation and bounded seven-day operation receipts protect against partial edits and duplicate retry history.
- Compensation minimum/maximum decimal values, currency code, pay period and base/total/unknown basis, including editor, detail, CSV mapping/export and history. Unknown values are never replaced with zero; currencies/periods are not converted.
- Duplicate merge previews list affected contacts, documents, tasks, assessments and rounds. The chosen primary fields remain; the other application is archived with original notes/history accessible. File bytes stay immutable. Preview fingerprints detect linked-record changes; version-checked undo restores original links and refuses to overwrite later edits. Merges are bounded to 100 linked records and a 200 KB reversal snapshot.

Verification: all 31 API/security/recovery tests passed; backend lint, TypeScript and production build passed; dependency audit reported zero known vulnerabilities. Ten desktop/mobile workflows passed in the full browser run. The two merge workflows initially failed on an overly exact text locator; after correcting the test locator, both passed in a focused rerun. Expanded document-link/byte preservation coverage also passed. No deployment or external provider connections were made.

At this checkpoint, contact provenance, submitted-document usage, offer outcomes and listing metadata remained open. The completion increment below closes those step 1 gaps; later milestones remain open.

### Production-quality review — 2026-10-20

Fixed account-state retention across logout/session expiry, stale workspace/timeline responses, and a password-change revocation race. Account state now remounts on resets, requests from earlier session generations are discarded, timeline responses must match the active application, and supporting browsers clear other open tabs through BroadcastChannel. Password changes recheck the initiating session after the final asynchronous hash before committing.

Added regression coverage for account switching with private dialogs open, delayed timeline responses, cross-tab logout, revocation during password changes, and history-quota failures after a bulk/merge transaction has already written its first record. The latter verifies rollback of records, events, review records and operation receipts.

Browser tests now use dedicated loopback ports 4173/3002 and a temporary database with normal production rate limits. They refuse to reuse a development server and clean up their database on normal shutdown. This prevents test accounts and persisted throttling counters from contaminating the developer's workspace. Lint now also covers tests and runtime configuration; frontend checking remains strict TypeScript plus browser verification.

Verification: all 33 backend tests passed, lint/build/type checking passed, and dependency audit found zero known vulnerabilities. Seventeen of eighteen desktop/mobile scenarios passed in the full final browser run; the remaining mobile test targeted a desktop-only sidebar control. After changing that test to use Settings, both desktop/mobile cross-tab logout tests passed. All eighteen scenarios are verified across the full run and focused rerun. No public-production certification is implied; the deployment and public-account blockers in `SECURITY.md` remain open.

### Step 1 completion — 2026-10-20

Closed the remaining manual-tracker gaps:

- Contacts retain multiple email addresses, explicit confirmations, agency/employer/hiring-company distinctions, relationship, phone/LinkedIn and last interaction. Field-level sources and evidence have server-recorded timestamps. Changed values discard inherited confirmations and stale evidence; names never trigger automatic identity merging.
- Submitted-document records identify the exact immutable version, original file hash, submission date and purpose. Corrections, retractions and restorations retain history. Repeated identical creates return the existing active record; conflicting evidence requires an explicit correction. Duplicate merge/undo includes submission links without altering file bytes. Legacy version numbers remain unknown.
- Offer outcomes and received/decision dates are validated independently of application stage and included in CSV mapping/export.
- Listing edits atomically append immutable description/source/capture snapshots. Legacy descriptions are preserved before replacement without inventing capture dates. Unrelated edits do not append redundant captures. History-quota failure rolls back both the application change and its events. Full JSON export includes all new records and history.

Step 1 is complete for the manual pilot. Step 2 (durable recruiting review/jobs) is next. Gmail, discovery, recommendations, generated documents, extension support and public launch remain outside this completed slice. The public-production prerequisites in `SECURITY.md` still apply.

Final verification: `npm run check` passed (52 backend/API/security/recovery tests, ESLint, strict TypeScript, production build and dependency audit with zero known vulnerabilities). `npm run test:e2e` passed all 24 desktop/mobile scenarios in one clean run. Populated contact and application editors passed focused WCAG 2 A/AA checks; desktop/mobile screenshots were inspected. These checks do not constitute full accessibility certification or a zero-risk security guarantee. Synthetic previews: `reference/screenshots/contact-editor-mobile.png` and `reference/screenshots/listing-history-desktop.png`. Changes remain local; no deployment performed.

### Step 2 — recruiting review foundation

Implemented a manual evidence path into durable queued jobs and a Reviews page. Pasted evidence, source references, explicit-offset effective timestamps and user-proposed changes remain immutable. A separate Node worker runs outside API requests, claims bounded jobs with leases, recovers abandoned leases, backs off failures, stops after three attempts and supports explicit retry/cancel. Owner-scoped operation receipts prevent duplicate ingestion and decisions; conflicting operation/source IDs return conflicts.

Reviews show candidate applications and matching rationale; they never apply automatically. Accept/reject/correct and undo preserve append-only history. Stage/response-owner manual edits and corrected proposals set field locks. Older evidence, protected fields and terminal reopening require an explicit per-decision override. Application versions and field-decision versions prevent stale edits or undo from overwriting subsequent work. Account deletion cascades jobs, evidence, decisions, locks, reminders and receipts. Full JSON export retains them.

Added date-only in-app reminders on application follow-ups, rounds, assessments and tasks, with snooze/dismiss/cancel and history. The scheduler uses workspace-local calendar dates without inventing midnight timestamps. Source changes cancel obsolete reminders within the source edit transaction; closed applications cancel general follow-ups while explicit tasks remain until completed. Worker failure isolation and bounded scans keep one account's failed reminder from blocking later records. Today refreshes while visible.

Scope: user-proposed stage/response-owner changes only, manual evidence only, no extraction confidence claims, no Gmail connection, no automatic status changes, no outgoing notifications. Gmail event extraction, provider-specific disconnect behavior and precision evaluation remain step 3/M2 work. Public deployment prerequisites remain unchanged.

Verification: all 62 backend/API/security/recovery tests and all 26 desktop/mobile browser scenarios passed. Final mobile form refinement and stronger cross-account scheduler failure test passed the 10 focused backend tests and both review/reminder browser scenarios again. ESLint, strict TypeScript, production build and dependency audit passed (zero known dependency vulnerabilities). Focused WCAG 2 A/AA review-page checks passed; screenshots were inspected and saved under `reference/screenshots/recruiting-{desktop,mobile}.png`. These are scoped checks, not production certification. Verification completed before committing Step 2. No deployment was performed.
