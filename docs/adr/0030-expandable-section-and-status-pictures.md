# ADR-0030: One Expandable Section, one status language, one layout guard

- **Status:** Accepted, 18 November 2026
- **Date:** 2026-11-18
- **Deciders:** Owner (Wallet upgrade, 17 November 2026), Guardian 9 (scope split)
- **Unit:** WAL1, Wallet upgrade U1a (Foundation)
- **Builds on:** ADR 0023 (Calm Core With Depths), ADR 0027 (visual depth, not used here: the section and the pictures are flat)

## Context

The Wallet board estimated about 70 hand-built open-and-close sections across 45 files, plus the shared folds. Counted exactly on main `70b8940` by the new count-down (section 3): 108 raw `<details>` elements in 72 files, and 194 open-and-close sections in 106 files once every use of a shared fold is included (`Disclosure`, `AboutDisclosure`, `CollapsibleGroup`, `CollapsibleGroups`, `StickyDetails`, `LazyDisclosure`, the case `RailFold`, the collect `Fold`, `ReadinessLegendFold`). None has a picture slot or a status slot, so every opened section reads as a plain form, and each screen spells its states in its own text chips. Defect 1 of the Wallet board (the Add button painted over the open document sheet on a phone) shipped because no check rendered that screen at phone width and pressed its controls.

Owner decision, 17 November 2026 (exact words): "I agree with the rest, your recommended options". This covers the Foundation unit as recommended on the Wallet board: One Expandable Section, One Guard. Rules for every Wallet unit: no database change, no new switch, Title Case, 44 px targets, the Explain rule (a name plus one plain sentence on hover, focus or tap; Escape closes), reduced motion shows the finished state, brand tokens only, truthful words (Received is not Reviewed, Suggested is not Confirmed, Saved is not Shared). Traveller screens first; admin and staff screens stay flat.

## Decision

### 1. Expandable Section

`apps/web/src/components/ui-lift/expandable-section.tsx` is the one open-and-close section.

- Closed row: picture slot, name (a heading directly inside the summary, level 2 to 5 as for every kit piece, default 3), one-line summary slot, status slot, chevron. Open: the content below with the same padding everywhere.
- Built on the browser's own `details` and `summary`, with the content inside `details`: it works before the script loads and with script switched off, Enter and Space toggle it, find-in-page opens it, and the summary carries the native expanded state.
- The row is at least 56 px; picture, status and chevron are 44 px and pinned to the top of the row, so a summary that wraps (long English, longer Bangla) moves nothing.
- The status picture is drawn beside the toggle in a reserved column, never inside `summary`. A button inside a summary is nested interactive content (a screen reader reads the whole row as one button and may not reach the inner one) and its press can toggle the section. Outside, both problems cannot happen, so no `stopPropagation` is needed.
- Names and order for assistive technology (Guardian 9 decision, 18 Nov 2026): the summary is named by the title alone (`aria-labelledby`), so the toggle's name stays short, and described by the summary line and the status in words (`aria-describedby`, the `statusDescription` prop; for a status picture `statusPictureWords(kind)`). The status button follows the `details` element in page order, so Tab reaches the row first and the status next. Open, the content sits between them in Tab order (the content must stay inside `details` for the native disclosure and find-in-page); this is acceptable because the row itself already says the status, and the status button only repeats it with its sentence.
- Known limit: some screen readers present a summary as one button, so its heading may not appear in heading navigation. Not checked with VoiceOver or NVDA in this unit.
- It is a server component, like the rest of the `ui-lift` kit (its guard forbids client code). With `remember` the open-and-close state is held by the existing `StickyDetails` island (a server refresh after a save never closes a section over the result the person still needs); StickyDetails gained one optional, additive `summaryProps` (class and the two aria links) and draws existing callers byte for byte as before. No new storage is introduced. Without `remember` the section follows `defaultOpen`. Server and browser draw the same first state, so nothing flashes. A `#id` link scrolls to the card but does not open it; a page reached by such a link sets `defaultOpen`.
- Reduced motion: the chevron shows its finished position; it turns gradually only without reduced motion. Right to left, the chevron points the reading way (`:dir(rtl)` with a `[dir="rtl"]` fallback). Styles are one block at the end of `globals.css` starting `/* WP-WAL1`.
- The existing shared folds and their call sites are unchanged in this unit; later Wallet units swap screens onto the section.

### 2. One status language: six status pictures

`apps/web/src/components/pictures/status-picture.tsx` draws one small flat picture for each of the six states a saved value can be in. One name per thing (`docs/uiux/ccd/VOCABULARY.md`): the NAMES are not written in this unit; they are read from `FIELD_STATUS_WORDS` in `apps/web/src/lib/field-state-words.ts`, the one map History, the profile pages and Application Memory already use, and a test fails if a name is typed again. `status-picture-words.ts` adds only the picture and the one sentence of the Explain note, keyed by the stored status code a screen already holds. Reviewed by an Agency and Replaced have no picture in this unit.

| Stored code | Name (from the map) | Ring (reads without colour) | Mark | Tone token |
|---|---|---|---|---|
| DECLARED | Entered | thin solid | dot | brand |
| EXTRACTED_PENDING | Suggested | long dashes | spark | brand |
| APPLICANT_CONFIRMED | Confirmed | two rings | tick | brand |
| DOCUMENT_SUPPORTED | Backed by a Document | thick solid | page | success |
| CONFLICTED | Does Not Match | short dashes | exclamation mark | danger |
| STALE | No Longer Current | dots | clock | tertiary text |

The sentences follow where each state is really set in the services: DECLARED is the default of any saved value (a typed entry, a form answer, an edit by someone with access), so Entered never says who typed it; APPLICANT_CONFIRMED is set when a person saves or accepts a value without a file, so Confirmed says it was not checked against a file; Suggested names its sources (reading one of your files, or a connected app); No Longer Current does not promise the value is kept for ever; Backed by a Document says that alone it does not mean anyone has checked it. A unit test fails on words such as verified, approved, valid, forever or only you. Sensitive (a protection marker, not a field state, and not in the vocabulary) was dropped from this unit and is listed for U4.

High-contrast (forced colours) mode draws them in system colours, so ring and mark carry the meaning. Each picture is wrapped in the existing `ExplainTip` (a 44 px button named by the state, described by its sentence, opened by hover, focus or tap, closed by Escape). A key of the pictures uses the shared `status-picture-key` list: every item is a full 44 px row, because the Explain button's negative margin (it lets a 44 px target sit inside a line of text) makes stacked buttons overlap; the layout guard found this on its first run. In a key the visible name beside the button is hidden from screen readers, since the button already carries it.

### 3. The open-and-close count-down

`scripts/ui-ratchet.mjs` has a fourth counter, `folds`: per file in `apps/web/src` (.tsx and .ts, test files excluded), every open-and-close section built outside the Expandable Section, that is a raw `<details>` or a use of one of the shared folds (`FOLD_TAGS`: `Disclosure`, `AboutDisclosure`, `CollapsibleGroup`, `CollapsibleGroups`, `StickyDetails`, `LazyDisclosure`, `RailFold`, `Fold`, `ReadinessLegendFold`), however it is written: a plain tag, a dotted name (counted by its last part), a renamed import, or `createElement('details' | Fold, ...)`. The case section links fold ("Jump to Section") is a raw `<details>` and counted as one. `expandable-section.tsx` is the one file not counted. The starting point is 194 in 106 files on main `70b8940` (108 of them raw `<details>` in 72 files), in `scripts/ui-ratchet.baseline.json`.

A file may only go down; a new file may hold none. `node scripts/ui-ratchet.mjs --lower` records a reduction. The totals of every counter are pinned in `scripts/ui-ratchet.test.mjs` (`PINNED_TOTALS`), so the baseline cannot be raised quietly: raising a number needs the Guardian's approval written in the pull request, and `.github/CODEOWNERS` names an owner for the baseline file. When main adds a section outside the Expandable Section while a branch is open, the merge turn either lowers the baseline with `--lower` or raises one file's number, with that approval.

### 4. The layout guard

`apps/web/e2e/support/layout-guards.ts` holds two checks any page can run, at 390, 400 and 1280 px (`GUARD_SIZES`): no sideways scroll, and nothing painted over a control. Each visible button, button-styled link, field, select, text area and summary is met where a person meets it: brought to the middle of the screen, reached from above (it arrives at the bottom edge, where fixed bars sit) and reached from below (it arrives at the top edge, under a sticky header), each as the browser scrolls to a focused control. At each place nine points are hit-tested with `elementFromPoint`: the centre, the four corners (2 px in, and inside a rounded corner's curve) and the middle of each edge. A failure names the control, where it was met and what covers it. A control that can never be brought on screen is reported; so is one smaller than 4 px unless it has a drawn label (a styled checkbox is pressed through its label). Leaving a control out needs a reason string. A row may declare a narrow companion drawn on it (`data-row-companion`, the status column); a hit counts only inside the companion's own box and only while it is at most a third of the row's width.

`runLayoutGuards(page, open)` takes any way of opening a page, so the same check serves fixture screens now and signed-in routes later. `e2e/wallet/u1-foundation.spec.ts` runs it on the WAL1 fixture and the public pages, and includes self-tests that prove each rule fails on a broken page, one of them under the real site stylesheet.

## Options rejected

- **Restyle each screen separately.** Cheaper first, but the 70 hand-built sections would drift again and every screen would keep its own state words.
- **A new client component with its own storage for the remembered state.** Remembering across visits would need a new storage scheme (cookie or local storage per person); the brief asked to reuse StickyDetails, and the kit stays server-safe.
- **The status picture inside `summary` with `stopPropagation`.** Nested interactive content, unreliable on screen readers; a click guard treats the symptom.
- **Colour-only status dots.** Fail for people who do not see the colour difference.
- **A guard that hard-codes one screen's selectors (as WAL0's spec does).** Not reusable; WAL0's and the journey screens' helpers may import the shared one later.

## The U1b split (Guardian decision)

Wallet U1 is split. U1a (this ADR) is the section, the pictures, the count-down and the guard on fixture-mounted screens and public pages. U1b is a later unit: a made-up CI test user that signs in to real pages, which needs its own auth design; it then points `runLayoutGuards` at every signed-in route. U1a builds no sign-in path, test identity, auth adapter or database seeding.

## Consequences

- Later Wallet units become swaps: a screen moves onto `ExpandableSection` and `StatusPicture`, and its file's fold count goes down.
- No new names enter the interface (the six names already exist in the shared map); six new sentences do, listed for the Bengali list in `docs/upgrades/programme/wal/WAL1-records.md`.
- The PR browser workflow must list `wallet/` for the spec to run on pull requests (`.github/workflows/pr-browser-checks.yml`).

## Rollback

Revert the WAL1 PR. Nothing on screen uses the new pieces yet, no data or setting changes, and the ratchet baseline returns with the revert.
