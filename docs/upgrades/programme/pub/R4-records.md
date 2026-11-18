# R4 records: Countries rework to the approved reference

Branch `claude/r4-countries-rework`, Class B, builder R4. Reference: the owner-approved "public site, one continuous story" mock, Countries page (artifact EhrC98mm1wBgY9JhafDHpz). Saved copy rendered through `r4-shots/reference-shots.cjs`.

## What changed

- `/countries` now follows the reference order: dark hero "Every Country. With Its Sources." with a search that types "Singapore" by itself; a ribbon of flags; the real country list; light "Rules, Not Guesses." beside the checklist panel; closing band "Pick a Country. See the Gap." with the passport.
- Removed: the still 12-flag ring hero and the pinned "How to Read These Facts" scene (about 1.3 screens of empty navy).
- Kept untouched: every PUB4 and PUBFIX behaviour of the list (12 rows, Show More through `?show=` with no script, "Not from an official page." and "Needs checking before you rely on it.", host-name source labels, Checked On per shown source, Not Researched Yet), the tab title "Countries and Sources", the pilot notice, header and footer, CSP (no inline style, same-site flags only).
- New parts (own folder `apps/web/src/components/public-countries/`): `TypingSearch`, `FlagRibbon`, `search-match.ts`. The search is a real form (works without script: `?q=` lists matches), the demo never takes a key (first focus, press or key clears the demo word), the count is spoken politely (silent while the demo runs) and also shown in words. The ribbon is decoration (`aria-hidden`) with a visible "All Countries" link, pauses under pointer or focus, and stands still (one wrapped row) under reduced motion.
- Shared kit: R1 had not merged, so `standins/` holds temporary local copies of `CountryChecklistPanel`, `SegmentRing`, `ClosingBand` and `RiseIn` with the contract props. At the TURN the imports in `page.tsx` switch to the kit and `standins/` is deleted (the stand-in `ClosingBand` takes an extra `labelledBy` the page does not pass; `RiseIn` ignores `delay`).
- Placed in `components/public-countries/` (not `components/public-site/countries/` as claimed): `public-site-guards.test.ts` reads `public-site/` as a flat folder and fails on a subfolder. No file outside the claimed manifest was edited.
- Flag weight: `es.svg` is 82 KB, so the ribbon leaves Spain out; a unit test keeps the ribbon flags under 20 KB (the page's pictures are 76 KB of the 150 KB budget).

## Fidelity table (1440x900 and 390x844, spec `e2e/public-site/r4-reference-fidelity.spec.ts`, 21 tests, all pass)

Pictures: `r4-shots/ch*-d.png` (computer) and `ch*-m.png` (phone), reference `reference-d.png` and `reference-m.png` (whole page, all small).

| Chapter | Reference | Ours | Result |
|---|---|---|---|
| 1 Hero and search | Dark, two-line headline, search types "Sing..." and lists matches | Same layout, order and copy; flat headline words (the reference uses a gradient, not allowed by the flat rule); search types Singapore, then a person types freely; filled and still under reduced motion | Pass, with the flat-design difference |
| 1 Ribbon | Pills with flags drifting, white band | Same, 15 real flags, still under reduced motion, paused on hover and focus, visible "All Countries" link | Pass |
| 2 Real list | Not drawn in the reference | Today's sourced rows unchanged | Pass (behaviour tests) |
| 3 Rules and panel | Two-line headline, copy, source chip, panel with tabs, ring 5/8, Reused and To add rows, Example note | Same parts, flat panel (no soft shadow), checklist pictures from today's document drawings (some fall back to the plain icon) | Pass, with the flat-design difference |
| 4 Closing band | Two-line headline, sub line, two buttons, passport floating below | Same order, today's button words, still passport | Pass |

## Motion control (WCAG 2.2.2)

The typing demo and the ribbon both start by themselves and run for more than 5 seconds, so one visible button, `Pause Motion` / `Play Motion` (44 px, `aria-pressed`), stops and resumes both together. It shows only where something moves (not without script, not under reduced motion). The state is one attribute on the page root, so a reload starts moving again. Tested in the fidelity spec (typing freezes and the ribbon's animation state is paused, Play resumes; no button under reduced motion).

## English-only words for the localization lane

New file `apps/web/src/i18n/countries-public.ts` (English only, `bn` empty, approved into the manifest by Guardian 10): Matching Countries; "{count} country found." / "{count} countries found."; "{count} countries found. Showing the first {limit}. Keep typing to narrow it."; Type at least two letters.; Type a country name.; Pause Motion; Play Motion. On a Bangla page they show English, marked `lang="en"`. Reused existing keys (Bengali exists for the last three): `components.countryBrowser.searchCountries` (no Bengali yet), `components.countryBrowser.allCountries`, `components.activityLog.search`, `components.countryBrowser.noCountriesMatch`. The page's own headings and body copy go through `publicText` as on the other public pages.

## Page length (WP-SB8, phone)

English 5.63 screens, Bengali 5.67 screens, limit 5.88. The phone shows 4 flags per copy of the ribbon and tighter row spacing; words and 44 px buttons are unchanged.

## Verified on one fresh production build

Typecheck, lint (with flat-design, navigation and UI ratchet checks), full web vitest (882 files, 9753 tests at the first battery; the final run is green too), scripts tests (78 pass), Playwright on `public-site/*`, `ux-public`, `browser-security`, `no-secret-auth` and WP-SB8 (523 passed, 15 skipped by their own design), `check-public-budget` (pictures 76 KB), em dash sweep 0. Guards proven to fail: adding Spain to the ribbon fails the weight test; lowering the two-letter rule fails the search test.

## Not verified

Real devices, real visitor reactions, screen readers by hand, the typing demo on slow phones, Bengali layout beyond the page-length check, and the page against the real kit (stand-ins only until the TURN). Without script the search box opens with "Singapore" in it (the finished demo picture), so a no-script visitor clears it before typing.
