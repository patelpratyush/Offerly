# Offerly UI/UX redesign — October 28, 2026

## Evidence and scope

Inspected README, implementation status, PRD tracking/state/accessibility requirements, build plan, existing design references, package scripts, all frontend views and related API/test contracts. No repository AGENTS.md found. React/TypeScript, Vite, Express and SQLite retained. Local app started with documented `npm run dev`, using disposable `/tmp/offerly-design-audit.sqlite`. Synthetic Morgan account only; no existing user data edited. Baseline screenshots cover every workspace destination at 375, 768, 1024 and 1440px. These are inspection findings, not user interview results.

Live website responds HTTP 200. Browser verified deployed signup includes invitation code; local signup does not. No invitation supplied, so deployed private pages were not accessed. Public/auth appearance matches repository; private deployment parity is unverified.

## Screen and workflow map

| Surface | Verified implementation / boundary |
| --- | --- |
| Public landing | Product demonstration, signup/signin links; demonstration data is separate from workspace |
| Authentication | Registration, sign-in, password recovery with previously generated codes; hosted invitation gate |
| First use | Empty Today; manual application creation and CSV import; browser timezone saved, editable in Settings; no separate onboarding wizard |
| Today | Open tasks, assessment deadlines, scheduled/rescheduled interview rounds, in-app reminders, pending reviews, recent applications |
| Applications | Shared board/table search, stage, company, source, arrangement, priority, response owner, date filters; sort; saved views; bounded bulk changes; archive/restore; CSV export |
| Detail | Overview, activity, people/files; application edit; independent rounds, assessments, tasks; historical listings; contacts; document links and submission records |
| Connections | Searchable contact editor, multiple emails, confirmations and provenance, many-to-many application links |
| Documents | Private PDF/DOCX upload, immutable versions, original downloads; separate exact-version submission/correction/retraction records in detail |
| Reviews | Manual evidence queue, candidates, current/proposed values, field protections, accept/reject/correct/undo; background job retry/cancel |
| CSV / duplicates | Mapping/date interpretation, preview errors and row decisions, retry-safe commit; duplicate evidence, reversible archive/merge |
| Insights | Current stage counts including archived; no historical conversion claim |
| Settings | Timezone/custom stages, password/session changes, recovery codes, export, password-confirmed deletion; email explicitly disconnected |
| Experimental / planned | Phase 0 source/mail/model experiments are scripts, not connected workspace functionality. Gmail, AI extraction, discovery, autofill, calendar, outgoing email and historical analytics not implemented in UI |

## Prioritized audit

Evidence paths refer to `screenshots/before-*`. Severity: high = hides important action or accessibility barrier; medium = recurring friction; low = editorial polish.

| Severity | Page / evidence | Impact | Correction / ownership |
| --- | --- | --- | --- |
| High | Today, `before-today-1440.png`: scheduled interview begins around y=1480, after recent opportunity cards and empty reminder content | Near-term preparation easily missed | Move interviews ahead of optional summaries, clickable edit actions; `main.tsx` |
| High | Mobile `before-applications-375.png`: wide table shows selection and truncated role, other columns require scrolling | Stage, next response and priority unavailable together | Reflow semantic table rows into labeled compact records at narrow widths; keep all columns; `workspace.css`, table markup |
| High | Modal focus helper includes controls inside closed disclosures and has no background inertness | Keyboard can enter unavailable or background controls when forms evolve | Visible-only focus trap, inert underlying surfaces, lock body scroll; `main.tsx` |
| Medium | `before-editor-1440.png`: application editor mixes required identity, compensation, outcomes, notes and listing provenance in one long grid | High entry effort; save far below first screen | Required markers, named field groups, disclosures for secondary data, sticky save/cancel; preserve drafts/fields |
| Medium | Filter changes can be hidden in closed More filters; empty filtered results say “Make room for possibility” | Users cannot tell why records disappeared | Active-filter count, visible reset and result announcement; distinct empty vs no-match states |
| Medium | Mobile nav scrolls horizontally; account/signout absent; no programmatic current page | Destinations and account controls hard to discover | Explicit expandable mobile menu, all destinations, aria-current and skip link |
| Medium | Today task checkbox completes item, but no direct edit affordance | Correcting deadline requires finding application; personal tasks lack that route | Separate labeled task edit button alongside completion |
| Medium | Contacts search with no matches renders blank grid | Looks like missing content | Explicit no-results feedback with query context |
| Medium | Reviews: proposal queue follows full evidence-entry form and job list | Existing decisions buried beneath data entry | Move proposed updates before evidence form; retain manual protections and undo; `RecruitingReview.tsx` |
| Medium | 10–12px supporting copy across reminders, review evidence, dates, forms | Dense information difficult to read | Shared readable type, stronger neutral contrast, restrained semantic colors |
| Medium | Saved-view name/create form always visible; 375px results begin around y=920 | Repeated setup controls crowd daily tracking | Keep saved-view selector; disclose create/update controls |
| High | Invalid CSV preview: supplemental screenshot exposed raw serialized schema errors, including regex and internal codes | Cannot identify fix; long error hides other row decisions | Present field-specific guidance and selected date format, deduplicate issues, explain re-upload; preserve API contract; `ImportDialog.tsx` |
| Low | Oversized stage count tiles, four large Today metric cards, motivational sidebar/footer copy | Repeated decorative hierarchy competes with tasks | Compact stage tabs and single summary band; factual workflow copy |
| Low | Noninteractive metric arrows imply clickability/trends; “Offers” counts stage | Affordance and meaning ambiguous | Remove arrows, explicit “Offer stage”; retain independent outcome |

No baseline workflow blocker found. Existing account scoping, history/version checks and explicit statuses must remain intact. Baseline screenshots show no page-level horizontal overflow at tested widths; board/table internal scrolling is intentional.

## Reference matrix

Public sources browsed October 28, 2026. No competitor account created; no private interfaces claimed inspected.

| Source | Evidence type / observed pattern | Benefit | Offerly adaptation (design judgment) |
| --- | --- | --- | --- |
| [Simplify tracker](https://simplify.jobs/job-application-tracker), [published illustration](https://simplify.jobs/cdn-cgi/image/width%3D3840/_landing/images/job-tracker/manage.png) | Image directly inspected: role rows aligned against stage labels. Illustration, not authenticated live UI | Fast status scanning | Keep explicit stage beside role; no implied conversion or completed-stage history |
| [Teal dashboard guide](https://help.tealhq.com/en/articles/9524944-exploring-the-dashboard) | Help documentation: grid sorting, grouping, stage shortcuts toggle off; manual URL entry does not autofill | Predictable views and honest manual input | Shared filters, compact stage shortcuts, explicit reset; retain manual listing entry |
| [Teal tracker](https://www.tealhq.com/tools/job-tracker) | Public product description: spreadsheet view, contacts and checklists | Dense comparison plus next action | Labeled mobile records and application-linked task summaries |
| [Huntr tracker image](https://huntr.co/images/job-tracker-dynamic-board.png), [product page](https://huntr.co/product/job-tracker) | Image directly inspected: top workspace destinations, column counts, role-first cards | Clear location and scan path | Role-first board cards, compact column headings, accessible scroll regions |
| [Huntr board guide](https://help.huntr.co/en/articles/13413245-the-job-board) | Help documentation: minimal initial create, later details; Move button alternative to drag | Lower entry burden, keyboard alternative | Group initial company/title/tracking fields; retain edit-stage select rather than requiring drag |
| [Huntr job card](https://help.huntr.co/en/articles/12640406-understanding-the-job-card) | Help documentation: listing, deadlines, interviews and offers within job context | Related data stays together | Preserve three detail sections and independent child records |
| [Huntr activities](https://help.huntr.co/en/articles/10042702-activities) | Help documentation: due/completion filters and dated activities | Urgent work distinguished from history | Promote real overdue tasks and scheduled interviews. Do not adopt automatic completion inferred from stage |

No logos, proprietary copy, screenshots or competitor assets shipped in product.

## Implementation plan and direction

1. Keep forest/leaf identity and existing locally served DM Sans/Manrope. Introduce neutral ink and warm paper canvas, flat white surfaces, compact headers, 6–8px radii, visible focus and semantic text labels. Consolidate repeated visual values into existing workspace stylesheet tokens.
2. Shared shell: current-location semantics, skip link, responsive menu/account controls and keyboard-safe dialogs. Preserve authentication/session handling.
3. Today: compact factual summary, tasks and deadlines first, interviews directly after; editable task/round rows; explicit empty states. No invented activity or integrations.
4. Applications: compact stage navigation, active-filter feedback/reset, progressive saved-view controls, same collection in board/table, full data on mobile, real task/assessment next actions.
5. Forms/details: shared field sections, persistent required labels, secondary disclosures, sticky actions; keep every field, independent state and provenance.
6. Apply readable typography, borders, spacing and responsive rules to reviews, imports, contacts, documents, insights, auth and settings. Preserve historical data and reversible controls.
7. Run lint/backend/type/build/browser suites; targeted regression for navigation, filters, mobile, dialog focus and failed-save draft preservation. Capture matching after screenshots and perform separate editorial pass. Record actual limits.
