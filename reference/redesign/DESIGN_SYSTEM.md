# Offerly workspace system

Retain Offerly's forest/leaf identity, DM Sans body and Manrope headings, served locally. Calm editorial workspace: warm paper canvas, neutral ink, flat surfaces and compact controls. No new framework, package, hosted font or animation dependency.

Tokens live in `src/workspace.css`; existing `style.css` remains the structural base. The workspace stylesheet owns shared visual patterns and responsive adaptations, including secondary workflows. Superseded identical declarations were removed without reordering the cascade.

| Category | Tokens / use |
| --- | --- |
| Surfaces | `--canvas: #f5f5f0`, `--surface: #fff`, `--surface-subtle: #f1f3ee`, `--line: #dce2da` |
| Text | `--ink: #263b34`, `--muted: #52645b`; supporting copy generally 12–14px |
| Brand | `--green: #24634f`, `--brand-hover: #194d3d`, `--brand-soft: #e8f0e9`, `--nav: #193e33` |
| Semantic | Danger `#a23b32` / `#fff0ec`; warning `#79541d` / `#faf1df`; information `#315c78` / `#eaf2f8`; explicit stage, priority, response-owner and outcome labels remain independent |
| Type | Small 12px, body 14px, section 16px, page title 27px; weights 400/500/600/700, brand 800 |
| Space | 4/8/12/16/24/32px tokens; desktop content padding 32px, narrow padding 16–24px |
| Layout | Content max 1440px, desktop rail 216px; compact rail 200px; menu at ≤900px; record rows and single-column forms at ≤640px |
| Shape | 5px small radius, 8px surface radius; no routine surface shadows; dialog elevation `0 20px 70px #142d302b` |
| Focus | `--focus: #286bba`; 3px outline / 3px offset; skip link and current navigation semantics |
| Motion | 140ms token, ease `cubic-bezier(.2,.7,.2,1)`; existing short control transitions; reduced-motion removes nonessential animation |

Shared patterns:

- Compact page heading with one primary action; factual supporting copy.
- Today summary band, editable task/interview rows, assessment deadlines, review shortcut and real reminders. Interviews precede recent application cards. Summary arrows removed; offer-stage count explicitly distinct from offer outcome.
- Application stage tabs, shared search/sort/view controls, live result/filter summary, explicit reset and distinct no-results state. Saved view selection stays visible; management uses disclosure. Mobile rows retain all data, selection and open controls. Table renders 25 records per page; board starts with 25 per stage and offers Show more. Filters still cover the complete collection, and matching bulk selection remains explicitly capped at 100. Pagination preserves selection; loading more moves focus to the first added card. Board preserves keyboard stage editing through application editor.
- Real next-action summary from earliest dated open task, outstanding assessment or scheduled future round; unknown dates sort after dated items. One map built per render rather than scanning every child collection for each application. Response ownership remains separate and no event is inferred completed.
- Application editor groups role/tracking, notes, compensation/outcome and listing provenance. Secondary groups start collapsed on creation and open for existing records. Persistent labels, required indicators, inline native-validation guidance, preserved failed-save drafts and sticky save/cancel actions.
- Dialog focus captures opener before inertness, ignores hidden/disabled controls, traps Tab, restores opener and locks background scrolling. Nested editors retain their parent detail. VisualViewport changes size/pan dialogs around on-screen keyboards, with safe-area padding and focused-field scrolling. Touch controls target 44px; touch inputs use 16px text. Escape remains available through existing handlers.
- Reviews surface proposals before evidence entry. Existing current/proposed values, provenance, locks, explicit overrides and undo remain intact. Import errors translate serialized schema issues into field-specific guidance without changing API validation or row decisions.
- Contacts, documents, settings, insights, authentication, import and duplicate review share readable typography, neutral surfaces, focus, spacing and contrast fixes.

Editorial pass removed metric arrows, large colored statistic cards, empty-state leaf ornaments, repeated motivational copy and blurred modal backdrops. Tables, lists, boards and document records retain different treatments suited to their jobs.
