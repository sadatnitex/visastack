# WAL1 records: Expandable Section, status pictures, details count-down, layout guard

Unit WAL1 (Wallet upgrade U1a Foundation), Class A, FULL route. Branch claude/wal1-foundation. Decision record: ADR 0030. Example data only. No database change, no new switch, nothing on screen changes yet (later Wallet units swap screens onto these pieces).

## What changed

| Where | Change |
|---|---|
| components/ui-lift/expandable-section.tsx | New. `ExpandableSection`: native details and summary; row = picture, name (heading level 2 to 6), one-line summary, status, chevron; same body padding everywhere; `remember` keeps the person's choice through the existing StickyDetails island; server-safe like the rest of the kit. The status picture sits beside the toggle, never inside it. |
| components/pictures/status-picture-words.ts | New. The one typed record of the six status names and sentences (`STATUS_MEANINGS`). |
| components/pictures/status-picture.tsx | New. `StatusPicture` (Explain note around the drawing) and `StatusGlyph` (drawing alone). Six rings that differ without colour, six marks, brand tokens only. |
| globals.css, new block "WP-WAL1" (end of file) | Section and picture styles, plus `.status-picture-key` (a list of status pictures with full 44 px rows). Flat, tokens only; chevron turns only without reduced motion. |
| scripts/ui-ratchet.mjs, .baseline.json, .test.mjs | Fourth counter `folds`: open-and-close sections per file built outside expandable-section.tsx (raw details or the older shared folds; tests excluded). Baseline 175 in 103 files. The pass line and `--lower` now cover all four counters. |
| e2e/support/layout-guards.ts | New. `expectNoSidewaysScroll`, `coveredControls`, `expectNothingCoversControls`, `runLayoutGuards`, `GUARD_SIZES` (390, 400, 1280). |
| e2e/fixtures/wal1-foundation.fixture.tsx, e2e/wallet/u1-foundation.spec.ts | New. Fixture with all six pictures, long English and long Bangla summaries; spec runs the guard on the fixture (open and closed) and the public pages, keyboard toggle, Explain and Escape, 44 px, wrap without shift, reduced motion, script switched off, and self-tests that prove each guard fails. |
| .github/workflows/pr-browser-checks.yml line 123 | ` wallet/` added (Guardian 9 decision) so pull requests run the new spec. |
| docs/adr/0030-expandable-section-and-status-pictures.md | New ADR. |

## New visible words for the localization list

Names (Title Case): "Added", "Backed by a Document", "Suggested", "Sensitive", "Needs Fix", "Not Current".

Sentences:
- Added: "You typed this in yourself, and it is not linked to any file."
- Backed by a Document: "A file you uploaded shows the same value, which alone does not mean anyone has checked it."
- Suggested: "Read from one of your files, and not saved until you confirm it."
- Sensitive: "Hidden until you choose Show, and only you see it on this screen."
- Needs Fix: "Something here does not fit, and its details say what to change."
- Not Current: "This was true before and stays in your history, but it is not true now."

The fixture's made-up words (section names, field labels) are test data, not product words.

## Red then green

Red first, on main `70b8940` (the new files did not exist): the ratchet tests, the two unit test files and the browser spec all failed to load.

Each guard proven red by breaking the real code once (backed up with cp, restored, then green):
- Count-down: a second `<details>` added inside `collapsible-group.tsx` gave "collapsible-group.tsx: 2 raw details elements, up from 1" and exit 1.
- Hit test: the Expandable Section's status column stretched over the whole card (`inset: 0`) gave "<summary> "Added Details3 of 5 added" at 195,335 is under <circle>" at every size, sections open and closed.
- Sideways: a 2000 px wide child in the section body gave "sideways scroll in pixels" with the sections open (closed bodies are not drawn, as expected).

Found by the new guards on their first run and fixed in this unit: the six Explain buttons of a stacked status key overlapped (ExplainTip's -12 px margin), fixed with `.status-picture-key` rows of 44 px; the title moved 1 px when a summary wrapped; the guard itself read points while the site's smooth scroll was still moving (now instant).

Green: `e2e/wallet/u1-foundation.spec.ts` 20 of 20, run twice (40 of 40) on a production build with the no-secret settings at 390, 400 and 1280 px, including the public pages /, /trust, /privacy, /terms and /status. Unit: expandable-section.test.tsx and status-picture.test.tsx (with axe), ui-lift.test.tsx, title-case.test.ts, ui-ratchet.test.mjs 8 of 8.

Review: /code-review high and an independent accessibility and design review (fresh context). Fixed: status before the row in reading and focus order; heading a direct child of the summary; forced-colours rule; right-to-left padding and chevron; guard tests every point of a row with a declared narrow companion and reports a control it cannot bring on screen; the no-script test uses true server markup; the count-down also counts the older shared folds; two sentences reworded ("choose Show", "its details say what to change"). Kept on purpose: green for Backed by a Document (the approved board shows it green; the sentence says nobody checked it); English defaults in the one record with `label` and `text` props for the page language (the brief's single source for the Bengali list).

## Not verified

- Signed-in pages: the guard runs on fixture-mounted screens and public pages only (U1b brings a CI test user).
- Safari and Firefox (only Chromium was run).
- Remembering a section across visits (StickyDetails remembers within the page; no new storage, by design).
- Bengali wording of the six names and sentences (listed above for the localization list).
