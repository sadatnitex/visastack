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

## 9. Pass 2, 18 Nov 2026, main 19416e1e

Verifier: PUB5 pass 2 (Class B, docs only, did not touch product code). Build under test: main at 19416e1e1462013608755941024ea2d979c1f0b3 (PUBFIX #635, R1 to R5 reference rebuilds, NAV2 #653, MOT1 #651, ESS1 #654 on top of pass 1), one fresh production build (`next build`, 8 GB heap) served by `next start -p 3100` with the placeholder settings of CLAUDE.md section 6. Chromium 1243 from /opt/pw-browsers/chromium, `--no-sandbox`, throwaway Playwright configs and audit specs kept outside the repository. Routes: /, /how-it-works, /trust, /countries, /for-agencies, English and Bengali (cookie `visastack_locale=bn`, checked through `html[data-locale]`). Widths 320, 360, 390, 400, 768, 1024, 1280, 1440 for the matrix; 17 widths from 320 to 1920, including 1149, 1150, 1151, 1229, 1230 and 1231, for the header.

### 9.1 Verdict

No blocker. All seven pass 1 defects are fixed or have changed form. Pass 2 finds 3 Medium and 6 Low defects, listed in 9.5. The two that matter most to the owner: the Home first screen on a computer really does show very large, cropped document pictures with the readiness label cut by the fold (check d1), and the Countries flag ribbon never stops moving and has no Pause (check c).

### 9.2 Pass 1 defects, status now

| # | Status | Evidence on this build |
|---|---|---|
| D1 untrue "A person looks over the case." | Fixed by #635; the page was then rebuilt (R2) and the sentence is gone. Neither the old nor the new wording is on /how-it-works now | text search of the served page |
| D2 Bengali page length over 6 screens | Fixed by #635 | phone 390 x 844, 6 screens = 5,064 px: Home 4,772 (English), 4,960 (Bengali); /countries 4,603 and 4,692; no route over |
| D3 2 px eyebrow overlap | Fixed by #635 | overlap measure (HOT1's own) finds nothing on any route, 8 widths, motion on, English and Bengali (160 page loads); home-layout-overlap spec passes |
| D4 text clipped by the pinned stage | Fixed by #635 | same measure, nothing clipped at any width |
| D5 For Agencies button words | Fixed by #635 | both pages read "Sign in to get started"; Bengali "শুরু করতে সাইন ইন করুন" on both |
| D6 no `publicText` on /countries and /for-agencies | Fixed by #635 | on the Bengali pages every English word sits inside `lang="en"` (none unmarked on /for-agencies or /countries) |
| D7 targets under 44 px | Changed | header links, footer links, language switch, footer heights are 44 px. Still under: the Menu button (P2-4), footer links Terms (41 px wide) and Status (42 wide), pilot notice box 44 x 43 (P2-9) |

### 9.3 Pass 1 checks re-run

| Check | / | /how-it-works | /trust | /countries | /for-agencies |
|---|---|---|---|---|---|
| Status 200, `data-locale` right, no console errors, English and Bengali | P | P | P | P | P |
| No sideways scroll, 8 widths, motion on, English and Bengali | P | P | P | P | P |
| Overlap and clipping, 8 widths, English and Bengali | P | P | P | P | P |
| One h1, first heading in main, inside the first screen | P | P | P | P | P |
| axe serious or critical (360, 390, 1280; English and Bengali) | P (0) | P (0) | P (0) | P (0) | P (0) |
| Every Bengali word inside `lang="bn"` | P | P | P | P | P |
| Page length, phone 390 x 844, English / Bengali, screens of 6 | 5.65 / 5.88 P | 5.36 / 5.54 P | 4.65 / 4.83 P | 5.45 / 5.56 P | 3.41 / 3.51 P |
| Page length, computer 1280 x 800, English / Bengali, screens (budget 12 Home, 6 others) | 11.73 / 11.82 P | 6.02 / 6.10 F [P2-5] | 5.54 / 5.65 P | 5.65 / 5.80 P | 3.08 / 3.13 P |
| Words on first screen 360 x 640, English / Bengali (main only, max 30) | 30 / 34 (limit exactly, then over) [P2-3] | 13 / 13 | 39 / 38 F [P2-3] | 26 / 26 | 25 / 29 |

Existing browser specs on the same build (public-site/*, WP-SB1 to SB8, WAL0, WAL3, WALD3, ux-public, browser-security, no-secret-auth): 479 passed, 1 skipped, 2 failed on the final run. The 2 failures are the two known local WP-LIFT-B case-page checks (page 3,480 px against 3,470, the signed-in case page, not a public page; MOT1's records list the same two as known local reds that CI passes). Every public-site, browser-security and no-secret-auth test passed (343 of 343 public-site on the first run). A first run of the signed-in preview specs showed hundreds of "Build failed" reds that were my harness (config started from outside apps/web); started from apps/web they pass, so none of those reds is a finding. Unit guards (public-site, page, how-it-works, trust, countries, for-agencies, layout header and footer, page-titles, title-case, vocabulary): 18 files, 290 tests, all passed.

### 9.4 New work since pass 1

**b) Header, menu and footer (NAV2 #653).** Passed except P2-4.

- Header on one line: 170 combinations (5 routes, 17 widths, English and Bengali): no link or button wraps (text-node check, plus the NAV2 spec), nothing leaves the bar, no sideways scroll.
- Menu fallback point, measured on all five routes: English shows the Menu button at 1150 px and below, hides it at 1151 px and above; Bengali shows it at 1230 and below, hides it at 1231 and above. This is exactly the NAV2 number.
- Menu behaviour at 390 x 844 on every route, English and Bengali (10 of 10): opens on click and on Enter, focus moves into the panel, Escape closes and returns focus to the button, a press outside closes, tabbing out of the menu closes it, Shift+Tab out closes it.
- Footer: three groups named Product, Trust, Account (Bengali প্রোডাক্ট, আস্থা, অ্যাকাউন্ট); Product holds How It Works, Countries, For Agencies; Trust holds Privacy and Trust, Privacy, Terms, Status, About This Version; Account holds Sign In. One line under the brand: "One private profile for every visa." (Bengali "প্রতিটি ভিসার জন্য একটি ব্যক্তিগত প্রোফাইল।"). Group names are visually hidden under 400 px (by design, NAV2 records) and visible from 768 px; link rows 44 px tall; no overlap or clipping at 320, 390, 768, 1440. Footer height 210 px at phone English, 227 to 253 Bengali, 380 to 422 tablet and laptop.
- Wording left in English on Bengali pages (Low, in P2-8): header and footer "Home", "Privacy and Trust", "Countries"; footer "Status"; and the base line ends the pilot sentence with a Latin full stop ("পাইলট.").

**c) Motion (MOT1 #651).** Passed except P2-1 and P2-6. Measured while scrolling slowly through every route in four modes (pinned at 1440, reveal at 390, gentle at 1440 and 390), English and Bengali, with a frame sampler, a layout-shift observer and the overlap measure at every third scroll step.

- Mode attributes right: pinned `data-scene-mode=pinned`, `data-scenes=live`; phone `reveal`; reduced motion `gentle` on both sizes (pass 1's "`data-scenes` is never set under reduced motion" is superseded by MOT1, by design).
- Scenes advance: Home steps seen, pinned hero 5 to 0 to 1 to 3 to 5, add 2 to 0 to 1 to 2, ready 2 to 0 to 1 to 2, journey 6 to 0 to 2 to 6, share 3 to 0 to 1 to 3 to 4; reveal and gentle play the same steps once and rest on the finished step (journey 6, hero 5, add 2, ready 2, share 3).
- Page height does not change while a Home scene plays (pinned 10,235 px throughout; 4,772 px at 390 English). Layout shift while scrolling the whole page: Home 0.016 to 0.023 pinned, 0 to 0.003 reveal and gentle; /how-it-works 0 to 0.0005; /for-agencies 0 to 0.001; /countries 0.004 to 0.022; /trust 0.027 (computer) and 0.042 to 0.044 (phone), see P2-6.
- No sideways scroll in any frame.
- Reduced motion: the gentle mode animates opacity, colours and one transform per element, every transition 400 ms (the sampled transitions on all five routes at 1440 and 390; the distance of the transform was not measured here, MOT1 states an 8 px rise and its stylesheet guard enforces it); every Home scene ends on its finished step.
- After the page settles (6 s at the top): 0 running animations on every route and mode, except the Countries ribbon (P2-1): `r4-drift` on `.r4-ribbon-track`, 38 s, infinite, in pinned and reveal mode, 1 long-running animation per page.
- Overlaps found while a scene is mid-play are the sticky header sliding over content (not a defect, as pass 1 noted) and two transient cases in P2-6 and P2-9; the "Japan" and "Ready to Submit" words over the Home "Example names and counts" note that the sampler reported are hidden alternate steps of the ready scene (kit-sw), not visible at any scroll position (screenshots at four scroll positions of that scene show no overlap).

**d) The orchestrator's two Home checks.**

*(1) Desktop first screen, pictures against the viewport (pinned mode, scroll 0, motion allowed).*

| Viewport | Hero box | Side pictures (4) | Hero passport | Ready pill and Example line |
|---|---|---|---|---|
| 1280 x 800 | 704 px high, top 158 | each 330 to 359 px wide x 335 to 346 high (26 to 28 percent of the width, 42 to 43 percent of the height); the two upper ones are cut by the screen edge (152 px and 153 px outside) and the two lower ones by the screen edge and the fold (202 px below it) | 218 x 310, y 491 to 801, 1 px under the fold | ring pill at y 778 to 826: 26 px below the fold (cropped); Example line below the fold |
| 1440 x 900 | 804 px high | each 439 to 479 x 447 to 461 (30 to 33 percent of the width, about 50 percent of the height); outside the screen by 131, 133 and 31 px at the sides, lower two 208 px below the fold | 290 x 413, y 489 to 902, 2 px under the fold | ring pill 26 px below the fold, Example line cropped at the bottom edge |
| 1280 x 720 | 602 px high | 242 to 264 x 246 to 253 | 160 x 227 | ring pill 9 px below the fold |
| 1920 x 1080 | 804 px high | 439 to 479 wide; the lower two 112 px below the fold | 290 x 413 | ring pill inside |

So yes: at 1280 and 1440 wide, at the top of the page, four document pictures are cropped by the screen edges and the fold, and the readiness pill and its Example line are cut by the fold at 1280 x 800, 1280 x 720 and 1440 x 900. At 1920 x 1080 only the lower two side pictures are cut. In reduced motion (no scatter) the deck is smaller (each 169 to 264 px wide) and sits inside the screen except 3 to 9 px of the ring pill's bottom at 1280 and 1440. Screenshots (kept in the scratchpad, not committed): `d1-home-1440x900.png`, `d1-home-1280x800.png`. Cause: `kit.css` lines 140 to 190 start the side pictures at scale 1.5 and 45 to 52 percent of the deck width off centre (`--s0: 1.5`, `--x0: -45/-52`), and `home-story.css` lines 96 to 97 size the deck with `clamp(150px, calc(100svh - 500px), 400px)` so at 900 px high the deck is 400 px and ends below the fold once the notice, header and headline are counted.

*(2) "Know where it stands" first state.* The reference EhrC98mm1wBgY9JhafDHpz is a claude.ai artifact (read through the artifact tool, saved HTML), not a file under docs/design/harbor-v2 (a grep of docs and apps finds the id only in SESSION-START, the 18 Nov handoff and the R3 and R4 records). In the reference, `journey` starts at progress 0 on its first stage: stage index `floor(p * 7)` is 0, "Documents" with the "You" tag, and the track fills as you scroll to "Decided" with "Embassy". On this build:

| Mode | First state | After motion |
|---|---|---|
| Computer, motion allowed (pinned), 1280 and 1440 | Getting Started, tag You (matches the reference start) | Gathering Documents (You), Being Checked (Agency), Ready to Submit (Agency), Submitted (Embassy), Closed (Embassy) |
| Phone 390 (reveal, scene under 900 px wide), reduced motion (gentle), JavaScript off | Closed, tag Embassy, the whole track filled | the step moves 2, 4, 6 while it plays but the card keeps showing Closed (the card words follow the finished step by MOT1's design) |

Which state it should start on: Getting Started with the You tag, as in the reference. Pinned already does. The phone, reduced-motion and no-JavaScript visitor sees a case that is already Closed, which reads as the end of the story, and on a phone the track plays without the card changing. Suggested fix, for the Guardian to decide: let the card follow the playing step in this scene (reveal and gentle), and give the no-script picture a middle stage such as Being Checked (Agency) as its resting step instead of Closed. File: `apps/web/src/app/home-story.tsx` lines 261 to 281 (`finalStep={FIXTURE_STAGES.length - 1}`, `minWidth={900}`), with the card-follows-rest rule in `apps/web/src/components/public-site/scene.tsx` and `kit/kit.css`.

### 9.5 Pass 2 defects, ranked

| # | Severity | Route and width | Reproduction | Most likely file |
|---|---|---|---|---|
| P2-1 | Medium | /countries, any width with motion allowed (checked 1440 and 390, English and Bengali) | Open the page, wait 6 s. `document.getAnimations()` lists a running `r4-drift` on `.r4-ribbon-track` (38 s, infinite). The only pause is hover or focus inside the ribbon, but the ribbon view is `aria-hidden` and not focusable, so touch and keyboard visitors cannot stop it. Reduced motion stops it. This fails the "0 long-running animations after settle" rule and WCAG 2.2.2 (moving content over 5 s needs a Pause). MOT1 gave the two other loops a Pause button and missed this one | apps/web/src/app/countries/countries.css lines 276 to 286 (and the ribbon in countries/page.tsx) |
| P2-2 | Medium | / , 1280 x 800, 1440 x 900, 1280 x 720, motion allowed, scroll 0 | See 9.4 d1: four side pictures cropped by the screen edges and fold, readiness pill and Example line cut by the fold | apps/web/src/components/public-site/kit/kit.css:140-190, apps/web/src/app/home-story.css:96-97 |
| P2-3 | Medium | /trust 360 x 640 (39 words English, 38 Bengali); / Bengali (34) | Count the words of `main` fully or partly inside the first 360 x 640 screen. Pass 1 had /trust at 25. The 30-word rule is guarded only for English Home (pub2-home.spec.ts), so R3's rebuild slipped past. Home English sits at exactly 30 with no margin | apps/web/src/app/trust/page.tsx (R3 first chapter), apps/web/src/i18n/home.ts for Home |
| P2-4 | Low | all routes, English 1024 to 1150 px, Bengali 1024 to 1230 px | The Menu button is 69 x 26 (English) and 52 x 29 (Bengali) tall, against 44 px at 900 px and below (the 44 px minimum is only set for the phone range). Hit-tests fine. Screenshot `b-header-1024.png` in the scratchpad | apps/web/src/app/globals.css NAV2 block, the two `.site-navigation .site-menu-toggle` rules at lines 23974 and 24070 (add `min-height: 44px`) |
| P2-5 | Low | /how-it-works, computer 1280 x 800 | Page is 4,816 px (6.02 screens, English) and 4,878 px (6.10, Bengali) against 6 screens (4,800 px); 16 and 78 px over. R2's rebuild grew it from 4.77 (pass 1). WP-SB8 covers /trust and /countries only, so nothing guards it | apps/web/src/app/how-it-works/how-it-works.css, page.tsx |
| P2-6 | Low | /trust, 390 x 844 and 1440 x 900 | While scrolling, page height grows by 60 to 65 px (3,922 to 3,987 phone, 4,430 to 4,490 computer) with no scene playing, giving a layout shift of 0.042 to 0.044 on the phone (close to the 0.05 limit MOT1 used for Home) and 0.027 on the computer. Also during the rise-in the "today." heading sits over the paragraph below by 7 to 12 px for part of a second (gone once settled; settled pages are clean). Cause of the growth not located | apps/web/src/app/trust/share-hero.tsx (the timed share picture) or the "today" chapter in trust/page.tsx, not confirmed |
| P2-7 | Low (owner decision) | / on a phone, reduced motion, JavaScript off | The journey card starts on Closed with the Embassy tag; the reference starts on its first stage. See 9.4 d2 | apps/web/src/app/home-story.tsx:261-281 |
| P2-8 | Low | all five routes, Bengali | The header and footer keep English words (Home, Privacy and Trust, Countries, Status) and the base line uses "." instead of "।" after "পাইলট". This is the NAV2 words list already handed to the Bengali lane (record only; no new Bengali words found, PUB-bn-words.csv unchanged) | apps/web/src/i18n/home.ts (home.layout keys) and the bn catalogue |
| P2-9 | Low | all routes, 390 and 1440 | Footer links Terms and Status are 41 and 42 px wide (44 px high); the pilot notice box is 44 x 43. Hit-test fine | apps/web/src/app/globals.css NAV2 footer rules, pilot-notice rule |

Not product defects, recorded so nobody re-chases them: the sticky header over scrolled content in mid-scroll overlap samples; the Home ready scene's hidden alternate step words that the DOM overlap measure sees; the first-run "Build failed" reds of the signed-in preview specs (harness started from the wrong folder); the two WP-LIFT-B case-page reds known from MOT1.

### 9.6 Not verified in pass 2

- Safari and Firefox (Chromium only), real phones, real scroll feel and pinned scenes on touch.
- Screen readers (axe and outline checks only).
- Text above 100 percent and browser zoom (not tested; NAV2's breakpoints are in em so they move with text size, the number was not measured).
- Dark appearance (the public pages now alternate light and dark chapters on purpose, checked only through the unit guard `tonesAlternate`; no separate dark-preference pass was run) and forced colours.
- Live production (local production build with placeholder settings and no database, so /status shows its no-database state and /trust no published routes).
- Truthfulness of the page words beyond D1's sentence (the how-it-works case-flow sentences were not re-audited against the services code), and of each country fact.
- The signed-in variants (header Workspace, signed-in WP-LIFT-B checks).
- Lighthouse numbers; layout shift was measured only through the browser observer while scrolling.
- Bengali on /privacy, /terms, /status, /invitation and /pilot-access-denied.
- Whether the 30-word and 6-screen rules are meant for Bengali too (measured and reported, not ruled on).
