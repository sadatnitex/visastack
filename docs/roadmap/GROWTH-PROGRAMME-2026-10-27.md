# Growth programme (owner decisions of 27 October 2026)

Status: plan. Execution order and package split. Build only what the owner listed; anything not listed is out of scope. One package per pull request. Plain words, no em dashes. Code defects are tracked separately in the audit document (WP-1 to WP-10) and are not part of this programme.

## 1. The owner's decisions (verbatim in substance)

| # | Question | Decision |
|---|---|---|
| 1 | What does the homepage promise? | "A clean file you can stand behind." |
| 2 | First three minutes | Pick a country, see the checklist at once |
| 3 | What brings people back? | Deadline clocks; weekly file note by email; agency requests |
| 4 | When a file becomes ready | Ring, then an optional share card |
| 5 | Growth loops, in order | 1 Agency invites its clients; 2 Shareable readiness card; 3 Public country pages; 4 Sponsor and family contributors |
| 6 | How people share | Phone share sheet plus copy link; WhatsApp business messages; QR code for agency counters |
| 7 | Sign-in | Email one-time code; Sign in with Google; Phone number code |
| 8 | Invitation page | Option B: name the agency, show the terms |
| 9 | Moments of delight | Checklist fills in as you pick a country; progress ring on every file; specific success lines; share confirmation with a one-tap stop; empty states that teach; dark mode |
| 10 | Agencies as champions | "Verified on VisaStack" badge and public agency page; co-branded client page and QR; clients-joined counter on the agency dashboard |
| 11 | First measures | Time to first Ready item; invites accepted per active agency; files shared per active user; week four return |

Rules for every item: each new loop reports through the existing product event log with its own closed event names; respects consent and "Share the part, not the whole"; never describes readiness as approval.

## 2. What exists today (from the code map, 27 Oct)

- Homepage `apps/web/src/app/page.tsx`: headline "Your documents. Ready when you are." No country picker. Public-file wording is guarded by `plain-language.test.ts`.
- Country data: `packages/core/src/destinations` (156 countries, 61 routes, static JSON; many routes thin). A checklist for a chosen country can be shown with no account. Country pages exist only under `/app/countries` (signed in). No sitemap, robots, canonical tags.
- First run (`app/app/first-run.tsx`): consent, who is this for, what do you want to do. No country step.
- Readiness: `computeReadiness` needs a pack; only one pack exists. No ring component (only `.meter` bars). `MISSION_READY_REACHED` event exists. No share card.
- Reminders: expiry sweeps and an outbox worker with in-app and email channels; daily crons only. No weekly email, no preferences, no unsubscribe, MARKETING consent exists but gates nothing.
- Product events: `product-events.ts` closed vocabulary in three tables plus categories and the admin scorecard label map (a missed label breaks the build).
- Sharing: grants, sharing invitations, S9 outputs and the prepared WhatsApp message, `navigator.share` with copy fallback in `invitation-link.tsx`. QR drawing exists only for staff codes (`staff-code/qr-code.tsx`, `uqr`).
- Agencies: client invitations by email (7 days, hashed token), public `/invitation` handoff page (generic), agency dashboard counts, branding (accent colour, logo), organization verification status. No slug, no public agency page, no badge, no invite counters.
- Sign-in: Neon Auth only; email plus password with confirmation link. No code, Google or phone sign-in in the repo.
- Dark mode: none. The app is deliberately light-only (`color-scheme: light`, layout comment, service worker). Pixel tests assert that device appearance changes nothing.
- Contributors: owner asks one named third party for one document; contributor needs an account.
- WhatsApp: another session built the inbound and reply channel (migration 0095). It has no outbound growth or share.

## 3. Conflicts and assumptions (stated, not hidden)

1. Dark mode reverses the current light-only rule. The owner's latest decision wins. It lands late (G13), as an opt-in setting (System, Light, Dark) with Light staying the default look, and the pixel tests that pin "device appearance changes nothing" are rewritten for the new setting, not deleted.
2. Phone number code needs an SMS provider and Neon Auth support. Google needs a provider set up in the sign-in service. Both are built behind switches, default off, and cannot be completed without the owner (G9 notes). Email code is built first.
3. WhatsApp business messages need approved message templates and the other session's channel. Outbound share messages are built as prepared messages first (already exist from S9); sending through the business channel waits for that session's contract (G10).
4. "Ready item" is defined here as the first checklist item on a person's file that has a usable document attached. The measure is the time from account creation to that moment.
5. "Active agency" means an agency that created at least one invitation or case in the last 30 days.
6. A readiness card shows a ring and counts such as "6 of 9 items ready", the country and the date. It never shows names, numbers or documents, and never says approved, cleared or accepted.
7. Public pages record no per-visitor tracking.

## 4. Closed event names (added per package, each with its own tests)

`COUNTRY_CHECKLIST_STARTED` (label: country code), `FIRST_READY_ITEM` (metric: seconds since account creation, once per account), `READINESS_CARD_CREATED`, `READINESS_CARD_SHARED` (label: SHEET, COPY, WHATSAPP, QR), `CLIENT_INVITE_SENT`, `CLIENT_INVITE_ACCEPTED`, `AGENCY_QR_CREATED`, `WEEKLY_NOTE_SENT`, `WEEKLY_NOTE_STOPPED`, `ACTIVE_DAY` (once per account per day, for week four return), `SIGN_IN_METHOD_USED` (label: EMAIL_CODE, GOOGLE, PHONE_CODE), `CONTRIBUTOR_JOINED`, `AGENCY_PAGE_PUBLISHED`. No personal values, free text or addresses in any event.

## 5. Packages (one pull request each)

| Package | What | Depends on | Migration | Owner gate |
|---|---|---|---|---|
| G1 | Homepage promise and copy ("A clean file you can stand behind."), headline, meta, coverage ledger rows, public-file guard | none | none | wording check |
| G2 | Pick a country, see the checklist at once: country step in first run and on the homepage, checklist fills in as the country is picked, carried through sign-up, event COUNTRY_CHECKLIST_STARTED | G1 | none | none |
| G3 | Progress ring component on every file, specific success lines, empty states that teach (shared patterns and the main screens) | none | none | none |
| G4 | File ready moment: ring, then optional share card (card page with no personal data, phone share sheet plus copy link, share confirmation with a one-tap stop); events | G3 | likely (card links) | none |
| G5 | Deadline clocks on Home and the file, built on expiry and calendar data | G3 | none | none |
| G6 | Weekly file note by email: preferences, one-click stop, consent respected, daily job that sends on the person's chosen day; events | none | yes (preferences) | email sender domain already set |
| G7 | Agency requests as a reason to return: Home and email surfacing of open agency requests | G6 | none | none |
| G8 | Loop 1, agency invites its clients: invitation page Option B (name the agency, show the terms), QR code and join link for counters, co-branded client page, clients-joined counter on the agency dashboard; events | G3 | maybe | none |
| G9 | Sign-in: email one-time code first, then Google, then phone code, each behind its own switch | none | none expected | provider setup in the sign-in service, SMS provider |
| G10 | Share by WhatsApp business messages for readiness card and invitations, with the other session's channel | G4, other session | none | message template approval |
| G11 | Loop 3, public country pages: indexable pages from the static data, sitemap, robots, canonical tags, honest "may not be complete" note, link into the checklist | G2 | none | none |
| G12 | Loop 4, sponsor and family contributors: invitation page naming the person asking and the one document, joins with email code, then offer to start their own file; events | G9 | maybe | none |
| G13 | Agency champions: "Verified on VisaStack" badge and public agency page (slug), shown only for verified agencies; event | G8 | yes (slug) | verification policy wording |
| G14 | Dark mode as an opt-in setting with a toggle and updated pixel tests | G3 | none | none |
| G15 | Measurement: the four first measures on the admin scorecard, ACTIVE_DAY, FIRST_READY_ITEM, per-agency invite counts | events from G2 to G13 | none | none |

## 6. Order and interleaving with Small Commercial V1

Small Commercial V1 (S12 and later, S24 never merged without the owner) continues in its own lane. Growth packages run in separate worktree lanes, at most three lanes at once, merged one at a time. Migrations are numbered in merge order (next free: 0097).

1. Now: sidebar and account menu PR (in flight), then G1 and G3 in parallel (no migration, no overlap).
2. Then G2, G5, G8 (loop 1 first, as the owner ranked it), and S12.
3. Then G6 with G7, G4, G9 with S13 onward.
4. Then G11, G12, G10, G13, G14, G15.

Each package: plan note, code, tests with proven guards, code and security review as CLAUDE.md requires, one full check, draft PR, CI on the exact commit, merge, deploy check, plain-language report.
