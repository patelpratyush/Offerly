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

## Local 4B upgrade protocol (2026-10-23)

The owner chose $0 additional AI spend. A real local `qwen3:4b` download from
[Ollama](https://ollama.com/library/qwen3:4b) is approximately 2.5 GB, Apache-2.0,
and was verified against installed digest
`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`.
This Mac has 8 GiB RAM; the loaded model uses approximately 3.2 GB and CPU inference.
Only one model is loaded and requests run sequentially. No Gmail content enters
this model evaluation. There is no cloud inference or per-token provider payment.

The original 0.6B report and predictions remain unchanged. The upgrade first used
the exact original v1 prompt on six development examples. Its mail link precision
was 3/4 and event precision 1/4. Raw fit compensation agreement was 1/2 and recency
0/2. This stronger model alone did not solve the weak prompt or factual errors.

Two additional prompt versions were developed using only development outcomes:

- v2 clarified event meanings, current versus quoted text, and independent fit,
  eligibility, compensation and recency outputs. Dev mail still produced a false
  newsletter link and treated availability acknowledgment as confirmation. A fit
  output invented `120010` where input said `120000`; all raw outputs are retained.
- v3 added two explicitly labeled fictional development demonstrations for
  newsletters and availability acknowledgment with an older quoted interview.
  These demonstrations are part of the hashed system prompt. Development mail
  matched all four authored examples, but this is tuning feedback, not independent
  validation. One development fit request timed out after 60 seconds; its raw and
  pipeline metrics remain null, rather than scoring the placeholder as a model
  prediction.

The v3 prompt and complete pipeline were frozen before the first 4B held-out call.
The held-out request deadline was set to 180 seconds based on the development
latency failure. Context 4096, output-token cap 512, temperature/seed 0 and
`think:false` remain unchanged. Therefore comparisons change model, prompt and
latency budget; they do not isolate a causal model-only improvement. No 4B v1/v2
held-out runs were performed and no prompt is tuned against upgraded held-out
outcomes. Any preexisting 4B held-out artifact blocks another held-out run.

### Raw model versus factual pipeline

Raw predictions and raw metrics are retained separately. The fit-only
`explicit-listing-facts-v1` pipeline derives two fields directly from whitelisted
input: explicit currency-prefixed base/total amounts and the postedAt/asOf 24-hour
comparison. It never reads expected labels, changes application links/events,
repairs fit scores, or overrides eligibility/evidence. Pipeline predictions and
metrics use separate artifacts. If raw generation is incomplete, pipeline metrics
also stay null.

This salary parser is intentionally narrow and lexical. Unsupported formats,
ranges and conflicting currencies abstain, but negated or illustrative salary
text may still match. It is **not** semantic truth or evidence verification and
is not enabled in production. All eligibility examples have unknown gold labels;
perfect agreement cannot demonstrate discrimination of eligible/ineligible cases.
Evidence text presence is checked; entailment and relevance still need human review.

### Immutable artifacts and reproduction

Fixed commands select the provisioned local model and synthetic fixtures only:

```sh
node scripts/phase0-model.js upgrade-dev
node scripts/phase0-model.js upgrade-dev-v2
node scripts/phase0-model.js upgrade-dev-v3
node scripts/phase0-model.js upgrade-held-out-v3
```

These commands are single-record runs: existing artifacts are never overwritten.
Inspect the saved results rather than rerunning recorded held-out examples.
Development artifacts are suffixed `-qwen3-4b-dev`, `-dev-v2`, and `-dev-v3`;
final held-out artifacts use `-qwen3-4b-held-out-v3`. The held-out report captures
runner source, factual-parser source, fixture and system-prompt SHA256 hashes at
run start. Earlier development reports are retained as originally generated and
are not retrofitted with later source hashes. Every result remains synthetic and
`humanValidated:false`; no PRD auto-apply or production precision gate opens.

## Frozen 4B held-out results (2026-10-23)

The eight recruiting examples all produced schema/domain-valid outputs. Actual
application-link precision was **5/6 (83.3%)**, link recall **5/5 (100%)**, event
precision **3/3 (100%)**, and event recall **3/5 (60%)**. One ambiguous application
was linked incorrectly; two confirmation events were missed. Interview, rejection
and offer examples were recognized; injection/newsletter and agency examples
abstained. These are three emitted events, not proof of 98% production precision.
The point estimates fail the PRD's 95% application-link precision and 85% supported
event-recall requirements. No post-held-out prompt or pipeline changes were made.

This establishes runnable review-only feasibility with explicit failure evidence,
not automatic-stage readiness. Real consented human-labeled examples, additional
supported event types, deterministic ambiguity safeguards, independent evidence
review and application-level idempotency/effective-time tests remain required for
the email-enabled release. No automatically applied status change is enabled.

All four held-out fit requests returned valid structured outputs within the
180-second deadline (44.5–68.7 seconds each). Raw exact-compensation agreement was
4/4, raw recency agreement 3/4, and agreement with provisional authored fit ranges
2/4. The separately reported factual pipeline retained compensation 4/4 and made
recency 4/4 by computing it from input timestamps; it did not repair scores,
eligibility or evidence. Both raw/pipeline eligibility agreement was 4/4 against
four unknown labels and is not an eligibility-quality result.

Raw evidence also invented requirements or location/remote matches absent from
some listings. The listing containing an instruction to score 100 received 100,
outside its authored range; this single observation does not establish causal
prompt-injection behavior, but is unsafe for a production recommendation claim.
Pipeline factual accuracy must not conceal these evidence/score failures.

The complete held-out run took 371.35 seconds on this CPU-only Mac. The model was
unloaded afterward to free RAM; downloaded weights remain installed. Reported
runner and factual-parser SHA256 values were verified against the unchanged
source after the run. No original 0.6B evidence was modified.

Final artifacts:

- [Frozen held-out report](model-report-qwen3-4b-held-out-v3.json)
- [Raw recruiting predictions](../../eval/phase0/predictions-mail-qwen3-4b-held-out-v3.json)
- [Raw fit predictions](../../eval/phase0/predictions-fit-qwen3-4b-held-out-v3.json)
- [Input-derived factual pipeline predictions](../../eval/phase0/predictions-fit-qwen3-4b-held-out-v3-pipeline.json)
- [Negative v1 development report](model-report-qwen3-4b-dev.json),
  [v2 development report](model-report-qwen3-4b-dev-v2.json),
  [v3 development report, including timeout](model-report-qwen3-4b-dev-v3.json)

## Reasoning-mode development sanity check

A separate runner, `scripts/phase0-reasoning.js`, imports the frozen v3 predictor
and applies only declared transport/generation options plus the independently
reviewed source-evidence link veto. It never edits the frozen model module.
The reasoning arm uses `think:true`, 1024 generated tokens and a 180-second
request deadline. Its first development example timed out after 180.021 seconds;
per the predeclared first-two sanity rule, no further reasoning examples ran.
Coverage is **0 valid / 1 attempted / 4 planned** and both raw and guarded metrics
are null. This is a latency failure, not a measured reasoning-quality result.
The partial development predictions are failure placeholders, not model outputs.
No thinking text or chain-of-thought was retained.

The arm proposal is therefore unchanged v3 nonthinking output (512-token cap,
180-second deadline) with the source-evidence guard. This guard may only remove a
proposed application link; it cannot choose another application or change events.
Its lexical/quotation handling is conservative, not semantic evidence verification.
The independent fresh corpus remained unopened until the arm and all code
hashes froze. Root reviewer controlled the exclusive one-attempt marker and
fresh launch.

The current validation report's `fullAbstentions` counter includes null/empty
failure placeholders on incomplete runs. **Do not interpret it as model
abstention quality when coverage is incomplete.** Derive valid-only abstentions
by counting null/empty predictions whose diagnostic has `valid:true`; the thinking
sanity run has zero valid-only abstentions. Raw/guarded point metrics remain null
for incomplete runs. This limitation affects validation reporting, not extraction
or guard behavior, and no predictions were repaired.

Read [reasoning development report](model-reasoning-dev.json). Commands, in order:

```sh
node scripts/phase0-reasoning.js dev
# Root review and final guard/source confirmation before this step:
node scripts/phase0-reasoning.js freeze
# Root alone launched after creating the exclusive attempt marker:
node scripts/phase0-reasoning.js fresh
```

Each artifact is immutable. The runner, frozen predictor, source guard, evaluator,
system prompt and input fixture are hashed. Fresh input must match the independent
author's SHA256 before inference. Any source mismatch after freeze stops safely.

## Frozen fresh results and model decision (2026-10-23)

The one-shot fresh run used 24 independently authored synthetic cases and frozen
non-thinking Qwen3 4B v3 plus the source-evidence veto. **19/24 outputs were
schema-valid; five timed out or failed output validation.** The primary report
therefore keeps whole-run raw and guarded metrics null. Failures were not retried.
The model is not production-ready.

For diagnosis only, a reproducible valid-only slice excludes those five failures;
its exact excluded IDs/categories and metrics are in
[valid-only report](model-reasoning-fresh-valid-only.json). Raw links had precision
**13/18 (72.2%)**. Guarded links had precision **13/13 (100%)** but only
**13/19 (68.4%) coverage**. Event precision was **14/15 (93.3%)** and recall
**14/18 (77.8%)**; confirmation recall was **2/4 (50%)**. Guard changed links
only, not events. These values use 19 synthetic authored labels, not human-checked
or real mailbox data. Guarded precision is a small-sample point estimate and does
not imply zero risk. The incomplete five remain failures when evaluating full-run
coverage and accuracy.
Reproduce the valid-only metrics with `npm run phase0:valid-metrics`; the command
checks the fixture hash against the frozen report before scoring.

Reasoning mode was discarded after its first development case timed out at 180s.
Fresh execution measured only the preselected non-thinking arm. CPU-only local
latency ranged from **14.5s to 180.2s** for these cases. Results miss the PRD event
recall target and raw link precision target; guarded coverage is low. Keep automatic
stage changes disabled.

### GPT API as next evaluation candidate

GPT API is a plausible next candidate for extraction quality and practical
latency, but only a benchmark can tell whether it beats this local model. Current owner cap
remains **$0 additional spend**, and the configured Vercel AI Gateway reported no
credits. Do not call a paid endpoint until usable free credits are verified.
Start with synthetic cases only, strict Structured Outputs schema, no tools, low
token limits, server-side API key, and hard application-level per-run/request
limits. Schema validity still cannot guarantee correct event or application choice;
retain source evidence checks and human approval.

OpenAI says API data is not used for training by default, while abuse-monitoring
logs may retain prompts and responses for up to 30 days. Real Gmail requires a
separate, explicit opt-in before sending message content to any external model.
See [current API pricing](https://developers.openai.com/api/docs/pricing?tab=suite),
[data controls](https://developers.openai.com/api/docs/guides/your-data?content_language=English),
and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
