# LAND2 records: Bengali for the public pages (26 Nov 2026)

Branch `claude/nifty-meitner-iso6vc`. Draft pull request; not merged, not deployed. Owner decision for this work (26 Nov 2026): ordinary interface wording ships in Bengali; legal, privacy, consent, product-claim, status, authority and example wording is written out in full and HELD in English (marked `lang="en"`) until the owner or a qualified reviewer signs it off.

## How the gate works

- Every drafted line lives in `apps/web/src/i18n/*-messages.ts` as data: English, Bengali, a kind (`ordinary`, `claim`, `authority`, `status`, `example`, `legal`) and `live`. `live: true` shows the Bengali; `live: false` shows the English, marked English. Flipping one flag ships one line; nothing else changes.
- Nothing is approved by a person. Every row in the packet has review state `DRAFT_NOT_REVIEWED`. No page is described as approved.
- `public-lookup.ts` finds a line by its English text (or by catalogue key for words that live in an existing catalogue). `public-lookup.test.ts` fails if two lines share English with different Bengali or different release state.
- `BN_READY_ROUTES` now lists Home, How It Works, For Agencies, Countries, Trust, Status, Privacy, Terms and the account screens. A Bengali visitor on those pages gets `<html lang="bn">`; each held or untranslated English phrase carries its own `lang="en"`.

## Route coverage (from `docs/localization/data/public-bn/REVIEW_PACKET.csv`)

| Page | Live in Bengali | Held (written, shown in English) | Held kinds |
| --- | --- | --- | --- |
| Home and planner (`/`) | 81 | 14 | claim 3, authority 2, status 7, example 2 |
| Header, footer, notice banner (every page) | 15 | 5 | status 4, claim 1 |
| Browser tab titles (every public page) | 26 | 0 | none |
| How It Works | 40 | 3 | claim 2, authority 1 |
| For Agencies | 25 | 9 | claim 3, authority 2, status 3, example 1 |
| Countries and Sources | 26 | 10 | authority 9, example 1 |
| Privacy and Terms | 6 | 28 | legal 28 (every paragraph) |
| Privacy and Trust | 17 | 25 | claim 21, authority 2, status 2 |
| Status | 20 | 10 | status 10 |
| Account, errors, invitations, payments | 9 | 8 | claim 2, status 2, legal 4 |
| Shared pictures (example figures) | 22 | 1 | example 1 |
| Total | 287 | 113 | |

## Exceptions

- `/trust/[packKey]`: no packs are published, so it is not reachable signed out; its page is wired the same way but only covered by a unit test.
- Official route information on country pages (visa rules, offices, sources) stays English by the 12 Nov 2026 owner decision and is marked English.
- Country names in Bengali come from the platform's `bn-BD` region names; the value sent to the lookup stays the English catalogue name, so `/countries?q=` and the no-script path are unchanged.
- Terms and Privacy keep the substance of the English text. The Bengali of every paragraph is held for a legal reader; the English stays authoritative.
- Signed-in screens are outside this work.

## Evidence

- Web test suite: 910 files, 10,095 tests, all passed. `tsc --noEmit` clean. Biome clean. Flat-design, UI ratchet, route navigation checks pass. `pnpm run test:node`: 285 passed.
- Production build passes. Playwright (throwaway config, production build with placeholder auth): ux-public, browser-security, no-secret-auth and public-site specs, 679 passed, 15 skipped by design; the two failures seen on the first run (a 31-word first screen on `/trust` in Bengali, and a new check that expected a Bengali H1 on a page whose H1 is held) were fixed and the affected specs rerun green.
- A crawl of 14 routes under Bengali found no unmarked English text.
- Screenshots (phone 390 and desktop 1440): `docs/localization/data/public-bn/shots/`.

## NOT verified

- No Bengali reader has reviewed any line. Idiom, tone and the register's `review_state` are all open.
- The production site was not re-crawled after this change (not deployed).
- Real-device rendering of Bengali conjuncts at small sizes.
- Bengali on signed-in screens.

## Review round (26 Nov 2026, /code-review high)

Five findings, all fixed: the message files no longer ship to the browser (the server passes the few live keyed lines through the provider, the status list and the sharing picture are worded on the server; `public-lookup.test.ts` guards client components against importing the lookup); figure labels that had lost their English mark now go through the lookup; a Bengali tab title appears only on a page marked Bengali; the Home planner reuses the Countries page's country-name fallback; repeated sentence tokens get unique keys.
