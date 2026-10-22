# Phase 0 evaluation assets

Status: synthetic preparation and real local baseline evaluation complete; baseline failed quality checks. Independent pilot review and representative real-mail evaluation **not performed**. These hand-authored fictional cases contain no user emails. They are a small smoke/regression set, not evidence of launch precision. The author assigned expected labels, so they are not independently labeled or a representative consented historical-mail sample.

## Assets and split discipline

- `eval/phase0/recruiting.json`: 12 synthetic messages, 4 development and 8 held-out. Separate labels for application links and events. Includes same-company ambiguity, newsletters, assessments, scheduling versus vague intent, rejection/offer, agency outreach, quoted/forwarded history, timezone and prompt injection.
- `eval/phase0/job-fit.json`: 6 synthetic profile/listing pairs, 2 development and 4 held-out. Includes unknown eligibility, seniority mismatch, stale/unknown dates, base versus total compensation, currency, and malicious listing instructions. Fit ranges are provisional author judgments, not calibrated target scores.
- `scripts/phase0-evaluate.js`: strict Zod schema and deterministic metric computation. No model provider calls, training, production mutations, or extraction implementation.

All examples have fixed IDs, split and family identifiers. Keep related templates/paraphrases in one family/split; evaluator rejects recruiting family leakage. Freeze labels before selecting prompts. Do not tune on held-out outcomes. Because all fixtures are checked into this repository, they are developer-visible regression holdouts, not a blind external evaluation. Obtain independently labeled, minimized consented examples for a real launch decision; record annotator disagreements and adjudication.

## Run against independent predictions

Run `node scripts/phase0-evaluate.js eval/phase0/recruiting.json /path/to/predictions.json`. Prediction format:

```json
{
  "version": 1,
  "split": "held-out",
  "system": "provider/model:prompt-version",
  "predictions": [
    {
      "id": "mail-ambiguity",
      "applicationId": null,
      "events": ["confirmation"]
    }
  ]
}
```

Supply **every** ID in selected split once; example above is shape only and will fail completeness checking. Use `applicationId: null` and `events: []` to abstain. Unknown fields, event names, duplicate IDs/events, IDs from another split, and invented application IDs fail closed. Candidate system receives `input` only; never pass `expected`, labels, rationale or split-specific answers to extraction. Do not construct predictions from labels and report them as performance.

Output keeps numerator and denominator with each fraction. Zero denominator means `null`, never perfect precision. Link precision = correct emitted links / all emitted links. Link recall = correct emitted links / gold linkable messages. Link coverage = emitted links / all messages. Full abstention = messages emitting neither link nor event / all messages. Event micro precision/recall count message/event-label pairs; per-event counts expose supported-event sample size. A correctly identified event on an ambiguous message can be scored independently of its unresolved application link.

PRD launch targets: link precision at least 95%; auto-applied status precision at least 98%; supported-event recall at least 85%. These offline extraction metrics do **not** demonstrate safe automatic application: application correctness, source effective time, stage mapping, authorization, quoted history and idempotency must also pass end-to-end gates. No auto-apply gate is opened by this harness. Report uncertainty and sample size; eight examples cannot establish these targets reliably.

## Fit rubric and pilot review

Version initial rubric `fit-v0-proposed`: responsibilities/experience 35%, required skills 30%, seniority 20%, preferred qualifications 10%, preferences 5%. Only approved profile evidence contributes. Score eligibility separately as eligible/ineligible/unknown with evidence; unknown work authorization never becomes eligible. Preserve missing compensation as null and base/total/currency independently. Unknown posting dates never qualify as confirmed recent.

Before scoring pilot results, two reviewers independently define relevance: meets explicit user hard constraints, no known eligibility exclusion, plausible role/seniority, and evidence-backed skill alignment. Unknown constraints must be visible and reviewed, not silently assumed satisfied. Record reviewer IDs, timestamp, rubric version, listing/profile version, relevance yes/no/uncertain, reasons, missing evidence, eligibility and compensation corrections; adjudicate disagreements without overwriting original labels. Compare proposed score to reviewed relevance and rank top ten. Denominator is ten distinct jobs, with at least seven judged relevant by pilot reviewers. If fewer than ten reviewed jobs exist, report insufficient sample; do not claim 7/10 success. Synthetic fit ranges guide discussion only. Exported `evaluateFit(gold, predictions)` measures agreement with those provisional author ranges, eligibility, exact compensation and recency labels. It does not judge evidence truth or reviewer relevance. Fit prediction envelope: `{version:1,split,system,predictions:[{id,score,eligibility,evidence,compensation,confirmedLast24Hours}]}`. `score` is 0–100 or null; eligibility is eligible/ineligible/unknown; evidence is a nonempty string array; compensation contains nullable base/total/currency. Every selected split ID is required, with no duplicates, unknown fields or cross-split IDs. Call the exported function from model runner; CLI currently evaluates recruiting only.

## Existing code limitations

`server/recruiting.js` consumes manually supplied structured evidence. Matching normalizes company plus requisition, or company plus title; multiple matches remain candidates and every proposal requires review. It does not parse raw email, infer a sender's company, resolve aliases, extract quoted timestamps, score job fit or invoke a model. Therefore this work makes **no extraction/model accuracy claim**, and does not relabel the existing structured matcher as validated AI. A future harness may exercise it with independently extracted evidence, while separately measuring extraction and linking errors.

Fit model inputs must include `postedAt` (explicit instant with `value` and `precision: "instant"`, or null) along with title, description, approved profile and `asOf`. Never infer publication date from evaluation time. Gold validation rejects date/recency contradictions and compensation labels lacking amount/currency text evidence. This lexical guard checks fixture consistency, not general extraction entailment.

## Actual local model run (2026-10-22)

One held-out run used preinstalled `qwen3:0.6b` through loopback Ollama, prompt `phase0-local-v1`, temperature/seed 0, 4096 context and 512 output-token cap. No prompt tuning or held-out rerun occurred. `docs/phase0/model-report.json` records SHA256 fixture/prompt hashes, exact model digest, timestamps, per-example duration/token usage, valid-output coverage and failure diagnostics. `eval/phase0/predictions-mail.json` and `predictions-fit.json` retain synthetic outputs. Failed mail rows contain deliberate null/empty placeholders; consult diagnostics and do not treat those rows as genuine model predictions or use them to claim model accuracy.

Mail produced only 4/8 schema-valid/domain-valid outputs, with invented links/events among successful responses. Four requests/output validations failed; complete-split mail metrics are null and evaluation is invalid/incomplete. Fit produced 4/4 valid responses: eligibility label agreement 4/4, exact compensation 1/4, recency 2/4, author fit-range agreement 2/4. All four fit labels are unknown eligibility, so 4/4 does not demonstrate eligible/ineligible discrimination. These tiny synthetic results fail to support launch quality. No automatic status changes, production model integration, or user mailbox processing was enabled.
