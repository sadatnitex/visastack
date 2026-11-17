# PUB1 records text (draft for the Guardian)

## Known issues (append to docs/commercial-v1/known-issues.md)

## 17 Nov 2026: WP-PUB1 public site foundation

- The header now lists the five public pages in one list: Home, How It Works, Privacy and Trust, Countries, For Agencies. "Product" left the header. How It Works, Countries and For Agencies point at the matching part of the home page until their own pages ship (PUB3, PUB4), and a signed-in person's Countries link opens their country list in the app, since the home page's country picker is for visitors; every footer link is unchanged. Bangla visitors see How It Works and For Agencies in Bangla; Home, Privacy and Trust and Countries stay English (marked as English) until the catalogue has those words.
- New shared parts for the public pages (not used on any page yet): scroll scenes and their engine, chapters, buttons, story cards, the Example tag, status chips, the readiness ring with "Completeness only. Not an approval.", a ring of flags, self-hosted pictures and the tilting Bangladesh passport cover. Without JavaScript, with reduced motion, with data saver or on a phone, every scene shows its finished picture and stands still; the same on screens lower than 600 px, so nothing is cut off when zoomed.
- One new depth stylesheet (public-scenes.css) joins the flat-design exception list (ADR 0029, amends ADR 0027). Colours are brand tokens only; a test holds text at 4.5:1 and chips at 3:1 on both dark and light chapters.
- New budget check (scripts/programme/check-public-budget.mjs): first-load JavaScript per public page at most 10 KB over main's baseline, the scroll engine at most 2 KB (1.1 KB now), pictures at most 150 KB per page, nothing loaded from another site.
- NOT verified: scenes on a real page (no page uses them until PUB2); the scroll engine on real phones and in Safari; back-forward cache restore in a real browser (unit-tested only); the new browser spec apps/web/e2e/public-site/pub1-foundation.spec.ts is not in the PR browser-check list (pr-browser-checks.yml runs a fixed list; adding public-site/ needs a workflow line outside PUB1); the budget baseline came from a main build that compiled but ran out of memory in a later build step on this machine; Bengali for Home, Privacy and Trust, Countries and Example; the /trust page title still reads "Privacy and Control" (PUB3).

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
