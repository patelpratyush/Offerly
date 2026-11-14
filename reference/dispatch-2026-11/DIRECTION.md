# Offerly "Dispatch" — third visual pass

Problem: after two passes the UI was still a generic SaaS template (huge heading, ruled list, boxed cards, cobalt + yellow). Nothing about the layout came from job searching. This pass derives the whole interface from one idea that fits the product:

**A job search is a timetable. Every application is a service with a status, a gate and a next departure.**

Think station signage and printed rail timetables, not startup landing pages: departure boards, platform/gate codes, line diagrams, ticket stubs. Functional first — the metaphor must make scanning faster, never slower, and must never invent data.

## Tokens (defined in `src/styles/dispatch/tokens.css`; use these names)

Surfaces: `--board` #0e0f0c (signage black), `--board-2` #1b1c17, `--paper` #efebdd (timetable paper), `--paper-2` #e4dfcc, `--sheet` #f8f5ea (raised paper).
Ink: `--ink` #14130f, `--ink-2` #4a483f (muted, 7:1 on paper), `--rule` #14130f (hard rules), `--hair` #c9c3ac (hairlines).
Signal: `--amber` #ffb000 (board text / primary action / "your move"), `--amber-ink` #14130f (text on amber), `--red` #c21f17 (overdue/urgent, 5:1 on paper), `--green` #1f6b43 (confirmed/on time), `--blue` #1d4f91 (info/links, 7:1).
Legacy names the older CSS still reads are re-pointed: `--canvas`=paper, `--surface`=sheet, `--surface-subtle`=paper-2, `--line`=hair, `--muted`=ink-2, `--nav`=board, `--focus`=blue. `--cobalt`/`--signal` are retired.

Type: `--font-sign` "Archivo Variable" using `font-stretch` 62–100% and weight 700–900 for signage headings (condensed, uppercase allowed, tight tracking); `--font-body` "Archivo Variable" normal width 400/500/600 for reading and data; `--font-mono` "Martian Mono Variable" for times, codes, counts, IDs. No Manrope, no italic serif accents.
Scale (px): 11 label (mono, uppercase, +0.08em) · 13 small · 15 body · 17 lead · 22 · 30 · 44 · 64 · 96 signage.
Space: 4-pt scale (4 8 12 16 24 32 48 72). Radius: 0 everywhere except 2px on inputs; no pill badges (use rectangular code tags). Elevation: none — separate with hard 2px ink rules and hairlines; the only shadow is a 4px offset solid ink "stamp" on raised primary surfaces.
Motion: one signature — **split-flap**: text/counters change with a 180ms vertical flip (CSS transform, staggered 30ms per character) on stage changes, counts and the Today board. Everything else ≤150ms opacity/transform. All motion removed under `prefers-reduced-motion`.

## Vocabulary (use consistently in markup/classes/copy where it already exists as real data)
- Application = a **service** line. Stage = **gate** (a short code tag: SAV PRE SUB REV ASM INT OFR REJ WDR, with the full word beside/below it for accessibility; never code-only).
- "Your reply is next" = **YOUR MOVE** (amber). "Waiting on employer · N days" = **WAITING N D**. Overdue = **OVERDUE** (red). Interview/deadline date = **DEPARTS** time. Pending review = **HOLD**.
- Never fabricate: no fake times, no invented counts. Unknown stays "—" with the word Unknown available to screen readers.

## Page compositions (each different — no repeated card grid)
- **Shell**: left rail is a vertical *line diagram*: a 2px ink line with square station nodes per page (active = filled amber node, label in sign font); bottom: user + sign out. Top strip: current page code + local date/time in mono. Mobile: bottom station bar with the same nodes.
- **Today = Departures board**: a black signage panel, amber mono rows: DEPARTS · SERVICE (company — role) · GATE · STATUS, sorted by urgency; rows are links to the real source. Below on paper: "Hold" (pending reviews), tasks as a checklist, reminders, then recent applications as a compact timetable (not cards).
- **Applications = Timetable**: printed-timetable table on paper: sticky header band in ink, columns separated by hairlines, gate tags, status words, row hover = amber left edge. Board view = **platforms** (columns headed by gate code + count, cards as tickets with a perforated edge). Filters sit in one dense control band; saved views as tabs.
- **Application detail = Itinerary**: ticket-style header (company/role large in sign font, perforation line, gate + status + next departure block), then a vertical *journey line* timeline with stops (events) as nodes; sections as ruled chapters.
- **Reviews = Telegrams**: each proposal is a two-column "wire": left the source evidence as a mono quoted strip, right current → proposed as a struck/underlined comparison with lock icons; decision buttons explicit and at the bottom of each wire.
- **Connections = Directory**: phone-book style two-column listing with dotted leaders to linked applications; verified identity = solid tick tag, extracted = hollow dashed tag.
- **Documents = Manifest**: families as manifest entries with version ledger lines; submitted version stamped SUBMITTED (rectangular stamp), size limits stated plainly.
- **Insights = Punctuality report**: horizontal bar rows with explicit n/denominator in mono, no decorative charts; honest empty state "No data yet" (not 0).
- **Settings = Control room**: left sticky index of sections, right ruled panels; destructive zone separated by a hazard-stripe rule.
- **Discover / Companies / Prepare**: same grammar (timetable rows, gate/fit tags, ledger lines).
- **Landing**: the hero IS a live departures board (illustrative sample rows, labeled as such) flipping through states; sections follow timetable grammar; no gradient, no stock mockup. **Auth**: a ticket-stub form.

## Process improvements (not just paint)
- Global command palette (⌘K / Ctrl+K, also `/`): jump to any page or application by name, "Add application", "Add task". Keyboard-first, accessible combobox, no private text in URLs.
- Quick capture: `n` opens add-application; `g t/a/r/c/d/i/s` go-to shortcuts (disabled while typing); shortcut help (`?`).
- Next-move-first: every application row and detail shows a single primary "next move" action derived from real data (reply needed → Open conversation; overdue task → Complete task; interview scheduled → Prepare; none → Add next step).

## Constraints (unchanged)
No dependency beyond the two fonts. No backend/business-rule/security changes. Preserve routes, accessible names, focus behavior, existing tests' contracts (update tests only where visible copy/selectors intentionally change, and say so). WCAG AA contrast. Mobile first-class (320–2560). Never imply AI approval or unfinished features.
