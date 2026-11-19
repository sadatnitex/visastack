# PUBFIX2 records: public-site fixes from pass 2 (18 Nov 2026)

Source: `PUB5-verification.md` section 9.5. Class B, lean route. Base main `cecca4c6`. Measured on one local production build (`next start -p 3100`, placeholder settings of CLAUDE.md section 6), Chromium, English unless said.

## Before and after

| # | Defect | Before (main) | After | Guard |
|---|---|---|---|---|
| P2-1 | Countries ribbon cannot be stopped | Not reproduced as written: a visible "Pause Motion" button (R4, #642, 44 px, `aria-pressed`) already stops the ribbon and the typing demo; keyboard Enter stops it (running ribbon animations 1 to 0); under reduced motion nothing runs and no button shows. At 1280 x 800 it sits 209 px above the ribbon, at 390 x 844 169 px above, so both fit one screen | Unchanged, recorded as already fixed | `pubfix2-public-site.spec.ts` (button and ribbon in one screen height, keyboard Pause, zero running animations afterwards and under reduced motion) |
| P2-2 | Home first screen cropped on a computer | 1280 x 800: four side pictures cut by the edges and the fold, readiness pill and Example line below the fold (note bottom 862 of 800). 1440 x 900: note bottom 962 of 900 | All seven boxes (4 side pictures, hero passport, pill, Example line) inside the screen at 1280 x 800, 1440 x 900, 1280 x 720, 1920 x 1080, and by hand at 1024 x 768, 1100 x 700, 1366 x 768, 1536 x 864, 1680 x 1050, 1280 x 1024, 1920 x 1200, 900 x 1000, 2560 x 1440 | spec: every picture box inside the viewport at the four sizes |
| P2-3 | /trust first phone screen 39 words | 39 words English, 38 Bengali at 360 x 640 (every visible word counted, aria-hidden content included) | 28 in both: on a phone the line under the headline moves below the share picture (the hero keeps its height 696 px and every word stays); the headline, the start button and the picture open the page. No wording changed, so no new Bengali rows | spec: every visible word at 360 x 640, English and Bengali |
| P2-4 | Menu button under 44 px | 69 x 26 (en), 52 x 29 (bn) | 44 px tall at 1024, 1150 (en), 1024, 1230 (bn) | spec |
| P2-5 | How It Works over 6 screens | 4,842 px English, 4,901 px Bengali (6.05, 6.13 screens) at 1280 x 800 | within 4,800 px in both (less air between rows and chapters, computers only) | spec, both languages |
| P2-6 | /trust grows while scrolling | Share picture changed height step by step (phone 324, 350, 390 px; computer 362, 382, 422 px) so the hero changed by 66 px and the layout shifted 0.047 (phone) and 0.028 (computer); "today." heading passed over its paragraph while rising | Page height constant over a full loop and a full read (at most 2 px), layout shift under 0.01 at 390 x 844 and 1440 x 900; heading and paragraph rise together (gap never negative) | spec (both) |
| P2-7 | Home journey starts on Closed on a phone | Phone, reduced motion, no script: card on Closed, Embassy tag; on a phone the track played while the card stayed on Closed | Starts on Getting Started (You) everywhere. With reduced motion and without script it rests there. On a phone it then plays through all seven stages as it comes into view, the card follows the stage (fade only, no height change) and it rests on Closed; the computer scroll scene is unchanged and still plays 0 to 6 | `home-story-rest.test.tsx` (failed on old code: expected "0", received "6"), `scene-reveal.test.ts`, `public-site.test.tsx`, spec (rest cases and the phone sequence) |
| P2-8 | Bengali header and footer words | not in scope | Rows added to `PUB-bn-words.csv` (Home, Privacy and Trust, Countries, Status, the danda after the pilot sentence) for the localization lane; no catalogue Bengali edited | n/a |
| P2-9 | Footer targets under 44 x 44 | Terms 41 wide, Status 42 wide, pilot notice 44 x 43 | every footer link and the pilot notice 44 x 44 or more at 390 and 1440 | spec |

## What changed in the code

- `home-story.css`: from 900 px the hero deck takes `clamp(140px, 100svh - 620px, min(360px, 25vw))`, the four side pictures start closer in and smaller (`--x0`, `--y0`, `--s0` per slot, only inside `.hs-hero`), headline and line sizes follow a slightly smaller screen-height share. Phones are unchanged.
- `home-story.tsx`, `scene.tsx`, `scene-engine.ts`, `scene-reveal.ts`: the journey scene is written on its first stage (`finalStep={0}`) and carries `playTo` (`data-play-to`, 6). Reveal mode (phones, short or zoomed windows) plays it up to that step and rests there; gentle mode (reduced motion) and no script keep the first stage. `home-story.css` (marked block): in reveal mode the seven stage cards sit in one grid cell and only their opacity changes, so the card follows the stage and the scene never changes height.
- `public-pub3-story.css`, `share-hero.tsx`: the share picture's box is as tall as its tallest step (390 px on a phone, 422 px from 760 px up, measured), the picture rests at the top of it. (A first version held the height with five hidden copies of the picture; the light and dark pixel check of /trust then failed about half the time, with any hidden copy present and never without, so it was dropped.)
- `public-pub3-story.css`: on a phone the line under the /trust headline moves below the share picture and above its Pause button, by CSS order (P2-3). Hiding it, or putting it after the Pause button, moved the Pause button up, so the page scrolled less when the button was pressed and the first promise card ended up cut by the fold; the light and dark pixel check of /trust (which presses Pause) then failed about half the time on a card edge (clean main: 0 in 36). With the line between the picture and the button the Pause button keeps main's place. `share-hero.tsx` watches the picture box instead of the wrapper for this. The shared share-picture body is unchanged.
- `public-trust-story.tsx`: the "Where We Are Today" heading and paragraph sit in one rise-in.
- `globals.css`: min 44 px on the menu button (both NAV2 rule sets) and footer links and pilot notice (NAV2 block rules only).
- `how-it-works.css`: row gap and chapter padding trimmed from 900 px.

## Test changes outside the new spec

`pub2-home.spec.ts`, `mot1-phone-motion.spec.ts` (journey rests on 0; after a phone play it ends on 6), `public-pages.test.tsx` (journey rests on 0); `r3-story.test.tsx`, `r3-reference-fidelity.spec.ts`, `mot1-phone-motion.spec.ts`, `ux-public.spec.ts` (the live picture is `.tr-share-live`, the hidden copies are not counted).

## Decisions in force (Guardian 16, 18 Nov 2026)

- D1: no `aria-hidden` to meet the word budget. The P2-3 rule counts the words a person sees on the first phone screen; the measure no longer skips `aria-hidden` content, and the shared share-picture body is untouched.
- D2: a still journey on phones conflicts with the owner's standing motion decision ("motion/animation should be always activr for all device and states"; reduced motion gets gentle fades). On phones the journey starts on Getting Started and moves through the stages with the card following; reduced motion and no script rest on Getting Started.

## Not verified

Safari and Firefox, real phones, screen readers (nothing about the share picture changed for them; the copies that hold its height are `aria-hidden`). Bengali /trust and Home first-screen counts stay English-worded until approved rows exist; /trust Bengali is within 30, Home Bengali (34 in pass 2) is not touched here and stays on the localization list. The two WP-LIFT-B case-page checks fail locally on clean main too (CI passes them).
