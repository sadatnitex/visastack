# MOB1 records: the Home page on a phone in about four screens (19 Nov 2026)

Owner words: Unit B approved "1-yes" (19 Nov 2026); mock approved "phn mock okay for now", confirmed "confirmed. without any compromise with quality, standards, obejctives, speed, effeciencyu"; added scope "2-Do" (write the two new Bengali public beta lines now). Class B, lean route. Base main `887b6bb2` (PUBW1 merged). Measured on one local production build (`next start`, placeholder settings of CLAUDE.md section 6), Chromium.

## What a phone shows now (below 760 px)

| Part | Before | After |
|---|---|---|
| Hero | pill, two buttons, fan of five papers, readiness ring and note | the main button, "See What Works Today" as a text link, the Bangladesh passport cover alone with one Example tag; no pill, no fan, no ring |
| Bottom action | none | the page's own main button pinned at the bottom after the first screen, gone for the closing call and the footer |
| Add it once | three steps stacked, three fields, "Example record." | steps in one row with the lit step's line under them, two fields (Surname, Passport Ends), Example tag only |
| Ready for every trip | eight papers | four papers and a See All 8 button that opens the rest in place (`aria-expanded`); the second sentence and the "reused / to add" line are for larger screens; "Completeness only. Not an approval." once on the page |
| Know where it stands | starts on Getting Started (PUBFIX2) | unchanged; the repeated caption is for larger screens, the Example tag stays |
| You decide who sees what | three rows | two rows (Passport, Photo); the narrating captions are for larger screens |
| Every rule shows its source | three stacked cards | one swipe row, scroll-snap, next card peeking; takes focus only when it really scrolls (keyboard arrows) |
| Agencies | sentence, cases list | "Clients keep their own record." and the For Agencies button; the cases list is for larger screens (this removes the cases-note overlap PUBFIX2 measured) |

Computers (1280 and 1440 wide) are unchanged: every rule that changes what a phone draws sits inside `@media (max-width: 759px)`, the few rules outside it only hide phone-only parts or flatten a wrapper (`display: contents`).

## Measured at 390 x 844 (every visible word of the Home story counted, header and footer excluded)

| | English | Bengali |
|---|---|---|
| Words | 278 (was 385 before MOB1 on the same build) | 291 |
| Page height | 3,473 px = 4.11 screens | 3,570 px = 4.23 screens |
| Sideways scroll | none | none |

Closing chapter wording (the public beta notice, 69 words with the Example caption) is not cut. Target was about 250 words; the gap is the legal wording and the Example captions, which stay.

## Proof

| Check | Result |
|---|---|
| Desktop pixels vs main | 24 screenshots (12 per size) at 1440x900 and 1280x800 compared byte for byte with a build of main; all 24 match. One frame (1280x800, number 03) differs between two runs of main itself (motion), and mine equals one of those two runs. A first version split the agencies sentence in two text nodes and moved one glyph by a pixel; fixed with a phone-only short line, which is why the long and short lines are separate elements |
| New browser spec `mob1-phone-density.spec.ts` | 43 tests at 360, 390, 412 and 1280/1440; on main's build 30 fail (the 3 that pass are journey checks that were already true). Deliberate breaks (a margin that makes the sentence overlap the buttons, a wrong selector for the share row, a wrong id for the closing chapter) turned 11 tests red; restored |
| Unit test `home-story-mob1.test.tsx` | the stylesheet guard allows exactly seven selectors outside the phone query; adding `.hs-cases { display: none }` outside it fails the test (shown red once, restored); PhoneMore, SwipeRow, PhoneActionBar behaviours |
| Overlap | HOT1 rules extended to 360, 390, 412, live and reduced motion, with the papers opened; none |
| Accessibility | axe (WCAG 2 A, AA, 2.2 AA) at 360 and 390 with the bottom bar showing and the papers opened, English and Bengali: no serious or critical problem |
| Targets | every control on the phone Home page is 44 px or more |
| Full check `scripts/agent/full-check.sh` on `45d77f72` | install, audit, lint, typecheck, test, webtest, build, supply chain, no-secret Playwright (all browser tests) and smoke: all exit 0 |

An earlier full check on `86c314e3` found three things, all fixed before this head: stylesheet formatting, `scripts/no-auth-bypass.test.mjs` (my spec added a cookie by name; it now submits the language form instead), and `ux-public.spec.ts:76` (see below).

## Decisions and design notes

- The bottom action is drawn only after the page has started in the browser. Its visibility depends on scrolling, which needs script; without script it would be a permanently hidden duplicate link in the page and in the tab order. `page.test.tsx` counting the main link is how this was noticed, but the reason is the design, not the count.
- See All 8 and the swipe row's focus stop also appear only after the page has started, so without script a phone shows every paper and the cards are an ordinary scroll row.
- Guardian 18 allowed editing `apps/web/e2e/ux-public.spec.ts` lines 75 to 85 only: on a phone the hero pill is now expected hidden and the availability wording is proven in the pilot banner on the first screen; a new 1440x900 test keeps the pill visible on computers. The pill is NOT removed on desktop.
- "Create your free account" on the bottom bar follows the page's own button (it reads "Sign in to get started" in a private pilot and "Open your workspace" when signed in).

## Bengali (owner request "2-Do")

| Key | English | Bengali (draft, awaiting owner review) |
|---|---|---|
| `home.page.itIsFreeToUseAt` | It is free to use. The status page shows exactly what works today. | এটি বিনামূল্যে ব্যবহার করা যায়। আজ ঠিক কোনটি কাজ করছে তা স্ট্যাটাস পাতায় দেখা যায়। |
| `home.layout.footerAsIs` | Provided as is during the public beta. | পাবলিক বিটা চলাকালে যেমন আছে তেমনভাবেই দেওয়া হয়। |
| `home.phone.seeAll` | See All {count} | সব {count}টি দেখুন |
| `home.phone.showFewer` | Show Fewer | কম দেখান |

Vocabulary taken from register rows SG-57e8fee4 (free to use, status page, what works today), SG-affa8338 (status page), SG-58c298b7 ("provided as it is"), SG-f7012c57 (public beta, "during"). Two register rows added (SG-392e925a, SG-b87f6d55) as `ASSIGNED_NOT_REVIEWED` and `DRAFT_NOT_FOR_RELEASE`; the two PUBW1 rows in `PUB-bn-words.csv` now say superseded by the draft; MOB1 rows added for the two phone keys and the passport picture's text alternative (English, marked as English on a Bengali page).

## Files

`apps/web/src/app/home-story.tsx`, `home-story.css` (WP-MOB1 block, no `globals.css` edit), `apps/web/src/components/public-site/phone-actions.tsx` (new), `apps/web/src/i18n/home.ts`, `home.sources.json`, `apps/web/e2e/public-site/mob1-phone-density.spec.ts` (new), `apps/web/src/app/home-story-mob1.test.tsx` (new), `apps/web/e2e/ux-public.spec.ts` (lines 75 to 85, by Guardian 18's word), `docs/localization/VISASTACK_TRANSLATION_REGISTER.csv` (two rows), `PUB-bn-words.csv`, this file and `mob1-shots/` (first screens at 390 x 844, English and Bengali).

## Not verified

Safari and Firefox, real phones and their safe-area insets, screen readers on the bottom bar and the swipe row, Bengali beyond the first-screen check and the axe run (the Bengali lines are drafts the owner has not reviewed), the Bengali wording of the passport picture text alternative, and how the page behaves on a phone with data saver on.

## Review G18 (19 Nov 2026)

Review G18: 3 fixes + 2 nits applied. (1) the spec checks exactly one link in the bottom bar with the same words and address as the hero button; (2) the swipe row follows the 760 px line (media query listener, cleaned up) so a widened window drops its focus stop and role, with a unit test; (3) the swipe row has an inset focus ring; nits: the share row hides through a data attribute instead of position, the header offset is measured (fallback 72 px). Desktop byte identity is proven only locally: the CI copy of that test is skipped without baselines. Not done on purpose (follow-ups): header Sign In style on phones, Bengali pilot-banner-short, hero reassurance line, viewport-fit.


Superseded, replaced by `docs/upgrades/programme/pub/LAND1-records.md` (26 Nov 2026): the Home page this record describes is replaced by the approved homepage; the text above stays as history.
