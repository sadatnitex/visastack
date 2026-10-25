# WP-V3 part 2: four-tab shell, before and after link list

Branch `claude/prog-v3-tabs`, from origin/main 2ec8f72. Prepared 25 Oct 2026.

Only the traveller workspace changed. The agency and platform workspaces are unchanged; their full lists are pinned in `apps/web/src/lib/workspace-navigation.test.ts`. No page or route was removed. One page was added: the Record hub at `/app/applicant/[id]/record`.

`[id]` is the selected traveller. "Bar" is the phone bar at the bottom of the screen (four links). "More" is the sheet the More button opens. On a laptop or larger all of these sit in the sidebar.

## Traveller workspace (a traveller is selected)

| Before | Where before | After | Where after | Address |
| --- | --- | --- | --- | --- |
| Overview | Bar | Home | Bar | `/app/applicant/[id]` |
| My Profile | Bar | My Profile | Record section | `/app/applicant/[id]/profile` |
| Documents | Bar | Documents | Record section | `/app/applicant/[id]/documents` |
| (none) | | Record | Bar | `/app/applicant/[id]/record` (new hub) |
| Visa Cases | Bar | Cases | Bar | `/app/applicant/[id]/missions` |
| Sharing | More | Sharing | Bar | `/app/applicant/[id]/sharing` |
| Notifications | More | Notifications | More | `/app/notifications` |
| Countries | More | Countries | More | `/app/countries` |
| Shared with Me | More Tools | Shared with Me | More Tools | `/app/shared` |
| Account Overview | More Tools | Account and Permissions | More Tools | `/app` before, `/app#permissions` after (the same page, opened at Permissions You Control) |
| Evidence Requests | More Tools | Evidence Requests | More Tools | `/app/applicant/[id]/evidence` |
| Dates & Expiry | More Tools | Dates & Expiry | Record section | `/app/applicant/[id]/expiry` |
| History | More Tools | History | Record section | `/app/applicant/[id]/history` |

Record sections are the links shown at the top of every Record page: All Records, My Profile, Documents, Dates & Expiry, History. On any of those pages the Record tab is the current tab. The hub is called Record on the tab and All Records on its section link and its heading. Every address that worked before still works, and every earlier destination is still at most one step from the navigation. The section links are the product's usual section tabs (one underlined row above the page heading). On My Profile the page's own areas are a side list (a picker on a phone), not a second row of tabs.

On `/app` only Home is the current link. Account and Permissions opens the permissions section of that same page, so the page never has two current names.

## Personal space with no traveller yet

| Before | After | Address |
| --- | --- | --- |
| Overview | Home | `/app` |
| Add a Traveller (or Choose a Traveller) | unchanged | `/app/applicants` |
| Notifications | unchanged | `/app/notifications` |
| Countries | unchanged | `/app/countries` |
| Shared with Me (More Tools) | unchanged | `/app/shared` |
| Account Overview (More Tools) | Account and Permissions | `/app#permissions` (the same page as Home, opened at Permissions You Control) |

There is no Record, Cases or Sharing tab until a traveller exists, because those pages belong to a person.

## What the Record hub offers

Built only from data the owner's own profile and documents pages already read, through the same owner-only services, and only with links to pages that already exist.

- Groups: open profile sections under their profile group, and documents under their category (or "Kind Not Set Yet").
- Search by names, kinds, categories, states, cases and who it is shared with. File contents are not searched. A visible count says how many items match; the list pages twelve at a time, as the documents wallet does.
- Filters: Everything, Profile Details, Ready to Use, Needs Attention, Previous Versions, then Category, then Search (the wallet's order). When documents could not be loaded, the document filters say "Not available right now" instead of counting zero.
- Ready to use means: a CLEAN scan and a processing state the services allow to be opened (`isServableProcessingState`, the rule that gates preview and download; the normal finished state is AWAITING_REVIEW), decided on the server, and none of the documents page's review signals (a passport with no expiry date, a kind the sorting asked a person to confirm, a new name waiting for a decision).
- States are decided in this order: Cannot Be Used (refused, failed, held back or a failed scan), then Previous Version or Expired, then Still Being Checked, then Needs Your Check, then Expiring Soon or Current Version.
- Each item's title opens it: a document opens on the documents page (`documents?document=`), a profile section opens its place in My Profile (`profile#section-...`). Each row has at most one further action. A ready document: Share (`sharing?document=<id>#new-sharing-request`, which starts the new request on "Only the documents I choose" with that one document ticked; the person still reviews and confirms, and the server checks the scope as before). A document that is not ready: Update or Replace (`documents?type=...#document-upload`); it is never offered for sharing. A previous version: Open the Current Version.
- A profile section with at least one saved answer: Go to Cases (`missions`). It opens the case list; cases match their requirements against saved details. Nothing is attached from the Record.

## Evidence

- `node scripts/check-route-navigation.mjs`: 63 pages before (origin/main), 64 after, no dangling targets or unreferenced pages.
- The frozen before list and the "no destination is lost" test: `apps/web/src/lib/workspace-navigation.test.ts`.
