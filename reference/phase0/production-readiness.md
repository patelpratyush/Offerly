# Phase 0 production-readiness blockers

Reviewed October 23, 2026. This note separates work we can complete in this
repository from work requiring owner accounts, verified domains, independent
review, or a nonzero provider balance. No credentials or message contents are
included here.

## Current decision

Phase 0 feasibility spike is recorded; open exit items remain. Phase 1 manual-first
tracking can proceed. Production acceptance remains closed. GPT-6 Luna's one synthetic
run returned valid output for 42/42 calls. Original 32 repository-held-out mail cases
had author-label raw link precision 22/23 (95.7%), guarded precision 22/22 at 22/32
(68.8%) coverage, and event recall 24/25 (96%). Separate 24-case fresh set now has
independent synthetic labels: adjudicated link precision 17/18 (94.4%; Wilson CI
74.2–99.0%), event recall 20/23 (87.0%; CI 67.9–95.5%), and link agreement 24/24.
Cases remain prompt-visible and unrepresentative. Held-out fit score coverage was 0/4.
Automatic-status precision remains unmeasured. See [evaluation](evaluation.md).
No model-driven status changes or production model calls are enabled.

## Open Phase 0 exit items

- [x] Independent labels and adjudication for 24 synthetic fresh-mail cases — agreement and GPT scores recorded in [evaluation](evaluation.md); not representative or prompt-blind.
- [ ] Representative consented examples — **owner action:** collect consented, minimized examples.
- [ ] Stage-mapping and status-precision evaluation — protocol in [proposal](stage-mapping-evaluation.md); no result measured; keep automatic updates disabled.
- [x] Synthetic cross-instance replay guard — code and fault-injection test pass; provider-backed cursor recovery remains open.
- [x] Cursor/pagination design proposal — see [proposal](import-design.md); Gmail History API implementation and integration validation are Phase 2.
- [ ] Hosted OAuth — Phase 2; **owner action:** verified domain, Google restricted-scope review, and accurate privacy disclosures.

## Required before a production Gmail connection

| Gate                                        | Current state                                                                                                                 | Required action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified app domain and privacy disclosures | Owner previously said no custom domain is ready. Vercel-hosted prototype is not a domain the owner can independently verify.  | Register a domain; point the public app homepage to it; publish accurate privacy and terms pages on that verified domain; link them from the homepage and OAuth consent screen.                                                                                                                                                                                                                                                                                                                                   |
| Google OAuth release                        | Local Desktop OAuth was tested with named test users; Gmail scope is `gmail.readonly`, which Google classifies as restricted. | Determine and complete Google brand/scope verification for the intended audience. Keep test mode for private development only. Google requires production homepages and privacy policies on verified domains it says the developer owns. [Gmail scope table](https://developers.google.com/workspace/gmail/api/auth/scopes) · [Google requirements](https://support.google.com/cloud/answer/13464321?hl=en) · [OAuth domain policies](https://developers.google.com/identity/protocols/oauth2/policies)           |
| Restricted-scope security                   | Gmail `gmail.readonly` is restricted. Hosted service can access Gmail data.                                                   | Confirm applicable Google exception or complete required restricted-scope review and independent annual security assessment before production access. Google documents the assessment requirement for restricted data accessed from or through a server. [Restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)                                                                                                              |
| Durable credentials and sync                | Only local Keychain prototype exists.                                                                                         | Implement encrypted per-user refresh-token storage, account disconnect/revocation, deletion, limited retention, two-hour History API processing, durable cursors, replay protection, recovery from expired cursors, and operational alerts. Gmail can return 404 for expired history IDs and requires a full sync then. [Gmail sync guide](https://developers.google.com/workspace/gmail/api/guides/sync) · [History API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) |
| Review and correction in workspace          | Current import proof writes no app records.                                                                                   | Connect evidence-backed candidates to the workspace review UI. Require user confirmation before changing stages; retain corrections, source evidence, deduplication keys, and audit history.                                                                                                                                                                                                                                                                                                                      |

Google External/Testing refresh tokens expire after seven days for Gmail scopes.
That is suitable for short private tests with reconnects, not unattended sync.
[OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

## Required before enabling an AI provider

- Owner authorized one bounded synthetic-only GPT comparison using existing API
  credit. It cost $0.0020071 by reported token usage; no auto-recharge or recurring
  requests were enabled. Local key is in ignored, mode-600 `.env`; never print,
  commit, or expose it to client code. The one-time runner uses strict Structured
  Outputs, fixed endpoint/model, no tools, 384 output-token cap, and $0.10
  estimated preflight ceiling. Schema adherence does not validate factual
  correctness. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- OpenAI API input is not used for training by default, but abuse-monitoring logs
  may retain prompts and responses up to 30 days. Sending real Gmail content
  requires a separate explicit user opt-in and an updated retention/privacy
  decision. [Data controls](https://developers.openai.com/api/docs/guides/your-data?content_language=English)

## Required for a quality pass

Current original gold fixtures are synthetic and developer-authored. Two
reviewers independently labeled 24 additional synthetic fresh-mail cases, with
two disagreements adjudicated by owner. Cases were still visible during prompt
development, so this is not a blind model holdout. Build a new hidden set after
freezing model and prompt; collect independent labels; resolve disagreements;
then evaluate on representative consented examples without tuning on that holdout.
Keep the PRD thresholds: at least 95% application-link precision, 98% precision
for any status applied automatically, and 85% supported-event recall. Report
sample sizes, uncertainty, coverage, failures, and event-specific recall. If
results miss any gate, keep automatic status updates disabled.

Real-mail labels require minimized evidence and reviewer consent. Do not send
personal Gmail to a model as a shortcut to annotation.

## Owner decisions

- Choose and disclose retention window for Gmail-derived evidence before hosted sync.
- Set hosted inference budget and approve data handling before hosted model calls.
- Resolve access and redistribution terms for each job source before public collection.
- Complete verified-domain, Google restricted-scope, privacy, and any required security assessment before public Gmail OAuth.

## Scope boundary

Phase 0 validates whether integrations and extraction are feasible. Hosted Gmail
OAuth, token storage, recurring synchronization, review-queue integration, and
multi-source discovery are implementation phases after this gate. Public job
listing collection also remains blocked on source-specific rights; technical
availability of an endpoint is not permission to republish its data. See
[source access research](sources.md).
