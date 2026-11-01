# Scroll budget: measured heights

WP-SB10 (Integration and enforcement), 1 November 2026. Plan: `docs/upgrades/programme/SCROLL-BUDGET-PLAN.md` sections 1 and 5.

One screen is 844 px on a phone (390 by 844) and 800 px on a desktop (1280 by 800). Budgets (plan section 1): public landing 6 screens, dashboard or overview 2, task, form or settings 3, legal pages no limit. A plain list is held by rows (10 for travellers, 25 for agency and staff, then Show More), not by screens: the staff lists in `WP-SB7.spec.ts` (organizations 25 rows, members 20, a pack's 25 requirements) are checked against 6 screens with their row caps proven by the page tests, and measure 4.13 to 5.84 phone screens. The sweep in section 4 counts lists as 3 screens to be strict.

## 1. Where things stand

- Every check in `apps/web/e2e/scroll-budget/` now enforces by default (`DEFAULT_MODE = 'enforce'` in `support.ts`). A check fails a page that is over its budget unless it names its own mode. A guard in `WP-SB0.spec.ts` reads the switch directly, so a local `SCROLL_BUDGET_MODE` cannot hide a change to it; with the default set back to report it went red.
- Each reported exception carries a `ceiling`: it still fails, in every mode, if the page grows past that many screens (the same guard proves a ceiling fails).
- CI: `.github/workflows/pr-browser-checks.yml` runs the `scroll-budget/` folder in "No-secret Playwright checks" on every pull request (line 123).
- Local run, production build of `3535437e` plus the four mode changes below: 53 passed.

## 2. Known exceptions (reported, not enforced)

Each is still printed with its height on every run.

No known exception remains (lane Z, 1 Nov 2026). The last one, Documents on a phone, is fixed: the shared list in `apps/web/src/components/document-wallet-browser.tsx` shows 6 rows a page on a phone and 12 on a desktop, every document still reached through Previous and Next. Before: 2,955 px, 3.50 screens. Now: 2,025 px, 2.40 screens, against 3 (2,532 px); `WP-SB4.spec.ts` enforces it on both screens.

Fixed by WP-SB11 (1 November 2026), now enforced, measured on a local production build of the WP-SB11 head:

| Page | Viewport | Before | Now | Budget | What changed |
|---|---|---|---|---|---|
| Agency Clients (15 invitations, requests 10 a load) | phone | 3,558 px, 4.22 | 2,058 px, 2.44 | 3 | The pending invitations fold into their own counted group (open while there is no request, or while paging invitations); requests show 10 at a time, then Show More |
| Agency Clients (same) | desktop | 2,913 px, 3.64 | 1,934 px, 2.42 | 3 | Same |
| Agency Dashboard table (10 most urgent of 200, all seven columns) | phone | 2,616 px, 3.10 (5-column copy) | 1,610 px, 1.91 | 2 | On a phone each case is a compact card with every label kept; the first 5 show and the other 5 stay on the page behind Show the Other 5 Cases; the fixture now carries the page's seven columns and readiness ring |
| Agency Dashboard table (same) | desktop | 977 px, 1.22 (5-column copy) | 1,339 px, 1.67 | 2 | All 10 cases, no fold |
| Case snapshot, first group open (60 rows) | phone | 4,998 px, 5.92 | 1,469 px, 1.74 | 2 | Each part draws its first 8 rows; Show All inside the part unfolds the rest, which stay on the page |
| Case snapshot, first group open | desktop | not measured | 1,185 px, 1.48 | 2 | Same |

New guards that must stay red: Clients with both lists open (3,709 px, 4.39 phone screens), the Dashboard table with all 10 cases unfolded on a phone (2,838 px, 3.36) and the snapshot with every row drawn (7,814 px, 9.26).

Close to budget (under 10 percent headroom, may turn red from an unrelated style change): the landing page on a desktop (4,411 of 4,800 px), the staff organizations list on a phone (5.84 of 6 screens), AI Settings on a desktop (2.88 of 3), the admin overview on a desktop (1.92 of 2), the agency Cases list and the WP-SB4 consent page on a desktop (2.84 of 3).

## 3. Every browser budget check (worst-case data, built app)

Measured by the checks themselves (`npx playwright test scroll-budget/` against `next start` on port 3100, controlled_pilot, placeholder sign-in values). Rows named "fails" or "breaks" are the guards that prove a check can go red; their height is meant to be over.

| Spec | Check | Measured |
|---|---|---|
| WP-SB0.spec.ts | Show More keeps filters, lands on the first new row and is announced politely | desktop 1280x800: 800px = 1 screens (budget 2, 1600px) [enforce] |
| WP-SB0.spec.ts | Show More keeps filters, lands on the first new row and is announced politely | phone 390x844: 844px = 1 screens (budget 2, 1688px) [enforce] |
| WP-SB0.spec.ts | a 500-entry log keeps its fixed box and stays within one screen and a half | desktop 1280x800: 800px = 1 screens (budget 2, 1600px) [enforce] |
| WP-SB0.spec.ts | a 500-entry log keeps its fixed box and stays within one screen and a half | phone 390x844: 844px = 1 screens (budget 2, 1688px) [enforce] |
| WP-SB0.spec.ts | collapsible groups open the first group only and fit the budget | desktop 1280x800: 846px = 1.06 screens (budget 3, 2400px) [enforce] |
| WP-SB0.spec.ts | collapsible groups open the first group only and fit the budget | phone 390x844: 844px = 1 screens (budget 3, 2532px) [enforce] |
| WP-SB0.spec.ts | enforces by default: a check that names no mode fails an over-budget page | phone 390x844: 2601px = 3.08 screens (budget 2, 1688px) [enforce] |
| WP-SB0.spec.ts | fails a page that is taller than its budget, in enforce mode only | phone 390x844: 2601px = 3.08 screens (budget 2, 1688px) [enforce] |
| WP-SB0.spec.ts | fails a page that is taller than its budget, in enforce mode only | phone 390x844: 2601px = 3.08 screens (budget 2, 1688px) [report] |
| WP-SB0.spec.ts | fails a page that is taller than its budget, in enforce mode only | phone 390x844: 2601px = 3.08 screens (budget 4, 3376px) [enforce] |
| WP-SB0.spec.ts | fails a page that scrolls sideways | phone 390x844: 844px = 1 screens (budget 2, 1688px); sideways 1610px [enforce] |
| WP-SB0.spec.ts | the sticky bar stays in reach and never covers the last field | phone 390x844: 2367px = 2.8 screens (budget 3, 2532px) [enforce] |
| WP-SB1.spec.ts | Case History: the latest case open, the rest closed, records in a fixed panel | desktop 1280x800: 1228px = 1.54 screens (budget 3, 2400px) [enforce] |
| WP-SB1.spec.ts | Case History: the latest case open, the rest closed, records in a fixed panel | phone 390x844: 1185px = 1.4 screens (budget 3, 2532px) [enforce] |
| WP-SB1.spec.ts | Profile History: one fixed log of 50 versions, filters, and older entries on request | desktop 1280x800: 896px = 1.12 screens (budget 3, 2400px) [enforce] |
| WP-SB1.spec.ts | Profile History: one fixed log of 50 versions, filters, and older entries on request | phone 390x844: 984px = 1.17 screens (budget 3, 2532px) [enforce] |
| WP-SB1.spec.ts | consent history sits in a fixed panel with filters | desktop 1280x800: 841px = 1.05 screens (budget 2, 1600px) [enforce] |
| WP-SB1.spec.ts | consent history sits in a fixed panel with filters | phone 390x844: 856px = 1.01 screens (budget 2, 1688px) [enforce] |
| WP-SB1.spec.ts | notifications: ten in a fixed panel, Mark All Read, then Show More | desktop 1280x800: 800px = 1 screens (budget 2, 1600px) [enforce] |
| WP-SB1.spec.ts | notifications: ten in a fixed panel, Mark All Read, then Show More | phone 390x844: 844px = 1 screens (budget 2, 1688px) [enforce] |
| WP-SB2.spec.ts | a snapshot with 130 entries opens on its first group and folds to one screen | desktop 1280x800: 800px = 1 screens (budget 2, 1600px) [enforce] |
| WP-SB2.spec.ts | a snapshot with 130 entries opens on its first group and folds to one screen | phone 390x844: 1469px = 1.74 screens (budget 2, 1688px) [enforce] (WP-SB11) |
| WP-SB2.spec.ts | a snapshot with 130 entries opens on its first group and folds to one screen | desktop 1280x800: 1185px = 1.48 screens (budget 2, 1600px) [enforce] (WP-SB11, open) |
| WP-SB2.spec.ts | the open snapshot breaks the phone budget when its group draws every row | phone 390x844: 7814px = 9.26 screens (budget 2, 1688px) [enforce] (WP-SB11) |
| WP-SB2.spec.ts | a snapshot with 130 entries opens on its first group and folds to one screen | phone 390x844: 844px = 1 screens (budget 2, 1688px) [enforce] |
| WP-SB2.spec.ts | a worst-case case fits 3 screens on a phone and on a desktop | desktop 1280x800: 1566px = 1.96 screens (budget 3, 2400px) [enforce] |
| WP-SB2.spec.ts | a worst-case case fits 3 screens on a phone and on a desktop | phone 390x844: 2326px = 2.76 screens (budget 3, 2532px) [enforce] |
| WP-SB2.spec.ts | the same case laid out without the caps breaks the budget | phone 390x844: 30050px = 35.6 screens (budget 3, 2532px) [enforce] |
| WP-SB3.spec.ts | evidence requests and the shared view list ten rows, then Show More | desktop 1280x800: 1010px = 1.26 screens (budget 3, 2400px) [enforce] |
| WP-SB3.spec.ts | evidence requests and the shared view list ten rows, then Show More | desktop 1280x800: 800px = 1 screens (budget 3, 2400px) [enforce] |
| WP-SB3.spec.ts | evidence requests and the shared view list ten rows, then Show More | phone 390x844: 1106px = 1.31 screens (budget 3, 2532px) [enforce] |
| WP-SB3.spec.ts | evidence requests and the shared view list ten rows, then Show More | phone 390x844: 1349px = 1.6 screens (budget 3, 2532px) [enforce] |
| WP-SB3.spec.ts | insights with 100 documents stays within 3 screens | desktop 1280x800: 876px = 1.1 screens (budget 3, 2400px) [enforce] |
| WP-SB3.spec.ts | insights with 100 documents stays within 3 screens | phone 390x844: 1700px = 2.01 screens (budget 3, 2532px) [enforce] |
| WP-SB3.spec.ts | sharing with 40 grants stays within 3 screens, the log in its fixed box | desktop 1280x800: 2029px = 2.54 screens (budget 3, 2400px) [enforce] |
| WP-SB3.spec.ts | sharing with 40 grants stays within 3 screens, the log in its fixed box | phone 390x844: 2242px = 2.66 screens (budget 3, 2532px) [enforce] |
| WP-SB3.spec.ts | the sharing budget fails when the grant cap is lost | phone 390x844: 10832px = 12.83 screens (budget 3, 2532px) [enforce] |
| WP-SB4.spec.ts | calendar: 200 dates in folded groups, a 100-row preview in its panel, Preview in reach | desktop 1280x800: 2050px = 2.56 screens (budget 3, 2400px) [enforce] |
| WP-SB4.spec.ts | calendar: 200 dates in folded groups, a 100-row preview in its panel, Preview in reach | phone 390x844: 2035px = 2.41 screens (budget 3, 2532px) [enforce] |
| WP-SB4.spec.ts | consent: 20 cases and 40 files behind expanders, Allow and Do Not Allow in reach | desktop 1280x800: 2273px = 2.84 screens (budget 3, 2400px) [enforce] |
| WP-SB4.spec.ts | consent: 20 cases and 40 files behind expanders, Allow and Do Not Allow in reach | phone 390x844: 2233px = 2.65 screens (budget 3, 2532px) [enforce] |
| WP-SB4.spec.ts | documents: the selected document is a sheet that scrolls inside, the list stays in budget | desktop 1280x800: 1431px = 1.79 screens (budget 3, 2400px) [enforce] |
| WP-SB4.spec.ts | documents: the selected document is a sheet that scrolls inside, the list stays in budget | phone 390x844: 2955px = 3.5 screens (budget 3, 2532px) [report] |
| WP-SB5.spec.ts | case activity keeps 50 notes in the fixed log panel with filters | desktop 1280x800: 920px = 1.15 screens (budget 3, 2400px) [enforce] |
| WP-SB5.spec.ts | case activity keeps 50 notes in the fixed log panel with filters | phone 390x844: 1277px = 1.51 screens (budget 3, 2532px) [enforce] |
| WP-SB5.spec.ts | cases with 200 cases lists 15 and stays within 3 screens | desktop 1280x800: 1280px = 1.6 screens (budget 3, 2400px) [enforce] |
| WP-SB5.spec.ts | cases with 200 cases lists 15 and stays within 3 screens | phone 390x844: 2399px = 2.84 screens (budget 3, 2532px) [enforce] |
| WP-SB5.spec.ts | clients lists 15 invitations and 10 requests, forms closed | desktop 1280x800: 1934px = 2.42 screens (budget 3, 2400px) [enforce] (WP-SB11) |
| WP-SB5.spec.ts | clients lists 15 invitations and 10 requests, forms closed | phone 390x844: 2058px = 2.44 screens (budget 3, 2532px) [enforce] (WP-SB11) |
| WP-SB5.spec.ts | clients with both lists open breaks the budget | phone 390x844: 3709px = 4.39 screens (budget 3, 2532px) [enforce] (WP-SB11) |
| WP-SB5.spec.ts | the cases budget fails when the list cap is lost | phone 390x844: 28490px = 33.76 screens (budget 3, 2532px) [enforce] |
| WP-SB5.spec.ts | the dashboard table shows the 10 most urgent cases, then Show More | desktop 1280x800: 1339px = 1.67 screens (budget 2, 1600px) [enforce] (WP-SB11) |
| WP-SB5.spec.ts | the dashboard table shows the 10 most urgent cases, then Show More | phone 390x844: 1610px = 1.91 screens (budget 2, 1688px) [enforce] (WP-SB11) |
| WP-SB5.spec.ts | the dashboard table breaks its budget with all 10 cases unfolded on a phone | phone 390x844: 2838px = 3.36 screens (budget 2, 1688px) [enforce] (WP-SB11) |
| WP-SB6.spec.ts | access fits 3 screens: pending first, history apart, 25 a load each | desktop 1280x800: 1868px = 2.34 screens (budget 3, 2400px) [enforce] |
| WP-SB6.spec.ts | access fits 3 screens: pending first, history apart, 25 a load each | phone 390x844: 2157px = 2.56 screens (budget 3, 2532px) [enforce] |
| WP-SB6.spec.ts | complaints fit 3 screens: tabs, 20 complaints and feedback in fixed boxes | desktop 1280x800: 1892px = 2.37 screens (budget 3, 2400px) [enforce] |
| WP-SB6.spec.ts | complaints fit 3 screens: tabs, 20 complaints and feedback in fixed boxes | phone 390x844: 1874px = 2.22 screens (budget 3, 2532px) [enforce] |
| WP-SB6.spec.ts | email delivery fits 3 screens with both lists in fixed boxes | desktop 1280x800: 2103px = 2.63 screens (budget 3, 2400px) [enforce] |
| WP-SB6.spec.ts | email delivery fits 3 screens with both lists in fixed boxes | phone 390x844: 2278px = 2.7 screens (budget 3, 2532px) [enforce] |
| WP-SB6.spec.ts | the audit trail fits 3 screens with 50 entries in its fixed box | desktop 1280x800: 1184px = 1.48 screens (budget 3, 2400px) [enforce] |
| WP-SB6.spec.ts | the audit trail fits 3 screens with 50 entries in its fixed box | phone 390x844: 1486px = 1.76 screens (budget 3, 2532px) [enforce] |
| WP-SB6.spec.ts | the budget fails when the lists lose their fixed boxes | phone 390x844: 10354px = 12.27 screens (budget 2, 1688px) [enforce] |
| WP-SB6.spec.ts | the budget fails when the lists lose their fixed boxes | phone 390x844: 21499px = 25.47 screens (budget 3, 2532px) [enforce] |
| WP-SB6.spec.ts | the budget fails when the lists lose their fixed boxes | phone 390x844: 7682px = 9.1 screens (budget 3, 2532px) [enforce] |
| WP-SB6.spec.ts | the budget fails when the lists lose their fixed boxes | phone 390x844: 9639px = 11.42 screens (budget 3, 2532px) [enforce] |
| WP-SB6.spec.ts | the overview fits 2 screens: status and failed jobs first, the rest in groups | desktop 1280x800: 1532px = 1.92 screens (budget 2, 1600px) [enforce] |
| WP-SB6.spec.ts | the overview fits 2 screens: status and failed jobs first, the rest in groups | phone 390x844: 1597px = 1.89 screens (budget 2, 1688px) [enforce] |
| WP-SB7.spec.ts | AI settings: 10 features folded and grouped, within 3 screens | desktop 1280x800: 2307px = 2.88 screens (budget 3, 2400px) [enforce] |
| WP-SB7.spec.ts | AI settings: 10 features folded and grouped, within 3 screens | phone 390x844: 2222px = 2.63 screens (budget 3, 2532px) [enforce] |
| WP-SB7.spec.ts | document protection: one category tab open of 12, within 3 screens | desktop 1280x800: 932px = 1.17 screens (budget 3, 2400px) [enforce] |
| WP-SB7.spec.ts | document protection: one category tab open of 12, within 3 screens | phone 390x844: 1116px = 1.32 screens (budget 3, 2532px) [enforce] |
| WP-SB7.spec.ts | organizations, members and a pack list 25, 20 and 25 rows, then a next page | desktop 1280x800: 2267px = 2.83 screens (budget 6, 4800px) [enforce] |
| WP-SB7.spec.ts | organizations, members and a pack list 25, 20 and 25 rows, then a next page | desktop 1280x800: 3498px = 4.37 screens (budget 6, 4800px) [enforce] |
| WP-SB7.spec.ts | organizations, members and a pack list 25, 20 and 25 rows, then a next page | desktop 1280x800: 4163px = 5.2 screens (budget 6, 4800px) [enforce] |
| WP-SB7.spec.ts | organizations, members and a pack list 25, 20 and 25 rows, then a next page | phone 390x844: 3486px = 4.13 screens (budget 6, 5064px) [enforce] |
| WP-SB7.spec.ts | organizations, members and a pack list 25, 20 and 25 rows, then a next page | phone 390x844: 4199px = 4.98 screens (budget 6, 5064px) [enforce] |
| WP-SB7.spec.ts | organizations, members and a pack list 25, 20 and 25 rows, then a next page | phone 390x844: 4928px = 5.84 screens (budget 6, 5064px) [enforce] |
| WP-SB7.spec.ts | privacy holds: 25 holds in a fixed box, the picker and form, within 3 screens | desktop 1280x800: 1172px = 1.47 screens (budget 3, 2400px) [enforce] |
| WP-SB7.spec.ts | privacy holds: 25 holds in a fixed box, the picker and form, within 3 screens | phone 390x844: 1276px = 1.51 screens (budget 3, 2532px) [enforce] |
| WP-SB7.spec.ts | the settings budget fails when far more features are listed | phone 390x844: 11580px = 13.72 screens (budget 3, 2532px) [enforce] |
| WP-SB8.spec.ts | every country listed at once breaks the budget | phone 390x844: 7800px = 9.24 screens (budget 3, 2532px) [enforce] |
| WP-SB8.spec.ts | fits 6 screens on a phone and a desktop | desktop 1280x800: 1478px = 1.85 screens (budget 6, 4800px) [enforce] |
| WP-SB8.spec.ts | fits 6 screens on a phone and a desktop | phone 390x844: 2671px = 3.16 screens (budget 6, 5064px) [enforce] |
| WP-SB8.spec.ts | fits 6 screens on a phone, with the headline and main action on the first screen | desktop 1280x800: 4411px = 5.51 screens (budget 6, 4800px) [enforce] |
| WP-SB8.spec.ts | fits 6 screens on a phone, with the headline and main action on the first screen | phone 390x844: 4341px = 5.14 screens (budget 6, 5064px) [enforce] |
| WP-SB8.spec.ts | opening every story group still leaves no sideways scroll, and the closed page breaks without the groups | phone 390x844: 8585px = 10.17 screens (budget 6, 5064px) [enforce] |
| WP-SB8.spec.ts | the agency list of every country fits 3 screens on a phone and a desktop | desktop 1280x800: 1258px = 1.57 screens (budget 3, 2400px) [enforce] |
| WP-SB8.spec.ts | the agency list of every country fits 3 screens on a phone and a desktop | phone 390x844: 2169px = 2.57 screens (budget 3, 2532px) [enforce] |
| WP-SB8.spec.ts | the traveller list of every country fits 3 screens on a phone and a desktop | desktop 1280x800: 1258px = 1.57 screens (budget 3, 2400px) [enforce] |
| WP-SB8.spec.ts | the traveller list of every country fits 3 screens on a phone and a desktop | phone 390x844: 2169px = 2.57 screens (budget 3, 2532px) [enforce] |
| WP-SB9.spec.ts | a traveller's Billing History: 10 purchases, the newest open, within 3 screens | desktop 1280x800: 1375px = 1.72 screens (budget 3, 2400px) [enforce] |
| WP-SB9.spec.ts | a traveller's Billing History: 10 purchases, the newest open, within 3 screens | phone 390x844: 2154px = 2.55 screens (budget 3, 2532px) [enforce] |
| WP-SB9.spec.ts | an agency's Invoices: 10 invoices, one open with its form, within 3 screens | desktop 1280x800: 1408px = 1.76 screens (budget 3, 2400px) [enforce] |
| WP-SB9.spec.ts | an agency's Invoices: 10 invoices, one open with its form, within 3 screens | phone 390x844: 2039px = 2.42 screens (budget 3, 2532px) [enforce] |
| WP-SB9.spec.ts | the Plans page: 12 plans as closed rows within 3 screens | desktop 1280x800: 1171px = 1.46 screens (budget 3, 2400px) [enforce] |
| WP-SB9.spec.ts | the Plans page: 12 plans as closed rows within 3 screens | phone 390x844: 1744px = 2.07 screens (budget 3, 2532px) [enforce] |
| WP-SB9.spec.ts | the guard fails when every row is open (proof the budget check can go red) | phone 390x844: 8116px = 9.62 screens (budget 3, 2532px) [enforce] |

Sideways scroll: 0 px on every check except the guard that adds a 2,000 px block on purpose.

## 4. Every route the web tests render (390 and 1280)

Method (the CCD-7 width run): `UI_BASELINE_DIR=<dir> ./node_modules/.bin/vitest run` in `apps/web` saves each whole page a test renders (`apps/web/test/ui-capture-setup.ts`); each page was then loaded with the real stylesheet (`globals.css`) at 390 by 844 and 1280 by 800 and `document.documentElement.scrollHeight` was read, as `scripts/ui-baseline/capture.mjs` loads them. Commit `3535437e`, 1,246 rendered pages from 99 test files.

How to read it:
- These are page bodies without the signed-in menu, with the data each test chose. Some tests render far more rows on purpose (to prove Show More reaches the last row, or that every element survived a redesign), so a high maximum is not by itself a page over budget. "Default-state renders over" leaves out tests whose names say they reach past a cap ("past", "reaches", "every element", "longer than", "grows by", "all"): a name-based filter, not a proof.
- Sideways scroll: 0 px on all 1,246 pages at both widths.
- The browser checks in section 3 are the acceptance standard; this table is the wider sweep.

| Test file | Kind (budget) | Renders | Max phone px (screens) | Max desktop px (screens) | Renders over | Default-state renders over |
|---|---|---|---|---|---|---|
| `app/app/account/plan/billing/page.test.tsx` | Task, form, settings or list (3) | 16 | 9,561 (11.33) | 6,947 (8.68) | 1 | 1 |
| `app/app/account/plan/page.test.tsx` | Task, form, settings or list (3) | 31 | 4,052 (4.80) | 2,309 (2.89) | 15 | 15 |
| `app/app/admin/access/page.test.tsx` | Task, form, settings or list (3) | 11 | 2,225 (2.64) | 1,898 (2.37) | 0 | 0 |
| `app/app/admin/ai/page.test.tsx` | Task, form, settings or list (3) | 13 | 1,325 (1.57) | 1,104 (1.38) | 0 | 0 |
| `app/app/admin/ai/provider-settings.test.tsx` | Task, form, settings or list (3) | 2 | 3,122 (3.70) | 2,258 (2.82) | 1 | 1 |
| `app/app/admin/audit/page.test.tsx` | Task, form, settings or list (3) | 11 | 1,486 (1.76) | 1,184 (1.48) | 0 | 0 |
| `app/app/admin/billing/forms.test.tsx` | Task, form, settings or list (3) | 4 | 1,121 (1.33) | 909 (1.14) | 0 | 0 |
| `app/app/admin/billing/page.test.tsx` | Task, form, settings or list (3) | 10 | 2,391 (2.83) | 1,633 (2.04) | 0 | 0 |
| `app/app/admin/billing/travellers/page.test.tsx` | Task, form, settings or list (3) | 15 | 3,615 (4.28) | 2,385 (2.98) | 2 | 2 |
| `app/app/admin/complaints/page.test.tsx` | Task, form, settings or list (3) | 8 | 1,779 (2.11) | 1,762 (2.20) | 0 | 0 |
| `app/app/admin/document-protection/page.test.tsx` | Task, form, settings or list (3) | 14 | 1,431 (1.70) | 1,064 (1.33) | 0 | 0 |
| `app/app/admin/email/page.test.tsx` | Task, form, settings or list (3) | 3 | 2,203 (2.61) | 1,968 (2.46) | 0 | 0 |
| `app/app/admin/email/queue-panel.test.tsx` | Task, form, settings or list (3) | 1 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/admin/members/page.test.tsx` | Task, form, settings or list (3) | 5 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/admin/organizations/[orgId]/page.test.tsx` | Task, form, settings or list (3) | 12 | 3,443 (4.08) | 2,342 (2.93) | 2 | 2 |
| `app/app/admin/organizations/[orgId]/refund-panel.test.tsx` | Task, form, settings or list (3) | 1 | 1,963 (2.33) | 1,570 (1.96) | 0 | 0 |
| `app/app/admin/organizations/page.test.tsx` | Task, form, settings or list (3) | 11 | 1,138 (1.35) | 804 (1.00) | 0 | 0 |
| `app/app/admin/packs/[packId]/page.test.tsx` | Task, form, settings or list (3) | 9 | 19,440 (23.03) | 19,268 (24.09) | 9 | 7 |
| `app/app/admin/packs/page.test.tsx` | Task, form, settings or list (3) | 6 | 8,083 (9.58) | 7,431 (9.29) | 5 | 2 |
| `app/app/admin/page.test.tsx` | Dashboard or overview (2) | 25 | 1,746 (2.07) | 1,488 (1.86) | 5 | 5 |
| `app/app/admin/plans/page.test.tsx` | Task, form, settings or list (3) | 10 | 1,904 (2.26) | 1,363 (1.70) | 0 | 0 |
| `app/app/admin/privacy/page.test.tsx` | Task, form, settings or list (3) | 14 | 1,039 (1.23) | 986 (1.23) | 0 | 0 |
| `app/app/admin/settings/page.test.tsx` | Task, form, settings or list (3) | 4 | 1,113 (1.32) | 800 (1.00) | 0 | 0 |
| `app/app/agency/[orgId]/activity/page.test.tsx` | Task, form, settings or list (3) | 6 | 983 (1.16) | 896 (1.12) | 0 | 0 |
| `app/app/agency/[orgId]/cases/page.test.tsx` | Task, form, settings or list (3) | 12 | 11,261 (13.34) | 6,598 (8.25) | 2 | 0 |
| `app/app/agency/[orgId]/clients/page.test.tsx` | Task, form, settings or list (3) | 19 | 2,388 (2.83) | 1,933 (2.42) | 0 | 0 |
| `app/app/agency/[orgId]/countries/agency-countries.page.test.tsx` | Task, form, settings or list (3) | 2 | 3,104 (3.68) | 2,105 (2.63) | 1 | 1 |
| `app/app/agency/[orgId]/layout.test.tsx` | Task, form, settings or list (3) | 7 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/agency/[orgId]/page.test.tsx` | Dashboard or overview (2) | 39 | 5,904 (7.00) | 4,094 (5.12) | 18 | 17 |
| `app/app/agency/[orgId]/plan/invoices/invoice-card.test.tsx` | Task, form, settings or list (3) | 20 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/agency/[orgId]/plan/invoices/page.test.tsx` | Task, form, settings or list (3) | 7 | 6,948 (8.23) | 6,849 (8.56) | 1 | 1 |
| `app/app/agency/[orgId]/settings/page.test.tsx` | Task, form, settings or list (3) | 2 | 1,261 (1.49) | 956 (1.20) | 0 | 0 |
| `app/app/agency/page.test.tsx` | Task, form, settings or list (3) | 8 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/applicant/[id]/calendar/calendar-feed-panel.test.tsx` | Task, form, settings or list (3) | 1 | 1,266 (1.50) | 800 (1.00) | 0 | 0 |
| `app/app/applicant/[id]/calendar/page.test.tsx` | Task, form, settings or list (3) | 18 | 2,734 (3.24) | 2,286 (2.86) | 3 | 3 |
| `app/app/applicant/[id]/documents/page.test.tsx` | Task, form, settings or list (3) | 85 | 7,384 (8.75) | 1,847 (2.31) | 2 | 2 |
| `app/app/applicant/[id]/evidence/page.test.tsx` | Task, form, settings or list (3) | 18 | 1,594 (1.89) | 2,709 (3.39) | 1 | 0 |
| `app/app/applicant/[id]/expiry/page.test.tsx` | Task, form, settings or list (3) | 18 | 844 (1.00) | 10,528 (13.16) | 5 | 2 |
| `app/app/applicant/[id]/history/page.test.tsx` | Task, form, settings or list (3) | 7 | 1,054 (1.25) | 943 (1.18) | 0 | 0 |
| `app/app/applicant/[id]/insights/page.test.tsx` | Task, form, settings or list (3) | 6 | 1,805 (2.14) | 986 (1.23) | 0 | 0 |
| `app/app/applicant/[id]/memory/compare/page.test.tsx` | Task, form, settings or list (3) | 6 | 22,913 (27.15) | 22,855 (28.57) | 1 | 1 |
| `app/app/applicant/[id]/memory/page.test.tsx` | Task, form, settings or list (3) | 6 | 5,880 (6.97) | 5,837 (7.30) | 1 | 0 |
| `app/app/applicant/[id]/missions/create-mission-form.test.tsx` | Task, form, settings or list (3) | 8 | 1,005 (1.19) | 936 (1.17) | 0 | 0 |
| `app/app/applicant/[id]/missions/page.test.tsx` | Task, form, settings or list (3) | 12 | 844 (1.00) | 815 (1.02) | 0 | 0 |
| `app/app/applicant/[id]/missions/prepare-again/prepare-again-form.test.tsx` | Task, form, settings or list (3) | 1 | 1,501 (1.78) | 1,389 (1.74) | 0 | 0 |
| `app/app/applicant/[id]/outputs/outputs.test.tsx` | Task, form, settings or list (3) | 29 | 5,262 (6.23) | 3,603 (4.50) | 21 | 21 |
| `app/app/applicant/[id]/profile/page.test.tsx` | Task, form, settings or list (3) | 5 | 1,466 (1.74) | 1,111 (1.39) | 0 | 0 |
| `app/app/applicant/[id]/record/page.test.tsx` | Task, form, settings or list (3) | 5 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/applicant/[id]/sharing/ai-connections.test.tsx` | Task, form, settings or list (3) | 16 | 2,246 (2.66) | 1,696 (2.12) | 0 | 0 |
| `app/app/applicant/[id]/sharing/page.test.tsx` | Task, form, settings or list (3) | 48 | 1,667 (1.98) | 6,430 (8.04) | 2 | 0 |
| `app/app/applicants/page.test.tsx` | Task, form, settings or list (3) | 2 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/countries/countries.page.test.tsx` | Task, form, settings or list (3) | 9 | 3,331 (3.95) | 2,290 (2.86) | 4 | 4 |
| `app/app/error.test.tsx` | Task, form, settings or list (3) | 3 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/help/page.test.tsx` | Task, form, settings or list (3) | 5 | 3,229 (3.83) | 2,203 (2.75) | 5 | 5 |
| `app/app/mission/[id]/page.test.tsx` | Task, form, settings or list (3) | 66 | 1,720 (2.04) | 2,777 (3.47) | 1 | 1 |
| `app/app/mission/[id]/snapshots/[snapshotId]/page.test.tsx` | Task, form, settings or list (3) | 2 | 5,110 (6.05) | 5,087 (6.36) | 2 | 2 |
| `app/app/mission/[id]/snapshots/page.test.tsx` | Task, form, settings or list (3) | 3 | 1,661 (1.97) | 1,699 (2.12) | 0 | 0 |
| `app/app/mission/[id]/task-added-by.test.tsx` | Task, form, settings or list (3) | 3 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/app/notifications/page.test.tsx` | Task, form, settings or list (3) | 5 | 844 (1.00) | 922 (1.15) | 0 | 0 |
| `app/app/page.test.tsx` | Dashboard or overview (2) | 89 | 1,731 (2.05) | 6,513 (8.14) | 23 | 23 |
| `app/app/privacy/page.test.tsx` | Task, form, settings or list (3) | 4 | 844 (1.00) | 1,622 (2.03) | 0 | 0 |
| `app/app/shared/[grantId]/page.test.tsx` | Task, form, settings or list (3) | 9 | 2,836 (3.36) | 2,161 (2.70) | 1 | 1 |
| `app/app/staff-code/page.test.tsx` | Task, form, settings or list (3) | 10 | 854 (1.01) | 844 (1.05) | 0 | 0 |
| `app/auth-shell.test.tsx` | Task, form, settings or list (3) | 5 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/auth/sign-up/page.test.tsx` | Task, form, settings or list (3) | 2 | 1,180 (1.40) | 1,081 (1.35) | 0 | 0 |
| `app/invitation/page.test.tsx` | Task, form, settings or list (3) | 27 | 1,840 (2.18) | 1,441 (1.80) | 0 | 0 |
| `app/layout.test.tsx` | Task, form, settings or list (3) | 6 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/oauth/authorize/consent-form.test.tsx` | Task, form, settings or list (3) | 1 | 1,871 (2.22) | 1,636 (2.04) | 0 | 0 |
| `app/oauth/authorize/page.test.tsx` | Task, form, settings or list (3) | 5 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/page.test.tsx` | Public landing (6) | 21 | 4,386 (5.20) | 4,030 (5.04) | 0 | 0 |
| `app/payments/result/page.test.tsx` | Task, form, settings or list (3) | 12 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `app/privacy/page.test.tsx` | Legal (no limit) | 4 | 1,733 (2.05) | 1,208 (1.51) | 0 | 0 |
| `app/public-pages.test.tsx` | Task, form, settings or list (3) | 15 | 1,259 (1.49) | 1,081 (1.35) | 0 | 0 |
| `app/status/status-view.test.tsx` | Task, form, settings or list (3) | 16 | 1,083 (1.28) | 1,021 (1.28) | 0 | 0 |
| `app/trust/[packKey]/page.test.tsx` | Public page (6) | 8 | 2,299 (2.72) | 1,426 (1.78) | 0 | 0 |
| `app/trust/page.test.tsx` | Public page (6) | 10 | 23,817 (28.22) | 8,785 (10.98) | 2 | 1 |
| `components/ai-access-choices.test.tsx` | Task, form, settings or list (3) | 6 | 1,359 (1.61) | 1,210 (1.51) | 0 | 0 |
| `components/ai-file-choices.test.tsx` | Task, form, settings or list (3) | 12 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `components/brand-mark.test.tsx` | Task, form, settings or list (3) | 1 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `components/page-loading.test.tsx` | Task, form, settings or list (3) | 15 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `lib/a11y-pages.test.tsx` | Task, form, settings or list (3) | 25 | 4,690 (5.56) | 4,271 (5.34) | 10 | 0 |
| `lib/a11y-signed-in.test.tsx` | Task, form, settings or list (3) | 21 | 1,070 (1.27) | 976 (1.22) | 0 | 0 |
| `lib/ai-models.test.tsx` | Task, form, settings or list (3) | 2 | 1,928 (2.28) | 1,328 (1.66) | 0 | 0 |
| `lib/ccd/parity-agency-cases.test.tsx` | Task, form, settings or list (3) | 14 | 2,541 (3.01) | 2,364 (2.96) | 7 | 6 |
| `lib/ccd/parity-agency-home.test.tsx` | Dashboard or overview (2) | 15 | 5,329 (6.31) | 4,188 (5.24) | 12 | 8 |
| `lib/ccd/parity-case.test.tsx` | Task, form, settings or list (3) | 8 | 1,699 (2.01) | 2,191 (2.74) | 0 | 0 |
| `lib/ccd/parity-cases.test.tsx` | Task, form, settings or list (3) | 8 | 844 (1.00) | 800 (1.00) | 0 | 0 |
| `lib/ccd/parity-documents.test.tsx` | Task, form, settings or list (3) | 10 | 2,591 (3.07) | 1,132 (1.42) | 2 | 1 |
| `lib/ccd/parity-evidence.test.tsx` | Task, form, settings or list (3) | 15 | 844 (1.00) | 1,206 (1.51) | 0 | 0 |
| `lib/ccd/parity-expiry.test.tsx` | Task, form, settings or list (3) | 8 | 844 (1.00) | 1,078 (1.35) | 0 | 0 |
| `lib/ccd/parity-home.test.tsx` | Dashboard or overview (2) | 12 | 1,731 (2.05) | 3,793 (4.74) | 6 | 3 |
| `lib/ccd/parity-notifications.test.tsx` | Task, form, settings or list (3) | 11 | 844 (1.00) | 922 (1.15) | 0 | 0 |
| `lib/ccd/parity-privacy.test.tsx` | Task, form, settings or list (3) | 15 | 1,013 (1.20) | 1,633 (2.04) | 0 | 0 |
| `lib/ccd/parity-profile.test.tsx` | Task, form, settings or list (3) | 6 | 1,007 (1.19) | 818 (1.02) | 0 | 0 |
| `lib/ccd/parity-sharing.test.tsx` | Task, form, settings or list (3) | 12 | 967 (1.15) | 1,758 (2.20) | 0 | 0 |
| `lib/ccd/parity-traveller.test.tsx` | Task, form, settings or list (3) | 10 | 844 (1.00) | 1,266 (1.58) | 0 | 0 |
| `lib/ccd/parity.test.tsx` | Task, form, settings or list (3) | 6 | 844 (1.00) | 926 (1.16) | 0 | 0 |
| `lib/traveller-all-clear.test.tsx` | Task, form, settings or list (3) | 4 | 844 (1.00) | 1,155 (1.44) | 0 | 0 |
| `lib/traveller-composition.test.tsx` | Task, form, settings or list (3) | 21 | 1,108 (1.31) | 1,266 (1.58) | 0 | 0 |

## 5. To triage: test files with a render over budget (not fixed here)

27 of 99 test files have at least one render over its budget at one width that the name filter did not rule out. This is a triage list, not 27 confirmed pages: several worst renders are still deliberate extremes the filter missed (a test that asks for "older purchases", a huge `show` value, a list grown by Show More), and a phone value of 1.00 next to a large desktop value means the extra content is a desktop-only part of the page. Each needs a browser budget check with realistic data to confirm. Only the pages in section 2 are confirmed over budget by a browser check. WP-SB10 changes no product code.

| Test file | Budget | Worst default-state render | Phone screens | Desktop screens |
|---|---|---|---|---|
| `app/app/applicant/[id]/memory/compare/page.test.tsx` | 3 | then and now changes within the scroll budget wp sb1 shows the next step on request never  | 27.15 | 28.57 |
| `app/trust/page.test.tsx` | 6 | the public route list treats a malformed or huge show value as the first step or the whole | 7.82 | 3.47 |
| `app/app/admin/packs/[packId]/page.test.tsx` | 3 | platform rules one pack opens the version the address names with its attached cases counte | 9.74 | 9.94 |
| `app/app/applicant/[id]/expiry/page.test.tsx` | 3 | long lists on the expiry page wp sb4 grows one list by ten without changing the others and | 1.00 | 3.20 |
| `app/app/account/plan/billing/page.test.tsx` | 3 | billing history within the scroll budget wp sb9 says plainly when older purchases are past | 11.33 | 8.68 |
| `app/app/admin/packs/page.test.tsx` | 3 | platform rules pack studio folds the two forms with the count of overrides on the threshol | 3.21 | 2.57 |
| `app/app/applicant/[id]/documents/page.test.tsx` | 3 | archive recently deleted and the manage menu resource lifecycle migration 0113 gives each  | 8.75 | 2.22 |
| `app/app/agency/[orgId]/plan/invoices/page.test.tsx` | 3 | the agency invoices page within the scroll budget wp sb9 says plainly when older invoices  | 8.23 | 8.56 |
| `app/app/page.test.tsx` | 2 | home composition wp v4 v1 2 b13 and u03 reads the same people on every visit oldest first  | 1.00 | 8.14 |
| `app/app/agency/[orgId]/page.test.tsx` | 2 | agency dashboard within the scroll budget wp sb5 shows the 10 most urgent of 200 cases wit | 7.00 | 3.18 |
| `app/app/mission/[id]/snapshots/[snapshotId]/page.test.tsx` | 3 | a snapshot in groups puts the mapping facts and documents in counted groups with the mappi | 6.05 | 6.36 |
| `lib/ccd/parity-agency-home.test.tsx` | 2 | agency home the rules every converted screen follows a quick view has one h1 no skipped le | 6.31 | 5.24 |
| `app/app/applicant/[id]/outputs/outputs.test.tsx` | 3 | the briefs and summaries page is plain accessible markup | 6.23 | 4.50 |
| `app/app/account/plan/page.test.tsx` | 3 | buying a paid plan on plan usage adr 0025 t3c passes the automated accessibility rules wit | 4.80 | 2.89 |
| `lib/ccd/parity-home.test.tsx` | 2 | home the rules every converted screen follows more people than home reads has one h1 no sk | 1.00 | 4.74 |
| `app/app/admin/billing/travellers/page.test.tsx` | 3 | platform traveller billing adr 0025 t6b never shows a name an email or an account id | 4.28 | 2.98 |
| `app/app/admin/organizations/[orgId]/page.test.tsx` | 3 | the organization page within the scroll budget wp sb9 shows invoices as compact rows the n | 4.08 | 2.93 |
| `app/app/countries/countries.page.test.tsx` | 3 | a country page is case insensitive about the code and not found for an unknown one | 3.95 | 2.86 |
| `app/app/help/page.test.tsx` | 3 | help and support offers the support inbox to everyone once one is set up and only a real a | 3.83 | 2.75 |
| `app/app/admin/ai/provider-settings.test.tsx` | 3 | the ai providers data terms and ai apps sections s28 round 4 keeps the 351 parts in order  | 3.70 | 2.82 |
| `app/app/agency/[orgId]/countries/agency-countries.page.test.tsx` | 3 | country rules inside the agency workspace shows a country with the way back staying in the | 3.68 | 2.63 |
| `app/app/mission/[id]/page.test.tsx` | 3 | wp sb2 a worst case case stays short keeps the section open after show more and drops the  | 1.11 | 3.47 |
| `app/app/shared/[grantId]/page.test.tsx` | 3 | a long shared record stays short wp sb3 keeps the other list where it was when one grows | 3.36 | 2.70 |
| `app/app/applicant/[id]/calendar/page.test.tsx` | 3 | calendar export page v1 2 b05 previews exactly the titles dates and reminder the file hold | 3.24 | 2.53 |
| `lib/ccd/parity-documents.test.tsx` | 3 | documents the rules every converted screen follows several documents one selected has one  | 3.07 | 1.42 |
| `lib/ccd/parity-agency-cases.test.tsx` | 3 | agency cases levels ends the notes with their count right under them before the note form  | 3.01 | 2.93 |
| `app/app/admin/page.test.tsx` | 2 | does not show zero spend or capacity meters when the readings are unavailable | 2.07 | 1.71 |

Not verified: any of these pages signed in on the live site; heights with the real signed-in menu around them (the sweep has no menu, the browser checks have none either); data sets other than the tests' own.
