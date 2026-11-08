# Offerly / Fieldwork

Second visual pass, prompted by owner feedback that the first redesign felt bland. Owner delegated art direction. Baseline: main at `aea362a`; existing owner documentation remains untouched. No push or deployment performed for this pass.

## Art direction

Bold editorial, with ink `#171b24`, cobalt `#234ee8`, acid paper `#edf493` and warm paper `#f6f4ed`. Oversized Manrope headings and clear DM Sans data typography, with selective italic Georgia for short editorial accents. Mono section indexes and sharp rules provide a recognizable system. A tilted leaf stamp retains Offerly identity without copying another product.

The previous pass made layouts consistent but overused soft green and similar surface weights. This pass adds contrast, deliberate composition and stronger hierarchy:

- Today uses a cobalt action rail beside the reply ledger. Real overdue/reply/review counts lead to actual source sections or Reviews. Tasks, deadlines, interviews and reminders remain working workflows.
- Applications uses an ink table header, cobalt selected stage, crisp control deck and distinct company stamps. Board and narrow-screen record layouts retain full information and keyboard behavior.
- Documents reads as an archive: dark family mastheads, cobalt folder tabs and clearly separated immutable versions/submissions.
- Connections uses circular cobalt identity marks in a ruled directory. Reviews treats evidence as a quotation and proposed records as a separate blue comparison surface. Insights forms a data spread with explicit denominators.
- Settings retains clear account/integration/data sections; forms and dialogs inherit the same precise control language.
- Landing is rebuilt as a typographic masthead, ink/cobalt sample-workspace spread, capability ledger and closing cobalt statement. Authentication shares the ink/acid split. Illustrative data stays explicitly labeled; optional Gmail and AI gates remain accurately described.

## Behavior and safety

Existing backend, ownership checks, review decisions/undo, private downloads, AI gates, budgets and OAuth callback are unchanged. No new service, font dependency or generated production data. Real page URLs and existing filters are preserved. New Today anchors are allowlisted and survive safe authentication returns; scrolling occurs after the authenticated route is mounted. Reduced motion removes movement; keyboard focus remains visible.

## Validation

Final results and screenshot gallery are recorded in DELIVERY.md after frozen-source checks. First visual audit exposed two inherited text-color rules (selected stage and deadline month) and inherited serif/italic hero styling; these were corrected before final validation.
