# R2 records: How It Works rebuild

Branch `claude/r2-how-it-works-rebuild`. Reference: the approved public-site artifact (How It Works tab). Pictures in `docs/upgrades/programme/pub/r2-shots/`: `ref-<width>-chN.png` is the reference, `mine-<width>-chN.png` is the page, taken light at 1440 and 390 wide from one production build (reference sections taken with the rise-in forced visible).

## Chapter fidelity (1440 and 390)

| Chapter | Result | Notes |
|---|---|---|
| 1 Dark hero: "How it / works." with four numbered chips | match | Same words, two lines, centred, chips 1 Add, 2 Check, 3 Prepare, 4 Share. Differs only by the flat refinement: the reference draws a glow and a multi-colour gradient on "works."; the page uses the approved flat navy and the single tint of the existing headline words. The header and pilot notice sit outside the chapter in both. |
| 2 Four alternating rows with phones | match | Text and picture swap sides row by row (checked at 1440 by position), each picture rises in on scroll. Add shows the Suggested fields, Check the Confirmed fields, Prepare the Germany checklist at 3 of 8 (Reused / To add), Share the sheet resting on Turn Off. Differs: flat surfaces (no phone glow or shadow), no animated scan beam, document drawings are the product's own pictures (the kit's), and "Share with Agency" follows the Title Case guard. |
| 3 Light band: "Words mean exactly / what they say." with four flip tiles | match | Same headline on two lines, four tiles (Received, Suggested, Saved, Ready). Differs: the headline accent is flat, and each tile turns to show "is not X" plus one plain sentence; the full text is always in the page. |
| 4 Dark closing with the main call to action | match | Same title, sentence, two buttons and the real Bangladesh passport cover. Differs: the buttons keep today's labels and links ("Start with Your Own Profile" to /app, "Privacy and Trust" to /trust, owner rule that labels stay); the passport is still (no tilt); no blue glow. |

At 390 wide every chapter stacks to one column with the same order; rows swap sides only from 900 wide.

## Scroll budget (phone 390 x 844, budget 6 screens)

| Language | Height | Screens |
|---|---|---|
| English | 4,465 px | 5.29 |
| Bengali (cookie preview server) | 4,592 px | 5.44 |

Desktop 1280 x 800: about 5.7 screens (budget 12). The English numbers are held by `e2e/public-site/r2-how-it-works.spec.ts`. The Bengali number was measured by a throwaway script with the locale cookie (e2e files may not set cookies), so it is recorded here and not guarded by a test.

## Bengali and words for the localization lane

Per the Guardian's correction, there is no new catalogue file. Every English-only word of the page goes through `publicText(text, pageLang)` (marked `lang="en"` on a Bangla page), and the start button keeps the existing key `trust.publicTrustStory.startWithYourOwnProfile`. The pictures come from the shared kit and hold English Example text marked `lang="en"` on a Bangla page. The page's own words are the single list `HOW_WORDS` and `WORD_TILES` in `apps/web/src/components/public-how/how-sections.tsx`:

How It / Works. / Four steps. Each one is yours. / Add / Check / Prepare / Share / Add a document by photo or file. Details are suggested for you to confirm. / Confirm, change or skip each suggestion. Nothing is assumed. / Pick a country and purpose. The checklist fills from what you already have. / Choose what leaves, for whom, until when. Turn it off any time. / Words Mean Exactly / What They Say. / Select a word to read what it means. / Received, is not Reviewed, A file arrived. No one has checked it yet. / Suggested, is not Confirmed, A detail was read from your page. Nothing is true until you say so. / Saved, is not Shared, A saved file stays yours until you choose to share it. / Ready, is not Approved, Ready counts what is complete. It never promises a visa. / See It With Your / Own Passport. / Start with one document. / Privacy and Trust.

The route is not on `BN_READY_ROUTES` (outside the manifest), so the page `lang` stays English.

## Decisions and limits

- The pictures are the real R1 kit (`components/public-site/kit`): `ScanPhone`, `CountryChecklistPanel` (Germany pinned, 3 of 8), `ShareSheet` (step 3), `ClosingBand`, `RiseIn`. The stand-ins were removed.
- No pinned scene on this page, so `pub3-how-trust.spec.ts` registers its "pins each scene" check for `/trust` only (a registration condition, not a skip).
- The flat rule meant leaving out the reference's gradients, glows and shadows on purpose.
- Not verified: a real device, a screen reader pass, and the page in the live Bengali route.

## Review batch (kit swap, disclosure tiles, tests)

- Word tiles: where the meaning is always shown (no script, reduced motion, data saver, a phone) each tile is a plain non-interactive block with the whole text. While the scroll engine runs (`html[data-scenes="live"]`) it is a disclosure: a button naming the word and "is not X" with `aria-expanded` and `aria-controls` pointing at the meaning, which is `hidden` until opened. The opened tile is the accent fill with the light ink (about 8:1, above 4.5:1).
- Tests: page tests read a parsed document, the reduced-motion and no-script browser checks assert the real content is visible (rows, the Germany 3 of 8 count, Turn Off, the four meanings, the closing) and that nothing is faded or pressable. Proofs that the new guards fail: switching `aria-expanded` to `aria-pressed` fails the tile test; removing the words band fails three page tests.
- Dead rules for R3 (file `apps/web/src/components/public-pub3-story.css`, left untouched by R2): classes with no use left in non-test source: `p3-at`, `p3-bar`, `p3-chips`, `p3-fill`, `p3-node`, `p3-stage`, `p3-stage-line`, `p3-stage-word`, `p3-stages`. R3 should re-check tests, e2e and scripts before deleting.
- Share sheet wording (truth fix, approved by the Guardian outside the R2 manifest, 18 Nov 2026): `packages/services/src/sharing.ts` (`getRecipientWorkspace`) says recipient preview and download do not serve bytes yet, and non-original variants fail closed until redacted renditions exist, so sharing cannot be limited to part of a document and "Photo page only" and "Visa size" were untrue. In `apps/web/src/components/public-site/kit/share-sheet-body.tsx` the Passport and Photo sub-lines now read "See Document Details", the Bank row "Not Shared", and the chips "Passport, details" and "Photo, details". No other kit change. This also corrects the live Home page, which uses the same part. Held by a new assertion in `src/app/how-it-works/page.test.tsx`.
