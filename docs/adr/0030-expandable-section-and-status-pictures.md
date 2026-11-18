# ADR-0030: One Expandable Section, one status language, one layout guard

- **Status:** Accepted, 18 November 2026
- **Date:** 2026-11-18
- **Deciders:** Owner (Wallet upgrade, 17 November 2026), Guardian 9 (scope split)
- **Unit:** WAL1, Wallet upgrade U1a (Foundation)
- **Builds on:** ADR 0023 (Calm Core With Depths), ADR 0027 (visual depth, not used here: the section and the pictures are flat)

## Context

About 70 hand-built open-and-close sections exist across 45 files, plus five shared ones (`Disclosure` in `components/ui.tsx`, `AboutDisclosure`, `CollapsibleGroup`, `StickyDetails`, the case section fold). None has a picture slot or a status slot, so every opened section reads as a plain form, and each screen spells its states in its own text chips. Defect 1 of the Wallet board (the Add button painted over the open document sheet on a phone) shipped because no check rendered that screen at phone width and pressed its controls.

Owner decision, 17 November 2026 (exact words): "I agree with the rest, your recommended options". This covers the Foundation unit as recommended on the Wallet board: One Expandable Section, One Guard. Rules for every Wallet unit: no database change, no new switch, Title Case, 44 px targets, the Explain rule (a name plus one plain sentence on hover, focus or tap; Escape closes), reduced motion shows the finished state, brand tokens only, truthful words (Received is not Reviewed, Suggested is not Confirmed, Saved is not Shared). Traveller screens first; admin and staff screens stay flat.

## Decision

### 1. Expandable Section

`apps/web/src/components/ui-lift/expandable-section.tsx` is the one open-and-close section.

- Closed row: picture slot, name (a heading, level 2 to 6, default 3), one-line summary slot, status slot, chevron. Open: the content below with the same padding everywhere.
- Built on the browser's own `details` and `summary`: it works before the script loads and with script switched off, Enter and Space toggle it, find-in-page opens it.
- The row is at least 56 px; picture, status and chevron are 44 px and pinned to the top of the row, so a summary that wraps (long English, longer Bangla) moves nothing.
- The status picture is drawn beside the toggle in a reserved column, never inside `summary`. A button inside a summary is nested interactive content (a screen reader reads the whole row as one button and may not reach the inner one) and its press can toggle the section. Outside, both problems cannot happen, so no `stopPropagation` is needed.
- It is a server component, like the rest of the `ui-lift` kit (its guard forbids client code). With `remember` the open-and-close state is held by the existing `StickyDetails` island (a server refresh after a save never closes a section over the result the person still needs); no new storage is introduced. Without `remember` the section follows `defaultOpen`. Server and browser draw the same first state, so nothing flashes.
- Reduced motion: the chevron shows its finished position; it turns gradually only without reduced motion. Styles are one block at the end of `globals.css` starting `/* WP-WAL1`.
- The existing shared folds and their call sites are unchanged in this unit; later Wallet units swap screens onto the section.

### 2. One status language: six status pictures

`apps/web/src/components/pictures/status-picture.tsx` draws six small flat pictures; their names and sentences live in ONE typed record, `status-picture-words.ts` (`STATUS_MEANINGS`), read by screens, the Explain note and the Bengali word list.

| Name | Ring (reads without colour) | Mark | Tone token |
|---|---|---|---|
| Added | thin solid | dot | brand |
| Backed by a Document | thick solid | page | success |
| Suggested | long dashes | spark | brand |
| Sensitive | two rings | closed eye | warning |
| Needs Fix | short dashes | exclamation mark | danger |
| Not Current | dots | clock | tertiary text |

Each picture is wrapped in the existing `ExplainTip` (a 44 px button named by the status, described by its sentence, opened by hover, focus or tap, closed by Escape). The sentences never claim more than VisaStack knows: Backed by a Document says that alone it does not mean anyone has checked it; Suggested says it is not saved until the person confirms it. A unit test fails on words such as verified, approved or valid. A key of the pictures uses the shared `status-picture-key` list: every item is a full 44 px row, because the Explain button's negative margin (it lets a 44 px target sit inside a line of text) makes stacked buttons overlap; the layout guard found this on its first run.

### 3. The raw details count-down

`scripts/ui-ratchet.mjs` has a fourth counter: raw `<details>` elements per file in `apps/web/src` (test files excluded; `expandable-section.tsx` is the one file allowed to hold one). The starting point (108 in 72 files on main `70b8940`) is in `scripts/ui-ratchet.baseline.json`. A file may only go down; a new file may hold none. `node scripts/ui-ratchet.mjs --lower` records a reduction. When main adds a details element while a branch is open, the merge turn either lowers the baseline with `--lower` or raises one file's number in a reviewed edit with its reason.

### 4. The layout guard

`apps/web/e2e/support/layout-guards.ts` holds two checks any page can run, at 390, 400 and 1280 px (`GUARD_SIZES`): no sideways scroll, and nothing painted over a control (each visible button, button-styled link, field, select, text area and summary is scrolled to the middle and hit-tested with `elementFromPoint`; a summary at its centre only). A failure names the control and what covers it. `runLayoutGuards(page, open)` takes any way of opening a page, so the same check serves fixture screens now and signed-in routes later. `e2e/wallet/u1-foundation.spec.ts` runs it on the WAL1 fixture and the public pages, and includes self-tests that prove each guard fails on a broken page.

## Options rejected

- **Restyle each screen separately.** Cheaper first, but the 70 hand-built sections would drift again and every screen would keep its own state words.
- **A new client component with its own storage for the remembered state.** Remembering across visits would need a new storage scheme (cookie or local storage per person); the brief asked to reuse StickyDetails, and the kit stays server-safe.
- **The status picture inside `summary` with `stopPropagation`.** Nested interactive content, unreliable on screen readers; a click guard treats the symptom.
- **Colour-only status dots.** Fail for people who do not see the colour difference.
- **A guard that hard-codes one screen's selectors (as WAL0's spec does).** Not reusable; WAL0's and the journey screens' helpers may import the shared one later.

## The U1b split (Guardian decision)

Wallet U1 is split. U1a (this ADR) is the section, the pictures, the count-down and the guard on fixture-mounted screens and public pages. U1b is a later unit: a made-up CI test user that signs in to real pages, which needs its own auth design; it then points `runLayoutGuards` at every signed-in route. U1a builds no sign-in path, test identity, auth adapter or database seeding.

## Consequences

- Later Wallet units become swaps: a screen moves onto `ExpandableSection` and `StatusPicture`, and its file's details count goes down.
- New words enter the interface (the six names and sentences); they are listed for the Bengali list in `docs/upgrades/programme/wal/WAL1-records.md`.
- The PR browser workflow must list `wallet/` for the spec to run on pull requests (`.github/workflows/pr-browser-checks.yml`).

## Rollback

Revert the WAL1 PR. Nothing on screen uses the new pieces yet, no data or setting changes, and the ratchet baseline returns with the revert.
