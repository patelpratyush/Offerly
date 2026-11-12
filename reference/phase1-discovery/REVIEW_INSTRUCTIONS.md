# Independent reviewer instructions: job fit labels

You are judging how well job listings fit a candidate's **approved profile**, whether a listing's stated requirements disqualify the candidate, and whether a listing deserves a place near the top of that candidate's list. Your labels measure the fit rubric. They are not shown to the rubric's authors before you finish.

## Rules for independence

1. Label alone. Do not talk to the other reviewer, and do not look at their file, until both files are submitted.
2. Do not run the scoring script, read `server/discovery/scoring.js`, or look at any score or explanation before you finish. Judge from the profile and listing text only.
3. Work from your own copy of the label CSV and return it separately. Keep the original file.
4. Use only what is written in the profile and the listing. Do not look up the employer, guess pay, or assume a skill the profile does not list. A skill the profile marks `approved: false` does not count as something the candidate has.
5. If you cannot tell, leave the cell blank and explain in `notes`. A blank is better than a guess.
6. The packet contains private text. Keep it out of Git and out of any AI tool.

## Columns

| Column | Fill in |
| --- | --- |
| `example_id` | Keep as supplied. |
| `reviewer_id` | Your assigned id (for example `reviewer-a`). Same on every row. |
| `fit_label` | Integer 0-3 about match quality only, ignoring eligibility: **0** no meaningful fit (different field or role); **1** weak fit (some overlap, major gaps such as wrong level or most required skills missing); **2** reasonable fit (adjacent role or meets most requirements); **3** strong fit (role, required skills and level line up). |
| `eligibility_label` | `meets`, `needs_verification` or `does_not_meet`. See below. |
| `relevant_top10` | `yes`, `no` or `unsure`. See below. |
| `notes` | Short reason, especially for blanks and for any label that surprised you. |

### Eligibility

Judge only explicit restrictions in the listing against the candidate's eligibility answers (work authorization, sponsorship need, citizenship, clearance, graduation year).

- `does_not_meet`: the listing states a requirement and the candidate's answer clearly conflicts with it.
- `needs_verification`: the listing states a requirement and the candidate's answer is missing or unclear, or the listing is ambiguous.
- `meets`: the listing states no restriction, or states one the candidate clearly satisfies. Absence of a stated restriction is not a guarantee; it is still `meets` for this exercise.

Eligibility is separate from fit. A job can be a strong fit (3) and `does_not_meet`.

### Relevant to top-10?

Answer: "If this listing appeared in the top 10 recommendations for this candidate, would a reasonable career adviser consider it worth the candidate's time to open?" Answer `yes` when the role is in the candidate's field and level range (fit 2 or 3) **and** nothing in the listing clearly disqualifies the candidate. Answer `no` for wrong field, clearly wrong level, a known eligibility conflict, or a role the candidate could not do from the approved profile. Use `unsure` sparingly.

This definition is fixed before any results exist so it cannot be tuned afterward.

## Ordering

You do not need to rank listings. The harness derives the reviewer ordering from your `fit_label` values within each profile; ties are fine.

## Disagreements

After both reviewers return files, a third person (or the two reviewers together) adjudicates each disagreement and records the result as rows with `reviewer_id` set to `adjudicated`. Keep both original files. Report how often the reviewers agreed before adjudication.

## What the harness reports

Eligibility agreement, rank correlation with your fit labels, top-10 relevance rate against the 7-of-10 target, coverage (listings the rubric declines to score), and reviewer-to-reviewer agreement, each with sample sizes and Wilson 95% intervals. A small or single-reviewer run is reported as preliminary.
