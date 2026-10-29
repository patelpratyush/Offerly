# Screenshot comparisons

Captured from actual local app with disposable synthetic Morgan account. Matching comparisons use identical widths and 1000px viewport height, with full-page capture. Data and timestamps remain as stored; unknown applied dates stay unknown. Browser screenshots do not prove assistive-technology compatibility.

| Screen | Before | After |
| --- | --- | --- |
| Today · 1440px | [Before](screenshots/before-today-1440.png) | [After](screenshots/after-today-1440.png) |
| Today · 375px | [Before](screenshots/before-today-375.png) | [After](screenshots/after-today-375.png) |
| Applications · 1440px | [Before](screenshots/before-applications-1440.png) | [After](screenshots/after-applications-1440.png) |
| Applications · 375px | [Before](screenshots/before-applications-375.png) | [After](screenshots/after-applications-375.png) |
| Detail · 1440px | [Before](screenshots/before-detail-1440.png) | [After](screenshots/after-detail-1440.png) |
| Application editor · 1440px | [Before](screenshots/before-editor-1440.png) | [After](screenshots/after-editor-1440.png) |
| Empty Today · 1440px | [Before](screenshots/before-empty-1440.png) | [After](screenshots/after-empty-1440.png) |
| Reviews · 375px | [Before](screenshots/before-reviews-375.png) | [After](screenshots/after-reviews-375.png) |
| Connections · 1440px | [Before](screenshots/before-connections-1440.png) | [After](screenshots/after-connections-1440.png) |
| Settings · 375px | [Before](screenshots/before-settings-375.png) | [After](screenshots/after-settings-375.png) |

All seven workspace destinations also have `before-{page}-{width}.png` / `after-{page}-{width}.png` captures at 375, 768, 1024 and 1440px in this directory. Some panels require their own scrolling; full-page capture does not expand dialog contents.

Additional inspected states:

- [Board · 1440px](screenshots/after-board-1440.png), [375px](screenshots/after-board-375.png).
- [Import preview with invalid/duplicate rows · 1440px](screenshots/after-import-1440.png), [375px](screenshots/after-import-375.png).
- [Uploaded long-title document · 1440px](screenshots/after-document-populated-1440.png), [375px](screenshots/after-document-populated-375.png).
- [Local signup](screenshots/after-signup-1440.png); [deployed invitation-gated signup](screenshots/deployed-auth.png). These are different contexts, not a before/after comparison.

Representative PNGs were visually inspected. Final editorial check caught and fixed text overlap in next-action table cells, insufficient contrast in secondary copy/import errors, and raw validation JSON in import preview.

## Device follow-up

[Device optimization report](DEVICES.md) includes new 320px Chromium/WebKit/Firefox screenshots, keyboard/pan simulation and short-landscape editor captures. Device screenshots use a separate synthetic account; compare within that set.
