# U8 records: agency screens on the Wallet foundation

Unit U8 (Wallet upgrade, agency pages), Class B, presentation only. Branch claude/u8-agency-wallet. Owner request 18 Nov 2026 (with screenshots): the agency Team, Clients, Cases and Plan & Usage pages were not upgraded yet; give them the Wallet upgrade ("also these"). No service, policy, server action, billing or database change. Made-up data only.

## What changed

| Where | Change |
|---|---|
| `[orgId]/u8-rows.tsx` (new), `[orgId]/u8.css` (new) | Shared pieces built on the Expandable Section: `AgencyRow` (picture, name, one status chip, one short line, details in the body), `InitialsPicture`, `AgencyRows`, `LimitRing` (the share used, clockwise from the top; a thicker arc when nearly full, thicker and red when full) and `UnlimitedPicture` (a flat disc with a sideways eight). Flat, brand tokens only, no motion, forced-colours rule. |
| `team/page.tsx` | One compact row per member and per pending invitation: initials, email, role as one chip, Active or Inactive as the line; Deactivate and May Request Documents sit in the row body. An invitation row's chip says Invited with its expiry (the role is the line) and Revoke sits in the body. The owner row has nothing to open, so it is a plain row without a fold. The invite form is folded behind "Add Member". |
| `clients/page.tsx`, `clients/open-request-from-link.tsx` | Each pending invitation and each evidence request is one compact row. Invitation: initials, client name, status chip (Invited with expiry, Expired, or Cannot Be Accepted), contact as the line, Revoke in the body. Request: document picture (or a clipboard for a detail), "Document: Passport", status chip, client name and due date as the line; the conversation, sent copies and decision buttons in the body. A link to `#request-<id>` opens that row (`openRequestRow`). The page lists invitations and requests (there is no client roster); the client is named in each row. |
| `clients/` finding | "Invite a Client" and "Ask for a Document or Detail" rows were painted over at their corners. Root cause: the rows sit in a rounded group (`.agency-add-card .collapsible-group`, `overflow: hidden`) and the row's own corners were square, so a press at a corner reached the section behind. The row now takes the group's inner radius. The pin is removed from `ci-signed-in/routes.ts` and the baseline in `scripts/ci-signed-in.test.mjs`. |
| `cases/` list | Not changed: the list already draws one compact row per case (name, stage, destination, readiness picture, one action). |
| `cases/` (open case, `mission-collaboration.tsx`) | Add Task, Schedule and Add Note are folded behind one row each (Expandable Section, remembered across a refresh). Their success messages stay outside the fold. |
| Time Zone defect | Root cause: `.tz-select { flex: 1 1 15rem }` (globals.css, meant for a row of fields) inside `.field-row`, which is a flex COLUMN, so the 15rem flex basis became the list's height (240 px). `.field-row > .tz-select { flex: 0 0 auto }` in one marked block at the end of globals.css (WP-U8 time zone in a column row, Guardian decision 18 Nov) restores the normal control height for every form. The traveller case page (`mission/[id]/collaboration-panels.tsx`) draws the select as a grid child (`.collab-add-form`), so it never had the tall box; its height is checked in the same spec and stays normal. |
| `plan/page.tsx` | One compact row per limit: a ring that shows the share used, the count in words ("1 of 5 used"), the definition in the body. A limit with no ceiling shows no bar or ring arc, only the shared words ("1 used (unlimited)", `formatMeterValue`). Nothing allowed and nothing used draws a neutral ring (not full). An informational meter opens at first so its "does not limit" note is never hidden. AI Features is one section (its rows inside). The plan card keeps its wording. Invoices stays one action; `plan/invoices` is unchanged. |
| `activity/page.tsx`, `ai-connections/page.tsx` | The empty states now carry one real action: Open Cases (the one place notes are written) and Open Settings (the Agency Settings section that turns the AI connection on, `#agency-ai-title`). Both pins removed. |
| Sidebar check | Not a defect (checked on the agency Cases page and on a 2028 px tall applicant All Records page, same result). At 1280 by 900, scrolling the Cases page to its end, the sidebar (`.app-shell-nav`) stays `position: sticky` at top 0 with its first item 24 px down at scroll 0, 600 and the end (705 px of scroll on a 1605 px page). The owner's full-page screenshots draw a sticky element where the scroll happened to be when the capture was stitched. No change made to the app navigation or layout. |

## Out-of-manifest files (approved by the Guardian where noted in the messages)

- `[orgId]/mission-collaboration.tsx` and its tests; `e2e/fixtures/u8-agency.fixture.tsx` (new, needed by the new spec).
- `scripts/ci-signed-in.test.mjs` (baseline lines removed), `scripts/ui-ratchet.baseline.json` and `scripts/ui-ratchet.test.mjs` (inline styles 290 to 286, lowered only).

## New visible words (catalogue)

One marked block "WP-U8" at the end of the English side of `i18n/app-agency.ts` (keys `appAgency.appAgencyOrgidU8.*`). English only; no Bengali exists for them yet, so the localization lane writes it. Draft Bengali for that lane:

| Key | English | Bengali (draft) |
|---|---|---|
| addMember | Add Member | সদস্য যোগ করুন |
| addTask | Add Task | কাজ যোগ করুন |
| schedule | Schedule | সময় ঠিক করুন |
| addNote | Add Note | নোট যোগ করুন |
| openSettings | Open Settings | সেটিংস খুলুন |

The unlimited summary reuses `formatMeterValue` ("1 used (unlimited)"); Open Cases, Active, Inactive, Invited, Revoke, the status words, every definition and plan wording are reused.

## Keyboard and focus

- Opening Add Task, Schedule, Add Note or Add Member by its row moves focus to the form's first field (`u8-fold-focus.tsx`); a fold drawn open or opened by a link keeps focus where it is.
- After a refused add (task, appointment, note), focus moves to the message that says why (it carries the id the form's message already had, made focusable).
- Open Settings links to the Agency Settings page without an anchor: the AI card there is drawn only when the AI setting can be read, so `#agency-ai-title` cannot be promised.

## Tests

- Red first: the Time Zone test measured 240 px on the old code (the rule absent) and passes at control height with the fix. Layout guards (no sideways scroll, nothing covered) for the folded and open case forms and the team and limit rows. Axe on an open fold.
- Unit (parsed DOM, no regex on raw HTML): team rows, the plain owner row and the Add Member fold; plan limit rows (ring for a ceiling, shared words and no arc without one, neutral ring for 0 of 0, full ring for none allowed but in use) and AI Features as one section; activity and AI connections empty states carry their action; `openRequestRow`; focus on open and on a refused add. `task-status.test.tsx` finds the task area as `#tasks-m1`, the same container as before (the form's parent was that area; the form now sits one fold deeper).
- Signed-in route guard: all 50 pages pass with the three pins removed.

## Follow-ups (not done here)

- The traveller case page (`mission/[id]`) draws the same Time Zone select and probably has the same tall box; the fix belongs in the shared `.tz-select` rule in globals.css or in that page's own unit.
- WP-SB2 "real case page" (`scroll-budget/WP-SB2.spec.ts`, phone browse 3480 against a 3470 ceiling) failed in this container; it draws no agency component and no U8 file, so the cause is outside this diff (not checked against main here).
