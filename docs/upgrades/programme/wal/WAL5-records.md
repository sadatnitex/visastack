# WAL5 records: one tile per AI connection

Unit WAL5 (Wallet upgrade U5, Sharing and AI Connections), Class A (access), FULL route. Branch claude/wal5-connection-tiles. Owner decision 17 Nov 2026: AI Connections option "A" (One Tile Per Connection), Wallet board Pattern 4. Builds on WAL1 (ADR 0030: ExplainTip, layout guards). Presentation only: no service, policy, scope, audit, route or database change; no new action; every access check exactly as before. Example data only.

## What changed

| Where | Change |
|---|---|
| components/ai-connection-tile.tsx | New. `AiConnectionTile`: a plain group with the app's name and site as its heading (not a landmark), the pictures in groups ("Can Read"; Cases and Full Document Numbers, each naming itself; "Changes" for Suggest Changes) as small pictures (each a 44 px Explain button named by the consent label, with the consent screen's own sentence as its note; the visible word beside it is for the eye only), a clock ring for the time left (drawn at its final state, hidden from screen readers because the same words sit beside it), a facts list from one shared builder `aiConnectionFacts` (Connected, Connected By on the agency side, Ends while live, Last Used; an ended tile says "Ended <date>" on its clock instead of Ends) and the connection's own actions passed in untouched. |
| lib/ai-connection-time-left.ts | New. `aiConnectionTimeLeft` (open, running, ending soon, ended; share left; whole 24-hour days left, never rounded up; whole hours in the last day), `aiCurrentPeriodStart`, `aiEndingSoonWindowMs`, `displayTimeZone` (UTC only when the zone is unknown), `formatMomentIn` and `formatDayIn` (the shared formatters' exact behaviour when no zone is given). |
| app/app/applicant/[id]/sharing/ai-connections.tsx | Each live connection is one tile. The facts list and the comma-joined "Can Read" line became the tile; Change Access (its `details`, form and action) and Turn Off are the same components, moved into the tile's action slot. New props `timeZone` and `now`. `connectionReads` builds the pictures from `AI_LAYER_LABELS`, `AI_LAYER_NOTES` and the consent labels verbatim. |
| app/app/applicant/[id]/sharing/page.tsx | Passes the traveller's stored time zone (`applicants.timezone`) to the section. Nothing else. |
| app/app/agency/[orgId]/ai-connections/page.tsx, agency-connection-tile.tsx (new) | Each agency connection is one tile (one component, also used by the browser fixture), with its existing Turn Off. |
| i18n/components.ts, i18n/applicant-sharing.ts, i18n/app-agency.ts | New English keys only (listed below). No Bengali written. |
| globals.css, new block "WP-WAL5" (end of file) | Tile, picture row, ring and facts styles. Flat, tokens only; every picture item is a full 44 px row item (the Explain button's reach past the line is turned off inside it, so wrapped items never overlap); the ring reads without colour (ending soon draws a thicker arc, ended a dashed track); forced-colours rule. |
| Tests | New: components/ai-connection-tile.test.tsx, lib/ai-connection-time-left.test.ts, a WAL5 block in sharing/ai-connections.test.tsx, an agency case in ai-connections-locale.test.tsx, e2e/fixtures/wal5-connection-tiles.fixture.tsx and e2e/wallet/u5-connection-tiles.spec.ts. Changed: the two assertions that read the old comma-joined line and the old `<dt>Suggest Changes</dt>` now read the tile's buttons. |

## Choices made in this unit (sent to the Guardian with the ACK)

- Ending soon: the time left is at most a quarter of the connection's length, never more than seven days (1 hour: the last 15 minutes; 24 hours: the last 6; 7 days: the last 42 hours; 30 days: the last 7 days). A fixed seven-day window would mark every short connection as ending soon.
- Agency connections carry no scopes in their summary (the services fix them, and each case reads only what its traveller allowed). The agency tile shows one picture, "What Each Traveller Allowed", whose note is the page's existing sentence. No scope list is copied into the interface, so nothing can drift from the services or overstate what an app reads.
- Time zones: traveller dates (Connected, Ends, Last Used) and days left use the traveller's stored zone, UTC only when it is unknown. Agency staff have no stored zone, so agency dates keep today's formatter behaviour.
- Nothing lost (parity): every fact the old list showed is still on the tile: the app and site, Connected, each thing it can read, Cases, Full Document Numbers, Original Files, Suggest Changes (with "but turned off right now"), Ends or Until You Turn It Off, Last Used or Not Used Yet, Nothing From This Record, Change Access and Turn Off. On the agency side the old note "Connected by X on D. Ends D. Last read D." became the tile's facts; "Last read" now reads "Last Used", the owner's word for both views.
- No status chip ("Active") in the tile header: the ring and its words carry the state, and no new status name enters the vocabulary.

## New visible words for the localization list

Names and short words:
- "{count} Days Left" (one: "1 Day Left"), "{count} Hours Left" (one: "1 Hour Left"), "Less Than 1 Hour Left", "Ending Soon", "Ended", "Ended {date}" (components catalog `components.aiConnectionTile.*`)
- Agency page: "Connected By", "What Each Traveller Allowed" (`appAgency.appAgencyOrgidAiConnectionsPage.*`). Connected, Ends, Last Used, Not Used Yet and Can Read reuse the traveller page's keys, which already have Bengali.
- "UTC" after a time shown in UTC because the person's zone is unknown

New sentences (Explain notes):
- Cases: "Which of your cases this app can read." (`applicantSharing.appApplicantIdSharingAiConnections.casesNote`)
- Full Document Numbers, No: "Numbers show only their last three characters." (`...numbersShowOnlyTheirLastThree`; the same words already end the Personal Details note)

- Agency picture note: "For each case its owner or admin can see, the app reads only what that case’s traveller allowed this agency’s AI tools to read." (`...whatEachTravellerAllowedNote`)

Reused verbatim, not new: the term "Changes" (`components.aiAccessChoices.changes`), every consent label and layer note (`lib/ai-consent-labels.ts`), the document list, document text and full numbers notes (`components.aiAccessChoices.*`).

## Guardian fix round (two independent reviews of 72f6447)

- The ring after Change Access: the stored data has no field for when the current end was set (the connection keeps when it was made and when it ends; the `AI_CONNECTION_CHANGED` audit entry records it, but the Sharing page's audit list returns no resource id or metadata, so reading it would be a service change). No dated period is longer than 30 days, so the period is measured from the later of the connection's making and 30 days before its end (`aiCurrentPeriodStart`). A renewal for 30 days reads as a full period; a renewal for a shorter period reads as its share of 30 days, so the ending-soon window can open early, never late. Agency connections are never renewed and run from when they were made.
- Personal Details with Full Document Numbers: Yes takes the note's first sentence and the consent screen's full numbers sentence, verbatim (no claim that numbers are shortened).
- "Nothing from this record" is its own line under "Can Read", as before; Cases and Full Document Numbers are a separate group.
- One ended behaviour on both pages: "Ended <date>" on the clock when the end has passed, no Ends fact; an agency connection turned off before its end says "Ended" (the page has no date for it).
- One facts builder for both tiles, in the traveller page's existing words; the agency catalog keeps only its two new keys ("Connected By", "What Each Traveller Allowed" and its note).
- The picture list reuses the WAL1 key class `.status-picture-key` (44 px rows, no reach past the line) instead of repeating it.
- The 44 px browser check fails on a visible control without a box.
- Red then green for this round: the five new tests (period start, ring after a renewal, the matching note, Ended with its date, the separate line) failed on 72f6447's code and pass now.

ADR 0030 note: the time ring is a small custom SVG, not the progress ring (`components/progress-ring.tsx`): the progress ring always says "N of M items ready" and is a readiness count, while this ring is time left with its own words beside it, and its shape (full for no end, never full or empty while dated, dashed when ended) carries meaning without colour. It follows the progress ring's drawing (pathLength 100, a dash array attribute, no inline style, no motion).

## Review round (fresh context)

/code-review high, /security-review and an independent accessibility review. Security: no findings (same data, same gates, same forms; app names now cleaned). Fixed from the other two:
- One time zone per tile: Change Access "Keep the Current End" and the recently ended line use the traveller's zone too; a time shown in UTC only because the zone is unknown says "UTC".
- The time left is an exact moment, so it is counted as whole days (never rounded up), then whole hours in the last day; only the dates move with the zone. An earlier calendar-day count could say "2 Days Left" with 25 hours left.
- App names and sites are cleaned inside the tile (`aiAppName`, `aiAppHost`), and in the recently ended list.
- The agency tile is one component (`agency/[orgId]/ai-connections/agency-connection-tile.tsx`) used by the page and the browser fixture, so the test cannot drift from the page.
- A dated connection never draws a full ring (at most 98 of 100), so it differs from an open one without colour.
- Each tile is a plain group found by its heading, not a landmark per connection.
- Suggest Changes is not reading: it sits in its own group under the consent screen's term "Changes".
- An ended agency connection says Ended once (the clock), with no stale end date.
- The agency picture's note is one sentence (new key `whatEachTravellerAllowedNote`); a pause before "Ending Soon" for screen readers.

Kept on purpose: the visible word beside each picture is not part of the button (ExplainTip is the shared WAL1 piece, used the same way in the status key); many picture buttons before Change Access follow the screen order; `.ai-connection-facts` in the WP-S15 block is now unused but belongs to another block, listed below.

## Red then green

Red first: on the main screens (the new tests run against main's `ai-connections.tsx` and agency `page.tsx`), 6 tests failed: the WAL5 section tests, the two reworded assertions and the agency tile test. The tile and time-left test files did not exist on main.

Layout guard proven red by breaking the real CSS once (backed up with cp, restored): the picture items given a -40 px reach and no row height gave "<button.explain-tip-trigger> "Personal Details" ... is under <button.explain-tip-trigger> "Passports and Travel Documents"" at every size.

Green: unit and guard suites for the touched areas (106 files, 1834 tests), full web vitest before the review round 9738 of 9741 (the 3 were the review round's new tests, written ahead of their fix, green after it), typecheck, lint, ui-ratchet, em dash sweep 0. Browser: e2e/wallet (WAL1 and WAL5), ux-public, browser-security and no-secret-auth on one production build with the no-secret settings: 350 passed, 1 skipped (the phone-only Add button case at wide sizes, as on main). The final full check on the frozen head is recorded in the PR.

## Follow-up

- CSS tidy unit: `.ai-connection-facts` rules in the WP-S15 block of globals.css have no markup left.
- When the current end was set: a stored "period started" time (or the change audit's time on the page) would let the ring measure a renewed short period exactly; needs a service change.
- Agency staff have no stored time zone; agency dates keep the server formatter. A staff time zone would need its own decision.

## Not verified

- Signed-in pages: the tiles were checked on the fixture (the real section and the agency tile component on the real stylesheet), not on signed-in routes (U1b brings a CI test user).
- Safari and Firefox (only Chromium was run).
- VoiceOver and NVDA reading of the picture buttons and the time-left words.
- Forced-colours mode and right-to-left layout in a real browser (rules written, not run).
- Bengali wording of the new words (listed above for the localization list).
