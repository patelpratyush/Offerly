# Vercel + Supabase deployment

This deployment uses Supabase PostgreSQL and Vercel Functions. Existing Offerly authentication stays in place: scrypt password hashes, opaque HttpOnly sessions, invitation-only registration. Supabase Auth and Storage are not integrated in this version. No Supabase browser key is required.

## Configure the database

1. Create a Supabase project near the Vercel function region. Save database credentials in a password manager.
2. Apply `supabase/migrations/20261021000019_hosted_workspace.sql` through the Supabase SQL editor or a migration connection. It creates a new private `offerly` schema; never add this schema to the Data API exposed schemas. The migration deliberately fails if the schema already exists. Inspect existing state instead of dropping it.
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

Configure a trusted scheduler to request `GET https://offerly-nine-delta.vercel.app/api/jobs/run` every minute with `Authorization: Bearer <CRON_SECRET>`. Supabase Cron with pg_net and a Vault-held secret is an option; keep secrets out of cron SQL text. Do not assume the Vercel Hobby daily cron frequency supplies minute-level processing. No scheduler has been provisioned by the repository change.

Each invocation handles a bounded batch, checks a time budget, and preserves leases/retries. Pending reviews and reminders will not advance automatically until scheduling is configured. Monitor non-200 responses and retry; serialization conflicts return 409 rather than silently losing writes.

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
