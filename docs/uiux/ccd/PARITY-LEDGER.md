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
| 04 | My Profile | `/profile` | CCD-3 (slice 3b) | **Built and tested** (not seen live) |
| 05 | Documents | `/documents` | CCD-3 (slice 3a) | **Built and tested** (not seen live) |
| 06 | Dates & Expiry | `/expiry` | CCD-3 (slice 3b) | **Built and tested** (not seen live) |
| 07 | Notifications | `/app/notifications` | CCD-5 (slice 5a) | **Built and tested** (not seen live) |
| 08 | Cases | `/missions` | CCD-4 | **Built and tested** (not seen live) |
| 09 | Case | `/app/mission/{id}` | CCD-4 | **Built and tested** (not seen live) |
| 10 | Evidence Requests | `/evidence` | CCD-5 (slice 5b) | **Built and tested** (not seen live) |
| 11 | Sharing | `/sharing` | CCD-5 (slice 5b) | **Built and tested** (not seen live) |
| 12 | Privacy & Consent | `/app/privacy` | CCD-5 (slice 5a) | **Built and tested** (not seen live) |
| 13 | Your Account | `/app/account` | CCD-1 | **Built and tested** (not seen live) |
| 14 | Agency Overview | `/app/agency/{orgId}` | CCD-6 (slice 6a) | **Built and tested** (not seen live) |
| 15 | Agency Cases | `/cases` | CCD-6 (slice 6b) | **Built and tested** (not seen live) |

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

## 05. Documents (`/app/applicant/{id}/documents`)

Baseline: `apps/web/src/lib/ccd/baseline/documents.json`, five states (empty wallet; core processing off with a document; several documents with one selected; a failed file selected; records could not be loaded). Test: `apps/web/src/lib/ccd/parity-documents.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page heading "Documents", eyebrow "Record" | Glance; now the page's one h1 (approved change; eyebrow was "Your Private Wallet") | always |
| See Document Insights, Upload Document (header buttons) | Glance | always |
| Download, reading, preview, date and kind error notices; "still being checked" line | Glance | only when they apply |
| Four filter tiles (All, Ready to Use, Needs Review, Expiring) | Glance; tapping one at Glance opens the list (raises to Browse) | always |
| Reading offer card | Glance (above the tiles, so nothing jumps when the list opens) | only when reading can be offered |
| List, category, search, pages, Selected Document panel | Browse; the panel heading is now an h2 (approved change, same words and size). A `?document=` link opens the page at Browse at least | always |
| Each document's details: reference, name, status, preview and download, findings, kind and date forms, name and kind suggestions, re-checks | Browse (the plan put the forms at Everything; kept at Browse so a picked document is never missing its preview and download) | per document, as before |
| Add Documents (upload form, storage meter) | Everything; Upload Document and links to `#add-document` or `#document-upload` raise the level first | always (form only with core processing on) |

Decision D5: the limits line above the file picker now ends "PDF files can be added only while our virus scan is switched on." whenever PDF files are refused, built from the same switch the server uses; a picked PDF gets the same reason and what to do instead. The size it prints was already the server's real limit (the smaller of the account quota and the 4 MB one request can carry).

Approved changes: the h1 and the Selected Document heading level. Nothing removed. Not built: a Glance list of the documents that need review (Glance shows the counts; a tile opens the list).

## 04. My Profile (`/app/applicant/{id}/profile`)

Baseline: `baseline/profile.json`, three states (a new profile; core processing off; confirmed, supported and conflicting details). Test: `parity-profile.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page heading "My Profile", eyebrow "Record" (was "Your Canonical Record") | Glance; the one h1 (approved change) | always |
| Add Information (or Review Permissions) | Glance | always |
| Identity banner: photo, name (now an h2, same size), nationality, profile kind, Essentials Added meter | Glance | always |
| You Decide What Becomes a Fact, with Review Document Suggestions | Glance | always |
| Conflicting values notice | Glance (moved above the editor so it is never hidden) | only with conflicting values |
| The profile editor (or the choose-to-save message), the history note | Browse; `#profile-editor` links raise the level first | as before |
| Profile Health, Latest Changes (titles now h2, same size) | Everything | always |

Approved changes: heading levels only. Not built here: splitting the editor's area list (Browse) from its field forms (Everything); both are inside one editor and stay at Browse.

## 06. Dates & Expiry (`/app/applicant/{id}/expiry`)

Baseline: `baseline/expiry.json`, four states (nothing yet; a passport expiring soon with other documents; a route rule waiting for a date; dates could not be read). Test: `parity-expiry.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page heading "Dates & Expiry", eyebrow "Record" (was "Expiry & Freshness" under "Expiry Centre") | Glance; the one h1 (approved change) | always |
| Add Dates to My Calendar | Glance | always |
| Deadline Clock (the dates that come up next) | Glance | always |
| Intrinsic Expiry, Route Rules and Issuer Confirmations cards | Browse (route rules and confirmations were planned for Everything; kept at Browse so stale or undated evidence is never hidden by default) | always |

Approved changes: the heading. Links elsewhere that said "Document Expiry Centre" or "Open Expiry Centre" now say "Dates & Expiry".

Each Record page remembers its own level (families documents, profile and expiry), so a choice on one never changes another.

## All Records and History (naming and heading only)

Not converted to levels. All Records: "All Records" is the one h1 with eyebrow "Record"; its group titles are now h2 (same size). History: "History" (was "Fact History") is the one h1 with eyebrow "Record" (was "Provenance").

## 08. Cases (`/app/applicant/{id}/missions`)

Baseline: `baseline/cases.json`, four states (no cases; core processing off; active, no-checklist and closed cases; cases could not be read). Test: `parity-cases.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page heading "Cases", eyebrow the traveller's name (was "Visa Cases" under "Cases") | Glance; the one h1 (approved change) | always |
| Start a Case (header, secondary, goes to the form) | Glance (new) | always |
| Your case line (title and stage), "No active case yet.", or "Your cases could not be loaded." when the read failed | Glance only (new) | always |
| All Cases list (was "Active & Past" under "Your Cases") with rings and stages, or No Cases Yet | Browse (approved rename; the "Your Cases" label is removed as it repeated the page name) | always |
| Start a Case form, with Add More Details open | Browse while there is no case, Everything after; every Start a Case link in the app now carries `#start-case`, which raises the level first | form with core processing on |
| Prepare a Brief, Case History (were header buttons) | Everything | always |

## 09. Case (`/app/mission/{id}`)

Baseline: `baseline/case.json`, four states (a new case with no checklist; a busy case with a checklist and open tasks; a changed case; a closed case). Stubbed panels are counted too, so a missing panel fails the test. Test: `parity-case.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Header: case title (h1), stage, reference, confirmation badge, Add Evidence, Start a New Case from This One, snapshot, More | Glance | always |
| Welcome note, changed-case alert, Next Step | Glance | as before |
| "Preparing a file is not the same as submitting it. VisaStack does not submit applications or predict decisions." | Every level (tested) | always |
| Manual assessment notice | Glance | manual cases |
| Section links | Every level; each opens the level of its section | always |
| Stage tracker, attention chips | Browse | always |
| Evidence Progress summary, overall badge and sentence, the "completeness only" line | Glance; Evidence Progress is now an h2 at the same size (approved change) | with a checklist |
| Evidence Checklist (Needs You, Needs a Check, Done) | Browse; `#readiness` now points at it | with a checklist |
| Case Details, Requirement Pack (`#pack`), Advance the Case | Browse (Advance was planned for Everything; kept at Browse so the next stage is never hidden by default) | always |
| Tasks, Appointments and Letters (`#work`), Contributors and Notes (`#notes`) | Browse (planned for Everything; kept at Browse because notifications, tasks and request replies send people to the case for them) | always |
| Select or Update Evidence (`#evidence`), Submission and Outcome (`#outcome`), Problems and Feedback, Snapshots (`#snapshots`), Itinerary Reference | Everything; every listed anchor raises the level first; the changed-case alert links to Snapshots | always |

One primary button: the Next Step (or the changed-case alert) holds it; the welcome note and the checklist picker turn secondary when either is there. The cancel question in More is now an h2.

## 07. Notifications (`/app/notifications`)

Baseline: `baseline/notifications.json`, three states (nothing yet; two new and fourteen read; only read ones). Test: `parity-notifications.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page title "Notifications" (h1), eyebrow "Account" | Glance; was "Updates on Your Cases" with eyebrow "Alerts" (D3) | always |
| Unread notifications with Open and Mark Read | Glance | unread |
| "Nothing unread in your latest notifications." | Glance only | some notifications, none unread |
| The ten most recent read notifications | Browse | read |
| Older read notifications (the service keeps returning the latest 50) | Everything | read |
| Empty state "No Notifications Yet" (was "No Alerts Yet") | Glance | none at all |
| The list card when nothing is unread | Browse, so Glance never shows an empty card | some notifications, none unread |

## 12. Privacy & Consent (`/app/privacy`)

Baseline: `baseline/privacy.json`, two states (no consent changes yet; consent history and a deletion scheduled). Test: `parity-privacy.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page title "Privacy & Consent" (h1), eyebrow "Account", the description line | Glance; was "Your Data Rights" with eyebrow "Privacy" (D3) | always |
| The three rights as rows (new links to `#export-data`, `#consent-history`, `#delete-account`; each opens its level) | Glance | always |
| Export Your Data card with "Download Export (JSON)" and "Download Export (CSV/ZIP)" (was lower case) | Glance | always |
| What an export holds (the card's sentence) | Browse | always |
| Consent History | Browse | always |
| Export with files (the large export panel) | Everything | always |
| Delete Your Account | Everything; **Glance while a deletion is scheduled**, so cancelling it is never hidden (tested) | always |
| New line linking to Permissions You Control on Home (`/app#permissions`) | Everything | always |

## 10. Evidence Requests (`/app/applicant/{id}/evidence`)

Baseline: `baseline/evidence.json`, five states (no requests; two waiting, one received, one accepted, with a question asked; one sent back with a reason; nothing waiting; requests could not be read). Stubbed forms are counted. Test: `parity-evidence.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page title "Evidence Requests" (h1), eyebrow the traveller's name, the description | Glance; was "Requests from Agencies" as an h2 (D3) | always |
| "N requests are waiting for you" notice | Glance | something waiting |
| A request waiting on the person: its name, due and status badges, why it is needed, the reason it was sent back, the reply form | Glance (tested) | waiting |
| A sent file that could not be used (Needs Correction while received or under review): the request, its guidance and the question box | Glance (tested), so the way forward is never hidden | file unusable |
| "Nothing is waiting for you." | Glance only; the list then starts at Browse | requests, none waiting |
| Needed by, the checklist note, the request reference, the next-step guidance | Browse | as before |
| Requests already answered or closed (received, accepted, cancelled) | Browse | as before |
| Your Questions and the link to replies in the case notes | Browse | questions asked |
| Ask the Agency About This Item, and the "asked several questions" line | Everything | a case and a reference |
| Requests that could not be read | Every level: "Your requests could not be loaded. Refresh to try again." (was the empty state, which claimed there were none; approved change) | read failed |

Links from notifications (`#request-{id}`) open the level that shows the request.

## 11. Sharing (`/app/applicant/{id}/sharing`)

Baseline: `baseline/sharing.json`, three states (nobody has access; active, paused, pending and revoked access with exceptions, a scope confirmation, invitations and a log; records could not be read). Stubbed panels are counted. Test: `parity-sharing.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Page title "Sharing" (h1), eyebrow the traveller's name, New Sharing Request (opens the form's level) | Glance; was "Sharing & Access" as an h2 (D3) | always |
| Who Has Access card, its count line, the failed-read alert | Glance | always |
| The revoke warning ("Pausing or revoking stops all future access...") | Glance, so at every level (tested) | any access |
| Live and paused access: the recipient, status, the Pause, Resume and Revoke buttons and their sentence | Glance (tested) | live or paused |
| "N more are waiting to be accepted or have ended. Choose Browse to see them." | Glance only (new); counts pending or ended access and invitations not yet accepted | some pending or ended |
| What each person can see (the scope summary), when it was accepted, cases not covered, the new-items confirmation | Browse | as before |
| Access waiting to be accepted, and access that has ended (revoked, expired or past its end date) | Browse, with their buttons | as before |
| AI connections | Glance (unchanged: a connected AI can read the record, so it is part of who has access) | always |
| Access Log | Browse | always |
| Sharing invitations, with Revoke Invitation | Browse (planned for Everything; kept at Browse because an invitation not yet accepted can still become access); counted in the Glance line (tested) | invitations on |
| Grant Access form | Everything; Browse while nobody has access; Glance when the person came from Share on a document | as before |

At an explicit Glance or Browse that hides the form, the access column takes the full width.

On every converted screen: after a form is sent, if the refreshed page moves the block the person just used to a deeper level (an answered request, the first share), the level rises to keep it on screen for up to a minute, without saving the choice; choosing a level on the switch ends this (tested in `depth-switch.test.tsx`).

## The Next Step banner (CCD-7, owner request 28 Oct 2026)

The Next Step on Home, the traveller page and the Case page now uses the dark banner of the approved mockups: the brand ink of the page headings (the colour of "Welcome back"; owner, 28 Oct 2026, replacing the darker sign-in navy first used), white title, light reason text and a white button that is still the screen's one primary action. Full at Glance and without scripts; shorter at Browse and Everything (on Home and the traveller page the button moves to the end of the line). Style only: the same markup, names, links and levels, so no parity row changes. Not built: the mockup's single-line pill at Everything, because it drops the reason sentence and nothing may be lost at Everything; Everything uses the shorter banner instead. Text sizes come from the product's type scale (title at the title size, the lead size in the shorter form; the mockup's 11px and 13px become the caption and small sizes). An urgent or settled next step keeps its coloured left edge; on paper the banner prints as dark text in an outline; in high contrast mode it keeps a visible edge.

## 14. Agency Overview (`/app/agency/{orgId}`)

Baseline: `baseline/agency-home.json`, five states (a new agency; a busy administrator; a member; a quick view; a search with no match), rendered with the workspace heading because it holds the page's one h1. Test: `parity-agency-home.test.tsx`.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Heading: eyebrow the agency's name, h1 "Agency Overview" (was the agency's name as h1 under "Agency Workspace"), "Invite a Client" (was "Invite Traveller") | Glance (D3) | always |
| Four metric tiles | Glance | always |
| Do Next: heading, intro and the first item | Glance | always |
| "N more need you. Choose Browse to see them." | Glance only (new) | more than one item |
| Do Next items 2 to 8, "Showing N of M" | Browse | as before |
| Case Pipeline, Cases and Attention (quick views, table, empty states) | Browse; both at Glance when a search, stage or quick view asked for the list (tested) | always |
| Search form and its sentence ("Search covers only...", split from the list's intro, approved change) | Everything; at Glance with a search or quick view | always |
| Evidence Requests, Your Team (administrator); Your Case Work (member); the member notice | Browse | as before |
| Reassignment Queue, Case Activity, Clients Joined, Attention Details | Everything | as before |
| Finish Agency Setup | Every level (planned for Everything; it shows only while setup is unfinished, and then it is the next thing to do) (tested) | setup unfinished |

Every other agency page gets the same heading: the agency's name above and the page's name as the one h1 (Cases, Clients, Team, Agency Settings, matching the menu). Plan & Usage, Countries and Case Activity keep their own h1 (Case Activity's header is now that h1) and the heading shows the agency's name as plain text (tested).

## 15. Agency Cases (`/app/agency/{orgId}/cases`)

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Heading (eyebrow the agency's name, h1 "Cases"), the Cases card and its intro, the empty state | Glance | always |
| Each case row: title, traveller, case reference | Glance | always |
| "Needs you: ..." or "Nothing needs you on this case right now." | Glance only (new): open tasks assigned to this person; sent items waiting for review (checklist items for people assigned to the case, request replies for administrators); for an administrator, a case nobody looks after. Nothing for a closed, cancelled or submitted case, as Agency Overview (tested) | a case is listed |
| Where Things Stand | Browse | as before |
| Assigned, with assign and unassign | Browse | as before |
| Tasks, Appointments, Notes | Everything | as before |
| Decisions, Issuer Confirmations (was "Issuer confirmations (EVI-05)", approved change) | Everything | the case has a checklist |

A link to a case (`#mission-<id>`, from Agency Overview, Case Activity and the header search) opens Everything, so the whole case shows (`data-reveal`, links only; a form sent inside a case keeps the chosen level) (tested). Baseline captured from main at `5a8f4370`; four states (administrator and member, with and without cases).

## CCD-7 polish and heart pass (28 Oct 2026)

| Part | Where | State |
|---|---|---|
| One name per thing (D3), finished | slice 7a, #334 | Merged and live |
| The section 6 behaviours: anticipate, quiet closure, calm all-clear, reduced motion | slice 7b, #335 | Merged and live |
| Already in place (audited): level change read out, 44 pixel targets on the switch and Next Step, specific lines after sent evidence, single suggestions and new shares | audit 28 Oct | Confirmed |
| Phone, tablet and laptop widths | every page the tests render (824) loaded with the real stylesheet at 390, 768 and 1280 pixels | No page scrolls sideways at any width; the check was seen catching a deliberately wide page at all three widths |
| Copy pass (design:ux-copy) and accessibility pass | the new lines of 7b; WP-C2 | Done; four lines reworded |
| Not checked | the signed-in pages on the live site; hover, pressed and disabled states | Needs a signed-in run |

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
