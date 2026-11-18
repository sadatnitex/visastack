# WAL4 records: Profile Passport Page Card and value rows

Unit WAL4 (Wallet upgrade U4: Profile), Class A (personal data), FULL route. Branch claude/wal4-profile-passport-card, from main 11e63a9. Owner decision 17 Nov 2026: "Profile fields: A Value Rows And Sheet ... / B Passport Page Card ... - B". Builds on WAL1 (#631, ADR 0030) and WALD2 (#625). Presentation only: no service, policy, encryption, database or route change. Example data only.

## What changed

| Where | Change |
|---|---|
| `[id]/passport-page-card.tsx` (new) | `PassportPageCard`: a flat, schematic passport data page (a band, an emblem ring, a blank portrait outline and a chevron strip where a machine-readable zone sits; never a photo, a seal or a real document image) with eleven printed lines: Family Name, Given Name, Nationality, Date of Birth, Sex, Place of Birth, Passport Number, Issuing Country, Date of Issue, Date of Expiry, Marital Status. The drawing is decorative (`aria-hidden`); the lines are HTML, so they wrap, reflow and take 44 px targets. It says "Drawn from the details in your profile, not read from the passport itself. This does not verify identity." It holds no form and no box. |
| `[id]/profile-editor.tsx` | The card sits at the top of the editor (hidden while searching). Each line is worked out from the profile's own `ProfileValue`: a value; a protected value masked until Show; a value saved but not opened here (WALD2 `locked`, or a stand-in that slipped through) shows the existing words ("Protected detail", "Could not read this detail", "Needs to be added again"), never "[protected]", and gets no Show; Does Not Apply; No Longer Current; or "Not Added Yet" with Add. A tap on a line (or Add) opens that detail's own edit row: it switches to the area that holds it, opens the row, scrolls to it and focuses its box. In Essentials First a tap on an essential goes to its own box. Each line is a link (`#profile-row-<key>`, `#f-<key>` in Essentials First, or `?view=all#profile-row-<key>`), so it points somewhere real before any script. |
| `[id]/profile-editor.tsx`, SectionFields | The read summary list and the "Edit These Details" fold are replaced by one value row per single detail: an Expandable Section with the detail's name, its value (protected values as dots), one status picture (the stored code through `StatusPicture`, only for the six codes it knows) and, when open, the unchanged `SingleField` (Save, Add the Date This Became True, Where This Came From, How This Was Checked, No Longer Current, This Does Not Apply to Me). The eleven passport details keep their own rows too, so each detail has exactly one edit home and one box id. Rows open while searching, as the fold did. |
| `[id]/profile-editor.tsx`, `openFirstSection` | Add Information now opens the first value row of the area on screen and focuses its box (it used to look for the removed fold). |
| `globals.css`, new block "WP-WAL4" (end of file) | Card, sheet, lines, drawing colours and the value-row list spacing. Brand tokens only, flat, no motion, forced-colours rule, phone layout below 561 px. |
| `[id]/profile-editor.test.tsx` | Two selectors moved from `.profile-read-summary` to the value row summary (same assertions). |
| `[id]/passport-page-card.test.tsx` (new), `e2e/fixtures/wal4-profile.fixture.tsx` (new), `e2e/wallet/u4-profile.spec.ts` (new) | Tests below. The spec runs in pull requests through the existing `wallet/` entry in pr-browser-checks.yml. |

## Protected values

- Masked: `date_of_birth` and `passport_number` always, and any detail whose catalogue sensitivity is not STANDARD. The mask is a fixed run of dots, so it says nothing about the length.
- The unmasked value is never put into the drawing, a label, a title or a tooltip. Show (a toggle button, `aria-pressed`) prints it on the line; Hide masks it again. One detail at a time.
- Value rows mask the same details in their summary line.
- Not changed, said plainly: the editor already receives the opened value from the page (WALD2) and puts it in the detail's edit box, which is in the page markup inside the closed row. That is exactly as before this unit. Masking is about what is shown on screen, not about what the browser holds.

## Sensitive marker (deferred to WAL4 by WAL1)

`docs/uiux/ccd/VOCABULARY.md` has no word for a Sensitive marker, so none was added. The existing protected-value wording is used: dots with Show, and "Protected detail" / "Could not read this detail" / "Needs to be added again" for values not opened here. The existing Sensitive and Restricted badges inside the edit row are unchanged. A Sensitive status picture needs its word in VOCABULARY.md first (owner or design lane).

## New visible words for the localization list (English only in this unit)

The card's words are inline English, as the editor's other state words already are (`essentialStatus`, `displayValue`, the lock hints). Bengali drafts were not edited.

- Passport Page
- Drawn from the details in your profile, not read from the passport itself. This does not verify identity.
- Not Added Yet (already used by Essentials First)
- Add
- Show, Hide (button names read with the detail, for example "Show Passport Number")
- Hidden (screen readers only, in place of the dots)
- ". Edit <detail>" (screen readers only, after a printed value)
- Fallback names, only when a view does not list the detail: Issuing Country, Date of Issue, Date of Expiry (the others match the catalogue's names)

Reused through the catalogue: Does not apply, Other: <text>, Needs Review.

## Red then green

Red first, against main's `profile-editor.tsx` (backed up with cp, main's copy put in place, then restored):

- `[id]/passport-page-card.test.tsx`: 14 failed, 1 passed. The one that passed on main is "is hidden while searching" (main has no card at all, so it holds trivially; it guards the hide).

Each new guard proven red by breaking the real code once (backed up with cp, restored, green again):

- Mask: `isMaskedDetail` made to return false: "masks protected values until Show" failed (1 failed, 14 passed).
- Add Information: `openFirstSection` put back on the old fold selector: "Add Information opens the first row" failed.
- Found by the existing accessibility guard on the first run and fixed in this unit: in Essentials First the card's links pointed at rows not on the page (dangling links). They now point at the essential's own box, or at the full list.

Green: see the READY message for the full run.

## Not verified

- Signed-in pages with real data: the specs render the real editor in a fixture (U1b brings a CI test user).
- Safari and Firefox (only Chromium was run).
- VoiceOver and NVDA reading of the card lines.
- Forced-colours mode in a real browser (rule written, not run).
- Bengali wording of the new words (listed above).
- A `#profile-row-<key>` link opened without script lands on the closed row; the person taps it to open (a native fold has no open-on-link behaviour without script).
- The ui-ratchet baseline was not lowered: lowering changes the pinned totals in `scripts/ui-ratchet.test.mjs`, outside this manifest. The ratchet passes with this unit's counts below the baseline (folds 193 of 194).

## Rollback

Revert the PR. No database change, no data change, no new switch.
