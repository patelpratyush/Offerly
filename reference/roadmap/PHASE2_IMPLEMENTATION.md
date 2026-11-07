# Phase 2 implementation checkpoint

Hosted Gmail code added on main, extending existing manual review foundation.

- Private credential/state tables; AES-256-GCM per-user credentials, session-bound single-use OAuth state and PKCE; read-only Gmail scope.
- Bounded historical import, durable progress and page continuation, cancellation/retry, incremental history processing and expired-history resync.
- Existing scheduler and local worker invoke Gmail queue; two-hour sync due times live in durable state.
- Conservative deterministic extraction creates evidence and pending reviews. Application changes require explicit acceptance. Contact proposals require separate acceptance and remain unverified.
- Disconnect fences workers, removes credentials and retained Gmail evidence, attempts provider revocation. Account deletion invokes same cleanup.

## Configuration

Apply both 20261104 Gmail migrations before hosted startup. Set server-only GMAIL_ENABLED=true, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REDIRECT_URI (HTTPS /api/gmail/callback), and GMAIL_ENCRYPTION_KEY (base64 encoding of 32 random bytes). Keep encryption key stable and back it up separately from database backups. Never expose these through VITE variables.

Connection UI requires explicit acceptance of 30-day evidence retention. Existing Phase 0 domain, scope verification and security gates still apply. No live provider validation or production-readiness claim exists. AI extraction and automatic stage updates remain disabled; real stage-safety evidence remains unavailable with empty tracker.

Remaining release validation: hosted deployment/RLS verification, isolated consented mailbox OAuth/import/history/revocation drill, and representative extraction evaluation. Repository tests do not establish a production quality pass.

## Follow-up 2026-11-05

Explicit event action endpoint and review form now support user-confirmed task,
assessment and round creation/update. Users supply actual dates/timezones and
select existing targets for reschedules/cancellations. Existing reminder source
reconciliation handles changes; review undo restores unchanged targets and
refuses later edits. Contact acceptance remains separate and unverified.

OAuth callback receives a narrow cross-site GET exception and SameSite=Lax
session cookie; all mutation origin/header protections remain. OAuth states stay
session-bound, expiring and single-use. Isolated PostgreSQL migration/OAuth tests
passed; real hosted Gmail authorization and quality evidence remain open.

## Verified implementation boundary

SQLite full check passed 211 tests, lint, build and dependency audit (zero
vulnerabilities) during integration. Final focused Gmail run passed 14 tests;
recruiting/actions run passed 12. Isolated PostgreSQL full selected suite passed
73 tests, including migrations, owner isolation, review, undo, scheduler and
reminders. Stable browser rerun passed all 42 scenarios (21 desktop, 21 mobile). Initial run was invalidated by concurrent frontend hot reload; all three affected flows passed after frontend freeze.

Code remaining in the earlier checkpoint has been implemented: contact
provenance retention redaction, event actions/undo, and explicit partial-coverage
reporting. These replace the earlier code-gap list, not external release gates.

Phase 0 and production Phase 2 cannot be marked fully accepted without owner
tracker evidence and provider-backed verification. Required external work:
verified app domain/privacy disclosures, Google web OAuth client and restricted
scope approval/security assessment as applicable, hosted migration/deployment
and consented mailbox drill, representative independently labeled candidate and
tracker-context evaluation. Do not use synthetic passes to check these boxes.

Latest Gmail tests also passed 14/14 against isolated PostgreSQL. Deterministic
extractor supports a deliberately limited phrase set and abstains on conflicting
signals. It does not infer deadline or meeting dates, identities from names,
application stages from silence, or completion from elapsed time. Event forms
require user confirmation of those facts. Extraction recall and real-mail
application-link precision remain unmeasured; no production quality pass exists.

Final frozen-code `npm run check` passed (ESLint, full test suite, strict TypeScript, Vite build, zero dependency vulnerabilities). Full browser rerun passed 42/42 scenarios. `git diff --check` passed. No production deployment or provider-backed mailbox result is claimed.

## Gated AI follow-up (2026-11-06)

Hosted AI adapter now exists behind disabled enable/quality/evidence/model/prompt
approval gates and versioned user consent. Exact source-quote and application
identity guards constrain review proposals. Private per-user/project reservations
bound estimated daily spend and request count, including retries. Consent is
rechecked before network and evidence commit; disconnect withdraws it. Provider
failures are sanitized and retryable. Offline aggregate evaluator added.

Full check passed 226 tests, build/lint and zero vulnerabilities; CI-mode browser
run passed 42 scenarios. Focused policy tests passed SQLite and isolated
PostgreSQL. Synthetic checks do not establish real accuracy. No real email was
sent to AI. Production flags explicitly remain false. See
`reference/operations/RECRUITING_AI.md` for release requirements.

OAuth compatibility fix upgrades legacy Strict cookie at Connect to Lax without
extending absolute session expiry. Auth reset now explicitly shows sign-in after
URL cleanup; browser tests verify expiry/logout/password transitions.
