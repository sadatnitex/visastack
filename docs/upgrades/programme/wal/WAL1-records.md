# WAL1 records: Expandable Section, status pictures, details count-down, layout guard

Unit WAL1 (Wallet upgrade U1a Foundation), Class A, FULL route. Branch claude/wal1-foundation. Decision record: ADR 0030. Example data only. No database change, no new switch, nothing on screen changes yet (later Wallet units swap screens onto these pieces).

## What changed

| Where | Change |
|---|---|
| components/ui-lift/expandable-section.tsx | New. `ExpandableSection`: native details and summary with the content inside; row = picture, name (heading level 2 to 5), one-line summary, chevron; status picture after the details element, drawn in a reserved column of the row; the summary is named by the title and described by the summary line and the status in words (`statusDescription`); `remember` keeps the person's choice through StickyDetails; server-safe like the rest of the kit. |
| components/sticky-details.tsx | One optional, additive `summaryProps` (class, aria-labelledby, aria-describedby). Existing callers draw byte for byte as before (sticky-details.test.tsx). |
| components/pictures/status-picture-words.ts | New. Picture and sentence for six stored status codes; the NAMES are read from `FIELD_STATUS_WORDS` (lib/field-state-words.ts), never typed again. |
| components/pictures/status-picture.tsx | New. `StatusPicture` (Explain note around the drawing), `StatusGlyph` (drawing alone), `statusPictureWords(kind)`, `isStatusKind`. Six rings and six marks that differ without colour, brand tokens only. |
| globals.css, new block "WP-WAL1" (end of file) | Section and picture styles, `.status-picture-key` (a key of status pictures with full 44 px rows), forced-colours rule, right-to-left chevron. Flat, tokens only; the chevron turns only without reduced motion. |
| scripts/ui-ratchet.mjs, .baseline.json, .test.mjs | Fourth counter `folds`: open-and-close sections built outside expandable-section.tsx, raw details or any use of the shared folds (also dotted, renamed or through createElement; .tsx and .ts). Baseline 194 in 106 files (108 raw details in 72 files). Totals of every counter pinned in the test. The pass line and `--lower` cover all four counters. |
| .github/CODEOWNERS | The ratchet baseline file named with its owner. |
| e2e/support/layout-guards.ts | New. `expectNoSidewaysScroll`, `coveredControls`, `expectNothingCoversControls`, `runLayoutGuards`, `GUARD_SIZES` (390, 400, 1280). Controls met in the middle, from above and from below, nine points each; tiny controls, unreachable controls and ignores without a reason are reported. |
| e2e/fixtures/wal1-foundation.fixture.tsx, e2e/wallet/u1-foundation.spec.ts | New. Fixture with the six pictures, long English and long Bangla summaries; spec runs the guard on the fixture (open and closed) and the public pages, keyboard toggle, Tab order and the row's name and description, Explain and Escape, 44 px, wrap without shift, reduced motion, server markup with script switched off, and self-tests that prove each guard rule fails. |
| .github/workflows/pr-browser-checks.yml line 123 | ` wallet/` added (Guardian 9 decision) so pull requests run the new spec. |
| docs/adr/0030-expandable-section-and-status-pictures.md | New ADR. |
| docs/uiux/ccd/VOCABULARY.md | The field state row notes that the status pictures read the same map. |

## New visible words for the localization list

No new names: Entered, Suggested, Confirmed, Backed by a Document, Does Not Match and No Longer Current already exist in `FIELD_STATUS_WORDS`.

New sentences (the Explain notes):
- Entered: "Saved in this record with no confirmation and no file behind it yet."
- Suggested: "Offered by reading one of your files or by a connected app, and not confirmed yet."
- Confirmed: "Confirmed by a person with access to this record, but not checked against a file."
- Backed by a Document: "A file you uploaded shows the same value, which alone does not mean anyone has checked it."
- Does Not Match: "A file or a suggestion disagrees with the saved value, and the details show both."
- No Longer Current: "Marked as no longer current, so it is not used as the value for today."

The fixture's made-up words (section names, field labels) are test data, not product words.

## For U4

- Sensitive (a protection marker for hidden values, not a field state) was on the board but has no word in VOCABULARY.md; it was dropped from this unit. U4 decides its word and picture.

## Red then green

Red first, on main `70b8940` (the new files did not exist): the ratchet tests, the two unit test files and the browser spec all failed to load.

Each guard proven red by breaking the real code once (backed up with cp, restored, then green):
- Count-down: a second `<details>` added inside `collapsible-group.tsx` gave "collapsible-group.tsx: 2 raw details elements, up from 1" and exit 1.
- Hit test: the Expandable Section's status column stretched over the whole card (`inset: 0`) gave "<summary> "Added Details3 of 5 added" at 195,335 is under <circle>" at every size, sections open and closed.
- Sideways: a 2000 px wide child in the section body gave "sideways scroll in pixels" with the sections open (closed bodies are not drawn, as expected).

Found by the new guards on their first run and fixed in this unit: the six Explain buttons of a stacked status key overlapped (ExplainTip's -12 px margin), fixed with `.status-picture-key` rows of 44 px; the title moved 1 px when a summary wrapped; the guard itself read points while the site's smooth scroll was still moving (now instant).

Green (first round): `e2e/wallet/u1-foundation.spec.ts` 20 of 20, run twice (40 of 40) on a production build with the no-secret settings at 390, 400 and 1280 px, including the public pages /, /trust, /privacy, /terms and /status. Unit: expandable-section.test.tsx and status-picture.test.tsx (with axe), ui-lift.test.tsx, title-case.test.ts, ui-ratchet.test.mjs 8 of 8.

Guardian review round (two Opus reviewers): fixed as listed in "What changed". New red-then-green: the bypass tests (dotted name, renamed import, createElement, the case, collect and readiness folds, .ts files) failed against the previous ratchet (3 of 12 red) and pass now; raising one baseline number turned the pinned-totals test red; StickyDetails draws existing callers byte for byte as before. Green after the round: u1-foundation.spec.ts 25 of 25, run twice (50 of 50), including the self-tests for a sticky header met from below, a tiny control with no label, an ignore without a reason and a fixed bar under the real stylesheet; unit and guard suites (ui-lift, pictures, sticky-details, vocabulary, title-case, every parity test: 28 files, 426 tests); ui-ratchet 12 of 12.

Review: /code-review high and an independent accessibility and design review (fresh context). Fixed: status before the row in reading and focus order; heading a direct child of the summary; forced-colours rule; right-to-left padding and chevron; guard tests every point of a row with a declared narrow companion and reports a control it cannot bring on screen; the no-script test uses true server markup; the count-down also counts the older shared folds; two sentences reworded ("choose Show", "its details say what to change"). Kept on purpose: green for Backed by a Document (the approved board shows it green; the sentence says nobody checked it); English defaults in the one record with `label` and `text` props for the page language (the brief's single source for the Bengali list).

## Not verified

- Signed-in pages: the guard runs on fixture-mounted screens and public pages only (U1b brings a CI test user).
- Safari and Firefox (only Chromium was run).
- Remembering a section across visits (StickyDetails remembers within the page; no new storage, by design).
- Bengali wording of the six sentences (listed above for the localization list).
- VoiceOver and NVDA: heading navigation inside a summary, and how the row's description is read.
- Forced-colours mode and right-to-left layout in a real browser (rules written, not run).
- A `#id` link opening a closed section (it scrolls to the card only, by design; a page sets `defaultOpen`).
