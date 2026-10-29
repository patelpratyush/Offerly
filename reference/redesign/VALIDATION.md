# Verification and delivery

Verified October 28, 2026, including the completed [device optimization pass](DEVICES.md). Production deployment completed after user authorization; see [deployment record](DEPLOYMENT.md). Repository changes remain uncommitted; no merge or Git push performed. Development preview runs on http://127.0.0.1:5173 with disposable SQLite database `/tmp/offerly-design-audit.sqlite`; existing `data/` accounts were not edited.

| Check | Observed result |
| --- | --- |
| `npm run check` | Passed: ESLint, 173 backend/API/security tests, strict TypeScript, Vite production build and dependency audit (0 vulnerabilities) |
| `npm run test:e2e` | Passed: 20 desktop + 20 mobile tests, isolated temporary databases and ports 4173/3002 |
| `npm run test:devices` | Passed: 18 scenarios across six Chromium/WebKit/Firefox profiles, including 320px touch, landscape, tablet and ultrawide. Covers keyboard-open saves, focus, selection and 60-record pagination/board access |
| Final import regression | Guided CSV scenario rerun on desktop/mobile after adding invalid-row guidance and coverage: 2 passed |
| Final frontend build | Passed after device corrections. JS 363.11 kB / 106.67 kB gzip; CSS 128.77 kB / 36.50 kB gzip. No app dependencies added |
| Final lint / whitespace | ESLint and `git diff --check` passed |
| Workspace browser audit | Original 375/768/1024/1440px audit plus 320px, short landscape and ultrawide inspection; Chromium/WebKit/Firefox inspections found no page-level overflow. See device report for exact dimensions |
| Axe | No violations for WCAG 2 A/AA, 2.1 AA, 2.2 AA tags on seven destinations at 375/1440px; application editor; populated documents and invalid/duplicate import previews at 375/1440px; signup at 375/768/1440px. Device pass also checked Applications, Reviews, Settings and editor at narrow widths in all three engines; no tagged violations |
| Keyboard | Tested visible focus, dialog Tab/Shift+Tab containment, Escape dismissal, opener restoration, inert background, mobile current-page/menu behavior; native selects retain stage editing without drag |
| Reflow / motion | 720 CSS-pixel viewport (equivalent content width to 1440px at 200%) across Today, applications, contacts, documents, reviews and settings: no page overflow; editor inputs and save action usable. Reduced-motion media preference honored |
| Error / recovery | Injected failed application save preserves draft; required company error associated with field; clear filters recovers no-results state; invalid CSV rows remain nonimportable while valid rows commit |

Full browser suite covers application creation/editing, persisted board/table views, search/filter/sort and saved views, bulk changes, archive/restore, duplicate comparison/merge/undo, assessments, task and round creation, contact provenance and links, uploads and exact-version submissions/corrections/retractions, review locks/decisions/undo, reminders, recovery/password changes, expired-session handling, cross-tab signout and late timeline responses. Existing assertions were retained and adapted to actual mobile menu/disclosure interactions. Redesign regressions cover failed-save persistence, inline validation, filter parity, focus restoration and editable Today tasks. Device regressions additionally cover keyboard-open saves, active auth focus, orientation changes, 44px controls, nonoverlapping selection targets, pagination and Show more focus.

Earlier runs exposed real focus-restoration and contrast defects; these were fixed and rerun. Test selector updates account for required-label text, navigation counts, multiple status regions, collapsed secondary fields, and repeated next-action titles. No test skips or forced hidden-element clicks added.

## Changed files

| Files | Purpose |
| --- | --- |
| `src/main.tsx` | Shared shell, mobile menu, focus/inert handling, Today order/edit controls, real next actions, filters/no-results, mobile row labels, grouped forms and validation |
| `src/workspace.css` | Tokens and shared visual/responsive patterns across all workspace/auth screens, contrast, readable typography, semantic import errors |
| `src/style.css` | Remove blurred dialog backdrop; prevent intrinsic Settings grid expansion |
| `src/TrackerActions.tsx` | Disclose saved-view creation/update/removal while retaining saved selector and bulk editing |
| `src/RecruitingReview.tsx` | Move proposed decisions ahead of evidence-entry form |
| `src/ImportDialog.tsx` | Field-specific invalid-row messages and recovery instructions; API contract unchanged |
| `src/useDialogViewport.ts`, `index.html` | Visible-viewport dialog sizing/panning and safe-area metadata |
| `tests/browser/navigation.js`, `redesign.spec.js`, `devices.spec.js`, `auth-transition.spec.js` | Real navigation helper, redesign/device regressions and auth focus protection |
| Playwright configs, `package.json`, CI workflow | Dedicated six-profile device suite and repeatable Chromium/WebKit/Firefox validation |
| Existing browser specs | Adapt menu/disclosures and specific assertions; invalid CSV row regression added |
| `reference/redesign/*`, reference link | Audit, research matrix, design rationale, screenshots and validation |

No database schema, API mutation contract, ownership control, server implementation, document history, time interpretation, integration or dependency changed.

## Limits and follow-up

- Deployed private pages inaccessible without invitation/account. No claim of deployed authenticated parity. No production data or deployment validation.
- Chromium, Firefox and WebKit automation includes emulated phone/tablet profiles. Physical iOS/Android hardware, native browser zoom and NVDA/VoiceOver/TalkBack remain follow-up. WebKit emulation does not prove every Safari version; 200% equivalent reflow is not a native zoom test. Axe is scoped evidence, not full WCAG certification.
- Loading/empty/success/error states were exercised; not every backend outage, file scanner failure or large-data volume was manually reproduced. Existing security and backend regressions cover broader server failures.
- Client table pagination and progressive board rendering are implemented and verified with 60 applications. Workspace API still fetches the full collection. Server pagination, production load benchmarks and physical-device latency remain future work; no production capacity claim. Next-action lookup remains linear in child-record count.
- Gmail, AI extraction, discovery, autofill, calendar and outgoing notifications remain disconnected/planned as documented. Hosted upload scanning and provider integrations were not exercised; local synthetic uploads follow local policy.
- User interviews/usability studies were not conducted. Findings come from code, browser inspection, public product references and accessibility tooling. Validate prioritization with job seekers before broader release.
