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

## Tests

Red on main, green here (16 behaviour tests; run against main's page.tsx, ai-review.tsx and document-wallet-browser.tsx with the new files in place):

- documents/page.test.tsx, block "WAL2": the hero carries name, states and Preview and Download Original, with only one Preview button on the page; a file that cannot be opened has neither on its card; Dates, Name and Kind, Safe Copy and Reading and Checks with every form kept; Dates open after a date error; no Safe Copy section while a file is being checked; Issuer Confirmations is a section, never a plain fold.
- [id]/finding-review.test.tsx: the count line; one row per ordinary detail with value and Suggested picture; row Accept only for clear details and only with consent, sending the plain approve; the accept bar is the last child and counts clear ordinary details; one at a time only for Sensitive and differing details; 1 of 2, Back, Skip for Now (saves nothing); every detail listed before the script runs; Sensitive values hidden until opened; the hidden profile value never shown; ordinary details never masked.
- components/document-detail/document-hero-card.test.tsx: the hero's parts, no inline style, the drawing when there is no preview, each state with Explain note and word, live state announced, the browser's hero prop.
- e2e/wallet/u2-document-detail.spec.ts on e2e/fixtures/wal2-document-detail.fixture.tsx: layout guards at 390, 400 and 1280 with sections closed and open, both motion settings, and with every card open (nothing covers Save, a date box or Accept); hero at each size with 44 px targets and the dark pass; on a phone the Add button is gone and the accept bar rests above the bottom bar; one at a time with focus following; Sensitive value hidden until opened; 56 px choice tiles; nothing animates with reduced motion.

Existing tests edited (approved list in the ACK): ai-review.test.tsx (card heading is now h5 inside its row; three selectors), a11y-forms.test.tsx (three new rows: a masked Sensitive card, row Accept, one-at-a-time view), documents/page.test.tsx (issuer confirmations mock made configurable, WAL2 block appended).

## New visible words (for the Bengali lane)

English source only; no i18n file edited.

- Hero: "Updated {date}", "Kind Not Set".
- State notes: "No expiry date is confirmed for this document yet.", "Going by the saved dates, this document is in date.", "Going by the saved expiry date, this document runs out soon.", "Going by the saved expiry date, this document has run out.", "A newer document replaced this one.", "Where this file is in our checks right now.", "A copy with private details masked, for sharing. Your original file is never changed."
- Sections: "Dates", "Dated {date}", "No Document Date", "Expires {date}", "Name and Kind", "Reading and Checks", "Issuer Confirmations".
- Changed sentence: "We could not tell what kind of document this is. Choose the kind under Name and Kind." (was "... Choose the kind above.").
- Check What We Found: "{n} details, {n} clear, {n} to check" (and "1 detail"), "Nothing is saved to your profile until you accept it." (replaces "We read this document and found ... Nothing is saved to your profile until you accept it."), "Decide One at a Time", "{n} of {m}", "Back", "Skip for Now", "Value Found", "Accept" with the spoken name "Accept: {detail}".

## Not verified

- The real signed-in documents page in a real browser with real data: the browser spec renders the real components in a fixture whose sheet markup mirrors the page (as WAL0's does).
- Safari and Firefox (only Chromium was run).
- A real preview thumbnail: none exists without stored thumbnails (migration 0138 and the owner's word), so the drawing always shows.
- The Profile page also uses the review card (app-suggestions.tsx): its cards gain the large choice tiles for a difference; nothing else there changed. Not checked in a browser.
- The ui-ratchet baseline was not lowered (another lane owns the file); counts went down (folds and inline styles), and the ratchet passes.
