# Offerly

A private job-search workspace implementing the manual-tracking foundation of [the build plan](Job_Search_App_Build_Plan.md) and [PRD](Job_Search_Workspace_PRD.md).

Reviews accept pasted evidence and your proposed stage/response-owner changes. Background processing creates review items; you explicitly accept, reject, correct or undo them. Manual field protections and evidence chronology prevent silent overwrites. Today supports date-only in-app reminders with snooze/dismiss/cancel. Gmail and AI extraction are not connected.

## Run locally

Requires Node.js 24 or later.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173 and create an account. No API keys or external services are needed. Accounts start empty; sample data is not mixed into your workspace. SQLite persists locally in `data/offerly.sqlite` (gitignored). The API listens on port 3001, accessible only from this machine. The server starts a separate background worker against the same SQLite database; the service exits if its worker unexpectedly stops so your process manager can restart both.

## Implemented

- Asynchronous scrypt authentication, persistent throttling, expiring/idle-limited HttpOnly sessions, CSRF/origin protection, account-scoped queries, and password change with session revocation. Password-confirmed recovery codes provide self-service password reset without an email provider.
- Today dashboard with open tasks and explicitly scheduled interview rounds.
- Applications: create/edit, paginated table and progressively loaded board, shared company/source/date/work-arrangement filters, sorting, and stage/priority/response-owner filters, archive/restore, custom stage ordering, saved views, bounded atomic bulk edits, explicit compensation fields, unified application/child-record timeline with note revisions and historical link evidence, version conflict detection.
- Contacts with multiple emails, explicit confirmation, field-level source/evidence, agency/hiring company, relationship, phone/LinkedIn and last interaction; many-to-many application links. Tasks and named interview rounds with independent status/date/timezone.
- Offer outcomes and decision dates independent of stage. Listing capture dates/source URLs and immutable description history; unknown legacy capture dates remain unknown.
- Assessments with date-only deadlines, explicit completion and results; outstanding assessments appear on Today.
- Duplicate comparisons using requisition, job URL, and title evidence; keep separate or archive with undo and conflict protection.
- Private PDF/DOCX uploads, immutable numbered document versions and application links, authenticated original-file downloads. Explicit submitted-document records preserve exact version/hash/date/purpose; corrections, retractions and restoration retain history. Uploading or linking a document does not imply submission.
- Guided CSV import: column mapping, explicit ISO/US/European date formats, invalid-row previews, within-file and existing-record duplicate review, per-row skip/import/keep decisions. Preview-backed atomic commits are retry-safe. Application CSV and JSON export retain workspace history; local JSON exports include file bytes, while hosted exports include private document metadata and authenticated download paths.
- Workspace timezone, basic current-stage counts, password-confirmed account deletion.
- Responsive layouts, labeled fields, keyboard board editing, dialog focus containment, reduced-motion support, locally served fonts.

## Validation

```sh
npm test
npm run build
npx playwright install chromium webkit firefox
npm run test:e2e
npm run test:devices
```

API tests use isolated in-memory databases. Browser suites create synthetic `test-*` accounts in disposable databases on dedicated ports 4173/3002, separate from the development app. The device suite covers Chromium/Android, WebKit/iPhone/iPad, Firefox, 320px touch and ultrawide profiles, including landscape, keyboard/panning simulation and larger application lists. Profiles emulate devices; physical keyboards, native zoom and screen readers still need hardware testing. See [device verification](reference/redesign/DEVICES.md).

## Architecture

React + TypeScript with Vite; Express API; Node's built-in SQLite. The schema separates users, sessions, user-owned typed records, append-only events, and immutable file blobs. Runtime validation uses Zod. Every private lookup includes account ownership. API edits require the current record version; clients preserve editor drafts after failed saves.

`src/main.tsx` contains workspace views; `server/app.js` contains authenticated routes and validation; `server/store.js` owns persistence and transactional record/event writes. Integration workers are intentionally not simulated.

## Scope and remaining work

This is a manual job-search workspace. Hosted sign-up remains invitation-only. Gmail/OAuth, email extraction, job discovery, alerts, AI preparation, calendar, and browser extensions are not connected. No outgoing messages or applications are sent.

CSV previews expire after one hour. Successful commits retain compact replay receipts for seven days; committing that preview again returns its original result; uploading the file again creates a fresh preview with duplicate candidates. Choosing Keep explicitly creates a separate application. Duplicate review preserves both records and their relationships; merge and undo are bounded and version checked.

UI references and design decisions: [design notes](reference/DESIGN_REFERENCES.md).

Document validation checks PDF signatures and DOCX ZIP/XML structure and expansion limits. Hosted uploads require private Blob storage and a fresh isolated ClamAV scanner; they fail closed on scanner errors and accept files up to 2 MiB. Read [SECURITY.md](SECURITY.md) and [deployment setup](reference/SUPABASE_VERCEL.md) for controls and operational requirements. No zero-risk or public-production-readiness claim is made. SQLite remains a single-instance architecture; the PRD's 100-user load targets are unverified.

## Production build

```sh
npm run build
APP_ORIGIN=https://offerly.example.com TRUST_PROXY_LOOPBACK=true npm start
```

This serves the built frontend and API on loopback port 3001 behind your HTTPS proxy. An exact HTTPS `APP_ORIGIN` is mandatory. `TRUST_PROXY_LOOPBACK=true` is appropriate only for a same-host proxy that overwrites forwarding headers. See [proxy example](deploy/nginx.conf.example) and [.env.example](.env.example). Local registration works without external services; hosted registration remains invitation-only. Hosted service setup is documented in [Vercel and Supabase deployment](reference/SUPABASE_VERCEL.md).

## Security verification

```sh
npm run check
npm run test:e2e
```

CI runs lint, API/security regressions, frontend type/build checks, dependency audit, and desktop/mobile browser workflows. GitHub workflow files are configured; they have not been run on a hosted repository in this session. Existing sessions are invalidated once when migrating to idle-expiry tracking; existing password hashes upgrade on successful sign-in. Existing local uploads remain usable locally, but production requires re-uploading unscanned files.

## Database recovery

Verified online snapshots and restoration to a new database path are available through `npm run db:backup` and `npm run db:restore`. See [the recovery runbook](reference/BACKUP_RESTORE.md) for commands, prerequisites and limitations.

## Staged implementation

[Delivery steps](reference/DELIVERY_STEPS.md) tracks the full build sequence. Applications now support saved views, atomic bulk edits, explicit compensation and reversible duplicate merging. See [implementation status](IMPLEMENTATION_STATUS.md) for remaining PRD work and verification evidence.

Browser tests use isolated ports `4173` (web) and `3002` (API), plus a temporary database. They do not reuse the development server or `DATABASE_PATH`. Leave these ports free when running `npm run test:e2e`; the normal development app stays on `5173`/`3001`.

## Recover a forgotten password

While signed in, open Settings → Recovery codes, confirm your current password, and generate a set. Save it in a password manager before dismissing it; codes cannot be displayed again. Each code contains 128 bits of randomness, and only its hash is stored.

On sign-in, choose “Forgot password? Use a recovery code,” enter your email, a saved code, and a new password of at least 15 characters. Successful recovery signs out all sessions and invalidates the entire code set. Sign in and generate a new set. Normal password changes also invalidate recovery codes. If both password and codes are lost, this feature cannot recover the account.

The browser test script runs desktop and mobile suites separately, each with a fresh temporary database, so their synthetic account creations do not share a signup rate-limit budget. Production limits remain enabled.
