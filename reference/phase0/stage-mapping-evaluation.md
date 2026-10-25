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

For human annotation, copy `stage-mapping-label-template.csv` once per reviewer. Follow [review instructions](stage-mapping-review-instructions.md). Complete one case per row. Use `NONE` for unresolved application/event; stage fields use exact tracker stage names or `NONE`; booleans use `true`/`false`. Reviewers must label independently before comparing files. Keep completed files outside the repository because they contain email text. After adjudication, convert labels to the gold JSON fields documented above; preserve both reviewer originals. Send the completed files back for conversion, GPT prediction generation, and evaluation.

## Required data and procedure

1. Freeze extraction model, prompt, event taxonomy, and mapping table before any reviewer sees holdout cases.
2. Use representative, minimized, consented examples. Hide fixture text/labels from prompt authors until model and mapping freeze. Two reviewers independently label application link, event, event effective time, application stage before event, expected stage after event, correct application link, chronology validity, manual-lock state, and whether automatic transition is safe. Adjudicate disagreements without overwriting original labels.
3. Include same-company multiple applications, multiple applications in one message, duplicate/replayed messages, quoted history, stale/out-of-order mail, reschedules, cancellations, manual stage locks, and conflicting events.
4. Score extraction/linking separately from stage mapping. Count status precision only among transitions the system would apply automatically; denominator includes every automatically applied transition. Report false transitions, abstention coverage, per-stage counts, chronology failures, and Wilson 95% intervals.
5. Evaluate replay, correction, undo, and manual-lock behavior against immutable application history. A correct event label with wrong application, stage, or effective date counts as an incorrect transition.

## Release gate

PRD requires at least 98% precision for any automatically applied status and at least 85% recall for supported events, alongside at least 95% application-link precision. Current human-reviewed synthetic results do not satisfy evidence needs: link precision point estimate is 94.4%, data is prompt-visible, and status precision is unmeasured. Require adequate representative sample size and interval evidence before enabling automation; keep every update review-required until that gate passes. No production certification is implied by passing synthetic regression tests.
