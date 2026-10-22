# Phase 0 integration validation

Updated October 22, 2026. **Phase 0 remains partial: live Gmail authorization and body retrieval passed, but the first all-mail scan stopped early and model quality failed.** A configured client, synthetic fixture, or functioning manual tracker does not establish live mailbox integration.

## Evidence and exit gates

| Build-plan item | Evidence | State |
| --- | --- | --- |
| Test boards on three platforms | Six live public-board probes across Greenhouse, Lever, and Ashby, plus in-memory description retrieval; bounded adapters and malformed-feed regressions | Technical prototype verified; see [sources](sources.md) and [probe report](source-probe.json) |
| Gmail authorization and consented import | Official scope/policy research, exact Desktop-client setup, local credential readiness command, bounded import acceptance contract | Real Google authorization succeeded; at least 100 messages read locally; first full-mailbox traversal stopped early; temporary grant revoked |
| Small labeled matching/fit set | Twelve synthetic messages and six synthetic profile/listing pairs, separate development/held-out splits, strict prediction schemas and metric denominators | Authored synthetic set ready; independent human labels and representative real-mail evaluation remain open |
| Extraction and matching model prototype | Real local Ollama baseline within the zero-extra-spend constraint; see [model report](model-report.json) | Baseline failed quality: mail 4/8 valid outputs; fit compensation 1/4 and recency 2/4 correct. Production model remains unselected |
| Source conditions and mailbox launch dependencies | Source-specific official documentation, conservative read-only scope, no public catalog permission assumed; Google testing/restricted-scope dependencies recorded | Research complete for prototype; provider/employer rollout conditions and real OAuth proof remain explicit |
| Stack, hosting, model and operating budget | Decisions below | Prototype choices recorded; production model choice remains gated on privacy and quality evaluation |

## Selected architecture and budget

- Keep React/TypeScript/Vite frontend and Express on Node.js 24. Existing production runs on Vercel with Supabase PostgreSQL in a private schema, verified TLS, server-side ownership checks, and a dedicated runtime role. SQLite remains the isolated local development/test option.
- Keep private Vercel Blob documents and isolated ClamAV Sandbox scans. Existing Supabase Cron schedules reviews, reminders, file cleanup, and scanner maintenance. These are existing services; this phase adds no public job catalog, mailbox data store, or production model endpoint.
- Owner chose **$0 additional AI spend for Phase 0**. Do not buy credits, enable auto top-up, install paid providers, or change plan subscriptions. Existing hosting/database/storage/scan charges are outside this additional-AI budget and are not promised to be zero. Monitor provider dashboards before enlarging the pilot.
- Vercel AI Gateway OIDC authenticated after refreshing local credentials, but `/v1/credits` reported zero balance. An attempted zero-priced synthetic request returned `customer_verification_required` before generation. No successful paid or cloud inference occurred. Gateway is a possible future hosted route, not a validated production model dependency.
- Local Ollama was already installed. The prototype uses `qwen3:0.6b`, an Apache-2.0 model with an approximately 523 MB local download. It performs real inference locally and requires no per-token API payment. Model, digest, prompt, fixture hashes, timings and scores belong in the generated evaluation report. A tiny model is a baseline, not a quality guarantee or hosted feature.
- Initial pilot remains two invited users, no billing feature, no automatic status changes, no outgoing messages, and no automated applications. Before a larger pilot, declare message/listing volumes, choose a hosted inference budget, and measure actual cost per active user.

## Mailbox and model data boundaries

The owner explicitly authorized reading all emails, including personal messages, across mailbox history on October 22, 2026. The local proof may paginate the full mailbox, including Spam and Trash, but must process one message at a time without fetching separate attachments or decoding/saving inline attachment parts (which Gmail may include in MIME responses). A Google browser authorization is still required. Keep access/refresh tokens and message content in memory only for the local proof. Do not persist unrelated mail, export bodies, or send personal mailbox content to model providers. Retain only aggregate counts without message identifiers, addresses, subjects, or bodies. Revoke the temporary grant and discard tokens at exit.

The model evaluation uses only checked-in fictional cases. Inputs exclude gold labels and rationale. Freeze inputs and prompt before held-out execution. Keep independent predictions and failures; do not repair outputs using labels or tune a second prompt against held-out answers. Small synthetic scores never open the PRD automatic-update gate. Review-only behavior stays mandatory.

Future durable Gmail access requires encrypted credential storage, disconnect/revocation semantics, retention decisions, minimized evidence, and applicable Google review. Domain-free Desktop testing does not solve hosted/public OAuth readiness. See [Gmail setup and acceptance](gmail.md).

## Commands

```sh
npm run phase0:sources
npm run phase0:gmail
# After explicit consent; opens Google browser authorization:
npm run phase0:gmail:live -- --all-mail
npm run phase0:model
npm run phase0:test
```

`phase0:sources` reads the fixed public sample boards and writes metadata-only technical evidence. `phase0:gmail` inspects private local configuration without network/mailbox access and exits 2 when unavailable. `phase0:model` performs local synthetic inference only, after the selected model exists. It never connects Gmail or mutates an application. Commands are validation tools, not shipped discovery/import UI.

## Finish the remaining gate

The Desktop client is configured privately under ignored `data/`; owner consent covers an all-mail local scan. First real authorization and local body retrieval succeeded; complete and diagnose the all-mail traversal described in [gmail.md](gmail.md). Until retrieval limits and quality gates are resolved, keep Phase 0 marked partial.
