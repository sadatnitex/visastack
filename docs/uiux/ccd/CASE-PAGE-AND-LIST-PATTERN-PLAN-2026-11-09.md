# Case page and one list pattern across the product: plan (9 Nov 2026)

Status: **approved by the owner on 9 Nov 2026 ("Recommended" on every decision below). Nothing is built yet.** This was written after a design pass over the code, the owner's screenshots of the live case page, and a mockup (`mockups/case-page-proposal-2026-11-09.html`, open it in a browser at laptop and phone width). Paths are under `apps/web/src` unless stated. `M` means `app/app/mission/[id]`.

Owner's direction, in their words: the case page looks "cluttered, confusing and disturbing". Even Everything "should never feel too much". It should be "sophisticated and most relatable" for Bangladeshi travellers, "like how they do in Drive and Dropbox", and "consistent everywhere".

## 1. Decisions (all approved)

1. Phone: the item panel is **full screen** (Back and Esc close it, no dimmed backdrop, because translucent surfaces are not allowed).
2. A group **Does Not Apply** is a fifth fold, hidden when empty.
3. A row another option already covers goes in **On File**, labelled "Covered by Another Option".
4. Provenance wording when no agency has access: **"Added by an Agency"**. "Requested by Your Agency" stays only while an agency has access.
5. Plain words (add to `docs/uiux/ccd/VOCABULARY.md`, and the tests that read it): Snapshot becomes **Saved Copy**; Freshness Check becomes **Is This Still Up to Date?**; Trip Package becomes **Your Package** (it was an owner-approved term, now changed by the owner); Readiness in the jump nav becomes **How Complete**.
6. Chip words: keep the specific word (Missing, Out of Date, To Confirm, Optional, On File); the group is the folder header.
7. The 7-stage tracker, About Stages and Advance the Case: Everything-only while the case is self-reviewed (no agency has access); Browse when an agency does. **Never removed.**
8. "Files for This Item" heading for the two stored choices (package choice and evidence selection) is a Phase 3 matter: confirm the wording then, so it does not blur "counts toward readiness" and "goes in the handoff".
9. Adding a brand-new file is on the **Documents** page, not the case page. The panel's Add button links there, and also lets the person choose among files already on file.
10. Icons: `DESIGN-LANGUAGE.md` forbids "an icon on every item". Approved rule: the row's leading mark is the existing **status glyph**, no tile; a **file-kind icon only on the Documents list**. (The mockup shows a kind icon on every row; build to this rule, not to the mockup.)
11. Staff screens (Pack Studio and other admin screens) stay "naming and H1 only" and join the pattern **last**, if at all.
12. Screenshots: saved as review artifacts first, not committed pixel baselines.
13. Home and Trips: rows without a panel.

## 2. What was found (verified in code on 9 Nov 2026)

1. **The case page is only ever shown to the case owner.** `M/page.tsx:184` uses `getMissionForOwner`; anyone else gets `notFound()`. So the stage tracker, Advance the Case, Snapshots and Contributors are the traveller's own functions that use agency words, not agency-only controls. The only signal is `selfReviewed` (about `page.tsx:463`): no ACTIVE organisation grant reaches the case. Hiding by it is a pure display change that fails open, and must not hide data that exists (notes already shared).
2. **"Requested by Your Agency" comes from `M/package-panel.tsx:186`**, which prints `PROVENANCE_LABELS[item.provenance]` for every non-official item. Root cause: `packages/services/src/starter-packs.ts:253` stamps every starter requirement `AGENCY_ADDED`. Fix in the display only: `page.tsx` already computes `starterPack` (about line 382); pass it to the package panel. **Do not touch `PROVENANCE_LABELS` in core** (agency collect pages use it) and do not change `starter-packs.ts` or any published version.
3. **The "Other twice", "Nid", "Noc" names come from `package-panel.tsx`'s own `itemName()`**, which uses `humanizeCode(key)`. The checklist uses `requirementLabel()`, which prefers the starter sentence. There is a **third copy of every item**: the Select Evidence panel (`M/case-secondary.tsx`, Everything), also named by `humanizeCode`.
4. **The two time-zone lists are not in the server HTML.** `components/time-zone-select.tsx` draws 14 common zones on the server, then builds about 420 options and about 420 `Intl` formats after mount, once per select, on every page load, even inside closed folds. The selects are in `M/collaboration-panels.tsx` (Tasks about line 186, Appointments about line 326); the agency page reuses the component.
5. **The scroll budget never saw the problem.** `M/case-page-html.test.tsx` feeds the real page to WP-SB2 with `getCasePackage` returning `ok(null)` (about line 199), so Trip Package is absent, and it measures Glance only. Everything with a 19-item list is unmeasured.
6. **"Done 17" is wrong.** `lib/requirement-groups.ts` puts SATISFIED, ATTENTION (label "Optional") and NOT_APPLICABLE in Done. A starter list has mostly optional items with nothing uploaded, so "Done 17" held 1 item on file.
7. The jump nav has up to 8 anchors; most point at blocks hidden at Glance, so a click silently raises the depth (ADR 0023 section 4).
8. Most of the other clutter is the Everything depth. Complaint, Feedback, Outcome, Snapshots and Itinerary are Everything-only and folded; the tracker, attention list, rail and Advance the Case are Browse. At the default depth the problems are: the header speaks of "the traveller" to the traveller; a Snapshot button and the jump nav sit above the work; Done counts optional items; three layers of folds per row; the main job (add a file) links to `#evidence`, which lives at Everything; three overlapping progress statements.

## 3. Depths today

Blocks with no `data-level` show at every depth. "auto" means Glance on every width (ADR 0023 addendum, 6 Nov 2026).

- **Glance:** header (title, state line, Case Reference, "Traveller has not confirmed yet"), buttons Add Evidence, Start a New Case from This One, Take a Snapshot (desktop; a phone folds them into More), the depth switch, welcome note, changed-case alert, Next Step, Evidence Progress, About This Case, the 8-link jump nav, the checklist (Needs You, Needs a Check, Done; first 3 rows each; every row has a More About This Item fold), expiring documents, the sticky phone Next Step bar.
- **Browse adds:** self-reviewed note, attention list, 7-step tracker with About Stages, the whole Trip Package card, the rail (Case Details, Trip Date Checks, Requirement Pack, Advance the Case), More for This Case (Tasks, Appointments and Letters; Contributors and Notes from Your Agency).
- **Everything adds:** Snapshots, Itinerary Reference, Select or Update Evidence, Submission and Outcome, Problems and Feedback.

## 4. Target structure

**Mechanism: one list, one panel, everything still in the HTML.** Reuse the Documents shell (`components/document-wallet-browser.tsx`, about lines 96 to 170 and 388 to 440: `sheetOpen`, `useMediaQuery(DEPTH_PHONE_QUERY)`, `closeSheet`, `data-sheet`). Two modes: `selected` (only the chosen item's pane is drawn, as Documents does) and `all` (every pane is in the HTML, unselected ones carry the `hidden` attribute). The `hidden` attribute matters: the 30-word counter (`lib/prose-budget.test-support.ts`) skips `hidden`, `aria-hidden` and closed `<details>`, but **not** CSS-hidden blocks. With script, selection is client state initialised from `?item=<id>` so the server draws the right pane at once; without script, an `?item=<id>` link reloads with that pane visible and a `<noscript>` rule shows all panes (precedent: `.depth-nojs`). Keep CSS `:target` only as a fallback. The panel takes the rail's column on desktop (no third column); full screen on a phone; the sticky Next Step bar hides while a panel is open.

**Order, Glance on a phone:** quiet header (case name, one line like "Japan, In Progress, C-REF", Add Evidence, More); Next Step (the one filled button); Evidence Progress ("x of y required on file"); the grouped list (Needs You open, Needs a Check, Optional, On File); each row a status glyph, a name cut to 12 words or fewer (marked `data-value`, ending with an ellipsis, so long starter sentences stay out of the 30-word count), a chip, one action.
**Browse adds:** Trip Date Checks, Case Details and Requirement Pack as rail cards; Start a New Case and Take a Snapshot in the header; a section switcher with Tasks and Letters, Notes.
**Everything adds:** switcher entries Select Evidence, Snapshots, Submission and Outcome, Problems and Feedback, Family Trip; the tracker, About Stages and Advance the Case when self-reviewed.

**The item panel carries** (props the page already computes): the full sentence (starter `wording`), "For:" (`appliesWhen`), the source and View Source, "How to Provide It" format lines, the chosen document, "Any One of These", the booking reminder, the unreachable-source badge, the package choice (Use This File, Leave Missing, Leave Out, Go Back to the Suggested Copy; the reason box is revealed only after Leave Out is picked, and the input stays in the DOM but `hidden` so nothing is lost; `package-forms.tsx` already controls the select value), Edit Wording, Suggest a Correction, Explain with AI, and the old "Provide Evidence" link to `#evidence`.
**Trip Package after de-duplication:** one summary card (phrase badge, reasons, change note, questions, Freshness Check, Outside VisaStack, handoff, latest-handoff line). The per-item list "What This Package Uses" is removed. Look panel items up by `packRequirementId`; any package item without a checklist row (a safety net, it should never occur) is drawn below the list.
**Two different stored choices stay separate:** the package choice (`recordPackageChoiceAction`, what goes in the handoff) and evidence selection (`selectEvidenceAction`, what counts for readiness). Keep both server actions unchanged. Phase 1 puts only the package choice in the panel; Phase 3 moves per-item Select and Remove into it.
**Names:** use `requirementLabel()` everywhere. Add a document-kind label lookup (catalogue labels where they exist, `CATALOGUE_DOCUMENTS`, then `humanizeCode`) and a small acronym table ("National ID", "No Objection Certificate (NOC)").

## 5. The grouping fix (edit `lib/requirement-groups.ts`, the only definition; `buildChecklistGroups` in `M/case-model.ts` reads it)

| Group | States |
|---|---|
| Needs You | CRITICAL_GAP, CONFLICTING, EXPIRING_STALE |
| Needs a Check | UNVERIFIED |
| Optional | ATTENTION |
| On File | SATISFIED |
| Does Not Apply | NOT_APPLICABLE (fifth fold, hidden when empty) |

- Group ids come from the heading text: `case-checklist-done` goes away; `-optional` and `-on-file` are new. Nothing links to `-done`; only `-needs-you` and `-needs-a-check` are used (`case-model.ts`, mobile bar).
- ATTENTION also holds rows another option already covers (`coveredByAlternative`, `packages/services/src/missions.ts` about line 1186): put those in On File with the existing "met by an alternative" text, labelled "Covered by Another Option".
- Open rule: open the first of Needs You or Needs a Check; if neither exists, open On File and leave Optional closed.
- Effect: "Done 17" becomes "On File 1, Optional 16". Evidence Progress, the Next Step and the attention list read readiness and `requiredHardGapCount` / `requiredUnverifiedCount`, never the groups, so **readiness does not change**. Group counts are rows; "How This Is Counted" counts items.
- Guards touched: `lib/requirement-groups.test.ts`; `M/page.test.tsx` (about line 1019, "Done 30"); `M/case-structure.test.tsx` (about lines 348 and 422); `M/case-model.test.ts`; `lib/ccd/approved-changes.ts` (add heading `Done 1` to `On File 1` for the `case` screen, baseline about lines 491, 832, 1155); `docs/uiux/ccd/PARITY-LEDGER.md`.

## 6. Time-zone lists

Build the full grouped list once per page in a module-level memo shared by every select, and only when a select is actually on screen: an `IntersectionObserver` with a 200px margin never fires for `display:none` content or a closed `<details>`; fall back to building on `focus` or `pointerdown` if it is missing. Do not swap options while the native picker is opening. Set the default from `deviceTimeZone()` at once, without the list; if it is not one of the 14 common zones, add that single option. Keep the "reset after save" behaviour. Update the test "offers every zone" to focus or scroll first. Result: about 840 options and 840 formats per load become none until needed.

## 7. Ranked change list for the case page

| # | Change | Files | Risk | Guards |
|---|---|---|---|---|
| 1 | Give the worst-case page test `getCasePackage` data; add an Everything-depth budget; assert 19-item totals | `M/case-page-html.test.tsx`, `e2e/scroll-budget/WP-SB2.spec.ts` | Low | SB2 goes red first, by design |
| 2 | Time zones built only when on screen (section 6) | `components/time-zone-select.tsx` and its test | Low to medium | `time-zone-select.test.tsx`, a11y-forms |
| 3 | Provenance label: starter gives STARTER_BADGE; AGENCY_ADDED while self-reviewed reads "Added by an Agency"; one helper replaces both uses | `package-panel.tsx`, `case-checklist.tsx`, `lib/pack-labels.ts` | Low | vocabulary, title-case |
| 4 | Header in the second person ("You have not confirmed this case yet"; "Your confirmation:"); Start a New Case and Snapshot in the header become `data-level=browse` but stay in the DOM and in More | `page.tsx`, `case-status-panel.tsx`, `case-more-menu.tsx`, `.case-header-wide` CSS | Low | parity (approved-changes); `CaseMoreMenu` is stubbed in `parity-case.test.tsx`, so header links must stay in the DOM |
| 5 | Jump nav limited to links whose target is visible at the current level | `page.tsx` | Low | parity (links stay, tagged with their target's level) |
| 6 | Regroup (section 5) | files above | Low | parity rename, 30-word |
| 7 | Rows and item panel (Phase 1) | `components/ui-lift/checklist-row.tsx` (only used by `case-checklist.tsx` and its test), `case-checklist.tsx`, new `case-item-pane.tsx`, `package-panel.tsx`, `package-forms.tsx`, `page.tsx` | Medium | parity: the "Provide Evidence" link keeps its text, name and `#evidence` target (baseline about lines 476 to 481); row action "Add" via approved-changes; 30-word (panes `hidden`); a11y-forms (same registered components, only moved); heading order (`headingProblems`); scroll budget |
| 8 | Tracker, About Stages, Advance the Case levelled by `selfReviewed` | `page.tsx`, `case-status-panel.tsx`, `case-rail.tsx` | Low | parity unaffected (levels are not inventoried) |
| 9 | Split "Contributors and Notes from Your Agency": Ask a Contributor (a traveller feature) stays Browse; Notes from Your Agency at Browse only if notes exist or an agency has access | `case-secondary.tsx` | Low | parity (renamed heading in approved-changes) |
| 10 | Section switcher (tablist, one panel visible, hash link opens its section like `open-fold-on-link.tsx`) | `case-secondary.tsx`, new `section-switcher.tsx` | Medium | parity, a11y tablist |
| 11 | Sticky filter and search above about 8 items (appears only after mount) | new `ListFilterBar` | Medium | a11y-forms must register the input |
| 12 | Plain wording pairs (decision 5) | many | Medium | `VOCABULARY.md`, vocabulary and title-case tests, parity |

## 8. One pattern across the product

Documents already is a list plus a side panel that becomes a full screen on a phone. Extract that into a shared kit and reuse it. New folder `components/list-pattern/` (beside `ui-lift/`); reuse the `lift-` classes in `app/globals.css`; no new design language.

| Piece | Server or client | Replaces or wraps |
|---|---|---|
| `ListRow`: status glyph, name, optional one-line meta, `StatusPill` chip, at most one primary action, optional link that opens the panel | Server | `ui-lift/checklist-row.tsx` (becomes a thin wrapper, then removed); hand-built rows on Documents, Evidence, Sharing, agency lists |
| `GroupedList`: folding groups with Title Case headers and counts, "n More Items" fold, stable group ids | Server | `components/collapsible-group.tsx` plus `OpenGroupOnLink`; the details blocks in `case-checklist.tsx`; "Ended Access" and "Pending Invitations" folds |
| `ListWithPane` + `DetailPane`: selection, side panel on desktop, full-screen `role=dialog` on a phone, Esc, focus returns to the row, body scroll lock, close removes the selection param from the address | Client | Extracted from `DocumentWalletBrowser` |
| Quiet header: title, one status line, one primary, More menu | Server and client | Extend `PageHeader` in `components/ui.tsx` with `status` and `more` slots; generalise `case-more-menu.tsx` to `components/more-menu.tsx` |
| `SectionSwitcher` | Client | The stacked `MoreItem` rows in `case-secondary.tsx`; Sharing and Profile area lists |
| One empty state, one plain sentence | Server | Merge `ui-lift/empty-panel.tsx` and `EmptyState` in `components/ui.tsx` |
| `ListFilterBar`: search plus chips, only above about 8 rows, after mount | Client | Inline filter state in `document-wallet-browser.tsx`; filter tiles; Access Log filters |

The page-level depth switch (`components/depth-switch.tsx`) is unchanged. Panels and sections register their ids with its reveal logic (`lib/ccd/reveal.ts`) so links never land on hidden content.

| Screen | The list | Opens in the panel | Phase |
|---|---|---|---|
| Documents (PDF 06) | Documents, with filters and search | The selected document (preview, kind and date forms, findings, re-checks); Add a Document form | 2 |
| Case page (PDF 07) | Evidence checklist | The item (section 4) | 1 and 3 |
| Evidence requests (traveller) | Requests, waiting first, then Finished | The request: reply form, choices, Ask About This Item | 4 |
| Sharing (PDF 08) | Active grants and Ended Access | Grant detail (scope, Access Log, Pause, Resume, Revoke) and the grant composer; the revoke warning stays visible at every level | 5 |
| Home, Traveller overview (PDF 04), Cases list, Notifications, Trips, Account, Privacy | Rows | Nothing; a row opens its screen (quiet header only on Account and Privacy) | 6 |
| Agency Overview (PDF 09), Clients, Cases, document requests, Checklists | Clients, cases, requests | Decisions and case details; `#mission-<id>` anchor (`open-case-from-link.tsx`) must keep working | 7 |
| Profile (PDF 05) | Areas, then facts | One fact's editor and history (largest rebuild; versioned-fact forms keep their names) | 8 |
| Admin Pack Studio | Packs, versions, requirements | Rule detail | 9 (only if the owner says so) |

Reference compositions: `docs/uiux/PDF-TO-FUNCTION-MAPPING.md` rows 04 to 10 and `docs/uiux/ccd/PARITY-LEDGER.md`. Per the ledger, all converted screens are "built and tested, not seen live".

**Tokens and rules** (already in `docs/uiux/TOKENS-AND-COMPONENTS.md`, `DESIGN-LANGUAGE.md`, `DESIGN-CONTRACT.md`): the palette; radii 10, 16, 22; spacing 4, 8, 12, 16, 24, 32, 48, 64; 44px targets; type scale 12, 14, 16, 18, 24, 28, 32 (14 for controls, 16 for list rows, 18 for card titles); one icon set; six tones (green, amber, red are states; blue, violet, teal are kinds); flat (no shadow, gradient, glass or translucent surface); one filled primary per page. **To write into `TOKENS-AND-COMPONENTS.md`:** row minimum height 56px on every width, one line of name (clamped), at most one meta line; panel width 360 to 400px on desktop, full screen on a phone, 1px border, no shadow; the group header style; a single chip vocabulary in a new `lib/status-words.ts` mapping state to Title Case word and tone (Needs You red, Needs a Check amber, Optional neutral, On File green, Received blue and never green); button hierarchy (the page's one filled button is the Next Step; a row action is a secondary 14px button 44px high; the panel's save is secondary unless it is the page's only primary).
**Guards that enforce it:** `scripts/check-flat-design.mjs`; `scripts/ui-ratchet.mjs` (new components must have zero inline styles, raw codes, long dashes); `lib/title-case.test.ts`; `lib/vocabulary.test.ts` ("case", never "mission"); `lib/a11y-forms.test.tsx` (register any new form or input), `a11y-signed-in.test.tsx`, `a11y-pages.test.tsx`; `e2e/type-scale.spec.ts`; `lib/tone-contrast.test.ts`, `lib/palette-contrast.test.ts`; copy the CSS test pattern of `lib/wallet-sheet-css.test.ts` for the new row and panel CSS; `lib/ccd` parity, the 30-word rule, the WP-SB scroll budget.

## 9. Rollout (each package shippable alone with every guard green; no database change anywhere)

| # | Package | What it does | Size |
|---|---|---|---|
| 0 | Measure and cheap fixes | Change 1 first (so the budget goes red for the right reason), then 2, 3, 4, 5. No layout change | 1.5 days |
| 1 | Shared kit plus the case checklist | Kit and the conformance test (section 10); copy the Documents shell behaviour, do not edit Documents yet; regroup; rows; panel; package choice moves into the panel; Trip Package becomes its summary; item names fixed. Update `package-panel.test.tsx`, `case-checklist-wording.test.tsx`, `case-structure.test.tsx`, `page.test.tsx`. New: one Playwright test (open, close, Esc, Back, deep link, phone and desktop); add the case page to `e2e/signed-in/responsive-a11y.spec.ts` | 6 to 7 days |
| 2 | Documents | Repoint `DocumentWalletBrowser` to the kit and delete the copy; filters to `ListFilterBar`. The wallet tests (`document-wallet-browser*.test.tsx`, `parity-documents.test.tsx`) prove no change | 3 days |
| 3 | Case page finish | Quiet header, tracker levelled by `selfReviewed`, Contributors split, section switcher, Select Evidence into the panel (its shared `useActionState` needs splitting), sticky filter | 5 days |
| 4 | Evidence requests | Traveller screen first, then the agency side | 4 days |
| 5 | Sharing | Grants as rows, composer in the panel | 3 days |
| 6 | Rows-only screens | Home, Traveller overview, Cases, Notifications, Trips, Account, Privacy | 4 days |
| 7 | Agency console | Overview, Clients, Cases, document requests, Checklists | 6 days |
| 8 | Profile | Facts as rows, editor in the panel | 5 days |
| 9 | Admin Pack Studio | Only if the owner includes staff screens | 5 days |

Only packages 0 and 1 carry real regression risk. Package 1 renders one hidden panel per item, so hydration cost (about 19 panels with a few small forms each) must be measured; if it is heavy, hydrate-on-open is the fallback, but it breaks "the server renders everything" for that block, so **ask the owner first**.

**Must not change in any package:** access gates (`getMissionForOwner`, `ownedMission`, `requireAccess`, `grantReachesCase`, every owner-scoped read; no new data read); readiness (`computeReadiness`, `requiredCount`, `satisfiedRequired`, the attention counts); published pack versions, their pins and starter-list data; server actions (names, signatures, FormData field names; forms are moved, not rewritten); anchors that emails and notifications use (`#mission-<id>`, `?document=`, `#evidence`, `#work`, `#notes`) and the depth cookie `vs_depth`.

## 10. How consistency is proved

1. A registry `lib/ccd/pattern-registry.ts` lists every signed-in screen as `list+pane`, `list`, `cards` or `exempt(reason)`, and `lib/ccd/pattern-conformance.test.tsx` has three parts. **Static:** an AST scan (the `typescript` approach of `scripts/ui-ratchet.mjs`) fails if a screen listed as `list` or `list+pane` does not import from `components/list-pattern`, or hand-builds a `<table>` or `className="row"` list in a converted screen unless exempt; the exemption count is held in a baseline JSON that can only go down. **Rendered:** reuse the states `registerParity` already renders; assert every `[data-pattern="list-row"]` has at most one primary action and a chip word from `lib/status-words.ts`, and group headings are Title Case; for pane screens assert `[data-pattern="detail-pane"]` has a heading and a back control. **CSS:** `lib/list-pattern-css.test.ts` asserts row min-height 56px, 44px targets, no shadow.
2. A browser check at 390 and 1440 wide, `e2e/pattern/pattern-screens.spec.ts`, using the fixture approach of `e2e/journey-screens/support.ts` and `scroll-budget/support.ts` (`renderFixture`): rows equal height, every action target at least 44px, nothing scrolls sideways, a panel opens, closes on Esc and returns focus, axe passes. Screenshots go to `docs/uiux/evidence/pattern/<screen>-<phone|desktop>.png` as review artifacts. Honest limit: these are fixture renders, not live signed-in acceptance (seven authenticated screens are still blocked on verified isolated fixtures).


## Update, 10 Nov 2026: decision 10 (icons) is superseded by the owner

Owner, 10 Nov 2026, approving the visual language "better aligned with our color theme": things "talk loudly ... like flags". Decision 10 above (status glyph only, no tile, a file-kind icon only on the Documents list) is replaced by: the row's leading mark is the kind of item in a soft tone tile, the status shows in the chip with its own symbol, countries are flags, and every symbol comes from one map (`lib/item-icons.ts`). The row stays 56px minimum. See `docs/uiux/TOKENS-AND-COMPONENTS.md`, "The visual language: things talk loudly".
