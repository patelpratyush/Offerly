# Phase 0 access and dependency decision

Reviewed October 23, 2026 against current official provider documentation. No job
boards or mailboxes were requested during this audit. This record distinguishes
observed technical access from permission for a later production use. It is not a
legal approval or an assertion that public data is unconditionally reusable.

## Current prototype decision

Retain the completed bounded source probes and metadata-only evidence. Leave
recurring collection, shared catalog persistence, public listing republication,
and application submission disabled. Source documentation review for this
prototype is complete; no additional live source requests are needed to establish
its technical feasibility. Production rights remain unconfirmed and must not be
inferred from successful HTTP responses, a public API, robots directives, or a
customer agreement intended for a different party.

| Source and tested boards          | Documented interface and observed evidence                                                                                                                                       | Decision and unresolved production conditions                                                                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greenhouse: Stripe and Cloudflare | Public Job Board GET endpoints do not require authentication; previous probes returned 727 and 444 jobs. Documentation describes building the employer's careers pages.          | Technical read prototype verified. No permission to republish these employers' listings in an Offerly shared catalog established. Confirm provider/employer conditions, caching/retention, attribution and polling before adding either board to production.                 |
| Lever: Palantir and Wealthsimple  | Employer-scoped Postings API provides published listings and hosted links; previous probes returned 306 and 0 jobs. Documentation limits browser CORS to the employer's domains. | Server-side technical read prototype verified; CORS behavior is not a redistribution license. Empty Wealthsimple result is an observation, not proof of closure. Resolve each board's conditions before production; application POST limits are not a GET polling allowance. |
| Ashby: Linear and Notion          | Public Job Postings API documents published postings for an organization; previous probes returned 34 and 138 listed jobs.                                                       | Technical read prototype verified. Do not include unlisted jobs. No shared-catalog license for either employer established; confirm retention, attribution and refresh terms before production.                                                                              |

Counts above are historical probe observations, not current inventory. Full
listing text was not committed or published. No employer gave Offerly permission
through this audit. Provider customer terms alone do not answer the rights of an
unrelated aggregator. Review applicable employer notices and obtain permission
when required; an inaccessible or service-specific terms page remains unresolved,
not implicitly permissive.

Primary sources checked:

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): public GET mechanics and employer careers-page context.
- [Greenhouse legal center](https://www.greenhouse.com/legal) and [MSA](https://www.greenhouse.com/master-subscription-agreement): subscription context, not a third-party listing grant.
- [Lever Postings API](https://github.com/lever/postings-api): employer scope, hosted links and CORS boundary.
- [Lever terms](https://www.lever.co/legal/terms-of-service): customer/service access restrictions; no blanket aggregator grant inferred.
- [Ashby Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api) and [customer terms](https://www.ashbyhq.com/resources/terms): organization scope and customer restrictions; no third-party republication approval inferred.

Employer-site checks did not establish job-feed republication licenses: Stripe's
[consumer terms](https://stripe.com/legal/consumer) concern consumer services;
[Cloudflare website terms](https://www.cloudflare.com/website-terms/) and
[Linear service terms](https://linear.app/terms) do not supply an identified
Offerly job-feed agreement; the retrieved [Wealthsimple terms page](https://www.wealthsimple.com/en-ca/legal/terms)
displayed an older effective-period notice and needs current applicable terms
confirmed. The attempted Palantir terms URL was inaccessible through research
tooling and Notion's main terms URL redirected to a JavaScript-only page. Neither
retrieval outcome is a permission decision. These are reasons to keep all six
boards outside production until their actual use conditions are resolved.

## Gmail: prototype route established, launch dependencies recorded

The owner chose local Desktop OAuth, added their account as a test user, approved
read access including personal messages, and subsequently selected a seven-day
proof. The run was reported as 612 messages across seven pages, with zero skips or
retries, but no result artifact is committed; this result is unverified from repo
evidence. The dedicated read-only grant was retained in macOS login Keychain and
reused by a separate process. Message bodies stayed in process memory; no email
text was sent to external AI. This establishes local authorization and retrieval,
not extraction accuracy, production import, or ongoing synchronization.

Google's [scope table](https://developers.google.com/workspace/gmail/api/auth/scopes)
classifies `gmail.readonly` as restricted; `gmail.metadata` cannot provide bodies.
Google documents [development/testing and limited personal-use verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
External/Testing with named test users is the documented route used here. It does
not establish approval for a public application. Testing Gmail refresh tokens
expire after seven days under the current [OAuth expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration);
revocation, password changes and provider policies can also require reconnecting.

Before a hosted or wider release, determine the actual applicable verification
exception or complete required verification and assessment; document the app's
purpose and audience. Add real hosted web OAuth, per-account encrypted credential
storage, disconnect/deletion, minimized evidence retention, and incremental sync.
Review [Google Workspace data-use policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy),
including consent, Limited Use disclosure, token protection, restricted-scope
security requirements and restrictions on advertising/general-purpose model
training. No current owner consent authorizes sending email content to an
external model. None of these later deliverables is claimed complete by the
count-only local proof.

## Phase boundaries and remaining decisions

Phase 0 can close its access-research item as **conditions reviewed and prototype
scope constrained**, while retaining explicit production blockers. Do not relabel
that as **source permission granted**. Phase 0 as a whole still needs working
extraction and matching evidence; this audit cannot supply model-quality results.

The local mailbox proof, source feasibility evidence and documented dependency
choices do not require building Phase 2 hosted Gmail or Phase 3 discovery before
Phase 0 can finish. Those later phases must enforce the unresolved release gates.
No owner approval is needed merely to retain this existing prototype boundary.
Before enabling a production catalog, the owner must select the actual pilot
sources and resolve their use conditions. Before extending Gmail beyond the
current development/private audience, the owner must declare the intended
production audience and satisfy the applicable Google route. No messages to
providers, purchases, subscriptions or publishing changes were made.
