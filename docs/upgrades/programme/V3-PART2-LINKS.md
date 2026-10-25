# WP-V3 part 2: four-tab shell, before and after link list

Branch `claude/prog-v3-tabs`, from origin/main 2ec8f72. Prepared 25 Oct 2026.

Only the traveller workspace changed. The agency and platform workspaces are unchanged; their full lists are pinned in `apps/web/src/lib/workspace-navigation.test.ts`. No page or route was removed. One page was added: the Record hub at `/app/applicant/[id]/record`.

`[id]` is the selected traveller. "Bar" is the phone bar at the bottom of the screen (four links). "More" is the sheet the More button opens. On a laptop or larger all of these sit in the sidebar.

## Traveller workspace (a traveller is selected)

| Before | Where before | After | Where after | Address |
| --- | --- | --- | --- | --- |
| Overview | Bar | Home | Bar | `/app/applicant/[id]` |
| My Profile | Bar | Profile | Record section | `/app/applicant/[id]/profile` |
| Documents | Bar | Documents | Record section | `/app/applicant/[id]/documents` |
| (none) | | Record | Bar | `/app/applicant/[id]/record` (new hub) |
| Visa Cases | Bar | Cases | Bar | `/app/applicant/[id]/missions` |
| Sharing | More | Sharing | Bar | `/app/applicant/[id]/sharing` |
| Notifications | More | Notifications | More | `/app/notifications` |
| Countries | More | Countries | More | `/app/countries` |
| Shared with Me | More Tools | Shared with Me | More Tools | `/app/shared` |
| Account Overview | More Tools | Account and Permissions | More Tools | `/app` |
| Evidence Requests | More Tools | Evidence Requests | More Tools | `/app/applicant/[id]/evidence` |
| Dates & Expiry | More Tools | Dates & Expiry | Record section | `/app/applicant/[id]/expiry` |
| History | More Tools | History | Record section | `/app/applicant/[id]/history` |

Record sections are the links shown at the top of every Record page: All Records, Profile, Documents, Dates & Expiry, History. On any of those pages the Record tab is the current tab. Every address that worked before still works, and every earlier destination is still at most one step from the navigation.

## Personal space with no traveller yet

| Before | After | Address |
| --- | --- | --- |
| Overview | Home | `/app` |
| Add a Traveller (or Choose a Traveller) | unchanged | `/app/applicants` |
| Notifications | unchanged | `/app/notifications` |
| Countries | unchanged | `/app/countries` |
| Shared with Me (More Tools) | unchanged | `/app/shared` |
| Account Overview (More Tools) | Account and Permissions | `/app` |

There is no Record, Cases or Sharing tab until a traveller exists, because those pages belong to a person.

## What the Record hub offers

Built only from data the owner's own profile and documents pages already read, through the same owner-only services, and only with links to pages that already exist.

- Groups: open profile sections under their profile group, and documents under their category (or "Kind Not Set Yet").
- Search by names, kinds, groups, states, cases and who it is shared with. File contents are not searched.
- Filters: Everything, Profile Details, Ready to Use, Needs Attention, Previous Versions, and a Group choice.
- Actions on a ready document: View (`documents?document=`), Update or Replace (`documents?type=...#document-upload`), Use in Case (`missions`), Share (`sharing`). A file still being checked, refused, expired or replaced is never offered for a case or for sharing. A previous version offers View and Open the Current Version.
- Actions on a profile section: View or Update (`profile#section-...`), Use in Case (`missions`).

## Evidence

- `node scripts/check-route-navigation.mjs`: 63 pages before (origin/main), 64 after, no dangling targets or unreferenced pages.
- The frozen before list and the "no destination is lost" test: `apps/web/src/lib/workspace-navigation.test.ts`.
