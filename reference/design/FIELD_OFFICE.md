# Offerly "Field Office" (Nov 2026)

Replaces the Linear-style indigo pass. The goal is an interface that looks like no template: a
field office for a job search — sage paper on the desk, a forest-green filing rail, one
persimmon stamp for the action that matters and a butter highlighter for "your move".

## Tokens (`src/styles/dispatch/tokens.css`)

| Role | Token | Value |
| --- | --- | --- |
| Paper | `--bg` / `--bg-subtle` / `--surface-1` | `#e9ece4` / `#dfe3d9` / `#f6f7f2` |
| Ink | `--text` / `--text-2` / `--text-3` | `#13201a` / `#3f4c44` / `#56635b` |
| Forest panel | `--panel` / `--panel-2` / `--panel-text-2` | `#14302a` / `#1c3d35` / `#a8b8ae` |
| Persimmon | `--accent` (fill, ink text 4.99:1) / `--accent-deep` (text on paper) | `#ec5f2a` / `#a33410` |
| Butter | `--butter` (always with ink text) | `#f2c94c` |
| Semantic | `--danger` / `--success` / `--warning` | `#b3261e` / `#2d6a3e` / `#8a5a00` |

Rules: persimmon is never text on paper (use `--accent-deep`); white text never sits on persimmon;
butter is only for "your move" and highlights.

## Type

- Display: Archivo Variable, `font-stretch` 112–125%, weight 700–820, tight negative tracking.
- Body: Archivo Variable at normal width.
- Labels, counts, dates, kbd: Martian Mono Variable, 10.5–12px, uppercase for labels.

## Shape and depth

- Buttons sit on a 3px ink "ledge" (`box-shadow: 0 3px 0 var(--text)`), lift 1px on hover and
  press into the ledge on `:active`.
- Cards: 16px radius, 1px border, flat; feature cards on the landing use a 1.5px ink border and
  a 4px ink ledge.
- Stage marks are small diamonds (rotated squares), not dots.

## Motion and interaction (`src/lib/interactions.ts`, `src/styles/field/*.css`)

- Rail: one indicator glides between stations with a spring; a ghost previews the hovered
  station.
- Spotlight: cards catch a soft persimmon light under the pointer (`--mx`/`--my`).
- Magnet: primary buttons lean up to 4px toward the pointer.
- Route entrance: heading wipes up, blocks follow with a short stagger; Today numbers rise in.
- Landing: tilt-on-pointer product window with working filters, a working review-queue demo,
  a principles ticker, transform-only scroll reveal.
- Everything above is disabled for coarse pointers or `prefers-reduced-motion`. Reveal never
  hides content (transform only), so screenshots and assistive tech always see it.
