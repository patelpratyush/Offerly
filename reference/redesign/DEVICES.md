# Device optimization and verification

October 28, 2026. Implemented locally and [deployed after user authorization](DEPLOYMENT.md); no merge or Git push. This pass extends the original redesign, keeping the same React/Vite stack, APIs, persistence and account isolation.

## Changes

- **Keyboard-aware dialogs.** New `src/useDialogViewport.ts` follows visual viewport height, width and panning. Focused fields scroll into the dialog's visible area; save/cancel stay in its sticky footer. Safe-area padding and viewport metadata support notched screens without disabling zoom.
- **Touch controls.** Coarse pointers receive 44px buttons and checkbox-label targets, plus 16px inputs/selects/textareas to avoid small-field zoom. Narrow search/filter controls reflow; table and detail tabs retain keyboard scrolling.
- **Large lists.** Table renders 25 records per page, preserving sorting and selection between pages. Board starts with 25 per stage; Show more exposes every remaining record and focuses the first newly added card. Search/filter/sort still use the complete data set. Bulk selection explicitly says matching applications, capped at the existing 100-record limit.
- **Engine-specific corrections.** WebKit pointer clicks now capture a reliable dialog opener for focus restoration. Firefox Settings columns shrink around long account text. Active auth fields retain focus when delayed route effects run.
- **Repeatable coverage.** `npm run test:devices` adds six profiles to CI. Browser binaries are development tooling; no new application dependency.

## Observed results

- `npm run check`: lint, 173 backend tests, TypeScript/build, dependency audit passed; 0 known vulnerabilities. Final frontend checks rerun after device corrections.
- Existing workflow suite: **40 passed** (20 desktop, 20 mobile), including a new deterministic auth-focus regression.
- Device matrix: **18 passed**, covering navigation/orientation, keyboard-open application saves, touch sizes, nested-dialog focus and 60-record pagination/board/bulk selection.
- Layout inspection: seven destinations at 320×568, 568×320, 768×1024, 1024×768 and 1440×900 in Chromium, WebKit and Firefox; no page-level horizontal overflow. Additional Chromium inspection covered 844×390, 1280×720, 1920×1080 and 2560×1440.
- Axe WCAG 2 A/AA, 2.1 AA and 2.2 AA tags: no violations on Applications, Reviews, Settings and application editor in all three engines at narrow widths. Broader original redesign scans remain documented in [validation](VALIDATION.md).
- VisualViewport simulation reduced available height to 300px with 80px offset: dialog bottom measured 368px against visible bottom 380px in all three engines. Application save completed with keyboard simulation active.
- Initial 60-record table now renders 25 rows, with all 60 reachable. This is a rendering bound, not a claimed latency benchmark or server capacity result.

| Profile | Engine | Coverage |
| --- | --- | --- |
| Android / Pixel 7 | Chromium | Touch, landscape, navigation, dialogs, lists |
| iPhone 13 | WebKit | Mobile Safari-style emulation, touch, keyboard/pan simulation, lists |
| iPad Pro 11 | WebKit | Tablet viewport, landscape/compact reflow, dialogs, lists |
| Firefox | Firefox | Desktop plus compact reflow, long Settings text, focus, lists |
| Compact | Chromium | 320px touch viewport, landscape, keyboard simulation |
| Ultrawide | Chromium | 2560×1440 plus compact/landscape transitions |

Earlier runs correctly failed on keyboard obstruction, unbounded rendering, nested WebKit focus and Firefox overflow. Each received a targeted correction. An intermittent iPhone signup setup failure did not recur in three traced reruns. A separate, deterministic late-heading-focus interruption was reproduced, fixed and covered; signup now also asserts entered name before submitting. Final matrix passed without retries or forced hidden clicks.

## Screenshots

- 320px applications: [before](devices/before-applications-320.png), [Chromium after](devices/final-chromium-applications-320.png), [WebKit after](devices/final-webkit-applications-320.png), [Firefox after](devices/final-firefox-applications-320.png).
- Keyboard simulation: [before](devices/before-keyboard.png), [WebKit after](devices/final-webkit-keyboard.png), [Firefox after](devices/final-firefox-keyboard.png), [Chromium after](devices/final-chromium-keyboard.png).
- Short landscape editor: [568×320](devices/after-editor-568x320.png). Supporting tablet, laptop and ultrawide captures remain in `devices/`.

## Reproduce

```sh
npx playwright install chromium webkit firefox
npm run test:e2e
npm run test:devices
npm run check
```

Browser suites use dedicated ports and disposable databases. Keep ports 4173/3002 free; do not run both browser suites concurrently. Development app remains on 5173/3001.

## Remaining limits

Device profiles and keyboard/pan behavior are emulated. Physical iOS/Android hardware, native browser zoom and VoiceOver/TalkBack/NVDA have not been tested. WebKit emulation is not proof of every Safari version. Automated accessibility scans are scoped evidence, not full WCAG certification.

Client pagination bounds rendered records; workspace data is still fetched through the existing complete-workspace API. Very large accounts may later need server pagination and measured load testing. No schema or API contract changed here.
