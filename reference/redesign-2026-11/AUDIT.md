# Offerly routing and workspace redesign audit

Audit baseline: `main`, HEAD `cfef36a` (`feat(recruiting): add gated AI review extraction and consent budgets`). No AGENTS.md found in repository or applicable parent paths. Existing modified `IMPLEMENTATION_STATUS.md`, `Job_Search_App_Build_Plan.md`, untracked owner stage-context files and roadmap audit files are preserved. No private mailbox/evaluation contents used as design material.

Reviewed build plan, implementation status, delivery steps, Phase 1 audit, Phase 2 implementation, recruiting AI operations, security requirements, source architecture, tokens, components and browser-test harness. Historical roadmap shorthand is superseded by newer implementation checkpoints: Gmail and gated AI controls already exist. No backend rebuild required.

## Findings

- React 19 / TypeScript / Vite frontend, Express backend. Client UI is primarily `src/main.tsx`, with workspace components. Not Next.js.
- Page selection and application details were React state only. Sidebar buttons did not produce URLs; refresh/deep links could not restore destination. Auth used `#signin` / `#signup`.
- Existing session-generation fencing, private-state remount, BroadcastChannel reset, scoped API authorization and optimistic concurrency must remain.
- Existing Vercel rewrite already sends `/api/:path*` to API before non-API SPA fallback. `/api/gmail/callback` must remain unchanged. No rewrite migration needed.
- Existing CSS has three large cascading sheets. Existing locally served DM Sans and Manrope are suitable for readable interface text; editorial headings can use local system serif fallback without another remote font.
- Today used broad statistics before actionable work. Documents rendered every immutable version as an unrelated card. Insights lacked an intentional zero-data state and explicit per-bar denominators.
- Contacts, reviews and settings contain substantial working functionality: provenance, corrections, undo, locks, explicit AI gates, Gmail progress, recovery and deletion. Preserve rather than simplify away.

## Direction and implementation plan

Warm paper surfaces, strong ink, restrained forest accent, serif editorial headings, compact readable data typography. Flat ruled surfaces and restrained radii. Distinct agenda, tracker, comparison review, directory, version library and insight layouts. Shared controls retain focus visibility, 44px touch targets, dialog containment, reduced motion and responsive behavior.

1. Add maintained React Router declarative routing, native links, safe protected destination handling, route-backed details, URL filter state and titles.
2. Redesign shared tokens and navigation, authentic page layouts and existing secondary controls.
3. Replace Today statistics with recorded overdue/reply/review priorities and ownership lists. Keep full task, assessment, interview and reminder workflows.
4. Group document families and immutable versions, exact submitted-version counts and application source links. Preserve original downloads and new-version upload.
5. Render real stage/source snapshots with denominators and honest missing-date/no-data copy.
6. Verify isolated synthetic accounts with existing server/browser regressions plus route and visual tests. Capture desktop/mobile artifacts; fix issues before reporting.

No push, commit or deployment. No production AI enablement, provider connection, live email reads or destructive production actions.
