# Stage context: owner checklist

Use this guide to add verified Offerly tracker context to the 10-email review set. Current reviewer files have no candidate catalog or tracker snapshot, so their stage and safety fields cannot be used as stage-safety evidence.

## What to do

### Easiest: provide workspace export

1. Sign in to Offerly and open **Settings**.
2. Under **Your data belongs to you**, choose **Full workspace export** or **Workspace export with document links**. Do not choose the application CSV; it omits event history and lock records.
3. Save the downloaded `offerly-workspace.json` as `data/private-review/offerly-workspace.json` inside the project. This folder is ignored by Git.
4. Tell Codex the filename. Codex can locally inspect only application records, stage-history events, and lock records to build the case context. No credentials needed; do not paste passwords, database URLs, or API keys.

The JSON export contains your whole workspace, including application notes, contacts, import history, and event history. Hosted export does not include document bodies, but may include private document links. Share it only if comfortable providing that workspace data for this review. Do not commit it or send it to David.

### If you prefer a smaller file

Copy [`stage-context-owner-template.csv`](stage-context-owner-template.csv) to `data/private-review/stage-context-owner.csv` and fill one row per plausible application for each email case. Use the rules below. Tell Codex the filename when complete.

1. Open each email case in the private review packet. Use `case_id` to find the same email in your Offerly tracker.
2. Add one row for each plausible matching application. If one email could match two applications, add two rows. If no application matches, add one row with `candidate_application_id` set to `NONE`.
3. Copy application ID, employer, role, and requisition ID from Offerly. Do not invent IDs or infer an application from email text alone.
4. Record the application stage immediately before the email's `received_at` time. Use Offerly activity/history to account for changes made later. Current stage alone is not enough if stage changed after the email.
5. Record relevant stage changes around the email in `stage_history`. Use ISO timestamps with timezone, for example `2026-10-25T14:10:00Z: Submitted>Under review`. Include changes before and after the email when visible. Write `NONE` if no stage changes appear; write `UNKNOWN` if history is unavailable.
6. Record whether the stage field was manually locked at the email time in `manual_lock_at_email`: `true`, `false`, or `UNKNOWN`. If lock history is unavailable, use `UNKNOWN`; do not use today's lock state as proof of past state.
7. Set `tracker_context_verified` to `true` only after checking Offerly's tracker/history. Otherwise set `false` and explain in `owner_notes`.

## Values and rules

- Stage values: `Saved`, `Preparing`, `Submitted`, `Under review`, `Assessment`, `Interviewing`, `Offer`, `Rejected`, `Withdrawn`, or `UNKNOWN`.
- Times: ISO 8601 with timezone, such as `2026-10-25T14:10:00Z`.
- `NONE` means checked and no candidate/history exists. `UNKNOWN` means you could not verify it. They are different.
- For multiple plausible applications, include every plausible candidate. Reviewer must choose among them or abstain.
- Do not fill reviewer labels, expected stage after, safety, model predictions, or adjudication in this owner file. Reviewers do those independently after packet preparation.
- Do not change the original email packet or either reviewer's completed file.

## What happens after you finish

Codex can compare this context with the private email packet, reject incomplete or mismatched rows, and prepare a new blind reviewer packet. You send that packet and guide to David. After independent labels return, we compare agreement, adjudicate disagreements, score frozen model predictions against the adjudicated labels, and report whether evidence supports any stage-safety claim. A 10-case set remains exploratory; it cannot by itself prove production thresholds.

If you cannot find stage history or lock history in Offerly, leave those fields `UNKNOWN`. We can still report what the evidence supports, but cannot claim reliable stage-safety metrics for those cases.
