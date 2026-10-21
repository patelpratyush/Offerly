# Vercel + Supabase deployment

This deployment uses Supabase PostgreSQL and Vercel Functions. Existing Offerly authentication stays in place: scrypt password hashes, opaque HttpOnly sessions, invitation-only registration. Supabase Auth and Storage are not integrated in this version. No Supabase browser key is required.

## Configure the database

1. Create a Supabase project near the Vercel function region. Save database credentials in a password manager.
2. Apply the files in `supabase/migrations/` in filename order through a trusted migration connection. Apply only unapplied migrations to an existing installation. The first migration creates a new private `offerly` schema; never add this schema to the Data API exposed schemas. It deliberately fails if the schema already exists. Inspect existing state instead of dropping it.
3. Apply `supabase/runtime-role.sql` as the migration owner. This creates a dedicated runtime role with only table access. Set its password using an interactive trusted database client (`\password offerly_app` in psql); never commit the password to SQL or paste it into chat.
4. Your project is `xgaobvlmnuhxkcqubvee`, with transaction pooler host `aws-0-us-east-2.pooler.supabase.com:6543`. Copy the transaction pooler connection string from Supabase Connect. Replace its username with `offerly_app.PROJECT_REF` and use the runtime role password, URL-encoded. Do not include `sslmode` or other SSL query parameters; the adapter enforces verified TLS and includes Supabase’s public CA certificate from its official download source. Named prepared statements are not used. Keep the migration/admin credentials out of Vercel.

RLS is enabled on every app table. The server role has explicit access through RLS policies; browser roles have no schema access or policies. Per-user authorization is enforced by Offerly API ownership predicates, not Supabase JWTs. The server role must therefore remain secret.

The ignored local `.env` contains this project’s connection template. Replace its password placeholder with the URL-encoded **offerly_app role password** after creating that role. This differs from the project’s postgres/admin password. `DATABASE_ADMIN_URL`, when present, is for local migrations only; never copy it to Vercel. Vercel does not read your local `.env`; set its production variables separately.

## Configure Vercel

Use Node.js 24, the Vite framework preset, `npm run build`, and output directory `dist`. The committed `vercel.json` routes `/api/*` to the Node function. Set these **server-side Production environment variables**:

- `DATABASE_URL`: dedicated runtime role's transaction pooler URL.
- `APP_ORIGIN`: `https://offerly-nine-delta.vercel.app` (exact origin, no trailing slash).
- `REGISTRATION_TOKEN`: random secret, at least 32 characters. Share only with invited testers. Unset disables registration.
- `CRON_SECRET`: separate random secret, at least 32 characters.
- `BLOB_STORE_ID`: ID of the linked private Vercel Blob store.
- `HOSTED_UPLOADS_ENABLED`: set to `true` only after deploying and verifying scanner maintenance below. The Blob integration supplies its credential through Vercel project OIDC.

Do not set `DATABASE_PATH`, `TRUST_PROXY_LOOPBACK`, or `CLAMAV_SOCKET` for Vercel. Never prefix secrets with `VITE_`. Preview environments require their own database and exact origin; do not point previews at production data.

Redeploy after changing environment variables. Check `/api/auth/config` returns JSON, then test invited registration, sign-in, record creation, reload persistence, sign-out, and isolation with a second account. Missing database configuration returns a generic 503 without exposing credentials.

## Schedule durable jobs

Supabase Cron calls `GET /api/jobs/run` every minute using pg_net and a Vault-held credential. This uses the existing database rather than a second scheduler service. Vercel and the local setup environment must contain the same `CRON_SECRET`. Redeploy Vercel after setting that variable, then run:

```sh
npm run scheduler:setup
npm run scheduler:status
```

Setup reads `DATABASE_ADMIN_URL`, `APP_ORIGIN`, and `CRON_SECRET` from the ignored local `.env`. It enables pg_cron, pg_net, and pgcrypto, stores credentials encrypted in Vault, and creates or updates the named `offerly-workspace-tick` job. Secrets never appear in cron command text or the HTTP request queue: each request carries a SHA-256 HMAC of its timestamp and fixed endpoint path. Signatures expire after 60 seconds; a persistent timestamp rejects replayed or older requests. This matters because Supabase manages pg_net queue privileges, so a long-lived bearer secret must not be placed in queued headers. The endpoint also accepts the bearer credential for trusted manual execution. The invocation function runs with caller privileges and is inaccessible to browser and app runtime roles. Keep admin credentials local.

Each invocation claims a database lease, processes up to 20 reviews and 500 reminders within a 35-second soft budget, cleans up expired private files within 40 seconds, and records progress. Persistent cursors prevent large queues from restarting at the first batch on each cold start. Recruiting jobs retain retry/backoff and expired-lease recovery; proposed changes still require user approval. Reminders appear in-app, not via email or push. Overlapping invocations skip; a crashed function's lease expires after 120 seconds. The Vercel function lifetime is 90 seconds.

`scheduler:status` reports the active schedule, latest worker completion, latest HTTP response, and recent cron dispatches. A successful cron dispatch only means the HTTP request was queued: verify HTTP 200 and a fresh completed worker timestamp too. A null response may mean dispatch is still pending; pg_net retains HTTP responses for a limited time. Alert operationally if no successful completion occurs for five minutes or HTTP responses repeatedly fail. Cron dispatch history is trimmed to seven days for this job only.

To stop scheduling without deleting queued work, run `npm run scheduler:pause`. Run setup again to resume. Pause before changing the production origin or rotating the credential, update Vercel and local configuration, redeploy, then rerun setup. Never add secrets to `vercel.json`, SQL files, command-line arguments, or source control.

### Private document uploads and scanner refresh

The hosted upload path stores original bytes in a private Vercel Blob store. Offerly keeps object keys server-side, checks owner on every download, and scans files before storage using a disposable Vercel Sandbox clone with network disabled. The scanner image is built from Ubuntu security packages and fresh ClamAV signatures; signatures are verified and must be no older than 48 hours. Freshness failure, timeout, scanner warning, encrypted or malformed content, and malware all fail closed. Hosted upload limit is 2 MiB because browser uploads pass through the Vercel Function request limit. Use individual downloads; hosted JSON exports include private document metadata and authenticated download paths, not file bytes.

The scanner's maintenance endpoint uses the same timestamped HMAC scheme as the main scheduler. Setup installs both jobs: the workspace tick each minute and scanner refresh hourly. Deploy the scanner endpoint first, then run `npm run scheduler:setup` locally with trusted admin credentials. `npm run scanner:status` reports active signature age and refresh state. Refresh retains prior verified scanner snapshot through a two-minute retirement grace period; failed retirement remains queued for retry. Runtime scans always use active snapshot and never the previous one.

Enable `HOSTED_UPLOADS_ENABLED=true` only after `scheduler:status` confirms both jobs are active and `scanner:status` reports a fresh verified snapshot. Redeploy after changing Vercel variables. Existing downloads continue if new hosted uploads are disabled. Account removal queues private objects for deletion; the normal minute cleanup job retries provider failures durably.

## Current limits and safe rollout

- Hosted uploads use a 2 MiB cap and require the private Blob store, Vercel Sandbox, fresh scanner snapshot, both Supabase jobs, and `HOSTED_UPLOADS_ENABLED=true`. If any dependency is unavailable, upload fails closed. Disable the flag and redeploy to pause new uploads; previously attached files remain downloadable.
- Existing SQLite data is not transferred automatically. Keep its backup and original deployment. For existing users, plan a tested data transfer before switching databases; do not import password hashes through client CSV endpoints.
- Hosted JSON export is capped at 3 MiB and excludes document bytes. Use individual authenticated downloads for documents and database backups for recovery.
- Supabase free-project resource limits and inactivity pausing affect availability. Check the project's current dashboard limits before inviting more users.
- Rollback means restoring the prior deployment and its original database. There is no automatic bidirectional sync.

## Local verification

`npm run check` covers SQLite regression tests, lint, TypeScript, build, and dependency audit. `npm run test:e2e` covers browser flows.

For real PostgreSQL contract tests, set `TEST_DATABASE_URL` to an isolated local/CI PostgreSQL database and run `npm run test:postgres`. Each fixture creates and removes a random schema; the test role needs schema creation rights. These tests are never intended for production credentials.

References: [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel proxy headers](https://vercel.com/docs/headers/request-headers).
