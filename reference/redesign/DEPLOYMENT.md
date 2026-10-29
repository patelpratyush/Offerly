# Production deployment — October 28, 2026

User explicitly authorized deployment after reviewing the UI/device work.

- Live site: https://offerly-nine-delta.vercel.app/
- Project/scope: `patelpratyushs-projects/offerly`
- Deployment: `dpl_4vwwkLxTuz48zQDFj5rFm8Jcxw1c`
- Deployment URL: https://offerly-kz6piiybz-patelpratyushs-projects.vercel.app
- Inspector: https://vercel.com/patelpratyushs-projects/offerly/4vwwkLxTuz48zQDFj5rFm8Jcxw1c
- Final state: READY; production alias mapping completed.
- Previous production deployment: `dpl_9PHenSUDyDW2RgsPo6e7dYwd1bCt` (`offerly-k5s7uyua2-patelpratyushs-projects.vercel.app`). Recorded for rollback if needed; no rollback performed.

Used Vercel CLI 65.5.0 through `npx`, without modifying the global CLI install. Uploaded current local source, built using existing production settings with domain assignment deferred, verified the build, then promoted through Vercel MCP. Git changes remain uncommitted; no merge or Git push performed.

## Deployment hygiene

Added `.vercelignore` after a dry run showed that default CLI inputs included local environment/database files. Verified final upload contained 79 source files (870,967 bytes), including required server CA certificate, and excluded local environment files, databases, keys, test output and design screenshots. No secrets were printed. No schema migration, database replacement or environment-variable change performed.

## Live verification

- Staged and canonical production JavaScript matched the verified local production bundle byte-for-byte.
- Canonical homepage: HTTP 200; new JavaScript/CSS assets served.
- `/api/auth/config`: HTTP 200; invitation-only registration and hosted upload availability retained.
- Unauthenticated `/api/workspace`: HTTP 401 with `SESSION_REQUIRED`.
- Desktop Chromium (1440×1000) and mobile WebKit emulation (390×844): homepage and sign-in rendered, no page-level horizontal overflow, zero uncaught runtime errors.
- Screenshots: [desktop sign-in](deployed/signin-desktop.png), [mobile sign-in](deployed/signin-mobile.png).

The API intentionally rejects the unique staged hostname with HTTP 421 because production host validation allows the canonical origin only. That control was retained; API checks passed on the canonical domain after promotion.

Authenticated production workflows were not exercised with a real user account. Local regression evidence remains 173 backend tests, 40 browser workflow tests, 18 device scenarios, lint/type/build/audit checks. No production account or synthetic production records were created for deployment verification.
