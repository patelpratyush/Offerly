# Stage-mapping review instructions

## Packet limits

This email packet contains no candidate-application catalog (`candidate_applications` is `[]`) and no Offerly tracker snapshot. It does not provide application IDs, current stages, stage history, or manual-lock state. Do not infer those facts from the email or guess them.

As a result, this packet can support independent email-event labels and, where email text is unambiguous, a provisional event-to-stage suggestion. It cannot establish stage-before accuracy, chronology against tracker state, manual-lock state, or whether an automatic update would be safe. Preserve these fields as unknown; do not turn missing context into positive evaluation evidence.

## Offerly default stages

Use exact stage spelling:

`Saved`, `Preparing`, `Submitted`, `Under review`, `Assessment`, `Interviewing`, `Offer`, `Rejected`, `Withdrawn`.

These are application stages. Interview-round states such as invited, scheduled, completed, canceled, and rescheduled are separate from application stage.

## Per-column instructions

- `case_id`: keep supplied ID unchanged.
- `subject`, `body`, `received_at`: supplied minimized email data; do not edit. Addresses, links, and phone numbers were removed.
- `candidate_applications`: `[]` means no candidate catalog was supplied. Do not invent IDs.
- `reviewer_application_id`: enter employer and role only if email identifies them clearly; otherwise `NONE`. This is a human-readable match, not a real Offerly application ID.
- `reviewer_events`: comma-separated event labels, or `NONE`: `confirmation`, `review-update`, `assessment`, `assessment-deadline`, `availability-request`, `interview`, `scheduled-interview`, `reschedule`, `cancellation`, `recruiter-request`, `rejection`, `offer`.
- `application_stage_before`: use `NONE` because tracker state was not supplied. Do not guess from email.
- `event_effective_at`: explicit event time with timezone when present; otherwise `NONE`.
- `expected_stage_after`: provisional email-only suggestion using table below; use `NONE` when email does not support a stage change or evidence is insufficient. This is not an adjudicated state transition.
- `safe_to_auto_apply`: use `false` for every row in this packet. Missing tracker state, application catalog, and lock status prevent a safety determination; `false` here is a context limitation, not a measured system error.
- `application_link_correct`: `true` only if email itself clearly identifies one employer and role; otherwise `false`. This does not verify against Offerly application records.
- `chronology_valid`: use `false` only when email itself clearly contains stale/quoted chronology; otherwise use `NONE` because no tracker history was supplied. Do not claim chronology is valid from email timestamp alone.
- `manual_lock`: use `NONE`; no lock data was supplied.
- `confidence`: `high`, `medium`, or `low` for email event/match labels. Explain uncertainty in `reviewer_notes`.

## Provisional event-to-stage suggestions

| Email evidence | Provisional `expected_stage_after` |
| --- | --- |
| Application confirmation | `Submitted` |
| Explicit active review update | `Under review` |
| Assessment invitation or deadline | `Assessment` |
| Confirmed scheduled interview | `Interviewing` |
| Explicit rejection | `Rejected` |
| Explicit offer | `Offer` |
| Availability or recruiter request | `NONE` |
| Interview cancellation | `NONE` (round changes; application stage does not) |
| Reschedule | `Interviewing` only if email confirms scheduled interview; otherwise `NONE` |
| Generic interview mention or ambiguous email | `NONE` |

Mappings are hypotheses for labeling, not implemented automation policy. If multiple events conflict, or quoted email text makes current event unclear, use `NONE` and explain.

Review independently. Do not compare with another reviewer or inspect model predictions. Preserve original reviewer file; return a separate completed copy. These files contain private email text: keep them private and out of Git.

Do not convert this packet into stage-mapping gold data. A valid stage-safety evaluation needs consented examples plus candidate identity, tracker snapshot before the email, event chronology, and manual-lock state. Synthetic cases can test reviewer workflow, but only representative, consented, prompt-blind examples can support real-mail accuracy evaluation.
