# WAL1B-2 records: the route guard over every signed-in page

Owner goal (17 Nov 2026, approved under "I agree with the rest, your recommended options"): "A permanent made-up test traveller and agency login in CI so every upgrade is checked on the real pages, not on fixtures." WAL1B-1 (#634) signed the two made-up people in; this unit opens every signed-in page as them. How it works: docs/operations/ci-signed-in-guard.md, section "The route guard".

## Coverage

93 page files under apps/web/src/app/app: 50 guarded (36 as the traveller, 14 as the agency admin), 43 excluded with a reason (27 staff pages, 6 one-time invitation pages, 5 switched off in this build, 5 needing records the seed does not make yet). 34 guarded pages also check that the other made-up person cannot see their body text.

## What some guarded routes really cover

- /app/incoming: only its switched-off fallback ("That Share Did Not Come Through"), because sharing to VisaStack from other apps is off in this build (`note` on its route).
- /app/notifications and /app/trips: only their empty states ("No Notifications Yet", "No group trips yet"), because the seed makes no notification and no group trip.
- Follow-up: seed a notification and a group trip through `@visastack/services` so these two pages are checked with real rows, and move /app/trips/[id] from `EXCLUDED` to `ROUTES` with that trip.

## Real findings on today's pages (not fixed here)

Found by the shared WAL1 layout checks on the first signed-in run, 18 Nov 2026, on main 2e83440. Each is listed in `KNOWN_FAILING` (apps/web/ci-signed-in/routes.ts), and the guard fails as soon as one is fixed, so its line is removed and the ceiling lowered.

| Page | Sizes | Check | What the guard reported |
|---|---|---|---|
| /app/applicant/[id]/documents/add | 390, 400, 1280 | covered control | The hidden file pickers "Files to Import" and "Folder to Import" (`input.sr-only`, 1 by 1 px) can be reached by keyboard but have no drawn label tied to them. |
| /app/applicant/[id]/profile | 390, 400, 1280 | covered control | The hidden "Photo File" picker (`input.sr-only`, 1 by 1 px), same as above. |
| /app/applicant/[id]/record | 390, 400, 1280 | covered control | The Record Filters buttons (Everything2, Profile Details10 and Previous Versions0 at phone sizes; Everything2 and Previous Versions0 at 1280; the number is each filter's count with the seed's records) are painted over by their own `fieldset.record-hub-filter-set`. |
| /app/applicant/[id]/missions/prepare-again | 390, 400 | covered control | "Create Case", scrolled up from the bottom of the screen, sits under the phone bottom app bar (`nav.app-shell-links`). |
| /app/applicant/[id]/outputs | 390, 400 | covered control | "Preview", same: under the phone bottom app bar. |
| /app/mission/start | 390, 400 | covered control | "Start Trip", same: under the phone bottom app bar (at 390 px its Notifications icon). |
| /app/agency/[orgId]/clients | 390, 400, 1280 | covered control | The "Invite a Client" and "Ask for a Document or Detail" open rows (`summary.lift-action`) are painted over by their `section.agency-add-part`. |
| /app/agency/[orgId]/activity | 390, 400, 1280 | no control | With no case notes yet the page body is a dead end: "No Case Activity Recorded" offers no control or link (only the agency banner back link). |
| /app/agency/[orgId]/ai-connections | 390, 400, 1280 | no control | With no app connected the page body is a dead end: "No AI Apps Connected" says to turn it on in Settings but gives no link there. |

24 page and size pairs in all (35 lines in the pinned baseline, one per control). At desktop 1280 the record page reports only Everything and Previous Versions. No page needed a sideways scroll.

Likely shared causes, for the fixing unit to confirm: the three bottom-bar findings point at one missing bottom space under the phone app bar on pages whose last control is a main button; the record and clients findings at one stacking rule in the filter set and the add-part section; the two agency empty states need a next step (a link to Settings for AI connections).

## Not findings (checked and explained)

- A traveller who is not a member opening an agency page sees the agency name, branding and "You don't have a role", never the page content (agency layout, by design, noted in code). The guard's `deniedTo` check holds that.
- Pages answering "We Couldn't Find That Page" with status 200 were features switched off in this build or pages needing a query (`?document=`, `?from=`, `?pack=`); the two that need only seeded ids are guarded with them.

## Proof

- scripts/ci-signed-in.test.mjs (12 tests): new rules red on broken data (a page in neither list, a listed page with no file, a page in both lists, the known list growing, the excluded list growing, the person's own name as body text, a path opening another page), then green. A known covered finding matches only the covered control's exact name: a new control covered by a listed one is a new finding (unit test).
- The guard red when a listed finding no longer fails ("fixed? remove from KNOWN_FAILING") and when its body text sits only in the agency banner, then green.
- Local end to end on a fresh Postgres: 54 of 54 (50 routes and the 4 WAL1B-1 proofs) in about one minute with 2 workers.

## NOT verified

The GitHub run time of the full job, Safari and Firefox, real devices, the excluded pages, Bengali pages, production.
