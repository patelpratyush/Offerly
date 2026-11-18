# Phase 1 manual tracker audit

Audited November 1, 2026, on main at `6e8acef`. No product features were added. Scope: the four Phase 1 requirements and manual export exit condition in the build plan.

## Requirement evidence

| Requirement | Existing implementation / proof |
| --- | --- |
| Authentication and private account data | `server/security.js`, `server/app.js`; security, API, recovery and browser account-transition tests cover ownership, sessions, password changes, recovery and deletion. |
| Table, board, stages, rounds and timeline | `src/main.tsx`, `Timeline.tsx`, tracker APIs; workspace/tracking browser tests cover persistence, filters, saved views, bulk edits, rounds and history. |
| Contacts, notes, tasks and documents | Contact provenance, independent tasks, immutable document versions and submitted-document usage already exist. Contact-details, document-usage and tracker-completion tests cover ownership and retained evidence. |
| CSV and responsive layouts | Guided mapping, date validation, duplicate review and replay protection exist. Tracking/redesign browser tests cover desktop/mobile behavior. Separate device suite covers more viewport/browser combinations. |
| Manual lifecycle and export | Manual stages remain independent of rounds, tasks and offer outcome. CSV and JSON export exist; hosted export limitations are below. |

No missing core Phase 1 feature found in this audit. Automated coverage does not establish usability for a new user or certify public launch.

## Remaining gaps, in priority order

1. **Pilot usability evidence:** David has not yet reported results. Exercise the existing app before choosing another product slice. Record each issue with screen, viewport/browser, steps, expected/actual result and impact. Keep application names, resumes, evidence and account details out of committed reports; use synthetic reproductions.
2. **Hosted portability limits:** Hosted JSON export omits original document bytes, provides authenticated download paths and rejects payloads over 3 MiB. Originals require individual downloads while the account exists. CSV exports applications, not a full workspace backup. No full-workspace client restore/import path is established; SQLite recovery tooling does not prove hosted PostgreSQL restoration. These are documented limits, not missing export buttons.
3. **Operational/public launch proof:** Real hosted restore drill, monitoring/alerting, independent security review, broader accessibility review and declared-load validation remain open. Invitation-only pilot is distinct from public signup; recovery codes exist, but public email verification/recovery and stronger account lifecycle remain later work. Follow `SECURITY.md` together with `reference/operations/SUPABASE_VERCEL.md`; SQLite instructions alone do not describe hosted deployment.
4. **Documentation drift:** Phase 1 checklist was unchecked despite delivery. Historical status rows still describe scanner/recovery and all M2 work as pending. Current audit supersedes that shorthand: hosted scanning, recovery codes, scheduler, manual reviews and in-app reminders already exist. No reason to rebuild them.

## David's manual pilot checklist

- Create an application, edit it, reload, find it through table filters and board stages.
- Move stages manually; add a round, task, note and contact. Confirm those records remain independent and history explains edits.
- Upload a synthetic PDF/DOCX within the hosted 2 MiB limit; create another version and record which version was submitted.
- Import a small synthetic CSV; inspect invalid rows and duplicates before committing. Try a saved view and bulk edit.
- Set a follow-up/reminder, inspect Today, and complete or reschedule its source.
- Export CSV/JSON and download an original document. Confirm downloaded data is usable before deleting any disposable test account.
- Repeat key actions on a phone; report unclear labels, blocked controls, failed saves and unexpected navigation.

This checklist requests no credentials, private email packet or production AI calls. Do not put invitation tokens or recovery codes in feedback.

## Automation boundary

Production AI and automatic stage updates remain disabled. `server/recruiting.js` accepts user-proposed changes, creates pending reviews and requires explicit authenticated decisions; background processing does not apply inferred stages. Phase 0 model scripts are experiments, not production integration. Empty owner tracker means real candidate/stage context is unavailable; no real stage-safety score can be claimed. Gmail OAuth/sync, extraction and provider disconnect behavior remain later integration work.

## Verification

`npm run check` passed: ESLint, 197 tests, strict TypeScript, production build and dependency audit (zero vulnerabilities). `npm run test:e2e` passed all 40 scenarios (20 desktop, 20 mobile). `git diff --check` passed. Tests use isolated fixtures; no live mailbox, production account or private review packet is needed. PostgreSQL and broader device verification from the user's reported passing GitHub Verify run at `6e8acef` were not independently rerun against hosted services in this audit.

Existing untracked `docs/phase0/stage-context-owner-guide.md` and `stage-context-owner-template.csv` remain untouched and uncommitted. No credential files or private review contents were read, staged or committed.
