# LAND1 records: the approved homepage, with its header and footer (26 Nov 2026)

Owner request (26 Nov 2026, exact words): "update the landing page 100% correctly", with the hand-off package `VisaStack-Landing-Handoff.zip` (the published Landing Page Studio homepage, version 9, source commit `2a5c84eed0456067f96a70f8427824d5cff3bbf4`; the Harbor Blue folio hero, English first). Baseline: `main` at `48e276615faf6ec9864c51d814d6def457dfb78b` (NAV3, #662).

This replaces the Home page of R1 (eight scroll chapters), MOB1 (phone density) and the Home parts of MOT1 and PUBFIX2. Those records stay as history (each ends with a "superseded, replaced by LAND1" line).

## What changed

- Home (`/`) is the approved homepage, in the approved order: first screen (Bangladesh line, headline, destination planner, folio picture with caption), the plan the planner opens, a row of sources, privacy and status, the sample family case (one-at-a-time accordion), the reusable record with a passport-renewal example, the agency request workflow, five common questions, and one closing action. A still page: no scene engine, no animation.
- The planner: a labelled destination list (Japan, Singapore, United Kingdom, Canada, Germany, Australia, names read from the country catalogue), "See My First Steps" opens a short general plan below the first screen, "Myself" and "My Family" change the second step in memory only (nothing is saved or sent). The plan only opens the existing country guide through the guides' own `/countries?q=` search. Without script the form is a plain GET to the same address; the plan stays closed.
- Header (every public page): one flat bar the width of the page; a "How It Works" menu (Prepare a Case, Your Reusable Record, Privacy and Control), then Country Guides and For Agencies. On a phone the same entries are in the one Menu, followed by Privacy and Trust and Common Questions. The menu button opens and closes, Escape closes it and returns focus to its button, so does a press outside, a choice or focus leaving it.
- Footer (every public page): three groups, Travellers, Workspaces, Trust and Support, a quiet legal row (Privacy, Terms) and the existing version line and copyright. Sign In / Workspace / Sign Out / Get Started keep their rules.
- Anchors kept: `#how-it-works`, `#capabilities`, `#sources`, `#for-agencies`, `#start` now land on the sections that tell the same story (the case, the first screen, the sources row, the agencies card, the closing action); new `#planner`, `#prepare`, `#your-record`, `#questions`.
- Fonts: Instrument Serif and Space Grotesk, the licensed files of the approved design, loaded only on Home by `@font-face` in `home-landing.css` (same origin; notices in `apps/web/src/app/fonts/`). Body text keeps Inter and Noto Sans Bengali.
- Picture: `apps/web/public/landing/visa-record-folio.webp` (the published 1100 by 1375 file, sha256 `a0682d06...`), drawn by the site's own image route with its real dimensions, a `sizes` hint, `fetchpriority="high"` and one preload; the 640 file of the package is not needed (the image route makes the sizes). The caption is real text.

## Where the page differs from the approved design, and why

| Difference | Reason |
| --- | --- |
| Caption sits on a solid navy plate over the picture, not on a gradient fade | the flat rule (`scripts/check-flat-design.mjs`) forbids gradients, and a plate keeps the words readable whatever the picture is (the bright stripes of the picture measured 1.85 to 2.4 against white) |
| Cards and menus have a stronger edge instead of a shadow | the same flat rule |
| Buttons, links, badges, kickers and item names are in Title Case ("Start" is "Get Started", "See my first steps" is "See My First Steps", "Passport copy" is "Passport Copy") | the repository's Title Case guard for names; the editorial headings and body words are the approved copy |
| The header's filled action keeps its established words and gating: "Get Started" to sign-up while registration is open, "Sign In" (or "Workspace") otherwise; the reference's "Start preparing" planner anchor is the first-screen button | preserve account labels and registration gating |
| The third reassurance and the real-documents answer come from the deployment mode and whether registration is open (`lib/landing-status.ts`); the status link says "See What Works Today" | the notice contract with the banner, status and legal pages; the established name of the status page keeps its Bangla words |
| The notice words of the banner (made-up details, or the public beta line) sit under the closing action | `lib/public-beta-wording.test.tsx` requires the landing page to carry them |
| Footer says "Status", "Privacy", "Terms"; the version line and copyright keep today's words | established names with Bangla words |
| The heading "Before you begin" and the body copy stay in sentence case | approved display copy |
| One extra link under the closing action: the established account action (sign up, sign in or workspace) | keeps today's destinations on Home |
| Studio-only "Compare designs" is left out | studio navigation |

## Deliberate ratchet change

`scripts/ui-ratchet.baseline.json` gains one entry: `apps/web/src/components/landing/accordion.tsx` (one raw disclosure, the approved design's plus and minus row, used eight times). The product's Expandable Section is a card row with a heading and a chevron and would change the approved look; the homepage keeps its one small component instead of eight raw disclosures.

## Not covered

- The Bangla words of the new page: the approved copy has no translation yet, so on a Bangla page each section is marked English (WCAG 3.1.2), as R1 did. The header menu name, the status link and the notice keep their Bangla words.
- The signed-in header and footer in a real browser (no CI test can sign in); the unit tests cover their markup (`layout-header-footer.test.tsx`, `layout-nav3.test.tsx`).
- Real-device checks of the planner's smooth scroll.

## Cleanup left for a separate unit

- `Scene`, `scene-engine`, `scenes-runtime`, `scenes-boot` and the picture kit (`DocumentDeck`, `SegmentRing`, `ScanPhone`, fixtures) are no longer drawn by any page. They are kept (their own tests still pass, ADR 0029) and should be removed or reused in one deliberate unit.
- The catalogue keys `home.page.inviteOnlyPilot`, `freePublicBeta`, `aCleanFile`, `whatWorksToday` and `home.phone.*` have no reader now.
