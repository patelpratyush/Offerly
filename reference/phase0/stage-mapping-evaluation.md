# Application stage mapping evaluation proposal

Status: evaluation harness and synthetic demo are implemented. No representative, independently labeled stage-precision result exists. Do not treat event extraction metrics as status-change accuracy.

## Proposed event-to-stage candidates

| Confirmed event | Candidate tracker stage | Required guard |
| --- | --- | --- |
| Application confirmation | Submitted | Exact application link; do not overwrite later stage |
| Review update | Under review | Must state current review action, not generic receipt |
| Assessment invitation/deadline | Assessment | Distinguish invitation/deadline from assessment completion |
| Availability request | No stage change | Create review/task suggestion only; no confirmed interview |
| Scheduled interview | Interviewing | Confirmed appointment and exact application |
| Interview reschedule | Interviewing | Update linked round; retain prior schedule history |
| Interview cancellation | No automatic stage change | Cancel linked round; preserve application stage |
| Rejection | Rejected | Explicit final decision; stale/quoted rejection cannot regress newer state |
| Offer | Offer | Explicit employment offer; preserve decision dates and offer facts |
| Recruiter request / general request | No stage change | Review/task suggestion only |

Mappings are hypotheses for evaluation, not implemented automation policy. Unknown or contradictory events must abstain and enter review.

## Local evaluator

Run `npm run phase0:stage-evaluate -- GOLD.json PREDICTIONS.json`. Gold rows require `id`, `beforeStage`, `expectedStage` (or `null`), `safeToAutoApply`, `manualLock`, `applicationLinkCorrect`, and `chronologyValid`. Prediction rows require matching `id`, `proposedStage` (or `null`), `automatic`, `applicationMatched`, and `chronologyValid`. Input files must contain the same unique case IDs. The report includes automatic status precision, safe-transition recall, automatic coverage, false transitions, chronology and link failures, per-stage precision/recall, and Wilson 95% intervals. Empty denominators return `null`.

Synthetic smoke fixture only (not a quality result):

```sh
npm run phase0:stage-evaluate -- \
  eval/phase0/stage-mapping-synthetic-gold.json \
  eval/phase0/stage-mapping-synthetic-predictions.json
```

The synthetic prediction fixture intentionally contains unsafe automatic changes to prove the evaluator counts false transitions. Its metrics say nothing about model or production performance. For a real evaluation, freeze model/prompt/mapping first, collect minimized consented examples, have two reviewers label independently, adjudicate without replacing originals, then score frozen model predictions against adjudicated labels.

For human annotation, copy `stage-mapping-label-template.csv` once per reviewer. Follow [review instructions](stage-mapping-review-instructions.md). Complete one case per row and preserve each reviewer original. The current real-mail packet has no candidate catalog or tracker snapshot: it can support event labels, but cannot provide stage-before, manual-lock, chronology-versus-tracker, or safe-to-auto-apply gold labels. Do not convert it into stage-mapping gold JSON or report stage-safety metrics. Only evaluate stage mapping when each case includes candidate identity, pre-email tracker state/history, and lock context. Keep completed files outside the repository because they contain email text.

The agreement tool accepts the packet’s full 12-event taxonomy. With an empty candidate catalog, it compares human-readable `Employer — Role` labels after Unicode normalization, case folding, and whitespace collapse. This is reviewer-label agreement only; it does not verify Offerly application identity. Adjudicated model evaluation still requires candidate applications in each row.

## Independent reviewer agreement (2026-10-30)

Two reviewers independently labeled the same 10-case minimized email packet. These numbers measure agreement only; they do not measure label correctness, model performance, or stage safety. The packet had no candidate catalog or tracker snapshot, so human-readable application matches cannot be verified against Offerly records, and stage-before, chronology, manual-lock, and auto-update-safety labels are not valid ground truth.

| Label | Exact agreement | Cohen’s κ | Interpretation |
| --- | ---: | ---: | --- |
| Human-readable application match | 4/10 (40%) | 0.375 | Reviewer agreement low; not verified application-link accuracy |
| Event: confirmation | 10/10 (100%) | 1.000 | Agreement only |
| Event: review update | 9/10 (90%) | 0.000 | One disagreement |
| Event: cancellation | 9/10 (90%) | 0.000 | One disagreement |
| Event: rejection | 10/10 (100%) | 1.000 | Agreement only |
| Each other event class | 10/10 (100%) | Not defined | No positive examples; raw agreement is uninformative |
| Provisional expected stage after | 9/10 (90%) | 0.828 | Email-only suggestion; not a validated transition |
| Confidence | 5/10 (50%) | 0.020 | Reviewers calibrated confidence differently |

Reviewers agreed on all `safe_to_auto_apply` labels, with every case marked unsafe, consistent with the missing tracker context. This is not a safety-precision result. On 2026-10-31, the owner adjudicated all six disagreement rows in the private sheet; both reviewer originals remain preserved. An exploratory GPT-6 Luna event run was scored against the resulting 10-case set; see results below. Do not claim application-link accuracy or stage safety from these labels. Private CSVs and per-case predictions remain under ignored `data/private-review/` and must not enter Git.

## Exploratory GPT event score (2026-10-31)

One 10-call GPT-6 Luna run used the 12-event taxonomy. Gold labels combined six owner-adjudicated rows and four rows where both reviewers agreed. Only event extraction was scored; the API received minimized subject/body text, without case IDs or labels. The run used `store:false` and no tools. The aggregate-only report is [committed here](private-mail-event-evaluation-2026-10-31.json); raw email content and per-case predictions remain local and ignored.

| Metric | Result | Wilson 95% interval |
| --- | ---: | ---: |
| Event precision | 4/7 (57.1%) | 25.0–84.2% |
| Event recall | 4/4 (100%) | 51.0–100% |
| Exact event-set agreement | 7/10 (70%) | 39.7–89.2% |
| Valid model-output coverage | 10/10 (100%) | 72.2–100% |

The model made three false-positive event predictions: two confirmations and one review update. Confirmation precision was 2/4 (50%) with recall 2/2; rejection precision and recall were both 2/2. Other event classes had no gold positives and no predictions, so their precision/recall are undefined. Cost estimated from provider-reported token usage and [published GPT-6 Luna rates](https://developers.openai.com/api/docs/pricing) was **$0.0005778**, under the $1 cap.

This is a post-hoc exploratory score, not a blind holdout: packet content was visible before prompt authoring. Ten cases are not representative, and only two event classes had gold positives. The point estimates do not establish PRD thresholds. Missing candidate catalog and tracker snapshot still prevent link-accuracy, status-transition, chronology, manual-lock, and stage-safety evaluation. Default API response storage was disabled, but [OpenAI abuse-monitoring logs may retain content for up to 30 days](https://developers.openai.com/api/docs/guides/your-data). Do not use this run to enable automated updates.

## Required data and procedure

1. Freeze extraction model, prompt, event taxonomy, and mapping table before any reviewer sees holdout cases.
2. Use representative, minimized, consented examples. Hide fixture text/labels from prompt authors until model and mapping freeze. Two reviewers independently label application link, event, event effective time, application stage before event, expected stage after event, correct application link, chronology validity, manual-lock state, and whether automatic transition is safe. Adjudicate disagreements without overwriting original labels.
3. Include same-company multiple applications, multiple applications in one message, duplicate/replayed messages, quoted history, stale/out-of-order mail, reschedules, cancellations, manual stage locks, and conflicting events.
4. Score extraction/linking separately from stage mapping. Count status precision only among transitions the system would apply automatically; denominator includes every automatically applied transition. Report false transitions, abstention coverage, per-stage counts, chronology failures, and Wilson 95% intervals.
5. Evaluate replay, correction, undo, and manual-lock behavior against immutable application history. A correct event label with wrong application, stage, or effective date counts as an incorrect transition.

## Release gate

PRD requires at least 98% precision for any automatically applied status and at least 85% recall for supported events, alongside at least 95% application-link precision. Current human-reviewed synthetic results do not satisfy evidence needs: link precision point estimate is 94.4%, data is prompt-visible, and status precision is unmeasured. Require adequate representative sample size and interval evidence before enabling automation; keep every update review-required until that gate passes. No production certification is implied by passing synthetic regression tests.
