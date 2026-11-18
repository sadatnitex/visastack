# FIX9 records: the signed-in layout faults and the /status picture

Owner goal (17 Nov 2026): "A permanent made-up test traveller and agency login in CI so every upgrade is checked on the real pages, not on fixtures." The route guard (WAL1B-2, see WAL1B-2-records.md) listed real faults in `KNOWN_FAILING`. This unit fixes five of them at their root, removes their pins, and finds the cause of one intermittent picture test.

## Root causes and fixes

| Pin removed | Root cause | Fix |
|---|---|---|
| /app/applicant/[id]/missions/prepare-again "Create Case", /app/applicant/[id]/outputs "Preview", /app/mission/start "Start Trip" | One shared cause. The pinned action bar of a form (`.sticky-action-bar`) stuck at `bottom: 0` of the screen. Under 1024 px the navigation bar is also fixed to the bottom (3.5rem tall, a hairline and the home-indicator space, z-index above the action bar), so it sat on top of the buttons. | globals.css, block `WP-FIX9`: under 1024 px, inside the app shell, the bar sticks at `--fix9-nav-height` (the navigation bar's own height, one place) and the scroll padding grows by the same amount. A message strip (toast) and the scroll padding rise by the same amount, and on a phone the taller stacked bar keeps its own padding. The case page's own next-step bar keeps its rules. Other pages using the bar (calendar, create case, sign-in consent) gain the same lift. |
| /app/applicant/[id]/documents/add "Files to Import", "Folder to Import" | The two pickers were `input.sr-only`, 1 by 1 px, `aria-hidden`, `tabindex=-1`, opened by script from two separate buttons: nothing drawn was tied to the field. | The drawn buttons are now `<label htmlFor>` styled as buttons (44 px high, same words) tied to the field by id. The field stays out of sight but is a real, focusable field, so Tab and Enter work on it and its focus ring is drawn on the label (`.file-pick-input:focus-visible + .btn`). The folder label opens the folder picker itself; with no folder picker the plain file picker opens and the notice is announced, by tap or by keyboard (it now comes from the field's own click, which the keyboard also fires). Multiple files, folders and camera capture are unchanged. |
| /app/applicant/[id]/profile "Photo File" | Same: a hidden `aria-hidden` picker behind an Add / Replace Photo button. | Add Photo and Replace Photo are now a label tied to the field; the field is disabled while a photo is saving or removed. Focus returns to the field (shown on the label) when the crop step closes. Remove Photo stays a button. |

Visible words are unchanged. The old catalogue key `photoFile` ("Photo File" and its Bengali words) is retired from the English and Bengali catalogues and the source list: nothing shows it any more. The hidden "Files to Import", "Folder to Import" and "Photo File" names are no longer used: each field is now named by its drawn label.

## Intermittent /status picture test

Test: "/status keeps identical pixels under both device appearances at 390px" (apps/web/e2e/ux-public.spec.ts). It failed once each in two full local runs and passed on reruns.

- Reproduced: on one build, 30 repeats with 3 workers while 6 busy loops used the CPU, it failed in 4 to 7 of every 30 runs; 30 repeats on an idle machine passed 30 of 30. So it needs a loaded machine, as a full run makes.
- What differs: every failing pair differs in the same 21 pixels, by exactly one level out of 255, along the left and right edges of the "You Can Use Now" card between rows 391 and 396 (the end of its rounded corners). Layout is identical in every run (the card's top is 381.2656 px each time), the page clock is fixed, and the 15 second self-refresh and the Check Now state were ruled out (a refresh in flight does not change the visible part at 390 px; the layout probe showed one stable layout).
- Cause: the page is painted in steps (empty list first, then the answers). Chromium redraws only the changed part each time, and the rounded edge of a card redrawn that way can end one level away from a card drawn whole. Which of the two a capture ends with depends only on timing under load.
- Not the cause (tried): capture in fresh pages for both appearances (still 4 of 30 failed), a viewport resize and back (still 4 of 30), one raster thread (still 4 of 30).
- Fix (the comparison is unchanged: byte for byte, no tolerance added): both /status captures are made in a brand-new page opened at the final size, and before each picture the whole page is invalidated and drawn again (body background changed and restored over four frames), so each capture is a full paint whatever the timing of the steps was. The other routes keep their capture steps on both sides (light on the first page, dark in a fresh page), so the full repaint is applied to /status only.
- Proof: 70 of 70 passes under the same CPU load (30 and 40 repeats on one build), then all 30 appearance tests of the file pass on an idle machine.

## New tests

- apps/web/e2e/wallet/fix9-sticky-bar.spec.ts: the real stylesheet over the real class names. At 390 and 400 px a press on the bar's button reaches the button, not the navigation bar (red on the old stylesheet, green now); at 1280 px the bar still sticks to the bottom edge.
- import-panel.test.tsx, profile-photo-control.test.tsx, account-photo-card.test.tsx, import-panel-locale.test.tsx: each file field is tied to a drawn label by id, is reached by Tab, has no hidden-field attributes.
- scripts/ci-signed-in.test.mjs: the baseline loses the five lines; routes.ts loses the five entries. The signed-in guard passes 54 of 54 with them removed (a pin that still fails would be reported as unlisted).

## NOT verified

Safari and Firefox, real phones (the home-indicator space is the browser's `env()` value, not measured on a device), the GitHub run time, the two /record pins and the agency pins (other units), the case page's own next-step bar (kept as it was; not in the guard).
