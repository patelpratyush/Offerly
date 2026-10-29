# Phase 0 integration validation

Updated October 23, 2026. **Phase 0 feasibility spike is recorded; exit items and production quality gates remain open. Phase 1 manual-first tracking can proceed.** Source probes, local Gmail prototype, synthetic evaluation, and provider-dependency review are documented. GPT-6 Luna remains an experimental synthetic-only candidate; no model is integrated into production. Hosted Gmail and discovery remain later phases.

## Open Phase 0 exit items

- [x] Independent labels for 24 synthetic fresh-mail cases — owner and friend completed labels; owner adjudicated two event disagreements. This does not provide representative or prompt-blind data.
- [x] Reviewer agreement metrics — recorded in [evaluation results](evaluation.md); link agreement 24/24, event agreement 22/24 to 24/24 by event.
- [ ] Representative consented examples — **owner action:** obtain consent and minimize content before labeling; synthetic results do not replace this.
- [x] Stage-mapping evaluation harness — Wilson-interval metrics, safety checks, and synthetic demo added in [stage-mapping proposal](stage-mapping-evaluation.md), with a [review template](stage-mapping-label-template.csv) and [review instructions](stage-mapping-review-instructions.md). **Measured representative precision remains open** until consented cases receive independent labels and frozen predictions.
- [x] Synthetic cross-instance replay guard — implementation and failing-importer regression test pass. Provider-backed replay evidence remains open.
- [x] Cursor/pagination design proposal — documented in [import design](import-design.md); implementation and Gmail History API validation belong to Phase 2.
- [ ] Hosted Gmail OAuth — Phase 2, with **owner action** for verified domain, Google restricted-scope verification, and privacy disclosures.

## Owner decisions before later integrations

- [ ] Choose retention window for any Gmail-derived evidence before hosted sync. Current local prototype retains no message content.
- [ ] Set hosted inference spend cap and approve provider/data handling before adding any hosted model calls.
- [ ] Resolve redistribution/access terms separately for each job source before enabling public catalog collection.
- [ ] Complete verified-domain, Google scope-review, privacy-policy, and security-assessment requirements before public Gmail OAuth.

## Evidence and exit gates

| Build-plan item                                   | Evidence                                                                                                                                                                      | State                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test boards on three platforms                    | Six live public-board probes across Greenhouse, Lever, and Ashby, plus in-memory description retrieval; bounded adapters and malformed-feed regressions                       | Technical prototype verified; see [sources](sources.md) and [probe report](source-probe.json)                                                                                                                                                                                               |
| Gmail authorization and consented import          | Official scope/policy research, Desktop OAuth setup, local credential readiness command, bounded import acceptance contract                                                   | Seven-day scan was reported as 612 messages, but has no committed artifact and is unverified from repository evidence. Committed bounded report records 20 selected messages, one unresolved candidate, 19 abstentions, and replay outcome. No content/evidence persisted.                         |
| Small labeled matching/fit set                    | Twelve synthetic messages and six synthetic profile/listing pairs; separate 24-case synthetic fresh mail set with two reviewers and owner adjudication                          | Independent labels and agreement recorded for 24 synthetic cases; representative consented real-mail evaluation and prompt-blind data remain open                                                                                                                                            |
| Extraction and matching model prototype           | Local Ollama comparisons plus one frozen GPT-6 Luna synthetic run; see [evaluation](evaluation.md), [GPT report](model-report-gpt-6-luna-v1.json), and prediction artifacts | **Feasibility evidence recorded; production no-go:** GPT returned valid output for 42/42 calls. On adjudicated fresh labels, link precision was 17/18 (94.4%, CI 74.2–99.0%) and event recall 20/23 (87.0%, CI 67.9–95.5%). Author-label results across 32 held-out cases: link precision 22/23; event recall 24/25. Held-out fit score coverage was 0/4. Sets remain synthetic and prompt-visible. |
| Source conditions and mailbox launch dependencies | Source-specific official documentation, conservative read-only scope, no public catalog permission assumed; Google testing/restricted-scope dependencies recorded             | Prototype access review complete: [decision](access-decision.md). Public catalog permissions and hosted Gmail release requirements remain explicitly unresolved for later phases.                                                                                                           |
| Stack, hosting, model and operating budget        | Existing Vercel/Supabase stack; local Ollama plus GPT-6 Luna synthetic benchmark; API key stays local in ignored `.env`                                                       | Synthetic benchmark cost $0.0020071. A separate owner-authorized live smoke test processed 20 messages with GPT-6 Luna for $0.0008671; it retained only aggregate counts and did not measure accuracy. No model endpoint deployed. Production model choice remains gated on independent quality and privacy review. |

## Selected architecture and budget

- Keep React/TypeScript/Vite frontend and Express on Node.js 24. Existing production runs on Vercel with Supabase PostgreSQL in a private schema, verified TLS, server-side ownership checks, and a dedicated runtime role. SQLite remains the isolated local development/test option.
- Keep private Vercel Blob documents and isolated ClamAV Sandbox scans. Existing Supabase Cron schedules reviews, reminders, file cleanup, and scanner maintenance. These are existing services; this phase adds no public job catalog, mailbox data store, or production model endpoint.
- Owner authorized a bounded local synthetic GPT comparison from existing API credit. The frozen run made 42 calls and used 12,831 input tokens plus 1,448 output tokens; reported model-token cost was **$0.0020071**, below the runner's $0.10 preflight cap. This is observed inference cost only; billing adjustments or account-level charges may differ. No auto top-up or recurring spend was enabled.
- Vercel AI Gateway OIDC authenticated after refreshing local credentials, but `/v1/credits` reported zero balance. An attempted zero-priced synthetic request returned `customer_verification_required` before generation. No inference ran through Gateway; the separate direct OpenAI comparison is documented above. Gateway remains an unvalidated production model dependency.
- Local Ollama was already installed. The original baseline used `qwen3:0.6b`; stronger `qwen3:4b` was evaluated on an 8 GiB Mac. GPT-6 Luna was evaluated once against fixed synthetic development, held-out, and fresh-held-out fixtures. Exact outputs and failure diagnostics are retained. GPT showed strong email event extraction but one unsupported raw link on the fresh set; the existing evidence guard vetoed it. It returned null fit scores on all four held-out fit cases. No model runs in production or may mutate application stages. Any real-mail processing requires separate explicit external-processing consent.
- Initial pilot remains two invited users, no billing feature, no automatic status changes, no outgoing messages, and no automated applications. Before a larger pilot, declare message/listing volumes, choose a hosted inference budget, and measure actual cost per active user.

## Mailbox and model data boundaries

Production sync target: check connected Gmail accounts every two hours using the Gmail History API and a per-account `historyId`, rather than repeatedly scanning seven days. Perform an initial bounded sync to establish the cursor; if Google returns 404 for an expired cursor, do a deduplicated full resync. The existing Supabase cron can dispatch due sync work. The current Hobby Vercel Cron restriction is once daily, so do not schedule a two-hour Vercel Cron without a plan that supports it. New mail should create evidence-backed review items; user approves application changes. This production integration is not implemented. See [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync), [history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list), and [Vercel Cron limits](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

The owner explicitly authorized reading all emails, including personal messages, across mailbox history on October 22, 2026, and one bounded GPT smoke test on October 25, 2026. The local proof may paginate the full mailbox, including Spam and Trash, but must process one message at a time without fetching separate attachments or decoding/saving inline attachment parts (which Gmail may include in MIME responses). The live smoke test retained only aggregate counts; it did not retain per-message labels or prove accuracy. Do not persist unrelated mail, export bodies, or send more personal mailbox content to model providers without explicit authorization for that run. Retain only aggregate counts without message identifiers, addresses, subjects, or bodies. Retain the reusable Keychain grant until explicit disconnect or Google expiry/revocation; clear in-memory token references at exit.

The model evaluation uses only checked-in fictional cases. Inputs exclude gold labels and rationale. Freeze inputs and prompt before held-out execution. Keep independent predictions and failures; do not repair outputs using labels or tune a second prompt against held-out answers. Small synthetic scores never open the PRD automatic-update gate. Review-only behavior stays mandatory.

Future durable Gmail access requires encrypted credential storage, disconnect/revocation semantics, retention decisions, minimized evidence, and applicable Google review. Domain-free Desktop testing does not solve hosted/public OAuth readiness. See [Gmail setup and acceptance](gmail.md).

## Commands

```sh
npm run phase0:sources
npm run phase0:gmail
# After explicit consent; opens Google browser authorization:
npm run phase0:gmail:live -- --last-7-days
npm run phase0:import
npm run phase0:openai # one-time synthetic-only GPT comparison; max $0.10
npm run phase0:openai:analyze # reproducible source-guarded held-out metrics
npm run phase0:test
npm run phase0:agreement -- REVIEWER_A.csv REVIEWER_B.csv # once both reviewer files are complete
npm run phase0:stage-evaluate -- GOLD.json PREDICTIONS.json # representative labeled stage data only
```

`phase0:stage-evaluate` compares frozen stage predictions with independently adjudicated labels and reports safe-transition precision/recall, coverage, false transitions, chronology/link failures, per-stage metrics, and Wilson intervals. The checked-in synthetic example validates the harness only. This and all other Phase 0 commands are validation tools, not shipped UI.

## Phase boundaries and remaining gate

Bounded Phase 0 feasibility results and one model comparison are recorded. **Proceed to Phase 1 manual-first tracking.** Production acceptance remains **not passed**: original fixtures are developer-authored; the separate 24-case fresh set has independent labels but is still synthetic and prompt-visible. GPT link precision on adjudicated labels was 94.4%, fit-score coverage was 0/4, and automatic-stage precision/end-to-end correctness were not measured. Keep model extraction out of production and require user review before any future application changes. A representative, minimized, consented and prompt-blind evaluation remains needed for release; validate source evidence, event chronology, stage mapping, replay, and corrections. No synthetic score enables automatic updates.

Hosted web OAuth, per-user encrypted credentials, resumable two-hour History API sync, importing applications into the actual workspace, and complete recruiting-event/contact extraction belong to Phase 2. Public source permissions and discovery collection belong to Phase 3. Full-history scanning is not required to prove this explicitly bounded Phase 0 import. The [access decision](access-decision.md) records these boundaries.

No new delivery date is estimated from this spike. Phase 1 manual tracker can proceed. Gmail automation still depends on hosted OAuth approval, credential lifecycle/storage, durable incremental sync, review-queue wiring, and representative human-reviewed acceptance data. The synthetic GPT benchmark does not validate the broader delivery timeline.

See the consolidated [production-readiness blockers](production-readiness.md) for required owner account/domain work, Google restricted-scope review, AI budget/credential conditions, and measurable quality gates.
