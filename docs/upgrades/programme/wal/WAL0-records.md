# WAL0 records: open document sheet and case pill strip

Unit WAL0, Class B. Branch claude/wal0-sheet-and-strip. Example data only.

## What changed

| Where | Change |
|---|---|
| apps/web/src/app/globals.css, WP-PIC16 rule `.document-wallet-layout` | The view-transition name (it makes a stacking context around the open sheet) now applies only above 760 px and never while a sheet is open. List and Stack still fade on wider screens. |
| apps/web/src/app/globals.css, `.lift-case .jump-nav` (two rules) and the `.jump-nav` phone rule | Existing rules edited where the defect lived: nowrap and overflow-x auto removed, wrapping kept for every width. |
| apps/web/src/app/globals.css, new block "WP-WAL0" at the end | Add button and its spacer hidden while a sheet is open (client-opened sheet), and bottom padding on the open sheet that clears the bottom bar and the safe-area inset. |
| apps/web/src/app/app/applicant/[id]/documents/page.tsx | The Add button and its spacer are not rendered when a document is selected (address names one). |
| e2e/scroll-budget/WAL0.fixture.tsx, WAL0.spec.ts | New specs (below). |
| src/components/wal0-sheet.test.ts | New unit guards. |

## Cause found

D1: `.document-wallet-layout{view-transition-name: wallet-view}` (no-preference motion) puts the open sheet in a stacking context of its own, so the sheet's z-index 64 only counts inside it and the Add button (z 40) and bottom bar (z 45) paint over it. With reduced motion the sheet was already on top.

Prepare Safe Copy overlap: not reproduced. With the fold closed or open, at 390, 400, 360 and 1280 wide, the section, the reading status, Check the File Again and the date form are laid out one under another with no overlap (measured tops: Safe Copy fold 229 to 479, reading status from 485). The only overlap measured was the Add button and bottom bar over the sheet. Likely the owner's screenshot was that. The hit-test spec opens the fold and covers it from now on.

D4: three rules turned the strip into one nowrap, overflow-x auto row.

## Red then green

Red, run against the unfixed build (served with next start, throwaway Playwright config):

- Add button hidden while sheet is open: fails at 390x844, 400x860 and 360x640, both motion values (`expect(locator).toBeHidden()` received visible).
- Every control topmost (last control after scrolling to the end): fails at 390x844, 400x860 and 360x640 with no-preference motion (`About This File at 195,790 hit A`, the bottom bar link); passes with reduce, which confirms the stacking context cause.
- Pill strip: 390 browse scrollWidth 679 vs clientWidth 350; 390 everything 1112 vs 350; 360 everything 1112 vs 320; 1280 everything 1016 vs 934. Same numbers the owner measured.

Green: filled in after the fixed build ran (see below).

## Not verified

To be completed at READY.
