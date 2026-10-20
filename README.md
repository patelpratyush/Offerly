# Offerly

A private job-search workspace implementing the manual-tracking foundation of [the build plan](Job_Search_App_Build_Plan.md) and [PRD](Job_Search_Workspace_PRD.md).

## Run locally

Requires Node.js 24 or later.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173 and create an account. No API keys or external services are needed. Accounts start empty; sample data is not mixed into your workspace. SQLite persists locally in `data/offerly.sqlite` (gitignored). The API listens on port 3001, accessible only from this machine.

## Implemented

- Asynchronous scrypt authentication, persistent throttling, expiring/idle-limited HttpOnly sessions, CSRF/origin protection, account-scoped queries, and password change with session revocation.
- Today dashboard with open tasks and explicitly scheduled interview rounds.
- Applications: create/edit, board/table, shared company/source/date/work-arrangement filters, sorting, and stage/priority/response-owner filters, archive/restore, custom stage ordering, unified application/child-record timeline with note revisions and historical link evidence, version conflict detection.
- Contacts with multiple emails, explicit confirmation, field-level source/evidence, agency/hiring company, relationship, phone/LinkedIn and last interaction; many-to-many application links. Tasks and named interview rounds with independent status/date/timezone.
- Offer outcomes and decision dates independent of stage. Listing capture dates/source URLs and immutable description history; unknown legacy capture dates remain unknown.
- Assessments with date-only deadlines, explicit completion and results; outstanding assessments appear on Today.
- Duplicate comparisons using requisition, job URL, and title evidence; keep separate or archive with undo and conflict protection.
- Private PDF/DOCX uploads, immutable numbered document versions and application links, authenticated original-file downloads. Explicit submitted-document records preserve exact version/hash/date/purpose; corrections, retractions and restoration retain history. Uploading or linking a document does not imply submission.
- Guided CSV import: column mapping, explicit ISO/US/European date formats, invalid-row previews, within-file and existing-record duplicate review, per-row skip/import/keep decisions. Preview-backed atomic commits are retry-safe. Application CSV and full JSON export include original files/history and import decisions.
- Workspace timezone, basic current-stage counts, password-confirmed account deletion.
- Responsive layouts, labeled fields, keyboard board editing, dialog focus containment, reduced-motion support, locally served fonts.

## Validation

```sh
npm test
npm run build
npx playwright install chromium
npx playwright test
```

API tests use isolated in-memory databases. Browser tests create clearly named `test-*` accounts in the active local database and exercise desktop/mobile flows. Use a separate `DATABASE_PATH` when you want disposable end-to-end test data.

## Architecture

React + TypeScript with Vite; Express API; Node's built-in SQLite. The schema separates users, sessions, user-owned typed records, append-only events, and immutable file blobs. Runtime validation uses Zod. Every private lookup includes account ownership. API edits require the current record version; clients preserve editor drafts after failed saves.

`src/main.tsx` contains workspace views; `server/app.js` contains authenticated routes and validation; `server/store.js` owns persistence and transactional record/event writes. Integration workers are intentionally not simulated.

## Scope and remaining work

This is a **local pilot foundation**, not the full email-enabled P0 release. See [implementation status](IMPLEMENTATION_STATUS.md) for remaining acceptance criteria. Gmail/OAuth, email extraction and review, job discovery, alerts, AI preparation, calendar, browser extensions, and deployment are not implemented. No outgoing messages or applications are sent.

CSV previews expire after one hour. Successful commits retain compact replay receipts for seven days; committing that preview again returns its original result; uploading the file again creates a fresh preview with duplicate candidates. Choosing Keep explicitly creates a separate application. Duplicate review preserves both records and their relationships; true record merging is not implemented. Automation undo, reminder delivery, bulk editing, saved views, and compensation fields remain open.

UI references and design decisions: [design notes](docs/DESIGN_REFERENCES.md).

Document validation now checks PDF signatures and DOCX ZIP/XML structure and expansion limits. Production uploads require ClamAV scanning and fail closed on scanner errors; local uploads remain unscanned unless configured. Read [SECURITY.md](SECURITY.md) for verified controls, exact quotas, deployment setup, and unresolved launch blockers. No zero-risk or public-production-readiness claim is made. SQLite remains a single-instance architecture; the PRD's 100-user load targets are unverified.

## Production build

```sh
npm run build
APP_ORIGIN=https://offerly.example.com TRUST_PROXY_LOOPBACK=true npm start
```

This serves the built frontend and API on loopback port 3001 behind your HTTPS proxy. An exact HTTPS `APP_ORIGIN` is mandatory. `TRUST_PROXY_LOOPBACK=true` is appropriate only for a same-host proxy that overwrites forwarding headers. See [proxy example](deploy/nginx.conf.example) and [.env.example](.env.example). Production registration is disabled unless a strong invitation secret is configured; file uploads are disabled until a scanner is configured. No hosted deployment, TLS certificate, scanner daemon, backup service, or production database has been provisioned.

## Security verification

```sh
npm run check
npm run test:e2e
```

CI runs lint, API/security regressions, frontend type/build checks, dependency audit, and desktop/mobile browser workflows. GitHub workflow files are configured; they have not been run on a hosted repository in this session. Existing sessions are invalidated once when migrating to idle-expiry tracking; existing password hashes upgrade on successful sign-in. Existing local uploads remain usable locally, but production requires re-uploading unscanned files.

## Database recovery

Verified online snapshots and restoration to a new database path are available through `npm run db:backup` and `npm run db:restore`. See [the recovery runbook](docs/BACKUP_RESTORE.md) for commands, prerequisites and limitations.

## Staged implementation

[Delivery steps](docs/DELIVERY_STEPS.md) tracks the full build sequence. Applications now support saved views, atomic bulk edits, explicit compensation and reversible duplicate merging. See [implementation status](IMPLEMENTATION_STATUS.md) for remaining PRD work and verification evidence.

Browser tests use isolated ports `4173` (web) and `3002` (API), plus a temporary database. They do not reuse the development server or `DATABASE_PATH`. Leave these ports free when running `npm run test:e2e`; the normal development app stays on `5173`/`3001`.
