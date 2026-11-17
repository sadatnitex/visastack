# PUB1 records text (draft for the Guardian)

## Known issues (append to docs/commercial-v1/known-issues.md)

## 17 Nov 2026: WP-PUB1 public site foundation

- The header now lists the five public pages in one list: Home, How It Works, Privacy and Trust, Countries, For Agencies. "Product" left the header. How It Works, Countries and For Agencies point at the matching part of the home page until their own pages ship (PUB3, PUB4), and a signed-in person's Countries link opens their country list in the app, since the home page's country picker is for visitors; every footer link is unchanged. Bangla visitors see How It Works and For Agencies in Bangla; Home, Privacy and Trust and Countries stay English (marked as English) until the catalogue has those words.
- New shared parts for the public pages (not used on any page yet): scroll scenes and their engine (it pins scenes just below the header, reads the page before it changes it, and a tiny early script in the page head marks scenes before the first paint so nothing jumps), chapters, buttons, story cards, the Example tag, status chips, the readiness ring with "Completeness only. Not an approval.", a ring of flags, self-hosted pictures and the tilting Bangladesh passport cover. Without JavaScript, with reduced motion, with data saver or on a phone, every scene shows its finished picture and stands still; the same on screens lower than 600 px, so nothing is cut off when zoomed.
- One new depth stylesheet (public-scenes.css) joins the flat-design exception list (ADR 0029, amends ADR 0027). Depth sits only on an element marked for it, and the browser flat check now skips only that element, so a shadow on anything inside a dark chapter still fails. Colours are brand tokens only, and other pages do not inherit the public colour names; a test holds text at 4.5:1 and chips at 3:1 on both dark and light chapters. The design contract, the contrast and surfaces note and SESSION-START now name this file.
- New budget check (scripts/programme/check-public-budget.mjs): first-load JavaScript per public page at most 10 KB over main's baseline, the scroll engine at most 2 KB, pictures at most 150 KB per page, nothing loaded from another site. It only ever asks the site itself, never reads a file outside the site's public folder, and gives up on a slow request.
- The new browser checks for the shared frame (apps/web/e2e/public-site/) now run on every pull request.
- Bangla visitors now see Home, Privacy and Trust and Countries in English in the header (marked as English) where Product and Privacy and Control were in Bangla before; the Bangla words are on the list for the localization lane.
- NOT verified: scenes on a real page (no page uses them until PUB2); the scroll engine on real phones and in Safari; back-forward cache restore in a real browser (unit-tested only); a measured layout shift on a real scene (no page has one until PUB2; the spec proves the early mark is set before React starts); the budget baseline came from a main build that compiled but ran out of memory in a later build step on this machine; Bengali for Home, Privacy and Trust, Countries and Example; the /trust page title still reads "Privacy and Control" (PUB3).

- Fix after review: the early scenes script reads its nonce through ScenesBoot (scenes-boot.tsx), which, like the request path reader, gives none when there is no request, so the signed-in shell renders in unit tests again; the whole web test suite was run on the fixed head.

- Second fix after review: the early scenes mark is now a small same-site file (apps/web/public/scenes-boot.js) loaded with the page's nonce, instead of a script written into the page, so the supply-chain scan stays clean; the page's own security policy lets it run (browser-checked), and it is served fresh after every change.

## New words for the localization lane (Guardian, 17 Nov 2026)

Shown in English, marked lang="en" on a Bangla page, until the catalogue has them:

| English | Where | Suggested key |
|---|---|---|
| Home | header list (public-nav.ts) | home.layout.home |
| Privacy and Trust | header list (public-nav.ts) | home.layout.privacyAndTrust |
| Countries | header list (public-nav.ts) | home.layout.countries |

Also English for now: Example (Example tag), the status chip words (Received, Reviewed, Suggested, Confirmed, Saved, Shared, Access Ended) and "Completeness only. Not an approval." (not on any page until PUB2).

## Approved guard corrections (Guardian, 17 Nov 2026)

- apps/web/e2e/ux-public.spec.ts:937: the phone menu's first focused link is now Home (was Product).
- apps/web/src/lib/page-titles.test.ts: asserts the header's /trust entry reads Privacy and Trust, the layout draws the header from the public list, the footer keeps its /trust link, and the /trust title stays Privacy and Control (PUB3 changes it). Each assertion was broken on purpose and went red.

## Ledger text (for the Guardian to place)

- Public site foundation (WP-PUB1, ADR 0029): shared public parts and scroll engine in apps/web/src/components/public-site; header lists five public pages from public-nav.ts with LIVE_ROUTES fallbacks; flat-design exception list has three entries (landing-c1.css, pictures-depth.css, public-scenes.css); public budget check in scripts/programme/check-public-budget.mjs. Status: DONE for the foundation; scenes on pages follow in PUB2 to PUB4.
