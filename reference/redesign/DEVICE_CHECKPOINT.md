# Device optimization checkpoint — historical pause

Resumed after user requested continuation. See [completed device pass](DEVICES.md) and [current validation](VALIDATION.md) for latest results. Notes below preserve the earlier checkpoint.

October 28, 2026. Stopped product edits at user's request. All work remains local and uncommitted; no deployment or merge. Original redesign changes are still present. Local preview uses disposable data.

Implemented in this pass:

- Visual-viewport-aware dialogs, including keyboard height/panning, focused-field scrolling and safe-area padding (`src/useDialogViewport.ts`, shared stylesheet, viewport metadata).
- 44px coarse-pointer controls, larger checkbox label targets, 16px touch form text and narrow-screen search/filter layout.
- 25 application rows per table page; 25 cards initially per board stage with explicit Show more. Search/filter/sort still process all matching records; bounded bulk selection explicitly says matching applications. Selection persists between pages and resets on filter changes.
- Keyboard-scrollable table region; safer short-screen navigation and dialog sizing.
- WebKit pointer-button focus normalization for nested dialog opener restoration; Firefox Settings grid/text shrink fixes.
- New `npm run test:devices` matrix: Android/Chromium, iPhone/WebKit, iPad/WebKit, Firefox, 320px touch and 2560px desktop. CI configuration includes these browser engines and tests. No app dependencies added.

Verification observed:

- Initial regression run failed correctly: keyboard simulation left editor below visible viewport; 60-row table rendered all 60 rows.
- Latest device matrix: **17 passed, 1 failed (50.4s)**. Remaining failure is iPhone test account setup: expected Today heading never appeared after Create workspace; screenshot stayed on signup. Cause not investigated further because user requested stop. Other iPhone keyboard and large-list scenarios passed. iPad focus, Firefox narrow Settings, Android, compact and ultrawide scenarios passed.
- `npm run check` passed earlier in this pass: lint, 173 backend tests, TypeScript/build and dependency audit (0 vulnerabilities). This preceded final focus/grid adjustments. Full original desktop/mobile workflow suite has NOT been rerun after this device pass.
- `git diff --check` passed at pause.
- Chromium inspection found no page-level horizontal overflow across seven destinations at 320×568, 568×320, 844×390, 768×1024, 1024×768, 1280×720, 1920×1080 and 2560×1440. Matching touch target probe found no undersized tested buttons/links/selects after changes.
- Keyboard/panning is deterministic VisualViewport simulation, not physical iOS/Android keyboard validation. Physical hardware, native browser zoom and screen readers remain unverified.

Resume with:

1. Investigate remaining iPhone signup setup failure; distinguish test synchronization from app behavior, without weakening assertions.
2. Rerun final build/lint, `npm run test:e2e`, and device matrix. Check accessibility after pagination/touch changes.
3. Review new screenshots under `reference/redesign/devices/`; update final validation documentation once all checks pass. Current `VALIDATION.md` describes previous completed redesign, not a fully verified device pass.

Useful logs on this machine: `/tmp/offerly-devices-verified.log`, `/tmp/offerly-device-check.log`, `/tmp/offerly-device-before.log`, `/tmp/offerly-device-after.log`. Tests used isolated temporary databases; existing user data was not edited.
