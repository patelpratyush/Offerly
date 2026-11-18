# Phase 2 integration audit

Inspected 2026-11-04 on `main`, HEAD `6e8acef3e8d7d884d78ea7062f19de36c3f7c2b3`.
This is an implementation gap audit, not a completion or production-readiness claim.

## Preserve

Existing edits to IMPLEMENTATION_STATUS.md and Job_Search_App_Build_Plan.md, and
untracked PHASE1_AUDIT.md and the two docs/phase0 owner-context files predate this
audit. Preserve them. No private review packets or credential files were read.

## Existing implementation

- server/recruiting.js: durable evidence jobs, pending reviews, explicit acceptance,
  corrections, undo, optimistic versions, field locks, chronological guards,
  retry and cancellation. Reuse these mechanisms.
- server/scheduler.js: persistent scheduler lease and queue cursors. Extend this
  worker; do not introduce a competing scheduler.
- server/store.js: user-owned records and cascading account deletion. Credentials
  need a separate private persistence path, outside exported/audited record data.
- server/integrations/gmail-local.js: local Desktop OAuth, read-only scope,
  PKCE, bounded provider responses, sanitized errors and revocation helper.
  This is not a hosted web OAuth implementation.
- Existing reminders and manual tracking remain the integration targets.

## Remaining implementation

1. Hosted web OAuth callback with session-bound, expiring, single-use state and
   PKCE; configured HTTPS redirect; encrypted per-user refresh credentials in
   private storage. Never put credentials into record events or workspace export.
2. Durable user-selected import window and message budget, page checkpoints,
   progress, cancellation, retry and connection-generation fencing.
3. Two-hour due scheduling through the existing scheduler; History API pagination,
   cursor advancement only after durable handling, bounded expired-history resync,
   rate-limit backoff and reconnect-required state on revoked credentials.
4. Minimized source evidence and recruiting/contact proposals. Matching must
   abstain on ambiguity. Company-only matching cannot resolve multiple applications.
5. Route proposals into the existing review flow. Acceptance must remain the
   only path that changes application fields; preserve locks and event chronology.
6. Accepted reply ownership and event proposals must reconcile Today and reminder
   lifecycle, including canceled and rescheduled events.
7. Disconnect must fence in-flight commits, stop pending jobs, revoke credentials,
   remove local secrets and apply evidence retention. Account deletion needs the
   same lifecycle plus removal of derived private data.

## Evidence and release boundaries

Production AI and automatic stage updates remain disabled. Empty tracker means
real stage-safety evidence is unavailable. Synthetic tests can demonstrate code
behavior only. AI extraction remains incomplete until its evidence gates pass.

Hosted OAuth needs web-client configuration and consented isolated-account
verification. Public release also retains the verified-domain, privacy,
restricted-scope and security-review requirements recorded in Phase 0.
Retention needs an explicit disclosed policy before hosted sync is enabled.

Provider references checked during audit:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/guides/sync

Google documents HTTP 404 for expired history and requires full synchronization.
Capture a safe starting cursor before enumeration and catch up changes before
declaring initial synchronization complete; do not blindly adopt a cursor read
after enumeration and lose concurrent mailbox changes.

No implementation changes or new test results are claimed by this audit.
