# Offerly delivery steps

This is the execution sequence for the existing PRD and build plan, not a replacement specification. Complete and verify each slice before enabling dependent automation. A local implementation or synthetic fixture does not establish provider approval or production readiness.

| Step | Deliverable | Exit evidence / dependencies |
| --- | --- | --- |
| 1. Complete manual tracking — implemented | Saved views, atomic bulk edits, compensation, reversible duplicate merging, contact provenance, exact submitted versions, offer outcomes and listing history | Owner isolation, conflict/retry tests, full export fidelity, desktop/mobile workflows |
| 2. Recruiting review foundation — scoped implementation complete | Durable jobs, evidence records, review decisions, manual field locks, corrections/undo, reminder lifecycle | Synthetic replay, ordering, ambiguity, account deletion and disconnect tests |
| 3. Gmail integration | Read-only OAuth, bounded historical import, incremental sync, disconnect, progress | User-provided OAuth configuration and consented mailbox; current provider policies; held-out matching evaluation |
| 4. Discovery | Company/source registry, permitted source adapters, shared catalog, snapshots, freshness and duplicate handling | Source access conditions verified; complete-feed/outage/reopen tests |
| 5. Recommendations and alerts | Approved profile facts, eligibility, evidence-backed fit rubric, recency/company-size filters, watchlists and in-app alerts | Human-reviewed ranking evaluation; quiet hours, delivery-time rechecks, deduplication and opt-out tests |
| 6. Preparation and insights | Verified-fact drafts, reusable answers, interview prep, historical cohort metrics; calendar integration | No invented claims, explicit denominators, immutable document history; provider credentials for live integrations |
| 7. Assisted applications | Browser saving and supported form filling, further providers | Published site support; explicit review; no inferred submissions or autonomous sending |
| 8. Launch validation | Public auth lifecycle, production TLS/scanner/storage, backups, monitoring, accessibility and declared-load tests | Real deployment restoration drill, independent security review, measured pilot targets |

## Operating assumptions

- Keep the existing React/TypeScript, Express and SQLite stack for the invited single-instance pilot. Reassess deployment architecture against measured load before public launch.
- Use review-only recruiting updates until held-out evaluation demonstrates the PRD precision targets.
- External sending, form submission, mailbox access and production deployment are not implicitly enabled by this roadmap.
- Manual tracking remains usable without provider credentials or AI services.
- No real mailbox data, external AI processing or live source collection is configured yet. Do not present fixtures as working integrations.

Current detailed evidence and remaining gaps live in `IMPLEMENTATION_STATUS.md`.

## Step 2 delivered scope

The recruiting foundation accepts manually pasted evidence and explicit user-proposed stage/response-owner updates. A separate durable worker produces review items; no provider or model is called. Accept, reject, correct and undo decisions retain evidence, protect manual changes, and check target versions and effective-event ordering. Users can cancel pending work and explicitly retry failed jobs.

Reminders are explicitly configured, date-only, in-app reminders. They use the workspace timezone and cancel when their linked occurrence changes or completes. General follow-ups stop on closed applications; explicit unfinished tasks remain. Automatic reminder defaults, precise-time notifications, email/browser delivery, provider disconnect generations and the full email-event taxonomy belong to later integration slices.

Next: step 3 needs a Gmail OAuth client, an approved redirect URI, a consented test mailbox, and retention/provider-processing decisions. The existing manual workspace remains usable without these dependencies.
