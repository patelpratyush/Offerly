# Job Search Workspace

**Product Requirements Document**

Version 1.1 • October 19 2026 • Draft for product and engineering review

Product owner: Pratyush Patel. Product name is a placeholder. This document defines a responsive web application that organizes a job search from discovery through offer, using recruiting emails to maintain application history and contact relationships.

### Product decision

Build the application tracker and Gmail integration first. The first meaningful release must import job applications, identify recruiters and interviewers, explain status updates with source emails, and show the next action. Job discovery with company-size and recency filters follows email tracking. Preparation, communication, and browser assistance follow discovery. The updated roadmap below is aligned with the build plan.

### Problem

Job seekers keep applications in spreadsheets, conversations in email, interview details in calendars, and resumes in separate files. Updates arrive across several threads and hiring platforms. This makes it difficult to know the current stage, who needs to reply, which resume was used, and what deadline comes next.

### Intended users

The initial user is an individual managing many applications and several interview processes. The first pilot should serve early career software and data applicants, including Pratyush, while allowing users in other fields to name their own interview rounds.

### Document map

Sections 1–2 cover goals, scope, navigation, and user journeys. Sections 3–8 define product requirements. Sections 9–11 describe data, architecture, privacy, and quality. Sections 12–13 cover delivery, acceptance, risks, decisions, and references.

All release targets, timings, thresholds, architecture choices, and capacity figures below are proposed planning requirements. They are not measured results, vendor guarantees, or approved delivery commitments.

## 1 Goals and release scope

### Outcomes

- Reduce manual application entry and status maintenance while retaining the user’s ability to verify and correct every automated change.

- Make the next required action visible across applications, assessments, interviews, and recruiter conversations.

- Preserve the relationship between jobs, contacts, emails, interviews, and submitted documents.

- Help users prepare accurate application materials and review assisted applications before submission.

### Success measures for the initial pilot

| Measure | Proposed target and definition |
| --- | --- |
| Activation | At least 70% of consenting pilot users connect Gmail or import data, then review five applications within seven days. |
| Application matching | At least 95% precision on a labeled evaluation set. Precision is correct automatic links divided by all automatic links. |
| Status automation | At least 98% precision for automatically applied status changes; at least 85% recall for supported event types in labeled relevant mail. |
| User effort | Median below 10 minutes to review an initial import of 50 applications, excluding provider authorization and waiting for sync. |
| Retention | At least 40% of activated users return in week four while actively job searching. |
| Data integrity | Zero cross-user data exposures and zero duplicate external submissions in release validation. |

### Scope definitions

P0 is required for the initial email-enabled release. P1 extends the daily workflow and preparation tools. P2 introduces discovery and recommendations; browser application assistance follows in a later P2 milestone. Deferred features remain part of the product vision but are not launch commitments.

P0: authentication, manual and CSV tracking, Gmail import and ongoing sync, email evidence, custom stages, interview rounds, contacts, document attachment, tasks, basic filters, export, deletion, and accessible responsive screens.

P1: calendar integration, optional email sending, AI message drafts, resume tailoring, cover letters, analytics, contact imports, advanced reminders, and document exports.

P2: job discovery and ranking, browser saving, supported form filling, Outlook, and deeper integrations. Defer native mobile apps, employer-facing hiring tools, multi-user coaching workspaces, and autonomous bulk submission.

## 2 Navigation and user journeys

| Screen | Required experience |
| --- | --- |
| Today | Prioritized replies, deadlines, interviews, overdue tasks, and updates requiring review. |
| Applications | Table and board; shared filters, sorting, bulk editing, and saved views. |
| Application detail | Overview, chronological timeline, emails, contacts, rounds, assessments, documents, and notes. |
| Connections | Searchable people directory with linked jobs, conversation history, and follow-up tasks. |
| Documents | Master resume, versions, cover letters, reusable answers, and usage history. |
| Jobs | Later release: discovery results, matching explanation, shortlist, and listing freshness. |
| Insights | Funnel, time in stage, source performance, resume comparisons, and exports. |
| Settings | Email connections, sync range, automation level, notification preferences, export, and deletion. |

### First use

The user creates an account, selects a timezone, and chooses Gmail import, CSV import, or manual setup. Before Gmail access, explain what is read, what is retained, and whether a model processes email text. The user selects a historical date range and starts import. Progress shows scanned candidates, linked messages, created applications, and review items. The dashboard remains usable during import.

### Daily use

The user opens Today, reviews an assessment deadline, confirms a suggested interview update, and opens the relevant recruiter conversation. Completing a task updates the application timeline. A sent reply changes the response indicator only when message evidence or the user’s confirmation supports that change.

### Application preparation

The user saves a role, reviews eligibility and gaps, chooses a resume version, edits a tailored draft, and opens the employer application. An assisted form shows the chosen answers and documents. Submission remains a deliberate user action. The tracker records confirmation evidence or asks the user to confirm submission.

### Essential empty and error states

New accounts show working manual entry and import options. A disconnected mailbox shows the last successful sync and a reconnect action. An unmatched email enters the review queue. Deleted listings retain archived descriptions when available. Loading, sync failures, and unavailable AI tools must never resemble an empty application history.

## 3 Application tracking requirements

### APP 01 Create and organize applications P0

Users can create an application with a company and title, including an “unknown role” placeholder when an email proves submission but omits the title. Store requisition ID, job URL, source, location, work arrangement, compensation with currency and period, employment type, dates, priority, and notes. Unknown fields remain empty and visibly unknown.

Acceptance: saving a manual record adds it to table and board immediately. Filters for company, stage, dates, priority, source, work arrangement, and response owner produce identical sets in both views. A failed save preserves the draft and offers retry.

### APP 02 Stages and interview rounds P0

Default stages are Saved, Preparing, Submitted, Under review, Assessment, Interviewing, Offer, Rejected, and Withdrawn. Interviewing contains named rounds with invited, scheduled, completed, canceled, or rescheduled states. Users can add stages, reorder them, and rename rounds without losing history. Offer outcome can later be accepted or declined.

Acceptance: two completed interviews and one scheduled interview remain separate records. An interview invite creates an invited round; scheduling requires an explicit date. Reordering a board column does not rewrite past events. Assessment scores and completion require evidence or manual entry.

### APP 03 Timeline and document history P0

Each application displays timestamped events with source, actor, previous value, and new value. Notes are editable with revision history. Attachments retain their original version. Mark the specific document used at submission separately from the latest uploaded resume.

Acceptance: editing the master resume does not change a submitted resume snapshot. Reversing an automated stage change appends a correction event and preserves its evidence.

### APP 04 Duplicates and multiple roles P0

Use a normalized company and requisition ID as strong duplicate signals, supplemented by job URL and title. Similar records generate merge suggestions. Multiple legitimate applications at one company remain distinct. Merging shows the affected emails, documents, and contacts and supports reversal.

### APP 05 Import and archive P0

CSV import previews column mapping, invalid rows, duplicate candidates, and date interpretation before committing. Export uses stable IDs and explicit timezone fields. Archive hides an application from active views without deleting its history. Listing snapshots record capture date and source URL; inability to retrieve a listing allows pasted text.

## 4 Email ingestion and interpretation

### MAIL 01 Connect and synchronize Gmail P0

Use provider authorization rather than mailbox passwords. Separate mailbox read access from any later sending capability. Let users choose the import range, pause sync, exclude senders or threads, reconnect, and disconnect. Manual application tracking works without email access.

Initial import finds candidate recruiting messages, fetches relevant content, groups threads, extracts evidence, proposes application links, and creates permitted updates. Ongoing synchronization processes new and changed messages using a durable cursor and a fallback rescan when required. Import must be resumable and idempotent.

### MAIL 02 Extract structured events P0

Supported events include submission confirmation, review update, assessment invite, assessment deadline, availability request, interview invitation, scheduled interview, reschedule, cancellation, recruiter request, rejection, and offer. Extract company, role, requisition ID, contact names, next steps, explicit dates, original timezone, and meeting links when present.

Acceptance: repeated processing of the same provider message creates no duplicate event. Quoted older text does not override the new message. A generic recruitment newsletter creates no application. A statement that interviews may begin later does not create a scheduled interview.

### MAIL 03 Match the correct application P0

Prefer explicit requisition IDs and established thread links. Company, role, sender domain, and temporal context provide supporting evidence. Company name alone cannot auto-link a message when several active applications are plausible. One message may contain distinct events for multiple applications, each with separate evidence.

### MAIL 04 Explain and review automation P0

Provide a suggested update, source excerpt, source email link, extraction confidence, and matching rationale. Initial auto-apply thresholds are conservative hypotheses and must be calibrated against labeled examples. Enable automation only for event types that meet the launch precision target. Ambiguous messages remain unresolved until reviewed.

Users choose review-only or automatic clear updates. Manual overrides take precedence until the user accepts later evidence or explicitly restores automation. Historical import builds a dated timeline and derives current state by event time, not processing order. Conflicting or older events cannot silently regress an application.

### MAIL 05 Conversation view P0

Show linked inbound and available outbound messages in chronological order. Sanitize email HTML and disable remote image loading by default. Treat attachments, links, and message bodies as untrusted data. A job email can supply facts but cannot authorize sending, deleting, exporting, or changing application answers.

## 5 Connections and communication

### CON 01 Contact directory P0

Store name, confirmed email addresses, job title, company, agency, hiring company, relationship type, optional phone, LinkedIn URL, notes, and last interaction. Users may edit or remove extracted fields. Store field provenance so a signature-derived company is distinguishable from a manually confirmed one.

### CON 02 Extract and link people P0

Extract people from senders, recipients, signatures, and explicit introductions. Do not turn no-reply addresses, distribution lists, scheduling bots, or names found only in quoted templates into confirmed personal contacts. Potential interviewers mentioned in a schedule can be saved as unverified until their identity is clear.

One contact can be linked to several applications, and one application can have several contacts. Keep the recruiting agency separate from the employer. Merge verified identical email identities automatically; suggest rather than assume merges based only on a common name. Support merge reversal.

Acceptance: an agency recruiter representing two employers appears once, with both application relationships and the correct agency. Two people named Alex at different companies remain separate. Extracted email addresses must be present in source content; the system must not invent addresses.

### CON 03 Relationship management P0 and P1

P0 provides conversation history, notes, related applications, contact search, and follow-up tasks. P1 adds CSV contact import, supported address-book import, relationship tags, referral history, and optional integration-based network imports. Store LinkedIn URLs without requiring account connection.

### COM 01 Drafting messages P1

Generate follow-ups, thank-you messages, referral requests, availability replies, and deadline-extension requests from selected context. Users can edit tone, recipients, subject, and body. Display all recipients and the linked application. A draft must never claim an interview, referral, availability, or attachment that is not supported by the selected context.

### COM 02 Sending messages P1

Sending requires separately enabled provider permission and a deliberate action on a reviewed draft. Maintain draft, sending, sent, and failed states. Use a client action identifier to prevent duplicate sends on retries. After a timeout with unknown delivery state, verify provider state before allowing another send. Do not infer delivery, reading, or recruiter response from an email merely being sent.

Acceptance: double-clicking Send creates at most one outgoing message. A failure leaves the draft intact. No background reminder sends a message unless a later explicitly configured workflow permits that action.

## 6 Documents and application preparation

### DOC 01 Document storage and versions P0

Upload PDF and DOCX resumes and cover letters; allow notes and other supported application attachments. Validate file type and size, scan uploads, and provide authenticated download access. Store a stable document identity with immutable versions, labels, creation date, and linked applications. Initial proposed maximum is 20 MB per file.

### DOC 02 Verified candidate profile P1

Parse the master resume into editable education, employment, skills, projects, and achievements. The user confirms extracted facts before they become reusable application data. Store approved eligibility and location answers separately from resume text. Do not assume information that is missing or stale.

### DOC 03 Tailored materials P1

Compare the selected resume with the saved job description, explain supported matches and gaps, and draft revised bullets or a cover letter. Reordering and emphasis may change; employers, dates, degrees, skills, metrics, responsibilities, and accomplishments cannot be invented. Suggest learning gaps separately from candidate claims.

Acceptance: each generated experience claim traces to an approved profile fact or selected source document. Unsupported additions are blocked or presented as questions. Missing job requirements appear as gaps. Export preserves the reviewed text and selected document version.

### DOC 04 Review and export P1

Provide side-by-side source and draft, visible edits, an editable preview, version naming, and PDF/DOCX export. Retain the exact exported document attached to an application. A failed export preserves the draft. The product must not promise a particular ATS score or guaranteed interview outcome.

### ANS 01 Reusable application answers P1

Store user-approved answers to recurring questions, including experience summaries and work preferences. Track answer provenance and last confirmation. Show character counts and preserve numeric limits when preparing text. Eligibility, sponsorship, salary, relocation, and start-date answers require confirmed profile values; unanswered sensitive questions remain for user input.

### Preparation workspace P1

For each interview round, show the role description, people involved, logistics, user notes, project examples, and practice questions. Provide a post-interview notes area and a thank-you draft action. Preparation is distinct from completing an employer’s live or independent assessment.

## 7 Job discovery and assisted applying

### JOB 01 Discovery and source adapters P2

Start with supported employer feeds, permitted APIs, user-saved listings, and explicitly supported job sources. Each adapter records source URL, source identifier, posted date when available, fetched time, and retrieval outcome. Universal scraping is not a launch dependency. Coverage must be displayed accurately.

Deduplicate the same opening across sources while preserving source links. A role is active only when verified through a supported source or labeled with the last verification date. Removed or inaccessible roles display their state without silently disappearing from saved applications.

### JOB 02 Preferences and ranking P2

Users configure role families, seniority, experience, location, remote or hybrid preferences, salary minimum, work authorization constraints, start date, and dealbreakers. Hard constraints exclude known violations. Unknown eligibility or salary stays visible as unknown; users decide whether to include those results.

Provide a per-job explanation covering relevant experience, missing skills, explicit eligibility restrictions, and source freshness. Match scores describe fit under a documented rubric, not the probability of an interview. Do not invent salaries, experience equivalence, or graduation eligibility.

### JOB 03 Company coverage and collection P2

Maintain a company and source registry with canonical domain, career URL, board identifier, connector type, last success, next refresh, and source health. Start with a proposed 100–300 companies across validated Greenhouse, Lever, and Ashby connectors. Expand coverage through individually supported sources. Confirm current source conditions before deployment; public readability does not establish unrestricted redistribution rights.

Collect once into a shared job catalog and personalize per user. Preserve source IDs and descriptions, canonicalize duplicates, and retain all source URLs. Failed or partial fetches must not mark jobs closed. Record reopened and reposted jobs without resetting original discovery history.

Acceptance: the same role from two sources appears as one recommendation with source links; a legitimate second requisition remains separate. A source outage displays a stale-verification indicator and does not produce mass closures.

### JOB 04 Recency and listing freshness P2

Store employer_posted_at, first_discovered_at, last_checked_at, and last_changed_at separately, preserving date precision and timezone evidence. Provide rolling windows for 24 hours, 3 days, 7 days, 30 days, and a custom range. Latest postings and New to your feed are distinct views. Unknown posting dates remain unknown and do not qualify as confirmed recently posted jobs.

Acceptance: a listing posted two weeks ago and first discovered today appears in New to your feed but not Last 24 hours by posting date. A description update does not reset the original posting date. Date-only sources display date-only precision and avoid false exact-hour claims.

### JOB 05 Company size preferences P2

Define Small as 1–199 employees, Mid-sized as 200–999, Large as 1,000+, and Unknown when evidence is insufficient. These are product categories. Allow multiple selections and an independent include-unknown option. Store estimated employee count or range, source URL, as-of date, and the organization entity being described.

If a range crosses category boundaries, display the range as ambiguous and exclude it from strict size matches unless the user includes uncertain estimates. Keep startup status distinct. Company-size filters apply consistently to search, recommendations, saved searches, and alert delivery. Do not infer company size from name recognition or funding.

Acceptance: 199 employees maps to Small, 200 to Mid-sized, 999 to Mid-sized, and 1,000 to Large. A 150–500 range is not silently classified. A subsidiary’s size is not replaced by its parent’s headcount without a visible entity label.

### JOB 06 Match score and evidence P2

Use an approved candidate profile and separate eligibility results from fit scores. Initial proposed weights: relevant responsibilities and experience 35%, required skills 30%, seniority alignment 20%, preferred qualifications 10%, and user preferences 5%. Validate the rubric with human-reviewed examples and version it. Explain matches, missing requirements, and unknowns using profile and listing evidence. A fit score is not an interview probability.

Acceptance: unsupported skills cannot increase a candidate’s score. Missing compensation does not become zero or an invented estimate. Base salary and total compensation are not interchanged. Changing a profile triggers re-evaluation without treating every previously seen job as a new opening.

### JOB 07 Personalized discovery views P2

Provide Best matches, Latest postings, New to your feed, Company watchlist, Stretch roles, Saved, and Already applied views. Filters include role, seniority, location, work arrangement, salary, eligibility, source, recency basis, company size, and minimum fit. Persist saved searches and user dismissal feedback. Show source coverage and last verification without promising whole-internet completeness.

### EXT 01 Browser saving P2

On supported job pages, the extension previews extracted company, title, requisition, URL, and description before saving. Detect existing applications and offer to open them. Unsupported pages allow manual selection or pasted details. Request the narrowest practical site permissions and show when the extension is active.

### APPLY 01 Assisted form filling P2

Support a published list of sites and form fields. Fill only user-approved profile answers and selected documents. Pause for missing information, ambiguous questions, sensitive disclosures, unsupported controls, or employer challenges. Preserve the draft and explain what remains. Never guess an answer or bypass a site challenge.

Before submission, show the employer, role, selected resume, key answers, unanswered fields, and warnings. The user submits on the employer site. Store submission confirmation evidence when available; otherwise ask for manual confirmation. Opening or filling a form does not change stage to Submitted.

### Acceptance

An unsupported form yields a usable manual handoff. Reopening the same role warns of an existing submission. A failed or interrupted fill never records success. A changed application answer cannot silently replace an approved profile fact. Automated bulk submission remains deferred.

## 8 Daily actions reminders and analytics

### TASK 01 Today and next action P0

Today groups overdue tasks, actions due today, upcoming deadlines, interviews, emails needing a reply, and uncertain updates. Sort time-critical events first. Each item has a reason, related application, due date, and action. Users can complete, snooze, dismiss, or edit tasks.

Store response ownership as User, Recruiter or employer, None, or Unclear. An explicit request for availability can set User. A confirmed sent response may set Recruiter or employer. Ambiguous messages show Unclear. Do not label an employer as having read a message.

### TASK 02 Deadlines and notifications P0 and P1

P0 supports in-app tasks and deadline reminders. P1 adds opt-in email or browser notifications and calendar integration. Default proposed reminders are 24 hours and 1 hour before a scheduled interview, 48 hours and 24 hours before an assessment deadline, and a configurable follow-up after seven calendar days without a reply. Users can change or disable each rule.

Store exact deadlines in UTC with the original timezone. Date-only deadlines remain date-only until a user supplies a time; do not invent midnight. Relative dates must anchor to the message timestamp and explicit timezone when possible. Ambiguous daylight-saving times require review.

Acceptance: rescheduling replaces future reminders for the old occurrence. Canceled interviews generate no future interview reminder. Repeated sync does not duplicate tasks. Rejected, withdrawn, and archived applications stop general follow-up reminders unless the user retains a specific task.

### CAL 01 Calendar integration P1

Users select which calendars to connect and whether to read, export, or write events. Match email and calendar invitations by event identifiers, role, contacts, and time. Deduplicate the same interview across sources. Show conflicts, original timezone, local timezone, conferencing link, and cancellation state. A calendar event alone must not establish that the interview was attended.

### NOT 01 New job alert rules P2

Users create saved rules combining job preferences, recency, company size, watchlists, minimum fit score, and treatment of unknown eligibility. Support in-app notifications, opt-in email, and later browser notifications. Offer immediate processing-triggered alerts, daily digests, or weekly digests. Immediate delivery still depends on source collection and processing schedules.

Provide a preview, timezone, quiet hours, volume cap, pause, editing, disablement, and email unsubscribe. Do not notify the historical catalog on enablement unless the user requests a backfill. Re-check availability, eligibility, score, and rolling recency at delivery. Suppress applied and dismissed roles by default.

Deduplicate alerts across source copies and retries using user, rule, canonical job, and event type. Batch digests per user and channel; if overlapping rules match the same job, show it once and explain matched rules. Reposts, unchanged content, and score recomputation do not automatically generate new-job alerts. Optional material-change alerts are separate.

Acceptance: a qualifying job produces one notification despite two source records and a retried job. A rule for small and mid-sized companies excludes a verified large employer. Unknown sizes appear only when enabled. Jobs that age out of a 24-hour posting window before a weekly digest are excluded; the user is warned when selecting a window shorter than their digest interval. Quiet-hour deferral honors the user timezone, and disabling a rule cancels pending deliveries for it.

### NOT 02 Delivery reliability P2

Record pending, sent, failed, suppressed, and retry states. Use bounded retries and idempotent dispatch; verify provider state when delivery outcome is unknown. Re-check account activity and opt-in before dispatch. Account deletion cancels pending alerts. Notification timing targets are measured after successful ingestion and reported separately from source discovery lag.

### ANA 01 Insights P1

Show submissions per week, unique submitted applications, applications reaching interview, offers, time to first response, time in stage, and outcomes by source or resume version. Distinguish applications from individual interview rounds. Preserve historical stage visits when calculating funnel conversion, including users who skip assessments.

For a selected submission cohort, interview conversion equals applications with a verified interview event divided by submitted applications. Offer conversion uses unique applications reaching offer. Display sample sizes and exclude unknown dates from time metrics. Small samples are descriptive and cannot establish that a resume caused an outcome. P0 includes basic counts and CSV export.

## 9 State rules and logical data model

### State behavior

Application stage, interview state, response ownership, and next-action state are independent fields. A user may be Interviewing, have Round 2 completed, be waiting for the employer, and have no overdue task. Silence never creates Rejected. A scheduled interview in the past is not automatically completed.

Maintain an append-only event history and derive current application state from ordered effective events. Proposed updates may be accepted, rejected, or corrected. Terminal stages resist automatic reopening; explicit new evidence produces a review item. Manual corrections record a lock for the affected field until the user permits subsequent automation.

| Entity | Principal fields and relationships |
| --- | --- |
| User and preferences | Identity, timezone, role preferences, automation settings, notification choices. |
| Email connection | User ID, provider, encrypted credential reference, granted scopes, cursor, sync state. |
| Company and job listing | Normalized company, size estimate/range, size source and date, entity scope, source IDs, requisition, title, location, salary, snapshots, four separate freshness timestamps. |
| Discovery and recommendations | Source connector, collection run, canonical job, score and rubric version, per-requirement evidence, eligibility, feedback. |
| Search and notifications | Saved search, alert rule, cadence, timezone, quiet hours, channel consent, notification event, digest, delivery state, deduplication key. |
| Application | User ID, listing/company, current stage, response owner, priority, applied date, archive state. |
| Application event | Effective time, received time, type, field changes, source evidence, confidence, actor, model/parser version. |
| Email message and link | Provider message/thread IDs, relevant retained content, participants, message time, application links. |
| Contact and relationship | User-owned person, identity emails, employer/agency, role, provenance; many-to-many applications. |
| Interview and assessment | Application, round, status, schedule, timezone, people, meeting URL, deadline, evidence. |
| Document and version | Owner, immutable file reference, content hash, profile facts, version, application usage. |
| Task and draft | Application/contact, action, due time, reminder state; draft recipients, body, send state. |
| Review and audit record | Suggested change, reason, evidence, decision, manual override, security-relevant actions. |

### Integrity rules

Every user-owned record must enforce ownership at query and storage boundaries. Provider connection plus message ID is unique. Event extraction uses message ID, event type, application, and a stable event fingerprint to prevent duplicates. Application uniqueness cannot rely on company alone. Deletion cascades cover derived data, files, search indexes, model caches, and queued work.

## 10 System architecture and integration contracts

### Proposed architecture

Use a responsive web client, an authenticated application API, a relational datastore, private object storage, and durable background workers. The API handles interactive edits. Workers handle mailbox synchronization, parsing, model extraction, reminders, exports, and source refreshes. Keep these jobs outside interactive request time limits.

Technology selection is an implementation decision. Choose specific frameworks and managed services after a short integration prototype; this PRD does not assume current vendor prices, API quotas, or hosting capabilities. Separate provider adapters from core matching and state rules so Gmail and Outlook can share application behavior.

### Processing contract

Each job carries user ID, connection ID, operation ID, retry count, and correlation ID. Check that the account and connection remain active before each batch. Fetch candidates, normalize messages, extract structured events, validate fields, match applications, apply policy, write events, then create tasks. Use schema validation and deterministic rules around any model output.

Persist work before acknowledging it. Retry transient provider failures with bounded exponential backoff and jitter, respecting provider limits. Send repeated failures to an operator-visible queue. Advance sync cursors only after safely recording processed work. Handle expired cursors with a bounded overlapping rescan and deduplication.

### Application API capabilities

Expose authenticated operations for applications, events, contacts, rounds, assessments, tasks, documents, drafts, preferences, connections, imports, and exports. Review actions include accept, reject, correct, and undo. Mutating operations accept idempotency keys and record the actor. Concurrent edits use a version check and return a conflict with the latest state instead of overwriting silently.

### Failure behavior

If extraction is unavailable, retain the pending message and retry while manual tracking remains usable. Invalid model output cannot update stage or create an external action. If a job-source connector fails, show its last refresh rather than claiming no matching roles. If mail access is revoked, stop fetching, mark the connection disconnected, and preserve existing application records until deleted.

### Observability and cost controls

Measure queue age, import progress, sync lag, parsing error rate, review rate, precision on labeled examples, reminder delivery, provider errors, and model usage per user. Log record IDs and redacted error categories rather than full email bodies. Cache extraction by message content and parser version. Bound import batches and AI usage; disclose any user limits before blocking work.

## 11 Privacy security and quality requirements

### Access and retention P0

Encrypt transport and stored credentials. Keep refresh tokens out of clients and logs. Isolate users across database records, background jobs, search, downloads, and object storage. Use short-lived authenticated file access and verify object ownership on every request. Disconnect immediately stops new sync; disconnect and delete are separate controls.

Proposed retention: retain structured job data until deletion; retain only relevant email content needed for the workspace, with a configurable retention window. Do not persist unrelated messages after candidate filtering. Account deletion should remove live data within seven days and expire backup copies within 30 days, subject to validation of infrastructure capabilities. Explain any retained minimal security records and their retention before launch.

### AI processing and untrusted content P0

Disclose external model processing and provide a manual alternative when AI is disabled. Select providers and contracts before production; confirm retention and training terms rather than assuming them. Minimize the message context sent for extraction. Never use email instructions as system commands. Validate links, sanitize HTML, scan attachments, and prevent generated output from calling external actions directly.

### Reliability and performance targets

| Area | Proposed release target |
| --- | --- |
| Interactive use | 95th percentile below 2 seconds for application list and detail reads under the declared pilot load, excluding external providers. |
| Ongoing mail sync | 95% of relevant messages processed within 10 minutes of provider availability while connected and below quota. |
| Import | Process 1,000 candidate messages within 15 minutes under declared provider quota and model capacity; display progress and pause/resume. |
| Pilot capacity | Validate 100 active users, 5,000 applications per user, and 50,000 linked message records per user. |
| Availability | Proposed 99.5% monthly application availability; show integration outages separately. |
| Recovery | Proposed recovery point within 24 hours and recovery time within 8 hours; prove through a restore exercise. |

### Accessibility and responsive behavior

Target WCAG 2.2 AA with keyboard navigation, readable contrast, labeled controls, visible focus, status text beyond color, and screen-reader announcements for saves and errors. Provide buttons as an alternative to drag-and-drop. Validate narrow mobile layouts, timezone controls, document previews, and large application lists with pagination or virtualization.

### Integration readiness

Before a public launch, confirm provider OAuth scopes, consent screens, verification requirements, applicable data policies, approved sending behavior, and each job source’s permitted access. These are implementation dependencies to verify against current official documentation, not claims of completed approval.

## 12 Delivery roadmap and release acceptance

| Milestone | Deliverable and exit criteria |
| --- | --- |
| M0 Foundation | Prototype mailbox access, extraction evaluation, and listing import. Confirm provider dependencies and decide technologies. |
| M1 Manual tracker | Authentication, application board/table, stages, contacts, rounds, attachments, tasks, import/export. Pass ownership and data integrity tests. |
| M2 Email enabled MVP | Gmail import/sync, matching, evidence, review, contact extraction, corrections, Today. Meet precision targets and pass replay tests. |
| M3 Discovery and recommendations | Source registry, shared catalog, verified candidate profile, eligibility, fit explanations, recency and company-size filters, watchlists, saved searches, and configurable job alerts. Validate source deduplication, freshness, and alert suppression. |
| M4 Preparation and communication | Resume tailoring, cover letters, reusable answers, exports, calendar, interview preparation, relationship imports, reviewed drafts, optional sending, and analytics. |
| M5 Expanded assistance | Browser saving, supported form filling, more validated job sources, Outlook, and further integrations. Publish support and limitation lists. |

Illustrative estimate for one experienced full-time developer: M0–M2 may require 8–12 weeks, with later milestones adding substantial work. Provider verification and integration uncertainty can extend this. Re-estimate after M0; dates are not commitments. Reserve explicit time for evaluation, accessibility, privacy, and pilot feedback.

### M2 release acceptance scenarios

- Import the same message batch twice: one application event per unique event, no duplicate contacts, and a stable current stage.

- Receive an ambiguous update for one of three roles at the same employer: queue review and change none automatically.

- Process a newer interview invite before an older submission email: retain chronological history and the newer stage.

- Receive a reschedule and a cancellation: preserve prior occurrences, update the active round, and remove obsolete reminders.

- Correct a wrong application link: move the relevant evidence, rebuild derived state, and preserve the correction history.

- Open another user’s record or file URL: deny access without revealing private record contents.

- Disconnect or delete during import: stop queued work and prevent reinsertion after deletion.

- Upload a new resume: preserve the exact older document used for an existing submission.

- Read a message containing instructions to send or export data: extract recruiting facts only and take no external action.

### Discovery release acceptance scenarios

- Confirm company-size boundaries, ambiguous ranges, parent-versus-subsidiary labeling, and unknown-size controls.
- Distinguish newly discovered old listings from newly posted openings across all feeds and alerts.
- Suppress duplicate notifications across source copies, overlapping rules, retries, reposts, and score refreshes.
- Re-evaluate recency and availability when deferred or digest notifications are sent.
- Validate quiet hours, unsubscribe, account deletion, and source outage behavior.
- Evaluate top-10 recommendation relevance with pilot users; proposed target is at least seven relevant roles, using a predefined relevance rubric.

### Validation strategy

Use consented, minimized or synthetic recruiting emails across confirmations, assessments, multi-round interviews, agencies, rejections, forwards, quoted replies, and timezone cases. Label application matches and events separately. Evaluate precision, recall, and abstention rate on held-out examples. Re-run meaningful regression cases after changing parsers, prompts, models, or matching rules.

## 13 Risks decisions and product references

| Risk | Product response |
| --- | --- |
| Wrong email interpretation | Evidence, calibrated automation, review queue, field-level override, undo, and held-out evaluation. |
| Multiple roles or recruiter agencies | Requisition-aware matching and explicit many-to-many contact relationships. |
| Mailbox trust and provider approval | Read-only initial workflow, clear consent, minimal retention, deletion, and early integration prototype. |
| Overly broad initial scope | Launch M2 before discovery, advanced documents, or form automation. |
| Changing source and form behavior | Source adapters, published support list, freshness indicators, and manual handoff. |
| High processing cost | Candidate filtering, bounded historical import, deduplication, caching, and per-user usage controls. |
| Misleading analytics or fit scores | Clear denominators, sample sizes, source timestamps, unknown values, and no interview guarantees. |

### Open decisions before implementation

- Confirm product name, personal-use versus public-product launch, initial pilot size, and available engineering time.

- Choose the historical import default and retained email-content window. Decide whether review-only is the default for every new account.

- Select the production stack and model provider after integration validation. Establish a monthly operating budget and per-user usage limits.

- Choose the first supported job sources, employer forms, calendar provider, and Outlook milestone based on pilot demand.

- Decide whether pricing is required. Pilot assumptions use a single individual workspace without billing; no subscription or revenue forecast is implied.

### Competitive references

This PRD combines the requested workflow with feature categories discussed from Simplify, Huntr, Teal, Careerflow, and ApplyTrail. It does not claim that the requirements are unique or that every competitor lacks them. Access, pricing, and beta availability must be checked again before implementation decisions.

Simplify email integration: https://simplifyjobs.featurebase.app/help/articles/0236686-email-integration

Huntr contacts and documents: https://help.huntr.co/en/articles/10089169-contacts-and-documents

Teal job tracker: https://www.tealhq.com/tools/job-tracker

Careerflow feature overview: https://www.careerflow.ai/faq

ApplyTrail repository: https://github.com/rutuu/ApplyTrail

References were surfaced during the product discussion on October 15, 2026. Requirements, targets, and release sequencing in this document are proposed product decisions.


## 14 Revision notes

Version 1.1 adds the expanded job-discovery requirements and incorporates recency filters, configurable new-job notifications, and small/mid-sized/large company preferences. The delivery sequence is tracking foundation, email automation, discovery and recommendations, preparation and communication, then broader application assistance. The Markdown PRD is the updated specification; the previously generated Word document is version 1.0.

Technical source references from the planning discussion:

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever Postings API](https://github.com/lever/postings-api)
- [Ashby Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [LinkedIn prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software)

Source availability and access conditions must be rechecked during integration validation.
