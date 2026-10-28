# Calm Core With Depths: parity ledger

For the owner to read. It lists what each screen offers today, the level it lives at after the change, and the test that proves it is still there. **Nothing is removed unless a row says "approved change".** Last updated 2026-10-28 (CCD-0 and CCD-1).

How the guard works: before a screen is changed, a list of everything on it (headings, links, buttons, fields, sentences, each with its name) is captured from the screen as it was, in each state a person can meet. After the change, a test shows the screen at its deepest level and fails if any old item is missing, unless the item is listed under "Approved changes" in `apps/web/src/lib/ccd/approved-changes.ts` and below.

Levels: **Glance** (the one thing that matters now), **Browse** (the normal working view), **Everything** (every feature, grouped and quiet). Levels add up.

## Progress

| # | Screen | Route | Package | State |
|---|---|---|---|---|
| 01 | Sign In | `/auth/sign-in` | none | Not converted: no switch, content unchanged (by design) |
| 02 | Home | `/app` | CCD-2 (slice 2a) | **Built and tested** (not seen live) |
| 03 | Traveller home | `/app/applicant/{id}` | CCD-2 (slice 2b) | **Built and tested** (not seen live) |
| 04 | My Profile | `/profile` | CCD-3 | Planned |
| 05 | Documents | `/documents` | CCD-3 | Planned |
| 06 | Dates & Expiry | `/expiry` | CCD-3 | Planned |
| 07 | Notifications | `/app/notifications` | CCD-5 | Planned |
| 08 | Cases | `/missions` | CCD-4 | Planned |
| 09 | Case | `/app/mission/{id}` | CCD-4 | Planned |
| 10 | Evidence Requests | `/evidence` | CCD-5 | Planned |
| 11 | Sharing | `/sharing` | CCD-5 | Planned |
| 12 | Privacy & Consent | `/app/privacy` | CCD-5 | Planned |
| 13 | Your Account | `/app/account` | CCD-1 | **Built and tested** (not seen live) |
| 14 | Agency Overview | `/app/agency/{orgId}` | CCD-6 | Planned |
| 15 | Agency Cases | `/cases` | CCD-6 | Planned |

Element-by-element rows for screens 02 to 15 are written by their own package from the baseline it captures from main just before it changes the screen, so the rows describe the screen as it really was that day.

## 13. Your Account (`/app/account`)

Baseline: `apps/web/src/lib/ccd/baseline/account.json` (three states: plain account, everything switched on, WhatsApp connected but no longer configured). Test: `apps/web/src/lib/ccd/parity.test.tsx`.

| What it is | Where it lived | Level it lives at now | Condition (unchanged) |
|---|---|---|---|
| Page heading (H1) | Top of page, showed the email | **Your Account** (approved change) | always |
| Email address | The heading | A line under the heading (approved change, same words) | always |
| Signed In card with Sign Out | Last card | Glance (first card) | always |
| Your Photo card (add or change photo, or Add Yourself) | First card | Browse | only when the account has the photo feature data |
| Language card with Switch to বাংলা / English | Second card | Browse | only while language choice is switched on (it is off until translation work starts) |
| Privacy card with Open Privacy | Third card | Browse | always |
| WhatsApp card with Open WhatsApp Settings | Fourth card | Everything | only when WhatsApp is configured or already connected |
| Other Areas You Can Access: Agency Desk, Platform Administration | Fifth card | Everything | Agency Desk only with agency access; Platform Administration only for platform staff |

Approved changes on this screen: the heading and the email line (decision D3). Nothing removed.

Not applicable on Account: Next Step bar (no next step exists here), phone search entry (not built, see below).

## 02. Home (`/app`)

Baseline: `apps/web/src/lib/ccd/baseline/home.json`, six states (core processing off; nothing started with an agency role; busy; all clear; a household of two; more people than Home reads). Test: `apps/web/src/lib/ccd/parity-home.test.tsx`. First-run screens are separate pages and are not part of this screen.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page heading | **Welcome back, {first name}**, or "Welcome back" when there is no record of their own (approved change; was "Account Overview") | always |
| "Signed in as {email}. What needs you across every traveller..." line | Glance (under the heading) | always |
| Next Step card (one primary button) | Glance | always |
| "{n} more things are waiting" with a link that opens them | Glance only (new line, hidden at deeper levels) | only when more is waiting |
| Needs Attention list and its overflow notes | Browse | only with core processing on and more than the next step waiting |
| Coming Up (dates) | Browse | only with core processing on and a traveller |
| My Records, Add Dates to My Calendar | Browse | only with core processing on |
| Active Requests and Work | Browse | only with core processing on and a traveller |
| My Next Journey (setup checklist or Start a Case card) | Everything | only while setup is unfinished, or when a traveller exists |
| Permissions You Control (six switches) | Everything; a link to `#permissions` raises the level first. While core processing is off it stays at every level, because it is then the required next step | always |

Approved change: the heading only. Nothing removed.

Not built yet on Home: the "Every Page" list (new content, planned for CCD-7); a shorter Next Step at Browse and a slim bar at Everything (the full card shows at every level for now); the navigation and page-title name "Account Overview" becomes "Home" together with the traveller page in slice 2b, so the two never disagree.

## 03. Traveller home (`/app/applicant/{id}`)

Baseline: `apps/web/src/lib/ccd/baseline/traveller.json`, five states (empty account; core processing off; a request, suggested details and a flagged document; an active case with a checklist, a second case and a grant; some records could not be loaded). Test: `apps/web/src/lib/ccd/parity-traveller.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page heading | **{Traveller's full name}** as the one page heading, eyebrow "Home" (approved change; was "Welcome, {name}" under "Your Space", and not the page heading) | always |
| Start a Case button in the header | Glance; now a secondary button named "Start a Case" (approved change; was the primary "New Visa Case") | always |
| Next Step card | Glance. Now taken from the same ranking as Account Home, with Home's wording (approved change). Flagged documents and the profile steps still follow when the ranking has nothing | always |
| Your case line (title and stage) | Glance only (new line) | only with an active case |
| Three count cards | Browse | always |
| Continue Where You Left Off, the case card, other cases | Browse; "Continue Case" is secondary so the Next Step holds the one primary | always |
| Needs Your Attention rows (requests, suggestions, documents to review) | Browse; says "Nothing needs a decision right now." when empty | rows only when something is waiting |
| Deadline Clock | Browse | always |
| Upcoming, Recent Activity, Profile & Sharing | Everything | always |

Approved changes on this screen: the heading, the Start a Case button, and the wording of the request next step (decision D1). Nothing removed.

Calm all-clear: when nothing is waiting and the profile is complete, the Next Step reads "Nothing Needs You Right Now" with "Continue Case" (or "Start a Case") as the primary action.

Not built yet: the "Every Page for this traveller" list (new content, CCD-7).

## Screens 02 to 15: the level plan (from the approved canvas)

| # | Glance | Browse adds | Everything adds |
|---|---|---|---|
| 02 Home | Next Step (full) and "N more things are waiting" | short Next Step; Needs Attention list; My Records; Active Requests and Work | slim Next Step; My Next Journey; Permissions You Control (6 switches); Every Page list |
| 03 Traveller home | Next Step (Home's wording) and featured case line | three metric cards; Continue Where You Left Off; Needs Attention rows | Upcoming; Recent Activity; Profile & Sharing; Every Page for this traveller |
| 04 My Profile | identity banner, completion, "You Decide What Becomes a Fact" | purpose picker; area list with counts; selected area with open sections | field forms; Profile Health; Latest Changes; history note |
| 05 Documents | four filter tiles; documents that need review | list with category, search, notice, selected-document panel | per-document panel; kind-and-name suggestion card; full Add a Document form with upload rules |
| 06 Dates & Expiry | the document that runs out first | Intrinsic Expiry card | Route Rules card; Issuer Confirmations card |
| 07 Notifications | unread only | plus recent | plus the latest 50 |
| 08 Cases | active case and Start a Case | all cases | Start a Case form; Prepare a Brief; Application Memory |
| 09 Case | Next Step, reminder line, progress | stage tracker, attention chips, jump links, readiness and checklist, Case Details, Requirement Pack | Tasks, Appointments, Cover Letters, Contributors and Notes, Advance the Case, Snapshots, Itinerary Reference, plus closed rows for Select or Update Evidence, Submission and Outcome, Problems and Feedback |
| 10 Evidence Requests | waiting request and reply form | details, guidance, reference, closed requests | Ask the Agency About This Item |
| 11 Sharing | who has access (and the revoke warning) | full scope of each grant, pending grants, Access Log | invitations, full Grant Access form |
| 12 Privacy & Consent | three rights as rows and export | export card, consent history | export with files, account deletion, link to permissions |
| 14 Agency Overview | four metric tiles and first Do Next item | all Do Next items, Case Pipeline, Cases and Attention table, Evidence Requests and Your Team | search form, Reassignment Queue, Case Activity, setup checklist, Clients Joined, Attention Details |
| 15 Agency Cases | every case row | one case: Where Things Stand, Assigned | Tasks, Appointments, Notes, Decisions, Issuer confirmations, other cases |

Two lines stay visible at every level of their screen: "Preparing a file is not the same as submitting it. VisaStack does not submit applications or predict decisions." (Case) and the revoke warning (Sharing).

## Pages outside the table

Provisional: each is confirmed by the package that touches it, and any change is noted here.

| Page | Plan | Reason |
|---|---|---|
| Admin pages (`/app/admin/*`) | Naming and H1 only; not converted | Staff screens are out of scope for depth |
| Platform and staff screens | Untouched | Out of scope |
| First-run screens | Untouched for now | One-time guided steps; check in CCD-2 |
| Countries, Help | Naming and H1 only | Reference pages, not working screens |
| Shared with Me | Naming and H1 only (CCD-5) | Short list |
| Application Memory, History, Insights, Calendar, Outputs | Naming and H1 only (CCD-3 and CCD-4) | Secondary views |
| Snapshot pages | Untouched | Frozen exports |
| Accept pages (invitations, contributor, sharing, client) | Untouched | One decision per page, already focused (UX-G) |
| `/status` | Untouched | Public page |

## Things deliberately not built

- **Phone search entry ("Search or do anything" above the tab bar).** The canvas shows it. It is a shell change and the shell was being reworked by another session; it needs the existing scoped search with no new backend. Not started; will be checked in CCD-7.
- **Rules R1 and R2 for document expiry (decision D1).** They need case travel dates and document usage that the ranking service does not read today. Needs the owner's go-ahead for the extra reads; ADR 0016 stands meanwhile.
