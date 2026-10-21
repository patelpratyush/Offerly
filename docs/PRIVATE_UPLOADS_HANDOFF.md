# Private document uploads — paused checkpoint

User requested stopping at a safe spot. This branch is unfinished and must not be deployed or merged yet.

## Live state

- Production remains on `9ad82c1`; hosted uploads are still disabled.
- Existing review/reminder scheduler is unchanged.
- Empty Vercel private Blob store `offerly-private-documents` (`store_B3Ln2NyxAKizgRzU`, iad1) was created and linked to Offerly production. No documents uploaded.
- No database migrations applied, scanner VMs created, or new deployment pushed.
- Local Vercel project link and ignored `.env.local` were created. Never commit their credentials.

## Saved work

- Exact dependencies: `@vercel/blob@2.8.2`, `@vercel/sandbox@3.8.0`; lockfile updated. Install audit reported zero vulnerabilities.
- `server/blob-storage.js`: standalone private immutable object adapter with bounded reads and integrity checks. Agent reported four passing adapter tests; not integrated.
- `server/sandbox-scanner.js`: partial, unverified scanner/snapshot implementation. Not imported by the app. Verify all SDK APIs and ClamAV flags before use; remove questionable `--no-summary=no` argument.
- No lifecycle module, scanner administration CLI, scanner tests, or UI changes implemented.

## Resume work

1. Review adapter and scanner; benchmark a real isolated ClamAV scan before enabling uploads. Trusted scanner snapshots must contain no user documents. Runtime clones must deny network egress, never persist user data, stop reliably, and fail closed for infection, stale definitions, timeout, resource limits, or incomplete scans.
2. Implement durable object reservation, quota accounting, attachment, failed-upload cleanup, and account-deletion cleanup. Object write and database transaction are separate systems; retain cleanup jobs through failures and account deletion.
3. Add schema migrations and local SQLite compatibility, explicit private RLS/grants, and tests before applying live changes.
4. Wire server upload/download/export paths. Existing JSON upload transport supports approximately 2 MB raw files on Vercel, not the UI's advertised 20 MB. Supporting 20 MB needs a broader quarantine/direct-upload design.
5. Address full export size: current base64 file export can exceed Vercel's response limit. Keep download/export descriptions accurate.
6. Provision and validate automatic trusted snapshot refresh. Initial ClamAV install/signature download cannot assume completion within the existing 60-second API lifetime. Do not weaken scanner freshness checks to enable uploads.
7. Verify clean and infected uploads, private access, integrity, session revocation, quota concurrency, cleanup retries, legacy files, and account deletion. Only then deploy and enable hosted uploads.

Agents used: upload audit/lifecycle investigation, Blob adapter implementation, and Sandbox scanner investigation/partial implementation. All stopped at user request.
