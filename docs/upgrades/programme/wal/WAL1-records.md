# WAL1 records: Expandable Section, status pictures, details count-down, layout guard

Unit WAL1 (Wallet upgrade U1a Foundation), Class A, FULL route. Branch claude/wal1-foundation. Decision record: ADR 0030. Example data only. No database change, no new switch, nothing on screen changes yet (later Wallet units swap screens onto these pieces).

## What changed

| Where | Change |
|---|---|
| components/ui-lift/expandable-section.tsx | New. `ExpandableSection`: native details and summary; row = picture, name (heading level 2 to 6), one-line summary, status, chevron; same body padding everywhere; `remember` keeps the person's choice through the existing StickyDetails island; server-safe like the rest of the kit. The status picture sits beside the toggle, never inside it. |
| components/pictures/status-picture-words.ts | New. The one typed record of the six status names and sentences (`STATUS_MEANINGS`). |
| components/pictures/status-picture.tsx | New. `StatusPicture` (Explain note around the drawing) and `StatusGlyph` (drawing alone). Six rings that differ without colour, six marks, brand tokens only. |
| globals.css, new block "WP-WAL1" (end of file) | Section and picture styles. Flat, tokens only; chevron turns only without reduced motion. |
| scripts/ui-ratchet.mjs, .baseline.json, .test.mjs | Fourth counter: raw details elements per file outside expandable-section.tsx (tests excluded). Baseline 108 in 72 files. The pass line and `--lower` now cover all four counters. |
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
- Sensitive: "Hidden until you tap Show, and only you see it on this screen."
- Needs Fix: "Something here does not fit, so open it to see what to change."
- Not Current: "This was true before and stays in your history, but it is not true now."

The fixture's made-up words (section names, field labels) are test data, not product words.

## Red then green

RESULTS_PLACEHOLDER

## Not verified

- Signed-in pages: the guard runs on fixture-mounted screens and public pages only (U1b brings a CI test user).
- Safari and Firefox (only Chromium was run).
- Remembering a section across visits (StickyDetails remembers within the page; no new storage, by design).
- Bengali wording of the six names and sentences (listed above for the localization list).
