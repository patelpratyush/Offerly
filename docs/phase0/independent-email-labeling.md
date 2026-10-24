# Independent email labeling task

## Your task

Use `docs/phase0/email-labeling-packet.csv`. It contains 24 fictional recruiting
emails and candidate applications. No model predictions or expected labels appear
in the packet.

1. Make two copies of the CSV: one for you, one for your friend.
2. Each reviewer labels every row alone. Do not compare answers until both files
   are complete. Do not open the source fixtures or model reports first.
3. For `reviewer_application_id`, enter one candidate ID from that row, or
   `NONE` if the email cannot be tied to one application with confidence.
4. For `events`, enter zero or more comma-separated values from:
   `confirmation`, `assessment`, `interview`, `rejection`, `offer`.
   Use `NONE` when no current recruiting event is explicit. Ignore quoted old
   messages, newsletters, and general outreach.
5. For `confidence`, enter `high`, `medium`, or `low`. Add short explanation in
   `reviewer_notes` when uncertain.
6. Send both completed CSV copies back. I’ll compare agreement, adjudicate
   disagreements with you, then score frozen GPT predictions. Keep each
   reviewer’s original labels unchanged.

This first task validates reviewer agreement on fictional cases only. It does
not close production quality gates; those still need representative, consented
examples and end-to-end safety validation. Do not add real Gmail content to this
packet or send it to an AI provider.
