# P13 plan: three traveller entry points and the connected experience

Base: origin/main 44d38213 (P9 merged). Branch umpe/p13-experience. Lease: app-nav, workspace-navigation.ts, layouts, Home and traveller Home, one CSS block.

## Audit (real code, 3 Nov 2026)
- Traveller sidebar today: Home, Record, Cases, Sharing, Notifications, Countries; More Tools: Shared with Me, Account Overview, Evidence Requests. Phone bar: first four.
- No navigation entry today: /app/trips (P5 Group Trips), /app/mission/start (P4 Start a Trip), /collect/account/answers (P7 Your Answers to Agencies).
- Home and traveller Home rank Needs Attention (attention.ts); open P4 package changes and P11 rule impacts are not listed (P4 hand-back gap). Both notes deep-link to /app/mission/{id}#trip-package.
- Agency and platform navigation: unchanged by this unit.

## Build
1. Navigation (workspace-navigation.ts, navigation.ts, app-nav.tsx, workspace-shell.tsx)
   - Traveller primary: Home, My Documents (documents; also lit on Record and its sections), My Trips (Cases page; also lit on case pages and Group Trips), Sharing & Requests (Sharing; also lit on Evidence Requests and Shared with Me), Notifications, Countries. Phone bar: Home, Documents, Trips, Sharing.
   - Sub-actions: Add Documents under My Documents (documents#add-document), Start a Trip under My Trips (/app/mission/start). Sidebar shows them under their parent; phone shows them in More.
   - More Tools: Record, Group Trips, Evidence Requests, Answers to Agencies, Shared with Me, Account Overview. A tool is marked current only when no primary link already is (one aria-current per page).
   - No URL removed, no page or permission check changed. Agency and platform lists unchanged.
2. Package-change notices: new services/umpe-experience-notices.ts, owner gate only, reads open umpe_package_changes and umpe_rule_impacts that still apply (active case, still on the older version), one item per case, kind case_changed (tier 4), tolerant of missing tables. Home and traveller Home merge them into the ranking; Home shows a "Checklist Changed" line under the affected case with the full history (Notifications) one step away.
3. Task-first: Home "Start Here" row (Add Documents, Start a Trip, Answer a Request) and first-run task list gains Add Documents and Start a Trip first. No profile questions before a first file or an agency answer.
4. Agency home: untouched (request-first composer and triage desk already lead).
5. States: notices fail closed to nothing (Home never fails); 44px targets; layouts at 390, 768, 1280.

## Tests
- experience-parity.test.ts: every page route under /app classified (navigation or a named contextual link proven present in source); every previous destination still in navigation.
- workspace-navigation tests updated for the new words; entry points for travellers only; agency and admin lists byte-equal to before.
- Services test for notices (PGlite): open, resolved, inactive, other owner, missing tables.
- Playwright: entry points at 390 and 1280, keyboard order, 44px.
- Guards proven red: parity map, owner-only notices.
