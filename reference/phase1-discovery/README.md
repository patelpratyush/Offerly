# Discovery fit evaluation harness

Status: **harness built; no human-labeled evaluation has been run; the rubric is not validated.** PRD JOB 06 requires validating the fit rubric with human-reviewed examples, and the Build Plan sets a target of at least 7 of the top 10 recommendations judged relevant by pilot reviewers. This directory provides the tooling and review protocol. It does not supply evidence.

## Files

| File | Purpose |
| --- | --- |
| `scripts/discovery-evaluate.js` | Scores a dataset with the current rubric and compares it with reviewer labels. `npm run discovery:evaluate` runs it on the synthetic seed set. |
| `synthetic-seed.json` | 16 invented examples, 2 invented profiles, labels written by the harness author. Proves the harness runs. **Not validation.** |
| `dataset-template.json` | Blank human dataset: profiles (approved facts, eligibility answers, preferences), listings, reviewers, labels. |
| `fit-labels-template.csv` | Blank label sheet header. `--template` writes one pre-filled with a dataset's example ids. |
| `REVIEW_INSTRUCTIONS.md` | Independent-reviewer protocol and the fixed definition of "relevant to top-10". |
| `CONNECTOR_NOTES.md` | Connector fixture shapes vs vendor documentation, and unverified assumptions. |

## Running

```sh
npm run discovery:evaluate                                   # synthetic seed, prints the report
node scripts/discovery-evaluate.js my-dataset.json --template --reviewer reviewer-a > reviewer-a.csv
node scripts/discovery-evaluate.js my-dataset.json --labels labels.csv --json --out report.json
```

`--labels` takes one CSV. To combine reviewers, concatenate their rows into one CSV (keep a single header); `reviewer_id` separates them. Rows with `reviewer_id` of `adjudicated` override reviewer disagreements. No model calls, network access or database are used.

## What it reports

All proportions show numerator, denominator and Wilson 95% interval.

- **Eligibility agreement**: rubric `checkEligibility` status vs consensus reviewer label, a confusion table, and a count of the costly error (rubric says `meets`, reviewers found a stated restriction).
- **Rank correlation**: Spearman rho between rubric score and reviewer fit label, per candidate profile (average ranks for ties), then the mean. Needs at least 3 scored, labeled examples per profile.
- **Top-10 relevance**: for each profile, the rubric's top 10 by score among examples not known to be ineligible; the share the reviewers flagged relevant. Pooled and per profile, against the 70% target. Whether the point estimate and the Wilson lower bound clear the target are reported separately.
- **Coverage**: how many examples got a score at all. A null score means under 35 of 100 rubric weight had evidence; it is reported, not treated as low.
- **Reviewer-to-reviewer agreement** on eligibility, fit (within one step) and relevance.

## Honesty rules built into the tool

- Every report starts with the data kind. Synthetic runs print `NOT VALIDATION` and repeat it at the end.
- Human-labeled runs are labeled `PRELIMINARY` unless there are at least 30 examples, 3 profiles and 2 declared independent reviewers, and even then the tool only says to interpret with the intervals. It never says the rubric is validated.
- Disagreements without adjudication are excluded and counted, not resolved silently. Unknown labels stay unknown.
- The rubric version is recorded in each report, so a score change after a rubric edit is attributable.

## Observations from building it (synthetic, not findings about real quality)

- On the seed set the rubric's top-10 relevance is about 8/15, below the 70% target. The seed set is tiny and author-labeled, so this says nothing about real performance. It does show the harness can report a miss.
- A listing with a matching title and **no description** scores high: only the experience component is known, which meets the 35-point evidence floor. Example `a10` in the seed set was added to expose this. Raising the floor or requiring a described listing is a rubric decision for the owner; it was left unchanged here.
- Preferred-section cues are now matched only at the start of a line; real listings use many other headings, so required-vs-preferred splitting needs checking on real text.

## Rubric changes from robustness testing (version `fit-2026-11-v2`)

Weights are unchanged. See `tests/server/discovery-robustness.test.js`. Fixes: unknown pay basis no longer compared with a base-salary minimum, and a minimum with no currency is never compared; whole-word location and role matching (`US` vs `Russia`, `Java` vs `JavaScript`); remote jobs limited to another region no longer count as a location match; ordinary words (`excel`, `swift`, `spring`) no longer count as skills; a sentence mentioning a bonus no longer moves requirements into "preferred"; `5-7 years` uses 5; `U.S.`/`US` work-authorization and negated-sponsorship phrasings are now detected; graduation ranges; placeholder requisitions such as `N/A` no longer merge unrelated jobs; Ashby `isRemote` no longer implies Remote.
