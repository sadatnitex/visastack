# PUB3 records text (draft for the Guardian)

Unit PUB3: How It Works and Privacy and Trust. Branch claude/pub3-how-it-works-trust.

## Known issues (append to docs/commercial-v1/known-issues.md)

## 18 Nov 2026: WP-PUB3 How It Works and Privacy and Trust

- New page How It Works (/how-it-works). It tells the case story as one scroll story: a dark opening, a scene where the case line fills stage by stage (Getting Started, Gathering Documents, Being Checked, Ready to Submit, Submitted - the product's own stage words, read from the code that names them on the Trips list), a dark chapter that says who stays in charge (Suggested is not Confirmed, Saved is not Shared, Received is not Reviewed), and a light closing with the sign-in button. The drawn case and its readiness ring are tagged Example and carry "Completeness only. Not an approval." Submitted never reads as a decision. The header's How It Works link now opens this page.
- Privacy and Trust (/trust) is rebuilt as a story: a dark opening ("Your documents. Your decisions."), a share scene (Saved, then Shared, then Shared for a limited time, then Access Ended, drawn with an Example traveller and an Example agency), the four promises, and the same route list as before in a light chapter. The tab and the menu both say "Privacy and Trust". The route list is unchanged in behaviour: 12 routes, Show More adds 12, search with ?q=, the pack pages, and the plain notice when the database is down. Search and Show More are still plain links and a plain form, so they work without JavaScript. The routes are now compact rows (one column on a phone, two from 900 px) so the whole page stays under the 6-screen budget.
- Below 760 px, with reduced motion, with data saver or without JavaScript, both scenes show their finished picture and stand still, and the stage list on How It Works shows every stage reached. On a wide screen the scene pins under the header and moves with the scroll.
- Page length (WP-SB8 trust budget stays at 6): a new check renders the real story and the real route section with 12 route cards, search and Show More (e2e/scroll-budget/PUB3-trust.fixture.tsx) and measures 5.43 screens on a phone and 4.89 on a desktop, without the shared header and footer. The whole real page, measured by putting the same 12 route cards into the built page, is about 5.84 screens on a phone and about 5.2 on a desktop (the share scene is 2 screens long). The existing no-database check stays (3.98 and 4.14).
- Approved guard corrections (Guardian 7, owner PUB decision 17 Nov 2026): the /trust tab title assertion in page-titles.test.ts is "Privacy and Trust"; the one pinned pixel position of the old /trust opening and its 12 px eyebrow in e2e/ux-public.spec.ts are replaced by checks that keep their intent (exactly one h1, it is #trust-story-title and the first heading in main, fully inside the first screen at 1440x900 and 360x640 below the notice and header and not covered, caption at least 12 px); the default header list in public-site.test.tsx expects /how-it-works. Applied at TURN after PUB2 merges: the header How It Works click in landing-locale.test.tsx (3 places), WP-SB8.spec.ts landing block (~73) and ux-public.spec.ts (~948).
- Budget script (scripts/programme/check-public-budget.mjs, against the production build): passed. /how-it-works first load 124,891 bytes gzipped (below Home's), /trust +1.5 KB over baseline, engine 1,535 bytes, pictures 0, nothing from another site. No new dependency, no database change, no new switch; one new co-located style file (apps/web/src/components/public-pub3-story.css), flat, colours only from the chapter tokens, no motion of its own.

## Red then green

Before the build (on main fc228fe plus the new tests only): `vitest run src/app/how-it-works src/app/trust src/lib/page-titles.test.ts` gave Test Files 3 failed, Tests 4 failed:
- src/app/how-it-works/page.test.tsx: the page did not exist (import of ./page failed).
- src/app/trust/page.test.tsx: `expected 'Privacy and Control' to be 'Privacy and Trust'`; the share scene regex did not match (`expected '<section class="trust-story land-wrap...' to match /data-scene="share"...`); `expected 0 to be greater than or equal to 3` (no dark or light chapters).
- src/lib/page-titles.test.ts: the title assertion changed to "Privacy and Trust".
After the build: the same command passes (58 tests with the accessibility page checks), and the browser spec e2e/public-site/pub3-how-trust.spec.ts passes 25 of 25 on a production build (on main both pages fail it: /how-it-works is a 404 and /trust has no scene).

## New words for the localization lane (Guardian, 18 Nov 2026)

Shown in English, marked lang="en" on a Bangla page, until the catalogue has them (home page words stay the PUB1 list):

| English | Where | Suggested key |
|---|---|---|
| Your Case, / Step by Step | How It Works headline | pub3.howItWorks.headline |
| Add your documents once. See what each case needs next. | How It Works opening | pub3.howItWorks.lead |
| Follow a Case / Every Case Has a Clear Next Step | case scene heading | pub3.howItWorks.sceneTitle |
| You pick a country and a route. / Documents join the case from your vault. / Each requirement is checked against what you saved. / Every item on the list is covered. / You sent it. The decision is not ours. | the five stage lines (the stage names are the product's own words) | pub3.howItWorks.stage1 to stage5 |
| Example Case: Japan Visit / Documents Ready | the drawn case and its ring | pub3.howItWorks.exampleCase |
| You Stay in Charge | dark chapter heading | pub3.howItWorks.chargeTitle |
| Suggested Is Not Confirmed / Saved Is Not Shared / Received Is Not Reviewed, each with one line | the three cards | pub3.howItWorks.card1 to card3 |
| Ready When You Are / Readiness shows how complete a case is. It is never an approval. | closing | pub3.howItWorks.closing |
| Your documents. / Your decisions. | Privacy and Trust headline (was fixed English text before) | pub3.trust.headline |
| Share only what you choose, for as long as you choose. | Privacy and Trust opening | pub3.trust.lead |
| Saved is yours alone. Nobody else can see it. / You switch on the items an agency may see. / Access ends when you choose. | the share scene lines | pub3.trust.moment1, moment2, until |
| How Your Records Are Protected | heading above the four promises | pub3.trust.promisesTitle |

Words read from the existing trust catalogue and unchanged: The Trust Model, Sharing Permissions, the passport and itinerary rows, Original files stay protected, Example Traveller, Example Agency, the four promises, the boundary line, View Privacy Details, Start with Your Own Profile. Catalogue keys no longer read by any page: trust.publicTrustStory.illustrationWithMadeUpDetails and trust.publicTrustStory.youChoose (the localization lane may retire them). The footer link keeps its own words (home.layout.privacyAndControl, "Privacy and Control"); the owner's menu name "Privacy and Trust" is the header and the tab. Also English for now: Example, the status chip words, "Completeness only. Not an approval.", the header's Home, Privacy and Trust and Countries.

## Not verified

- Scenes pinned and moving on a real phone or in Safari (checked in Chromium at 360x640, 400x860, 760x600, 1280x800 and 1440x900: finished stills below 760 px, reduced motion and without JavaScript; pinned stage fits one screen at 760x600).
- Search and Show More without JavaScript in a browser against a real database (the CI build has none): held by the page's unit tests (server rendered from the address) and the browser spec asserts the plain notice there.
- Layout shift and Lighthouse numbers on a live deployment (budget script and page length measured on a local production build only).
- Real contrast on every step state beyond the token pairs the guard test covers; the design review items are in the PR.
- Bengali for the words above; stale comment in apps/web/src/app/landing-story.tsx (line 7) still names the home anchor as the menu target (outside PUB3's files).
- The old /trust opening rules (.trust-hero, .trust-control, .trust-principles, .trust-bottom in globals.css) are now unused by the page; one is pinned by type-scale.test.ts, so they stay until a unit that owns globals.css retires both.
- Compact route rows do not yet show a flag, source or Checked On (layout only, as decided; the route data for them is not on the list query).
