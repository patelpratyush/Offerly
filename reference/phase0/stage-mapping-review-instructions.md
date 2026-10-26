# Stage-mapping review instructions

Use separate copies of `stage-mapping-label-template.csv`. Review only cases supplied by Pratyush; do not compare labels with other reviewer or inspect model predictions before both copies are complete.

For each row:

- `case_id`: keep supplied ID unchanged.
- `subject`, `body`, `received_at`: supplied case information; do not edit. Email addresses, links, and phone numbers were removed.
- `candidate_applications`: empty for this real-mail packet; no candidate catalog is included. Do not invent IDs.
- `reviewer_application_id`: enter employer and role if email identifies them clearly; otherwise `NONE`.
- `reviewer_events`: comma-separated event names, or `NONE`: `confirmation`, `review-update`, `assessment`, `assessment-deadline`, `availability-request`, `interview`, `scheduled-interview`, `reschedule`, `cancellation`, `recruiter-request`, `rejection`, `offer`.
- `application_stage_before`: stage recorded immediately before email, if known; use exact stage name or `NONE`. Do not guess.
- `event_effective_at`: explicit event time with timezone when present; use `NONE` if unknown.
- `expected_stage_after`: stage that should follow this email, or `NONE` if stage should not change.
- `safe_to_auto_apply`: `true` only when event, exact application, known current stage, chronology, and no manual lock support change. Otherwise `false`.
- `application_link_correct`: `true` only when email clearly identifies one application; otherwise `false`.
- `chronology_valid`: `true` only when event is current and cannot regress newer state; quoted or stale events are `false`.
- `manual_lock`: `true` when user has locked stage against automatic edits.
- `confidence`: `high`, `medium`, or `low`; explain uncertainty in `reviewer_notes`.

Do not guess missing facts. Use `NONE` or `false` and explain uncertainty. Return completed file without changing original copy. These files contain minimized private email text; keep them private and out of Git.

Synthetic cases can test reviewer workflow, but only representative, consented examples can support real-mail accuracy evaluation.
