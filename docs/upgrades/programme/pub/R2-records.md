# R2 records: How It Works rebuild

Branch `claude/r2-how-it-works-rebuild`. Reference: the approved public-site artifact (How It Works tab). Pictures in `docs/upgrades/programme/pub/r2-shots/`: `ref-<width>-chN.png` is the reference, `mine-<width>-chN.png` is the page, taken light at 1440 and 390 wide from one production build (reference sections taken with the rise-in forced visible).

## Chapter fidelity (1440 and 390)

| Chapter | Result | Notes |
|---|---|---|
| 1 Dark hero: "How it / works." with four numbered chips | match | Same words, two lines, centred, chips 1 Add, 2 Check, 3 Prepare, 4 Share. Differs only by the flat refinement: the reference draws a glow and a multi-colour gradient on "works."; the page uses the approved flat navy and the single tint of the existing headline words. The header and pilot notice sit outside the chapter in both. |
| 2 Four alternating rows with phones | match | Text and picture swap sides row by row (checked at 1440 by position), each picture rises in on scroll. Add shows the Suggested fields, Check the Confirmed fields, Prepare the Germany checklist at 3 of 8 (Reused / To add), Share the sheet resting on Turn Off. Differs: flat surfaces (no phone glow or shadow), no animated scan beam, document drawings are the product's own pictures, and "Share with Agency" follows the Title Case guard. |
| 3 Light band: "Words mean exactly / what they say." with four flip tiles | match | Same headline on two lines, four tiles (Received, Suggested, Saved, Ready). Differs: the headline accent is flat, and each tile turns to show "is not X" plus one plain sentence; the full text is always in the page. |
| 4 Dark closing with the main call to action | match | Same title, sentence, two buttons and the real Bangladesh passport cover. Differs: the buttons keep today's labels and links ("Start with Your Own Profile" to /app, "Privacy and Trust" to /trust, owner rule that labels stay); the passport is still (no tilt); no blue glow. |

At 390 wide every chapter stacks to one column with the same order; rows swap sides only from 900 wide.

## Scroll budget (phone 390 x 844, budget 6 screens)

| Language | Height | Screens |
|---|---|---|
| English | 4,830 px | 5.72 |
| Bengali (cookie preview server) | 4,968 px | 5.89 |

Desktop 1280 x 800: 5.1 screens (budget 12). The English numbers are held by `e2e/public-site/r2-how-it-works.spec.ts`. The Bengali number was measured by a throwaway script with the locale cookie (e2e files may not set cookies), so it is recorded here and not guarded by a test.

## Bengali

Every visible string of the page is in `apps/web/src/i18n/public-how.ts`. Bengali values exist only where the translation register has a row (Add, Share, Received, Ready; see `public-how.sources.json`). Everything else shows English marked as English until the register has rows. The pictures hold English Example text marked `lang="en"` on a Bengali page, as the kit contract says. The route is not on `BN_READY_ROUTES` (not in the manifest), so the page `lang` stays English.

## Decisions and limits

- Kit stand-ins live in `components/public-how/kit-standins.tsx` with the R1 contract names and props (`SegmentRing`, `ScanPhone`, `CountryChecklistPanel`, `ShareSheet`, `ClosingBand`, `RiseIn`). At the turn the swap is an import change in `how-sections.tsx`. `ShareSheet` ignores `mode` (the stand-in is a still at step 3).
- No pinned scene on this page, so `pub3-how-trust.spec.ts` registers its "pins each scene" check for `/trust` only (a registration condition, not a skip).
- The flat rule meant leaving out the reference's gradients, glows and shadows on purpose.
- Not verified: a real device, a screen reader pass, and the page in the live Bengali route.
