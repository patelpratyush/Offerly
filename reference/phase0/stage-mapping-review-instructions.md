# Stage-mapping review instructions

Use separate copies of `stage-mapping-label-template.csv`. Review only cases supplied by Pratyush; do not compare labels with other reviewer or inspect model predictions before both copies are complete.

For each row:

- `case_id`: keep supplied ID unchanged.
- `subject`, `body`, `received_at`, `candidate_applications`: supplied case information; do not edit.
- `reviewer_application_id`: choose one candidate ID, or `NONE` if unclear.
- `reviewer_events`: comma-separated supported event names, or `NONE`.
- `application_stage_before`: stage recorded immediately before email; use exact stage name.
- `event_effective_at`: explicit event time with timezone when present; use `NONE` if unknown.
- `expected_stage_after`: stage that should follow this email, or `NONE` if stage should not change.
- `safe_to_auto_apply`: `true` only when event, exact application, chronology, and current state all support change with no manual lock. Otherwise `false`.
- `application_link_correct`: `true` only when email clearly refers to selected application.
- `chronology_valid`: `true` only when event is current and cannot regress newer state; quoted or stale events are `false`.
- `manual_lock`: `true` when user has locked stage against automatic edits.
- `confidence`: `high`, `medium`, or `low`; explain uncertainty in `reviewer_notes`.

Do not guess missing facts. Use `NONE` or `false` and explain uncertainty. Return completed file without changing original copy. These files may contain private email text; keep them private and out of Git.

Synthetic cases can test reviewer workflow, but only representative, consented examples can support real-mail accuracy evaluation.
