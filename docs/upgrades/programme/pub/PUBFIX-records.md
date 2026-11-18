# PUBFIX: public site fixes after the independent check (18 Nov 2026)

Fixes every defect in docs/upgrades/programme/pub/PUB5-verification.md (PR #632), one pass, one PR. Class B.

## Defects and what changed

| # | Fix | Where |
|---|---|---|
| D1 | "A person looks over the case." is now "You look over the case before it moves on." (only the case owner moves a case into review) | how-it-works/page.tsx; guard in how-it-works/page.test.tsx |
| D2 | Phone spacing trimmed so Home and Countries stay at or under 4,962 px (2 percent under 6 screens) in English and Bengali; no word cut. Measured on the production build: Home 4,949 (bn), 4,838 (en); Countries 4,883 (bn), 4,619 (en). Bengali cases (chosen through the real language switch) added | landing-c1.css (WP-PUBFIX blocks), countries/countries.css, e2e/scroll-budget/WP-SB8.spec.ts |
| D3 | `.p3-eyebrow` line height 1 to 1.25 | components/public-pub3-story.css |
| D4 | `.pub-scene-stage` gets 0.5rem top padding; Home scenes keep their own spacing (no extra padding) so the pinned scenes still fit 1024 x 600 | components/public-site/public-site.css, landing-c1.css |
| D5 | For Agencies button words and the kicker read the Home catalogue entries (same words as Home, Bengali follows the language) | for-agencies/page.tsx; test compares with the catalogue |
| D6 | Countries and For Agencies wrap visible English with publicText and pass the page language to ExampleTag, StatusChip, StoryCard, ReadinessRing, FlagRing | countries/page.tsx, for-agencies/page.tsx |
| D7 | 44 px targets: header links and language switch (computers), footer links, pilot notice link and Hide button, no layout jump (negative margins pull the extra height back; notice Hide width variable is now 44 px) | globals.css block "WP-PUBFIX" at the end, plus one variable value |

## Guard

e2e/public-site/home-layout-overlap.spec.ts now measures Home, How It Works, Trust, Countries and For Agencies (7 widths, motion on and reduced) plus a JavaScript-off pass (390 and 1024). Proven red: with the old D3 and D4 rules injected it failed 28 overlap and 16 clipped checks; green after the fixes. Trust left the report-only baseline.

## Files outside the manifest that had to change (hits of changed strings or rules)

- apps/web/src/components/ui-lift/ui-lift.test.tsx: block-name list now accepts `WP-PUBFIX` (the end-of-file block guard)
- apps/web/src/lib/version-notice-css.test.ts: Hide variable is 44 px for every pointer
- apps/web/e2e/ux-public.spec.ts: eyebrow line height 15 px (was 12 px)
- apps/web/src/app/for-agencies/page.test.tsx, countries/page.test.tsx, how-it-works/page.test.tsx (own tests)

## PUB5 report files

PUB5-verification.md and PUB-bn-words.csv are brought in unchanged from PR #632 (to be closed in favour of this one), except the D1 row of the word list and a new section 8 "Fixed in PUBFIX" in the report.

## Not verified

Real phones, Safari and Firefox, screen readers, live production. Bengali on pages other than Home and Countries. Pointer-device feel of the 44 px header and footer links.
