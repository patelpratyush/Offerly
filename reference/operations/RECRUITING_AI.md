# Recruiting AI operations

Status: implementation behind disabled gates. No representative real-mail
quality result exists. Production AI and automatic stage updates remain disabled.

## Data and review boundary

AI receives minimized current email text and bounded application identity facts
only after explicit, versioned per-user consent. Attachments, document bytes,
resume details, notes and authentication tokens are excluded. Email is untrusted
input, not instructions. Requests have no tools and cannot send email, submit
applications or mutate application records. Provider output must pass schema,
exact source-quote and application-link checks before becoming a pending review.
Contacts come from actual message participants, not generated identities. Every
application change still requires authenticated user acceptance.

Responses use `store:false`. This does not mean zero retention: OpenAI may retain
abuse-monitoring logs for up to 30 days, subject to documented exceptions. See
https://developers.openai.com/api/docs/guides/your-data . Withdrawing consent
stops future requests; it cannot recall content already transmitted.

## Budget and reliability

Private database tables store consent and daily budget reservations, outside
workspace exports/audit snapshots. Reservations happen before provider requests.
Timeouts, malformed responses and ambiguous failures do not refund reservations;
this prevents retries from silently exceeding budget. Per-user and project caps
must both pass. Credentials remain server-only. Never add VITE-prefixed keys.

AI failure leaves message processing retryable. Gate-denied extraction must not
be represented as successful AI analysis. Historical messages previously handled
by deterministic rules are not automatically resent to AI when gates change.

## Quality procedure (offline evaluation, no provider calls)

Freeze model, prompt, parser and taxonomy versions. Collect minimized consented
cases containing candidate catalog and pre-message tracker/lock/history context.
Have independent reviewers label and adjudicate without replacing originals.
Keep private files outside Git. Compare frozen predictions with gold JSON arrays:

```sh
node scripts/recruiting-ai-evaluate.js /private/gold.json /private/predictions.json
```

Each array contains `{id, applicationId: string|null, events: string[]}`. The tool
prints aggregate link precision, coverage, event precision/recall, per-event
results and Wilson intervals. It makes no API calls and never approves production.
Stage safety requires the separate Phase 0 stage-mapping evaluator with valid
tracker context; email-only labels cannot provide it. Keep original PRD thresholds
and representative-sample uncertainty review. No synthetic test can close gates.

## Release steps

Apply AI policy migration before hosted startup. Configure bounded server-side
budgets, exact model/prompt and evidence reference. Keep enable and quality flags
false until evidence/data-handling approval exists. Then record owner approval,
obtain per-user consent through Settings, and use a bounded isolated pilot.
Automatic stage updates remain disabled independently of reviewed AI extraction.
Rollback: disable recruiting AI flag and redeploy; revoke consent to prevent
future requests immediately. Preserve review decisions and manual tracker data.

## Server configuration reference

Keep `RECRUITING_AI_ENABLED=false` and
`RECRUITING_AI_QUALITY_APPROVED=false` in production while evidence is absent.
`RECRUITING_AI_EVIDENCE_VERSION` identifies the independently reviewed report;
setting a flag is not itself evidence. Adapter also requires exact approved
versions: `RECRUITING_AI_APPROVED_MODEL=gpt-6-luna` and
`RECRUITING_AI_APPROVED_PROMPT_VERSION=recruiting-review-v1`. Neither is set by
this implementation. OPENAI_API_KEY stays server-only and is not provisioned by
synthetic tests.

Default daily limits: 20 requests/$0.20 reserved per user, 100 requests/$1.00
reserved project-wide. Each call reserves $0.01 conservatively; these are
estimated reservation ceilings, not a substitute for provider billing limits or
current pricing validation. Input is capped at 12,000 characters including
candidate catalog and output at 512 tokens. Configure request/spend limits through
`.env.example` names. Requests reserve before network and retain reservations on
failure. No automatic retries inside provider adapter.

The offline harness and synthetic tests do not execute live inference. No real
email content was sent to a provider during development. Existing real tracker
context remains unavailable; reviewed AI capability is incomplete until gates
are supported by required evidence and explicit consent.
