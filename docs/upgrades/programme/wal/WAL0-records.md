# WAL0 records: open document sheet and case page strip

Unit WAL0, Class B. Branch claude/wal0-sheet-and-strip. Example data only.

## What changed

| Where | Change |
|---|---|
| globals.css, WP-PIC16 rule `.document-wallet-layout` | The view-transition name (it makes a stacking context around the open sheet) now applies only above 760 px. List and Stack still fade on wider screens, where the chosen document is a side panel. |
| globals.css, new block "WP-WAL0" (end of file) | Add button and spacer hidden while a sheet is open (also a client-opened one); open sheet bottom padding `61px + safe-area inset + space-4` so its last control clears the bottom bar; More panel kept inside the screen from 641 to 760 px; depth switch fits 320 px. |
| globals.css, new block "WP-WAL0 Jump To Section" | Below 761 px the case section links are one closed 44 px native fold, opening into full-width 44 px links in the page flow. From 761 px the pills wrap. |
| globals.css, existing rules edited where the defect lived | `.lift-case .jump-nav` (two rules) and the phone `.jump-nav` rule: nowrap and overflow-x auto removed. `.task-row .row-key`: `overflow-wrap: anywhere` (a pasted address stretched the whole page). |
| mission/[id]/page.tsx | The section links render once (`jumpLinks`) inside a `details.jump-select` fold ("Jump To Section") and the `.jump-links` pills. |
| documents/page.tsx | Comment only: the Add button stays in the page; the stylesheet hides it while the sheet is open (the page cannot know when the sheet is closed in the browser, so a server-side omission would lose the button after closing). |
| e2e/scroll-budget/WAL0.fixture.tsx, WAL0.spec.ts | New. Real document browser, Safe Copy, reading status, workspace shell with bottom bar and the Add button markup; real page header, More menu, depth switch, tasks panel with a 120-character unbroken title; section links markup. |
| src/components/wal0-sheet.test.ts | New unit guards. |

Approved guard corrections (Guardian 7, owner D4): case-lift-b.test.ts (strip test now asserts wrapping, no overflow-x auto), WP-SB2.spec.ts (:284 rewritten for the new phone behaviour), case-structure.test.tsx (one added line "summary: Jump To Section" in each of the three expected outlines).

New words for the localization list: "Jump To Section".

## Causes found

D1: `.document-wallet-layout{view-transition-name: wallet-view}` under no-preference motion puts the open sheet in a stacking context of its own, so the sheet's z-index 64 only counts inside it and the Add button (z 40) and bottom bar (z 45) paint over it. With reduced motion the sheet was already on top. Prepare Safe Copy overlap: not reproduced (a closed fold gives stale rectangles; open, the controls are disjoint at 390, 400, 360 and 1280). The hit-test spec opens the fold and guards it.

D4: three rules made the strip one nowrap, overflow-x auto row (390 px Browse 679 vs 350, Everything 1112 vs 350; 1280 px Everything 1016 vs 934). Also found by the Guardian: a pasted address in a task title widened the page (page 1098 px at 320), the More panel opened 269 px off the left edge at 641 to 650 px, and the depth switch spilled 5 px at 320.

## Red then green

Red, against the unfixed code (next start of the build before each fix):
- Add button hidden while the sheet is open: failed at 390x844, 400x860, 360x640, both motion values.
- Every control topmost, last control after scrolling to the end: failed at 390x844, 400x860, 360x640 with no-preference motion (`About This File at 195,790 hit A`, the bottom bar link); passes with reduce, which confirms the stacking-context cause.
- Strip: 390 browse scrollWidth 679 vs clientWidth 350; 390 everything 1112 vs 350; 360 everything 1112 vs 320; 1280 everything 1016 vs 934.
- Case page: page scrollWidth 1098 vs 320 at 320, and a failure at every width from 320 to 1280 at browse and everything; More panel x = -269 at 641 and 650; depth switch 5 px over at 320.

Green, on the fixed build: WAL0.spec.ts 40 of 40 at the sheet sizes and every case width (320, 360, 390, 400, 641, 650, 700, 760, 761, 768, 1280) at Glance, Browse and Everything. The whole e2e/scroll-budget/ folder: 125 pass, see "Not verified" for the one open number.

## Not verified

- The real signed-in case and documents pages in a real browser with real data (the specs render the real components in a fixture; the case page strip markup in the fixture is a copy of the page's, kept in step by a source guard in wal0-sheet.test.ts).
- Safari and Firefox on a phone (only Chromium was run).
- WP-SB2 desktop Everything page height 3321 vs 3300 (the second row of pills at 1280): awaiting the Guardian's word.
- Prepare Safe Copy overlap was not reproduced, so no fix was made for it.
- The current-section mark on the pills: the page has none today, so none was kept.
