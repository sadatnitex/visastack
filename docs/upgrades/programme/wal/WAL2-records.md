# WAL2 records: Document detail and Check What We Found

Unit WAL2 (Wallet upgrade U2), Class A (documents), FULL route. Branch claude/wal2-document-detail. Example data only. Presentation only: no service, policy, database, route or server action change.

Owner decision, 17 Nov 2026: "Document detail: ... Liked both A& B, u do the best." Guardian 9's call: Preview Card First with the Wallet Pass front as the hero card (ADR 0027 dark pass style), no tabs; one-at-a-time review only for Sensitive or conflicting details.

## What changed

| Where | Change |
|---|---|
| components/document-detail/document-hero-card.tsx (new) | The front of the opened document: the drawing of its kind (no stored thumbnails exist, so the drawing always shows; a `preview` slot is ready for a real one), name, kind, last change date, each state (how the file was checked, expiry, processing, safe copy) as a small picture with an Explain note and its word, and the page's own Preview and Download Original buttons. |
| components/document-wallet-browser.tsx | Optional `hero` per document. With it, the hero takes the place of the plain name box; "Preview is blocked" still shows for a file that cannot be opened. Without it, the name box is unchanged (other screens and fixtures). |
| documents/page.tsx | The opened document leads with the hero. The badge row is replaced by the hero's states (the Replaced link stays right after its word). Details and dates move into Expandable Section rows: Dates (Document Date with Save, expiry), Name and Kind (rename, kind), Safe Copy (visa photo sizes, safe copy; only when the file can be opened), Reading and Checks (the short check line, Check the File Again, document type check, text reader result, consistency check), Issuer Confirmations (was a raw fold). Dates opens by itself after a date error, Name and Kind after a kind error. Possible mismatches waiting for a decision stay in view. Every form, action and condition moved unchanged. |
| ai-review.tsx | Check What We Found: a count line ("8 details, 6 clear, 2 to check"), each ordinary detail as one row (name, value, the Suggested status picture) that opens into its full card, Accept on the row for a clear detail, Sensitive and differing details one at a time, the bulk Accept as the last thing in the list (the accept bar). A Sensitive detail's value, quote and source sit inside a closed "Value Found" section until opened. The difference question shows its choices as large tiles (same radio names and values). |
| finding-review-parts.tsx (new) | Row Accept (sends exactly what the card's Accept sends for an unchanged value) and the one-at-a-time view (1 of N, Back, Skip for Now; Skip for Now only moves on and saves nothing; before the script runs every detail is listed). |
| globals.css, new block "WP-WAL2" (end of file) | Layout of the hero, sections, rows, steps, tiles and accept bar. On a phone the accept bar is sticky at the bottom of the open document, above the bottom bar; on wider screens it sits in the flow. Flat, tokens only. |
| pictures-depth.css, new block "WP-WAL2" | The dark pass look (gradient ground, resting shadow, light text, white focus ring). Nothing moves. |

## Behaviour notes (Guardian findings round, 18 Nov 2026)

- Bulk Accept is now slightly stricter than main: "Accept N Clear Details" also needs the quoted words to have been found in the document (the card's own test for Clear; a reading whose words were not found already showed Please Check on its card). The count line, the rows and the bulk Accept use this one meaning.
- Check What We Found also renders on the What We Found page (review/page.tsx): the same rows, one-at-a-time view and accept bar. There the accept bar sits in the flow and is not sticky (only the opened document on a phone makes it sticky). Proven by review/page-findings.test.tsx.
- Dates and Name and Kind open by themselves only after a date or kind error (accepted as is by the Guardian).

## Tests

Red on main, green here (16 behaviour tests; run against main's page.tsx, ai-review.tsx and document-wallet-browser.tsx with the new files in place):

- documents/page.test.tsx, block "WAL2": the hero carries name, states and Preview and Download Original, with only one Preview button on the page; a file that cannot be opened has neither on its card; Dates, Name and Kind, Safe Copy and Reading and Checks with every form kept; Dates open after a date error; no Safe Copy section while a file is being checked; Issuer Confirmations is a section, never a plain fold.
- [id]/finding-review.test.tsx: the count line; one row per ordinary detail with value and Suggested picture; row Accept only for clear details and only with consent, sending the plain approve; the accept bar is the last child and counts clear ordinary details; one at a time only for Sensitive and differing details; 1 of 2, Back, Skip for Now (saves nothing); every detail listed before the script runs; Sensitive values hidden until opened; the hidden profile value never shown; ordinary details never masked.
- components/document-detail/document-hero-card.test.tsx: the hero's parts, no inline style, the drawing when there is no preview, each state with Explain note and word, live state announced, the browser's hero prop.
- review/page-findings.test.tsx: the What We Found page draws the real rows, the masked one-at-a-time Sensitive detail and the accept bar.
- e2e/wallet/u2-document-detail.spec.ts on e2e/fixtures/wal2-document-detail.fixture.tsx: layout guards at 390, 400 and 1280 with sections closed and open, both motion settings, and with every card open (nothing covers Save, a date box or Accept); hero at each size with 44 px targets and the dark pass; on a phone the Add button is gone and the accept bar rests above the bottom bar; one at a time with focus following; Sensitive value hidden until opened; 56 px choice tiles; nothing animates with reduced motion; at 390 px, scrolled in 120 px touch steps with every section and card open, every row Accept and card Accept comes fully clear of the accept bar and the sheet's top bar and can be tapped there, and no section Save ever sits under the accept bar (proven red by fixing the bar over the bottom of the screen: four section buttons reported under it).

Existing tests edited (approved list in the ACK): ai-review.test.tsx (card heading is now h5 inside its row; three selectors), a11y-forms.test.tsx (three new rows: a masked Sensitive card, row Accept, one-at-a-time view), documents/page.test.tsx (issuer confirmations mock made configurable, WAL2 block appended).

## Reviews

- /code-review high: 10 findings, 9 fixed. A return to `#safe-copy-<document>` opens the closed Safe Copy section (components/document-detail/open-on-hash.tsx). One meaning of clear everywhere, so a reading whose words were not found is never accepted in bulk. Check the File Again and the document type check stay in view. A masked card never prints a profile value and keeps the consent note in view. A row that needs checking says Please Check. Focus moves to the next detail after a decision. An opened row hides its own Accept, so one detail is never sent twice. Badge tones come from an exact list. Not taken: putting the new sections at heading level 4 would nest them under Check What We Found; the outline stays flat under Selected Document (document name, Check What We Found, then each section).
- /security-review: no finding at confidence 8 or above. Every permission, consent and binned-file condition moved intact; row Accept uses the existing server action with its ownership check; nothing new reaches the browser.
- Accessibility review (fresh context): focus after a row or the last detail is decided now moves to the next row, the heading or the message box; the masked value is read as "Hidden"; the processing state is announced once, from its own live region; the accept bar's scroll padding is raised so a focused control is not partly covered. Not done: "Value Found" is a level 5 heading inside a level 5 card heading, and an opened row's card repeats the row's name as a heading (Expandable Section allows levels 2 to 5 only; its type is outside this unit).

## New visible words (for the Bengali lane)

English source only; no i18n file edited.

- Hero: "Updated {date}", "Kind Not Set".
- State notes: "No expiry date is confirmed for this document yet.", "Going by the saved dates, this document is in date.", "Going by the saved expiry date, this document runs out soon.", "Going by the saved expiry date, this document has run out.", "A newer document replaced this one.", "Where this file is in our checks right now.", "A copy with private details masked, for sharing. Your original file is never changed."
- Sections: "Dates", "Dated {date}", "No Document Date", "Expires {date}", "Name and Kind", "Reading and Checks", "Issuer Confirmations".
- Changed sentence: "We could not tell what kind of document this is. Choose the kind under Name and Kind." (was "... Choose the kind above.").
- Check What We Found: "Hidden" (read aloud for a masked value), "Please Check" on a row (existing word), "{n} details, {n} clear, {n} to check" (and "1 detail"), "Nothing is saved to your profile until you accept it." (replaces "We read this document and found ... Nothing is saved to your profile until you accept it."), "Decide One at a Time", "{n} of {m}", "Back", "Skip for Now", "Value Found", "Accept" with the spoken name "Accept: {detail}".

## Not verified

- The real signed-in documents page in a real browser with real data: the browser spec renders the real components in a fixture whose sheet markup mirrors the page (as WAL0's does).
- Safari and Firefox (only Chromium was run).
- A real preview thumbnail: none exists without stored thumbnails (migration 0138 and the owner's word), so the drawing always shows.
- The Profile page also uses the review card (app-suggestions.tsx): its cards gain the large choice tiles for a difference; nothing else there changed. Not checked in a browser.
- The ui-ratchet baseline was not lowered (another lane owns the file); counts went down (folds and inline styles), and the ratchet passes.
