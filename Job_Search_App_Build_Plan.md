# Job Search App Build Plan

**Owner:** Pratyush Patel  
**Updated:** October 22, 2026
**Version:** 1.1  
**Status:** Implementation in progress; Phase 0 live Gmail gate open
**Platform:** Responsive web app first; browser extension later

## 1. Product objective

Build a personal job-search workspace that discovers relevant openings, explains how they match a candidate, helps prepare applications, and tracks recruiting progress from email. Connect jobs, applications, people, documents, interviews, and next actions in one place.

Start with individual job seekers. Pilot with early career software engineering, backend, and data applicants before expanding to other roles. Users control preferences; Pratyush’s initial profile can use entry level roles, flexible location, and a $90,000 annual base salary preference without making those defaults mandatory for everyone.

The product should make these questions easy to answer:

- Which relevant jobs are new?
- Which jobs fit my actual experience, and where are the gaps?
- What have I already applied to?
- What stage is each application at?
- Who is involved, and who needs to reply next?
- What should I do today?

## 2. Complete feature scope

| Area | Features |
| --- | --- |
| Job discovery | Supported company career pages and job feeds, company directory, company watchlist, scheduled collection, search, recency filters, company-size filters, source links |
| Job quality | Normalized records, duplicate grouping, archived descriptions, freshness checks, closed-job detection, source health |
| Recommendations | Verified candidate profile, eligibility checks, explainable fit scores, missing requirements, best matches, latest matches, saved preferences |
| Application tracking | Board and table, custom stages, interview rounds, assessments, timeline, priorities, notes, application documents, import and export |
| Email automation | Gmail connection, historical import, ongoing sync, application matching, extracted events, source evidence, review queue, correction and undo |
| Connections | Recruiters, interviewers, hiring managers, agency and employer relationships, email addresses, notes, conversation history, referrals |
| Daily actions | Reply ownership, days waiting, follow-up tasks, deadlines, meeting links, reminders, upcoming interviews |
| Notifications | New-match alerts, immediate or daily/weekly delivery, saved searches, minimum fit score, quiet hours, deduplication, unsubscribe controls |
| Preparation | Resume versions, truthful tailored drafts, cover letters, reusable answers, interview preparation notes |
| Communication | Reviewed follow-up, thank-you, availability, and referral drafts; optional sending in a later release |
| Applying assistance | Browser saving, supported form filling, selected documents, final user review, submission confirmation |
| Insights | Submission counts, interview and offer conversion, time in stage, outcomes by source and document version |
| Account controls | Authentication, timezone, mailbox disconnect, automation preferences, export, deletion, private file access |

## 3. Build principles

1. Publish explicit source coverage. Do not promise to scrape every website or discover every opening.
2. Prefer documented feeds and permitted access. Add source-specific parsers where appropriate.
3. Preserve the evidence behind extracted facts and automated changes.
4. Keep unknown requirements, dates, and compensation visibly unknown.
5. Separate candidate eligibility, job fit, and listing freshness.
6. Require user review before external submissions and outgoing messages.
7. Collect a job once into a shared catalog, then personalize recommendations for each user.
8. Keep manual tracking usable during integration or AI failures.

## 4. Job collection and freshness

### Company and source registry

Maintain company name, canonical domain, career URL, hiring platform, board identifier, collection method, last successful fetch, next fetch, and source status. Users can request additional companies. Initial target coverage is 100–300 companies, subject to connector validation.

Start with validated connectors for Greenhouse, Lever, and Ashby. These platforms have documented posting interfaces, but public access alone must not be treated as blanket redistribution permission. Confirm applicable source conditions during implementation.

Expand through supported company pages and permitted feeds or integrations. Treat LinkedIn as a separate integration decision: use authorized access where available, manually supplied listing text, and source links. Do not make prohibited LinkedIn scraping or account automation a launch dependency. Evaluate other job boards individually.

### Collection pipeline

1. Select a source that is due for refresh.
2. Fetch listings using the source adapter and its rate limits.
3. Validate the response before changing existing records.
4. Normalize company, role, requisition, description, location, work arrangement, compensation, and application URL.
5. Record original values and extraction provenance.
6. Group duplicates while retaining source-specific records.
7. Identify new openings and meaningful changes.
8. Update availability only when the evidence supports it.
9. Recompute affected recommendations and create eligible alerts.

Keep `employer_posted_at`, `first_discovered_at`, `last_checked_at`, and `last_changed_at` separate. Show “New to your feed” when the original posting date is unavailable. Do not substitute a provider’s update timestamp for its original posting date.

Begin with configurable refresh intervals, for example hourly for followed companies and several times daily for other sources, only where source limits allow. These are proposed settings, not real-time guarantees.

A failed fetch means “Could not verify,” not “Closed.” A missing listing from an otherwise complete successful feed should be checked against source behavior before closure. Keep reopened jobs and reposts linked to their earlier history.

### Recency filters and sorting

Offer Last 24 hours, Last 3 days, Last 7 days, Last 30 days, and a custom range. Users choose whether the range applies to the employer posting date or first discovery. The default Latest jobs view uses known employer posting dates; provide a separate New to your feed view for discovery timestamps. Unknown dates are clearly labeled and can be included separately.

Use rolling elapsed-time windows for 24-hour and multi-day filters. Display dates in the user’s timezone. Re-check recency at notification delivery, not just when an alert is queued. A listing discovered today with an old posting date must not appear as newly posted. Preserve date-only precision and flag uncertain boundaries rather than inventing exact publication times.

### Company sizes

Use the following app-defined categories, rather than implying a universal classification:

| Category | Employee estimate |
| --- | ---: |
| Small | 1–199 |
| Mid-sized | 200–999 |
| Large | 1,000+ |
| Unknown | No usable employee estimate |

Allow selecting several sizes and including Unknown independently. Store employee count or range, source, as-of date, and whether the estimate describes the employer, subsidiary, or parent. A range spanning two categories is ambiguous; show the range and exclude it from strict size filtering unless the user includes uncertain estimates. Do not guess size from brand recognition, funding, or job count. Record startup status separately from employee size.

Use company size as a user preference unless marked as a dealbreaker. For strict searches, unknown or ambiguous sizes do not count as confirmed matches. Evaluate the same size rules in feed filters and notifications.

## 5. Matching and recommendations

### Candidate profile

Parse an uploaded resume into skills, education, projects, employment, and accomplishments. Let the user correct and approve the facts. Store role preferences, salary expectations, authorization, sponsorship needs, relocation preferences, and start date separately. Do not infer sensitive or eligibility answers from resume wording.

### Eligibility before scoring

- **Meets known requirements:** no explicit restriction is violated.
- **Needs verification:** important information is missing or ambiguous.
- **Does not meet a stated requirement:** explain the exact restriction and evidence.

Only known dealbreaker violations exclude a listing automatically. Let users decide whether to include jobs with unknown salary or eligibility. Compare compensation using its currency, period, and base-versus-total designation; do not treat total compensation as base salary.

### Proposed scoring rubric

| Component | Weight |
| --- | ---: |
| Relevant experience and responsibilities | 35% |
| Required skills | 30% |
| Seniority and experience alignment | 20% |
| Preferred qualifications | 10% |
| User preferences | 5% |

These weights are starting hypotheses. Evaluate them against human-reviewed examples before treating the rankings as useful. Use text similarity to retrieve candidates, then assess requirements against approved profile evidence. Avoid ranking solely by repeated keywords.

Every recommendation should show matching evidence, gaps, unknowns, and score version. A score measures fit under the rubric, not interview probability. Keep freshness as a separate sort or preference rather than hiding it inside an unexplained score.

Provide Best matches, Latest matches, Company watchlist, Stretch roles, Saved, and Already applied views. Users can dismiss a role and explain why; use explicit feedback to improve preferences without silently rewriting their qualifications.

## 6. Applications and email automation

### Application model

Default stages: Saved, Preparing, Submitted, Under review, Assessment, Interviewing, Offer, Rejected, and Withdrawn. Allow custom stages. Store interviews as named child rounds with invited, scheduled, completed, canceled, and rescheduled states.

Track stage, round status, response ownership, and next task independently. Example: “Interviewing · Round 2 completed · Waiting for employer for 6 days.” Silence does not imply rejection; an interview in the past does not prove completion.

### Gmail workflow

1. Explain requested access and obtain provider authorization.
2. Let the user choose the historical import range.
3. Identify recruiting messages and exclude unrelated content from persistent storage.
4. Extract application confirmations, assessments, availability requests, interviews, reschedules, rejections, offers, contacts, and deadlines.
5. Match by requisition ID and thread evidence, with company and title as supporting signals.
6. Apply clear permitted updates or place uncertain ones in a review queue.
7. Attach the original message reference and relevant excerpt.
8. Update associated tasks and contact relationships.

Never link a message by company alone when multiple applications are plausible. Process historical events by effective date. Replaying imports must not duplicate applications, contacts, rounds, or tasks. Manual corrections take precedence until the user re-enables automation for that field.

## 7. Contacts and daily actions

Store names, verified email addresses, roles, employers, recruiting agencies, LinkedIn URLs, optional phone numbers, notes, and linked applications. One recruiter can represent several employers; one application can involve several people.

Extract contacts from actual participants and explicit introductions. Keep uncertain identities unverified. Do not create people from no-reply addresses or invent contact details. Merge by verified identity, with review for name-only matches and a way to reverse merges.

Today should prioritize overdue tasks, replies needed, assessments due, interviews, suggested updates, and follow-ups. Show whether the next response belongs to the user, employer, nobody, or is unclear.

Store precise times with their original timezone and UTC equivalent. Keep date-only deadlines date-only. Cancel obsolete reminders when an interview is rescheduled or canceled. Add optional digest and new-match alerts with configurable frequency; avoid repeat alerts for the same opening.

### Notification rules

Users can save multiple alert rules with roles, location, remote preference, company watchlist, small/mid-sized/large selections, minimum fit score, eligibility handling, and recency window. Example: “Backend roles posted in the last 24 hours at small or mid-sized companies, match score at least 80.”

- Channels: in-app first; opt-in email next; browser notifications when supported and authorized.
- Cadence: immediate after processing, daily digest, or weekly digest. Immediate is not a guarantee of instant discovery.
- Controls: timezone, quiet hours, maximum alert volume, pause, edit, disable, and email unsubscribe.
- Delivery: batch repeated events, deduplicate by user/rule/canonical job, and suppress already applied, dismissed, closed, or no-longer-matching roles by default.
- Initial enablement: offer a preview; do not alert the entire historical catalog unless the user opts into a backfill.
- Changes: a score refresh or unchanged repost does not count as a new job. Material listing updates may have a separately enabled alert type.
- Digests: re-check recency and eligibility at send time; explain when no current matches remain rather than relabeling older jobs as fresh.
- Reliability: record pending, sent, failed, and suppressed outcomes; use bounded retries without duplicating delivery.

## 8. Documents and applying

Attach immutable document versions to applications. Updating the master resume must not alter previously submitted files. Tailored drafts may emphasize and reorder verified experience but cannot invent skills, employers, dates, achievements, or metrics.

Later, add an extension that saves supported listings and fills supported forms using approved answers. Pause for missing information, sensitive disclosures, unsupported fields, and site challenges. Show the selected documents and answers before the user submits.

Opening or filling a form does not mean Submitted. Require confirmation evidence or manual confirmation. Defer autonomous bulk applications.

## 9. Main screens

| Screen | Primary purpose |
| --- | --- |
| Today | Next actions, deadlines, interviews, reviews, and new matching jobs |
| Discover | Search, best matches, latest listings, eligibility, and score explanations |
| Companies | Follow companies, view coverage, request sources |
| Applications | Searchable table and customizable board |
| Application detail | Timeline, emails, contacts, rounds, tasks, documents, and notes |
| Connections | People directory and relationship history |
| Documents | Resume versions, cover letters, and reusable answers |
| Insights | Funnel, activity, response times, and outcomes |
| Settings | Connections, preferences, privacy, notifications, export, and deletion |

## 10. Architecture and data

Use a web client, authenticated API, relational database, private file storage, durable background workers, and a scheduler. Keep collection, email sync, extraction, scoring, notifications, and exports out of interactive request lifecycles. Select exact technologies after the integration prototype.

Core entities:

- User, preferences, approved profile facts, and email connection.
- Company with size provenance, source connector, collection run, source listing, canonical job, and listing snapshot.
- Saved search, alert rule, notification event, digest, delivery record, and deduplication key.
- Job recommendation, score breakdown, eligibility evidence, and user feedback.
- Application, application event, email message, and application-message link.
- Contact, contact identity, company relationship, and application-contact link.
- Interview round, assessment, task, reminder, and communication draft.
- Document, immutable document version, submitted-document link, review item, and audit event.

Separate public listing records from private candidate data. Enforce ownership in APIs, database queries, workers, file access, exports, and search. Use idempotency keys for jobs and mutations. Preserve source IDs, parser versions, model versions, and evidence for debugging and correction.

## 11. Delivery phases

### Phase 0 — Validate the integrations

- [x] Test sample boards across the first three source platforms. Six live public-board probes across Greenhouse, Lever, and Ashby, plus in-memory description retrieval; metadata evidence in `docs/phase0/source-probe.json`.
- [ ] Test Gmail authorization and a consented historical import. Google Desktop OAuth client validated and owner authorized all-mail local reading; real Google approval and at least 100 historical message reads succeeded, with temporary grant revoked; full-mailbox traversal stopped early and remains under diagnosis.
- [x] Build a small labeled set for email matching and job-fit evaluation. Eighteen fictional, developer-authored examples with separate development/held-out splits; not independently human-validated or representative launch evidence.
- [ ] Confirm source access conditions and mailbox launch dependencies. Public API documentation, prototype constraints and Google testing/restricted-scope dependencies are recorded; provider/employer rollout conditions and actual mailbox proof remain open.
- [x] Select stack, hosting, model provider, and operating budget for the prototype. Keep existing Vercel/Supabase stack; real local Ollama baseline honors $0 additional AI spend. Tiny model failed quality checks and is rejected for production extraction; hosted model selection remains gated on quality, privacy and budget.

**Current result:** Phase 0 remains partial. Real collection and local model inference were exercised, but local Gmail authorization/body retrieval succeeded but full-mailbox traversal stopped early, and the tiny-model extraction baseline is unsuitable. See `docs/phase0/README.md` for evidence, exact owner setup and remaining gates. No automatic changes, external AI processing of real emails, paid AI calls or discovery UI were enabled.

**Exit:** A working prototype proves collection, extraction, and matching on representative examples. Re-estimate the remaining work from actual findings.

### Phase 1 — Build the tracking foundation

- [ ] Authentication and private account data.
- [ ] Application table, board, custom stages, rounds, and timeline.
- [ ] Contacts, notes, tasks, and document attachments.
- [ ] CSV import/export and responsive layouts.

**Exit:** A user can manage an entire application manually and export their data.

### Phase 2 — Automate recruiting updates

- [ ] Historical Gmail import and ongoing sync.
- [ ] Event extraction, application matching, contact extraction.
- [ ] Evidence, review queue, correction, and undo.
- [ ] Reply ownership, waiting indicators, Today, and reminders.

**Exit:** Duplicate replay, ambiguous roles, older emails, reschedules, disconnects, and manual overrides behave correctly.

### Phase 3 — Launch discovery and recommendations

- [ ] Shared job catalog and company registry.
- [ ] Validated source connectors and scheduled collection.
- [ ] Duplicate grouping, snapshots, and freshness handling.
- [ ] Approved candidate profile and eligibility checks.
- [ ] Explainable scoring, latest matches, watchlists, and alerts.
- [ ] Posting-date versus discovery-date filters and small/mid-sized/large/unknown company filters.
- [ ] Saved alert rules, immediate/daily/weekly cadence, quiet hours, and unsubscribe controls.

**Exit:** Users receive relevant recommendations with source evidence and accurate freshness labels. Existing applications are identified before a user applies again.

### Phase 4 — Add preparation and communication

- [ ] Resume tailoring, cover letters, reusable answers, and export.
- [ ] Calendar integration and interview preparation workspace.
- [ ] Reviewed message drafts and optional authorized sending.
- [ ] Analytics and contact imports.

**Exit:** Generated candidate claims are traceable to approved facts; document history and message delivery states remain accurate.

### Phase 5 — Expand assistance and coverage

- [ ] Browser saving and supported form filling.
- [ ] Additional company parsers and permitted source integrations.
- [ ] Outlook and further calendar support.
- [ ] Better ranking informed by explicit user feedback.

**Exit:** Publish supported sites and limitations; interrupted form fills never record false submissions.

## 12. Quality and launch checks

Proposed targets are planning hypotheses, not measured performance:

| Measure | Initial target |
| --- | --- |
| Automatic email-to-application matching precision | At least 95% on held-out labeled examples |
| Automatically applied status-change precision | At least 98%; otherwise keep that event type in review-only mode |
| Repeat processing | Zero duplicate events in replay tests |
| Recommendation usefulness | At least 7 of the top 10 jobs judged relevant by pilot reviewers; define relevance before evaluation |
| Listing provenance | Every displayed job has a source and last-checked timestamp |
| Data isolation | No cross-user access in validation |
| Interactive response | Proposed 95th percentile below 2 seconds for normal reads at declared pilot load |

Test old jobs newly discovered, employee-count ranges spanning categories, unknown size estimates, quiet-hour boundaries, duplicate alerts, recency expiry before digest delivery, duplicate listings, multiple roles at one company, agency recruiters, unknown compensation, stale feeds, provider outages, timezone changes, malicious email instructions, expired credentials, and deletion during background work.

Provide keyboard alternatives to board dragging, accessible controls, mobile layouts, clear loading/error states, and visible last-sync times. Validate backups and recovery before a public launch.

## 13. Privacy and operations

Encrypt credentials, avoid logging message bodies, sanitize email HTML, scan uploads, and use authenticated file access. Treat job pages and emails as untrusted input; their text cannot authorize sending, exporting, or modifying unrelated records.

Explain what is sent to external models and verify provider retention terms. Let users pause or disconnect integrations, export data, and delete their accounts. Stop queued jobs after deletion so data is not re-created. Finalize live-data and backup-retention windows before launch.

Measure collection failures, source coverage, sync lag, review rate, extraction accuracy, recommendation feedback, duplicate rate, and processing cost per active user. Cache unchanged jobs and message extraction. Re-score jobs only when relevant listing data, profile facts, or scoring rules change.

## 14. Immediate next steps

1. Choose the initial pilot companies and manually verify their career sources.
2. Create source-connector and application-event schemas.
3. Prototype one job connector and one Gmail import path.
4. Label representative examples and establish accuracy baselines.
5. Build the manual application dashboard, then connect the verified automation.
6. Release to a small consenting pilot, collect feedback, and expand discovery coverage.

The full product includes discovery through offer management. The build sequence establishes reliable tracking first, adds personalized discovery next, and introduces application assistance after the underlying data is dependable.

## 15. Source references from the planning discussion

These references informed the proposed connector strategy. Recheck current documentation and applicable access conditions during Phase 0.

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever Postings API](https://github.com/lever/postings-api)
- [Ashby Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [LinkedIn prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software)
