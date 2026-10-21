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

Do not set `DATABASE_PATH`, `TRUST_PROXY_LOOPBACK`, or `CLAMAV_SOCKET` for Vercel. Never prefix secrets with `VITE_`. Preview environments require their own database and exact origin; do not point previews at production data.

Redeploy after changing environment variables. Check `/api/auth/config` returns JSON, then test invited registration, sign-in, record creation, reload persistence, sign-out, and isolation with a second account. Missing database configuration returns a generic 503 without exposing credentials.

## Schedule durable jobs

Supabase Cron calls `GET /api/jobs/run` every minute using pg_net and a Vault-held credential. This uses the existing database rather than a second scheduler service. Vercel and the local setup environment must contain the same `CRON_SECRET`. Redeploy Vercel after setting that variable, then run:

```sh
npm run scheduler:setup
npm run scheduler:status
```

Setup reads `DATABASE_ADMIN_URL`, `APP_ORIGIN`, and `CRON_SECRET` from the ignored local `.env`. It enables pg_cron and pg_net, stores credentials encrypted in Vault, and creates or updates the named `offerly-workspace-tick` job. Secrets never appear in cron command text. The invocation function runs with caller privileges and is inaccessible to browser and app runtime roles. Keep admin credentials local.

Each invocation claims a database lease, processes up to 20 reviews and 500 reminders within a 35-second soft budget, and records progress. Persistent cursors prevent large queues from restarting at the first batch on each cold start. Recruiting jobs retain retry/backoff and expired-lease recovery; proposed changes still require user approval. Reminders appear in-app, not via email or push. Overlapping invocations skip; a crashed function's lease expires after 90 seconds. The Vercel function lifetime must stay below that lease duration (currently 60 seconds).

`scheduler:status` reports the active schedule, latest worker completion, latest HTTP response, and recent cron dispatches. A successful cron dispatch only means the HTTP request was queued: verify HTTP 200 and a fresh completed worker timestamp too. A null response may mean dispatch is still pending; pg_net retains HTTP responses for a limited time. Alert operationally if no successful completion occurs for five minutes or HTTP responses repeatedly fail. Cron dispatch history is trimmed to seven days for this job only.

To stop scheduling without deleting queued work, run `npm run scheduler:pause`. Run setup again to resume. Pause before changing the production origin or rotating the credential, update Vercel and local configuration, redeploy, then rerun setup. Never add secrets to `vercel.json`, SQL files, command-line arguments, or source control.

## Current limits and safe rollout

- File uploads remain disabled on Vercel because there is no local ClamAV daemon. Document metadata works. Private object storage plus a remote scanning workflow remains separate work; do not bypass scanning to enable uploads.
- Existing SQLite data is not transferred automatically. Keep its backup and original deployment. For existing users, plan a tested data transfer before switching databases; do not import password hashes through client CSV endpoints.
- JSON export streams through the API; large exports need verification against hosting limits with representative data before relying on them for backups. Use database backups as well.
- Supabase free-project resource limits and inactivity pausing affect availability. Check the project's current dashboard limits before inviting more users.
- Rollback means restoring the prior deployment and its original database. There is no automatic bidirectional sync.

## Local verification

`npm run check` covers SQLite regression tests, lint, TypeScript, build, and dependency audit. `npm run test:e2e` covers browser flows.

For real PostgreSQL contract tests, set `TEST_DATABASE_URL` to an isolated local/CI PostgreSQL database and run `npm run test:postgres`. Each fixture creates and removes a random schema; the test role needs schema creation rights. These tests are never intended for production credentials.

References: [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel proxy headers](https://vercel.com/docs/headers/request-headers).
