# PUBFIX2 records: public-site fixes from pass 2 (18 Nov 2026)

Source: `PUB5-verification.md` section 9.5. Class B, lean route. Base main `cecca4c6`. Measured on one local production build (`next start -p 3100`, placeholder settings of CLAUDE.md section 6), Chromium, English unless said.

## Before and after

| # | Defect | Before (main) | After | Guard |
|---|---|---|---|---|
| P2-1 | Countries ribbon cannot be stopped | Not reproduced as written: a visible "Pause Motion" button (R4, #642, 44 px, `aria-pressed`) already stops the ribbon and the typing demo; keyboard Enter stops it (running ribbon animations 1 to 0); under reduced motion nothing runs and no button shows. At 1280 x 800 it sits 209 px above the ribbon, at 390 x 844 169 px above, so both fit one screen | Unchanged, recorded as already fixed | `pubfix2-public-site.spec.ts` (button and ribbon in one screen height, keyboard Pause, zero running animations afterwards and under reduced motion) |
| P2-2 | Home first screen cropped on a computer | 1280 x 800: four side pictures cut by the edges and the fold, readiness pill and Example line below the fold (note bottom 862 of 800). 1440 x 900: note bottom 962 of 900 | All seven boxes (4 side pictures, hero passport, pill, Example line) inside the screen at 1280 x 800, 1440 x 900, 1280 x 720, 1920 x 1080, and by hand at 1024 x 768, 1100 x 700, 1366 x 768, 1536 x 864, 1680 x 1050, 1280 x 1024, 1920 x 1200, 900 x 1000, 2560 x 1440 | spec: every picture box inside the viewport at the four sizes |
| P2-3 | /trust first phone screen 39 words | 39 words English, 38 Bengali at 360 x 640 | At most 30 in both (the picture's inner text is hidden from the word measure and from screen readers; the figure keeps its label "Example of sharing papers with an agency") | spec: PUB2 measure at 360 x 640, English and Bengali |
| P2-4 | Menu button under 44 px | 69 x 26 (en), 52 x 29 (bn) | 44 px tall at 1024, 1150 (en), 1024, 1230 (bn) | spec |
| P2-5 | How It Works over 6 screens | 4,842 px English, 4,901 px Bengali (6.05, 6.13 screens) at 1280 x 800 | within 4,800 px in both (less air between rows and chapters, computers only) | spec, both languages |
| P2-6 | /trust grows while scrolling | Share picture changed height step by step (phone 324, 350, 390 px; computer 362, 382, 422 px) so the hero changed by 66 px and the layout shifted 0.047 (phone) and 0.028 (computer); "today." heading passed over its paragraph while rising | Page height constant over a full loop and a full read (at most 2 px), layout shift under 0.01 at 390 x 844 and 1440 x 900; heading and paragraph rise together (gap never negative) | spec (both) |
| P2-7 | Home journey starts on Closed on a phone | Phone, reduced motion, no script: card on Closed, Embassy tag | Rests on Getting Started with the You tag in all three, like pinned mode and the reference | `home-story-rest.test.tsx` (failed on old code: expected "0", received "6"), spec, `public-pages.test.tsx` |
| P2-8 | Bengali header and footer words | not in scope | Rows added to `PUB-bn-words.csv` (Home, Privacy and Trust, Countries, Status, the danda after the pilot sentence) for the localization lane; no catalogue Bengali edited | n/a |
| P2-9 | Footer targets under 44 x 44 | Terms 41 wide, Status 42 wide, pilot notice 44 x 43 | every footer link and the pilot notice 44 x 44 or more at 390 and 1440 | spec |

## What changed in the code

- `home-story.css`: from 900 px the hero deck takes `clamp(140px, 100svh - 620px, min(360px, 25vw))`, the four side pictures start closer in and smaller (`--x0`, `--y0`, `--s0` per slot, only inside `.hs-hero`), headline and line sizes follow a slightly smaller screen-height share. Phones are unchanged.
- `home-story.tsx`: the journey scene has `finalStep={0}`. A scene that rests on its first step is not replayed by the phone and reduced-motion modes, so those visitors see a still first stage. Trade-off: the journey no longer plays on phones; pinned (computer) scroll still plays all seven stages.
- `share-hero.tsx`, `public-pub3-story.css`: five copies of the share picture sit in one grid cell (four hidden, `aria-hidden`, only to hold the tallest height); the live one rests at the top.
- `share-sheet-body.tsx`: the sheet's inner text is `aria-hidden` inside the labelled figure (the label already says what it is). Same body is used by the Home share scene.
- `public-trust-story.tsx`: the "Where We Are Today" heading and paragraph sit in one rise-in.
- `globals.css`: min 44 px on the menu button (both NAV2 rule sets) and footer links and pilot notice (NAV2 block rules only).
- `how-it-works.css`: row gap and chapter padding trimmed from 900 px.

## Test changes outside the new spec

`pub2-home.spec.ts`, `mot1-phone-motion.spec.ts`, `public-pages.test.tsx` (journey rests on 0); `r3-story.test.tsx`, `r3-reference-fidelity.spec.ts`, `mot1-phone-motion.spec.ts`, `ux-public.spec.ts` (the live picture is `.tr-share-live`, the hidden copies are not counted).

## Not verified

Safari and Firefox, real phones, screen readers (the figure keeps its name; its inner words are no longer read). Bengali /trust and Home first-screen counts stay English-worded until approved rows exist; /trust Bengali is within 30, Home Bengali (34 in pass 2) is not touched here and stays on the localization list. The two WP-LIFT-B case-page checks fail locally on clean main too (CI passes them).
