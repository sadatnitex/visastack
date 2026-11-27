# Public Bengali inventory: what a visitor sees under বাংলা (26 Nov 2026)

Measured, not assumed. Main at `630b6bed` (LAND1, #664), built locally (`NODE_ENV=production`, `DEPLOYMENT_MODE=controlled_pilot`, registration closed, no database) and crawled with a real browser at 390 and 1440 px with the `visastack_locale=bn` cookie, signed out. The same crawl was run against production (`https://vs.obsidianglobal.studio`, reached directly; the fallback host was not needed). Every closed disclosure was opened first, so answers inside accordions count.

Raw data: `data/public-bn/PUBLIC_ENGLISH_REMAINING_2026-11-26.csv` (every English string still shown, with the routes it appears on).

## Result in one line

No public page is fully in Bengali. Across the 25 routes crawled there are **420 distinct English items** under বাংলা (390 text strings, 9 accessible names, 1 placeholder, 1 image text, 18 page titles, 1 meta description). No page title and no meta description is Bengali on any route. Local main and production agree (differences of 1 to 5 strings on auth pages come from sign-in options only production shows).

## Route table

Columns: distinct English strings visible under বাংলা at 390 px on this build (local) and on production; accessible names still English; whether the page title or description is Bengali.

| Route | HTTP | `<html lang>` under bn | English strings (local) | English strings (production) | English accessible names | Title in Bengali | Description in Bengali |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 200 | `en` | 99 | 99 | 3 | no | no |
| `/how-it-works` | 200 | `en` | 84 | 84 | 6 | no | no |
| `/for-agencies` | 200 | `en` | 47 | 49 | 3 | no | no |
| `/countries` | 200 | `en` | 106 | 107 | 6 | no | no |
| `/countries?q=Japan` | 200 | `en` | 107 | - | 6 | no | no |
| `/trust` | 200 | `en` | 68 | 67 | 3 | no | no |
| `/status` | 200 | `en` | 38 | 37 | 1 | no | no |
| `/privacy` | 200 | `en` | 34 | 34 | 1 | no | no |
| `/terms` | 200 | `en` | 27 | 27 | 1 | no | no |
| `/auth/sign-in` | 200 | `bn` | 18 | 23 | 1 | no | no |
| `/auth/sign-up` | 200 | `bn` | 22 | 24 | 1 | no | no |
| `/auth/forgot-password` | 200 | `bn` | 16 | 16 | 1 | no | no |
| `/auth/reset-password` | 200 | `bn` | 16 | - | 1 | no | no |
| `/auth/verify-email` | 200 | `bn` | 16 | 16 | 1 | no | no |
| `/auth/account-recovery` | 200 | `en` | 21 | - | 1 | no | no |
| `/auth/confirmed` (a signed-out visitor is sent to `/auth/sign-in`) | 200 | `bn` | 19 | - | 1 | no | no |
| `/auth/accept-terms` (a signed-out visitor is sent to `/auth/sign-in`) | 200 | `bn` | 18 | - | 1 | no | no |
| `/auth/reauth` (a signed-out visitor is sent to `/auth/sign-in`) | 200 | `bn` | 18 | - | 1 | no | no |
| `/auth/social-return` (a signed-out visitor is sent to `/auth/sign-in`) | 200 | `bn` | 19 | - | 1 | no | no |
| `/invitation` | 200 | `en` | 14 | 14 | 1 | no | no |
| `/collect` | 404 | `en` | 18 | - | 1 | no | no |
| `/oauth/authorize` (a signed-out visitor is sent to `/auth/sign-in`) | 200 | `bn` | 18 | - | 1 | no | no |
| `/payments/result` | 200 | `en` | 15 | - | 1 | no | no |
| `/pilot-access-denied` (a signed-out visitor is sent to `/auth/sign-in`) | 200 | `bn` | 18 | - | 1 | no | no |
| `/no-such-page` | 404 | `en` | 18 | 18 | 1 | no | no |

Notes on the table:

- `<html lang>` is `en` on pages that are mostly English and `bn` on pages that are mostly Bengali (the page-language rule in `lib/page-language.ts`). That is why Home, How It Works, For Agencies, Countries, Trust, Status, Privacy, Terms, Invitation and the error pages are marked English while their few Bengali messages carry their own `lang="bn"`.
- About 17 English strings are shared chrome, drawn on every page: the pilot banner label and link, the header menu entries (Prepare a Case, Your Reusable Record, Country Guides, Privacy and Trust, Common Questions), the footer line and group names (Travellers, Workspaces, Trust and Support), Status, the legal row label, and the language switch's own word "English" (correct as it is).
- The Home page measured here is the LAND1 page: its 99 English strings are almost all of the page, because LAND1 shipped the approved English copy marked `lang="en"`.

## Routes reached, and routes not reachable signed out

Reached and measured: `/`, `/how-it-works`, `/for-agencies`, `/countries` (and `/countries?q=Japan`), `/trust`, `/status`, `/privacy`, `/terms`, `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/account-recovery`, `/invitation`, `/payments/result`, the not-found page.

Signed out, these send the visitor to sign-in (so their own copy is not reachable signed out): `/auth/confirmed`, `/auth/accept-terms`, `/auth/reauth`, `/auth/social-return`, `/oauth/authorize`, `/pilot-access-denied`. The sign-in screen they land on shows notices for some of them (`?n=confirmed`, `?e=social`); those notice lines are part of the sign-in screen's copy.

Not reachable now: `/trust/[packKey]`. The Trust page draws its route cards from published packs, and none are listed on the live site or in the local build (no links to `/trust/...` on either), so no pack page can be opened signed out today. Its code and copy are inventoried in Phase 2; it cannot be checked live until a pack is published. `/collect` answers 404 signed out (it needs a request link) and shows the "Document Request" not-found state; the guest upload screens behind a real link are likewise not reachable without one.

## What is already Bengali

Header: the How It Works label, For Agencies, the language switch, Sign In, Get Started, Workspace, Privacy and Control; footer: Privacy, Terms, copyright line; notice: the beta and pilot sentences; sign-in and sign-up screens: mostly Bengali (about 18 to 24 English strings left each, notices, option labels and the third-party sign-in buttons); Privacy and Terms: titles and the version notice only.

## What the rules say about new Bengali (why this is a gated task)

- `docs/localization/handover/WAVE-BRIEF.md` rule 13: Bengali comes only from register rows through the codemod; never written into a catalogue by hand. New drafting is a separate register task.
- `scripts/i18n/register.mjs`: only rows in the released queues (ordinary UI, commercial, privacy/consent/legal) and not in `HOLDBACK` go live; official visa rules and invoice/receipt record content stay English with a Bengali note (owner decisions of 2026-11-12).
- The 2026-11-12 sign-off was a blanket approval of the rows that existed then, "given without a line-by-line reading". The LAND1 strings, the new header and footer words and most of what is in the CSV are not register rows and have no approval of any kind.
- `docs/localization/data/drafts/OWNER_DECISIONS.json`: the owner is editor and legal reviewer; emails, staff and admin screens, official visa rule content and billing documents stay English.
