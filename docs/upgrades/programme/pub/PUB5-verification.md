# PUB5: independent verification of the public site

Verifier: PUB5 (Class A, did not build any of it). Date: 18 Nov 2026.
Build under test: main at cb5e1ba9 (PUB1 #623, PUB2 #626, PUB3 #628, PUB4 #630, HOT1 #629), production build (`next build`, 8 GB heap), served by `next start -p 3100` with the placeholder settings of CLAUDE.md section 6 (controlled_pilot, neon_auth, placeholder auth URL, random cookie secret). Chromium 1243 (pre-installed), headless. A baseline run on a78d67c (before HOT1) is kept for comparison.

Method: one audit script (kept outside the repository) opened every route at every width with motion allowed, then ran separate passes for reduced motion, JavaScript off, keyboard, dark preference and the Bengali choice. The text overlap and clipping check is the HOT1 guard's own measure (Range.getClientRects on text nodes, 1 px tolerance, the hero phone `.c1-devices` and its `.c1-hero` bleed excluded, as HOT1 does), so the results compare with that guard. Controls were hit-tested at their centre with `elementFromPoint` after scrolling each into the middle of the screen. Accessibility: axe with the wcag2a, wcag2aa and wcag22aa tags, serious and critical only. Widths 320, 360, 390, 400, 768, 1024, 1280, 1440; heights 568, 640, 844, 860, 1024 and 800 for the rest.

## 1. Verdict

No blocker. Two Medium defects (one untrue sentence, one Bengali page-length breach), five Low. HOT1 fixed every Home overlap the baseline found (Passport over Photo, Bank Statement over Employment Letter, Travel Plan over the ring caption, at 320 to 400 px). Everything else the owner rules ask for holds on all five new pages.

## 2. Results by route and check

P = pass, F = fail (defect number in brackets), n/a = not applicable. "Words" is the PUB2 measure: words of the page itself (inside `main`) on the first 360 x 640 screen; the full first screen including the header and pilot label is in section 4.

| Check | / | /how-it-works | /trust | /countries | /for-agencies |
|---|---|---|---|---|---|
| No sideways scroll, 8 widths | P | P | P | P | P |
| Text overlap, 8 widths | P (after HOT1) | F [D3] 2 px, all widths | F [D3] 2 px, all widths | P | P |
| Text clipped by a box | P | F [D4] 768 | F [D4] 768 to 1440 | F [D4] 1024 to 1440 | F [D4] 1024 to 1440 |
| Every control hit-tests at its centre | P | P | P | P | P |
| 44 px targets (page's own controls) | P | P | P | P | P |
| 44 px targets (shared header, footer, pilot notice) | F [D7] | F [D7] | F [D7] | F [D7] | F [D7] |
| One h1, first heading in main, inside the first screen, 8 widths | P | P | P | P | P |
| axe serious or critical, 8 widths | P (0) | P (0) | P (0) | P (0) | P (0) |
| Reduced motion: finished step, no engine, nothing moves, 0 running animations | P | P | P | P | P |
| JavaScript off: content, headings, links, finished scenes | P | P | P | P (Show More 12 to 24 to 36 by `?show=`) | P |
| CSP header with nonce, `img-src 'self'` only, no console violations | P | P | P | P | P |
| Page length, phone 390 x 844 (English) | P 6.00 of 6 (5,063 of 5,064 px) | P 3.28 of 6 | P 3.67 of 6 | P 5.79 of 6 | P 3.81 of 6 |
| Page length, computer 1280 x 800 | P 9.91 of 12 | P 4.77 of 6 | P 3.94 of 6 | P 4.93 of 6 | P 4.17 of 6 |
| Words on first phone screen (360 x 640, max 30) | P 25 | P 30 | P 25 | P 17 | P 29 |
| Keyboard: skip link first and visible, lands in main; focus ring on the first 25 stops; phone menu opens with Enter, closes with Escape, focus returns | P | P | P | P | P |
| Light and dark | n/a: no dark theme on the public site; a dark-preference visitor gets the identical light page (same colours, same height, axe 0) | n/a, same | n/a, same | n/a, same | n/a, same |
| Bengali path renders, `data-locale="bn"`, every Bengali word inside a `lang="bn"` mark | P | P | P | P | P |
| Bengali page length, phone | F [D2] 6.14 (5,179 px) | P 3.42 | P 3.85 | F [D2] 6.11 (5,156 px) | P 3.93 |
| Brand tokens only, no #5ad1ff, #8ef0c9, #3c7bf0, no `data:` or `blob:` pictures | P | P | P | P | P |
| Dark and light chapters alternate (unit guard `tonesAlternate`) | P | P | P | P | P |
| Every illustrative figure tagged Example | P | P | P | P (facts are the real catalogue, not examples) | P |
| Received is not Reviewed, Suggested is not Confirmed, Saved is not Shared, "Completeness only. Not an approval." | P | P | P | n/a | P |
| Pilot notice unchanged | P | P | P | P | P |
| Truthful wording | P | F [D1] | P | P | P |
| Title Case, "case" never "mission" (unit guards plus sweep) | P | P | P | P | P (see D5) |

Existing pages, same matrix (must be unchanged):

| Check | /privacy | /terms | /status | /invitation | /auth/sign-in | /pilot-access-denied |
|---|---|---|---|---|---|---|
| Status | 200 | 200 | 200 | 200 | 200 | 200, sends a signed-out visitor to /auth/sign-in (unchanged behaviour) |
| Sideways, overlap, clipping, 8 widths | P | P | P | P | P | P |
| axe serious or critical | P | P | P | P | P | P |
| CSP header, no violations | P | P | P (one 503 from its own health read: no database in this run, expected) | P | P | P |
| One h1 inside the first screen | P | P | P | P | P below 768; at 768 and up the first heading in main is not the h1 (pre-existing, not PUB) | same as sign-in |
| Pilot notice unchanged | P | P | P | P | P | P |
| Bengali | not checked | not checked | not checked | not checked | P: `lang="bn"`, h1 in Bengali, 1.03 screens | not checked |

Existing browser specs on the same build: see section 5.

## 3. Defects, ranked

| # | Severity | Where | What is wrong | One-line fix |
|---|---|---|---|---|
| D1 | Medium | apps/web/src/app/how-it-works/page.tsx:30 | "A person looks over the case." is not true today. Only the case owner can move a case into review (`ownedMission` in packages/services/src/missions.ts:131 to 160; the transition list at missions.ts:111 to 115 has no reviewer role). In the canonical case flow no agency or staff action moves a case into or out of review (the agency console only shows the stage), so the sentence promises a check by someone else that the product does not guarantee. | Change the line to "You look over the case before it moves on." (and the matching Bengali row in PUB-bn-words.csv). |
| D2 | Medium | Home and /countries with Bengali chosen, phone 390 x 844 | Over the 6-screen phone budget: Home 5,179 px (115 px over 5,064), /countries 5,156 px (92 px over). English Home sits at 5,063 px, 1 px of margin, so any longer line breaks it. PUB2 accepted the Bangla Home height as a follow-up; /countries is new. | Add the Bengali choice to WP-SB8 (cookie `visastack_locale=bn`) and trim the phone layout (for example the ready scene's phone min-height in landing-c1.css and the /countries scene card padding in countries.css) until both fit with at least 2 percent margin. |
| D3 | Low | apps/web/src/components/public-pub3-story.css:34 | `.p3-eyebrow` has `line-height: 1`, so its text box overlaps the heading under it by 2 px ("Follow a Case" over "Every Case Has a Clear Next Step"; "The Trust Model" over "Sharing Permissions") at every width, with motion on or off and without JavaScript. The ink does not touch (checked in a screenshot), but the HOT1 overlap guard fails it the moment it covers these pages. | Set `line-height: 1.25` on `.p3-eyebrow` (or give it `margin-bottom: 0.25rem`). |
| D4 | Low | apps/web/src/components/public-site/public-site.css:67 to 69 and 88 to 93 | The pinned stage clips (`overflow: clip`) and its first heading starts on the stage's top edge, so the heading's text box runs 1 to 2 px above the clip ("How to Read These Facts", "One Case, One Clear Line", the trust and how-it-works eyebrows) from 768 or 1024 px up. Nothing is visibly cut today; the heading also sits flush under the header with no breathing room. | Give `.pub-scene-stage` a top padding of about 0.5rem (inside the shared part, so every scene gets it). |
| D5 | Low | apps/web/src/app/for-agencies/page.tsx:29 to 32 | The button words differ from Home: For Agencies says "Sign In to Get Started", "Open Your Workspace", "Create Your Free Account"; Home (apps/web/src/i18n/home.ts:178, 140, 79) says "Sign in to get started", "Open your workspace", "Create your free account". The owner rule is today's labels, one wording. They are also hard-coded, so a Bengali visitor gets English here and Bengali on Home. | Read the three labels from the home catalogue keys (`home.page.signInToGetStarted`, `home.page.openYourWorkspace`, `home.page.createYourFreeAccount`) as Home does; the Guardian picks the casing once. |
| D6 | Low | apps/web/src/app/countries/page.tsx and apps/web/src/app/for-agencies/page.tsx (for example for-agencies/page.tsx:80 `<ExampleTag />` with no `pageLang`) | Neither page uses `publicText`, unlike Home, How It Works and Trust, so when these routes join `BN_READY_ROUTES` their English words will not be marked `lang="en"` (WCAG 3.1.2). No visible effect today, because the public pages stay `lang="en"` for a Bengali visitor. | Wrap the English strings in `publicText(text, getPageLanguage())` and pass `pageLang` to ExampleTag and StatusChip, as /how-it-works does. |
| D7 | Low (owner decision) | apps/web/src/app/globals.css:240 (desktop header links, 24 px target by design); footer links; pilot notice "What Works Today" (125 x 25) and "Hide This Notice" (32 px wide); the বাংলা switch (42 x 33) | On computers the five header links PUB1 added are 28 px tall, as the header's links were before (the rule targets WCAG 2.5.8, 24 px). The phone menu's links are 44 px. Footer links (29 px), the pilot notice controls and the language switch are older and also below 44 px. Each one hit-tests correctly. | If the owner's 44 px rule covers the desktop header and footer, set `min-height: 44px; display: inline-flex; align-items: center` on `.nav-links a:not(.btn)` and `.footer-links a`, and give the pilot notice's two controls 44 px; otherwise record the 24 px exception. |

Not product defects, recorded so nobody re-chases them:
- The privacy and terms "return to account creation" link failed my centre hit-test at 320 to 400 px. It is an inline link that wraps over two lines; the centre of its bounding box falls on the neighbouring link. A real tap on the words works. The probe, not the page, is wrong.
- In the reduced-motion pass at mid-scroll the sticky header sits over content scrolled under it. That is the header doing its job, not an overlap.
- HOT1's PR says its /trust baseline found no overlaps; this run finds the 2 px eyebrow overlap (D3) on /trust with the same measure. HOT1 ran /trust only as a report-only baseline that prints and never fails, which may explain it.

## 4. Measured figures

First screen words, `main` only and whole page (header and pilot label included):

| Route | 320 x 568 | 360 x 640 | 390 x 844 | 400 x 860 |
|---|---|---|---|---|
| / | 21 / 37 | 25 / 41 | 37 / 53 | 37 / 53 |
| /how-it-works | 23 / 39 | 30 / 46 | 48 / 64 | 50 / 66 |
| /trust | 23 / 39 | 25 / 41 | 62 / 78 | 62 / 78 |
| /countries | 17 / 33 | 17 / 33 | 19 / 35 | 19 / 35 |
| /for-agencies | 29 / 45 | 29 / 45 | 49 / 65 | 49 / 65 |

The 30-word rule is met at 360 x 640, the size PUB2 fixed for it (pub2-home.spec.ts). On a taller phone (390 x 844) more of the page is in view, so the count rises; if the owner means "any phone", /how-it-works, /trust and /for-agencies are over at 390 x 844. /how-it-works is exactly at 30 on 360 x 640 with no margin.

Public budget script (`scripts/programme/check-public-budget.mjs --base http://localhost:3100`): passed. First load JavaScript gzipped: / 144,975 (baseline 142,417), /how-it-works 124,917, /trust 125,892 (baseline 124,330), /countries 125,894, /for-agencies 124,925; scroll engine 1,535 bytes; pictures / 27,676, /countries 46,071, others 0; nothing from another site.

Reduced motion: every scene keeps the server's finished step (Home intake 3 of 4, ready 1 of 2, closing 0 of 1; how-it-works case 4 of 5; trust share 3 of 4; countries read 2 of 3; agencies line 2 of 3), `html[data-scenes]` is never set, no stage is sticky, nothing changes between the top and the middle of the page, 0 running animations.

Unit guards run on this tree: public-site, how-it-works, trust, countries, for-agencies, landing-scenes, page-titles, title-case, vocabulary (14 files, 175 tests) and pictures-depth (32 tests): all passed.

## 5. Existing browser specs on this build

Specs: ux-public, public-site/* (pub1 to pub4 and HOT1's home-layout-overlap), scroll-budget/WP-SB8, browser-security, no-secret-auth. Result: 452 tests, 430 passed, 22 skipped, 0 failed (2.0 minutes, two workers). The 22 skips are by design: 21 are HOT1's report-only baseline for /trust, /privacy and /terms (run only with HOT1_BASELINE=1) and 1 is the round Add button that exists on phones only (ux-public.spec.ts:448). Browser: the pre-installed Chromium 1243 under the names the project's Playwright expects (a scratch PLAYWRIGHT_BROWSERS_PATH outside the repository), against the same build and server as the audit.

## 6. Guards

No new permanent guard is added in this PR. The cheap guard that would have caught D3 and D4 is HOT1's own overlap spec run over all five public pages (today it measures Home only and reports /trust, /privacy and /terms without failing). Added now it would be red on main and turn this verification PR red, so it belongs with the builder that fixes D3 and D4: extend `apps/web/e2e/public-site/home-layout-overlap.spec.ts` to /how-it-works, /trust, /countries and /for-agencies (with JavaScript off as a third mode), and add the Bengali cookie case to WP-SB8 for D2.

## 7. Not verified

- Real phones, Safari and Firefox (Chromium only); real scroll feel and pinned scenes on touch.
- Screen readers (axe and the outline checks only).
- Truthfulness of each country fact on /countries (they are the catalogue's; this run checked only that they carry a source or "No Source Given" and a date or "Date Not Recorded").
- Live production; this was a local production build with placeholder settings and no database (/status showed its no-database state; /trust showed no published routes).
- Layout shift and Lighthouse numbers.
- Bengali on /privacy, /terms, /status, /invitation and /pilot-access-denied.
- The signed-in variants (header Countries link to /app/countries, "Open Your Workspace").
- Contrast beyond what axe measures on the default (finished) step of each scene.

## 8. Fixed in PUBFIX (PR #635)

| # | Fixed by |
|---|---|
| D1 | How It Works line now reads "You look over the case before it moves on."; the matching row in PUB-bn-words.csv is changed |
| D2 | Phone spacing trimmed (landing-c1.css, countries.css); Home and Countries end at or under 4,962 px in English and Bengali; Bengali cases (chosen through the real language switch) added to WP-SB8 |
| D3 | `.p3-eyebrow` line height 1.25 |
| D4 | `.pub-scene-stage` top padding 0.5rem (Home scenes keep their own spacing) |
| D5 | For Agencies button words read the Home catalogue entries |
| D6 | Countries and For Agencies use publicText and pass the page language to shared parts |
| D7 | 44 px targets for header links, language switch, footer links, pilot notice link and Hide button |

Guard (section 6): home-layout-overlap.spec.ts now covers all five public pages plus a JavaScript-off pass.
