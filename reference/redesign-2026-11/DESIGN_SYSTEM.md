# Offerly editorial workspace

Implemented in `src/styles/workspace.css` and `src/styles/landing.css`, building on existing structural CSS and locally served fonts. No remote font, animation or chart dependency added.

| Area | Rules |
| --- | --- |
| Surfaces | Warm paper `--canvas: #f5f2eb`; `--surface: #fffefa`; subtle `#edeae2`; ruled borders `#d9d8cc` |
| Text | Strong ink `#202e29`; muted copy darkened where axe revealed contrast problems; tabular numbers |
| Accent | Forest `#234c3e`, hover `#153c2e`, pale forest `#e6ede4`, dark navigation `#1e352c` |
| Semantics | Separate danger, warning and information tokens; explicit stage, priority and response ownership labels remain independent |
| Typography | Georgia editorial page/feature headings; existing locally served DM Sans for body/data and Manrope where retained; page heading 36px desktop, responsive reduction |
| Spacing | Existing 4/8/12/16/24/32px scale; 36px desktop content gutters; narrower mobile gutters |
| Shape | 3px small / 5px surface radius; flat working surfaces; elevated dialogs only |
| Controls | Primary forest action, bordered secondary, text tertiary; persistent input labels; visible focus `3px #2c7189`; disabled state remains explicit |
| Touch | Existing coarse-pointer 44px targets, 16px inputs and visual-viewport dialog behavior preserved |
| Motion | Restrained control transitions; no floating hero cards or moving ribbon; existing reduced-motion and pause behavior preserved for remaining animations |

## Page patterns

- Today: compact priority strip, reply ownership ledger, tasks and deadline agenda, interviews, explicit reviews/reminders, recent application sources. Waiting duration uses recorded timestamps only.
- Applications: stage strip, search/filter/saved-view control deck, bulk selection and precise table; compact board with bounded rendering. Mobile rows retain stage, location, owner, next action, priority, date and selection.
- Application: route-backed detail drawer with company/role, real next action, independent stage/response fields, tasks/rounds/assessments, linked people/files and activity. Nested editing and conflict behavior retained.
- Reviews: evidence excerpt plus current/proposed comparison, explicit decisions and overrides, provenance, jobs, locks and undo.
- Connections: ruled directory with user confirmations, provenance, agency/employer context and real linked applications. Existing contact editor remains source of corrections.
- Documents: grouped family ledger, immutable versions, exact submitted-version counts and original downloads; latest version never substitutes for submitted bytes.
- Insights: real stage/source distribution with denominators, unknown dates called out, explicit no-data state. No historical conversion or probability claims.
- Settings: sequential section layout removes empty left column. Preferences, account/recovery, Gmail, three AI readiness states, budgets, export and separate deletion remain available.
- Public/auth: matching editorial type and warm surfaces; previews explicitly illustrative; optional Gmail copy conditional on account configuration; AI and automatic stage changes never presented as generally enabled.
