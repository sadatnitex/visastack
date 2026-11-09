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
| Evidence Checklist (Needs You, Needs a Check, Done) | Glance (was Browse; Owner, 4 Nov 2026: the checklist is the heart of the page, so it shows at every level); `#readiness` points at it | with a checklist |
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

Baseline: `baseline/evidence.json`, six states (no requests; two waiting, one received, one accepted, with a question asked; one sent back with a reason; one sent back with the copy to replace still among the documents (added 4 Nov 2026, Lane E: the entry was added to the file, no earlier entry was changed); nothing waiting; requests could not be read). Stubbed forms and panels are counted. Test: `parity-evidence.test.tsx`.

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
| The copy picker inside the reply form (Lane E, 4 Nov 2026): the heading Choose the Copy to Send, each copy by name, kind, time added and how it was checked, the Newest and Sent Back by the Agency marks, the plain reason a copy cannot be sent yet, and the line saying what sending means for the exact copy | Glance, with the reply form it belongs to (tested) | a document request waiting on the person |
| Upload a Clearer Copy (the Replace with a Newer Document steps, opened from the copy the agency sent back) | Glance (tested), so the way forward is never hidden | request sent back, the sent back copy still an everyday copy |
| Add Documents, in its place | Glance | request sent back, no sendable copy, the sent back copy no longer an everyday copy |
| Your documents could not be loaded. Refresh to try again. | Every level, as an alert in the reply form | the documents or their states could not be read |
| Requests that could not be read | Every level: "Your requests could not be loaded. Refresh to try again." (was the empty state, which claimed there were none; approved change) | read failed |

Links from notifications (`#request-{id}`) open the level that shows the request.

Agency side (not a depth screen, so no baseline): on the agency Clients page each document request that has a copy sent shows that exact copy (name when sent, kind, which send, when, size, a short fingerprint, how it was checked, "Received is not Accepted"), earlier sends folded under "Earlier Sends (N)" with their state, time and the agency's own reason, and Download Sent File only where the service says the file can be opened. The Accept, reason and Cancel buttons are the same; they now post which copy the reviewer was shown. Test: `evidence-copies.test.tsx`, `evidence-request-actions.test.tsx`, `clients/page.test.tsx`.

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
| 09 Case | Next Step, reminder line, progress, the checklist | stage bar, attention chips, the six counts, jump links, Case Details, Requirement Pack | Tasks, Appointments, Cover Letters, Contributors and Notes, Advance the Case, Snapshots, Itinerary Reference, plus closed rows for Select or Update Evidence, Submission and Outcome, Problems and Feedback |
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

## UMPE P13: three traveller entry points (3 Nov 2026)

Guard: `apps/web/src/lib/experience-parity.test.ts` over the map in `apps/web/src/lib/experience-parity.ts`. Every page under `/app` is classified as a navigation destination, a contextual link (file and link text pinned) or an emailed address; a new page without an entry, a navigation page the menu no longer offers, or a removed contextual link fails the build. A frozen list of the traveller links just before P13 must all still be offered.

| Before P13 (traveller sidebar) | After P13 | Address |
|---|---|---|
| Home (tab) | Home (tab, unchanged) | `/app/applicant/{id}` |
| Record (tab) | More Tools: Record; its sections light up My Documents | `/app/applicant/{id}/record` |
| (Record section) Documents | My Documents (tab), with the task Add Documents | `/app/applicant/{id}/documents` |
| Cases (tab) | My Trips (tab), with the task Start a Trip | `/app/applicant/{id}/missions` |
| Sharing (tab) | Sharing & Requests (tab) | `/app/applicant/{id}/sharing` |
| Notifications, Countries | unchanged (under More on a phone) | `/app/notifications`, `/app/countries` |
| More Tools: Evidence Requests | More Tools (lights up Sharing & Requests) | `/app/applicant/{id}/evidence` |
| More Tools: Shared with Me | More Tools (lights up Sharing & Requests) | `/app/shared` |
| More Tools: Account Overview | More Tools, unchanged | `/app` |
| (no menu entry) | Task under My Trips: Start a Trip | `/app/mission/start` |
| (no menu entry) | More Tools: Group Trips | `/app/trips` |
| (no menu entry) | More Tools: Answers to Agencies | `/collect/account/answers` |

Unchanged: the agency and platform lists (pinned by `workspace-navigation.test.ts`), the account menu, the Record section tabs, every URL and every page's own access check. Application Memory, outputs, calendar, insights, removal records, billing, AI settings and the admin tools keep their contextual links, now pinned by the parity map. Home gains a Start Here row and, beside a case, a change note when one needs the traveller; nothing was removed from Home or the traveller's Home, so their baselines are unchanged.

## UX17 Documents: removals approved by the owner (4 Nov 2026)

The owner said "we dont need Add Documents at the bottom". The bottom Add Documents card is removed from the Documents page: its heading, its words (including the earlier UX7 wording that sat beside the link), and the consent hint that lived only inside it. The Add Documents page asks for the consent. The header button stays, a phone gets an Add button that stays in reach, and the empty list opens the Add Documents page directly. Recorded in `apps/web/src/lib/ccd/approved-changes.ts` against UX17.

## UX18 Home after Start Here: changes approved by the owner (4 Nov 2026)

The owner approved the drawing for Home after Start Here. Renames: My Records is People, Active Requests and Work is Cases. Removals: the small labels People and In Progress above those headings, the My Next Journey heading and its sentence (the next case is a dashed Start a Case tile at the end of Cases). Reshaped, same facts and same addresses: a person, a case and a set of agency requests are each one card; the order of the words in their link text and the chevron differ. Recorded in `apps/web/src/lib/ccd/approved-changes.ts` against UX18. Dates That Matter, Start Here, Needs Attention and the Permissions content are unchanged.

## LIFT-B Case rail, More for This Case and phone bar (Owner, 4 Nov 2026: redesign the case pages and the others)

Package B of the signed-in redesign. Nothing is removed; every id, link address, heading and fixed sentence of screen 09 stays. Recorded in `apps/web/src/lib/ccd/approved-changes.ts` under the line `WP-LIFT-B entries`. Tests: `parity-case.test.tsx` (unchanged), `case-rail.test.tsx`, `case-secondary.test.tsx`, `case-mobile-bar.test.tsx`, `trip-checks-panel.test.tsx`, `case-lift-b.test.ts`, and `e2e/scroll-budget/WP-SB2.spec.ts`, which now measures the real case page with worst-case data.

| What it is | Level it lives at now | Condition (unchanged) |
|---|---|---|
| Case Details: the place, the travel dates as a calendar row, the target deadline (new, only when one is set), Edit Case Details; the "Add your travel dates..." line now sits here | Browse | always |
| Trip Date Checks (`#trip-checks`): one compact row per check (mark, title, status in words, one line of detail); the long explanation sits under "About These Checks"; new line "No date checks apply yet." when no check applies. Moved from the main column into the rail | Browse | the stage shows date checks and the case has travel dates |
| Requirement Pack (`#pack`) with "Sources for This Checklist" (moved here from the main column) | Browse | always; the sources only with a checklist |
| Advance the Case | Browse | always |
| Snapshots (`#snapshots`) as rows with a chevron; Itinerary Reference with its form under "Link to a Family Trip" (open once a label is set) | Everything | always |
| More for This Case: one card, five rows (Select or Update Evidence at Everything, Tasks, Appointments and Letters at Browse, Contributors and Notes from Your Agency at Browse, Submission and Outcome at Everything, Problems and Feedback at Everything), each with a count where its hint was | the card shows at Browse; each row at its own level as before | always |
| Phone: each rail card folds into one 56px row (name, one line, a status) and opens in place; the next step bar shows "6 of 12 · the step" with a 40px bar; the section links are one row that scrolls inside its own box | every level | phones only; a wide screen shows the cards |

Approved changes: the five section summary names (the hint line is replaced by a count: "Select or Update Evidence" now reads with "7 Checklist Items" or "No Items Yet", "Tasks, Appointments and Letters" with "2 Open Tasks" or "No Open Tasks", "Contributors and Notes from Your Agency" with "3 Notes" or "No Notes Yet", "Submission and Outcome" with "1 Outcome" or "No Outcome Yet", "Problems and Feedback" with "2 Raised" or "None Raised"). No sentence, link or heading was removed, so no owner removal entry is needed.

## 09. Case: the status card and the checklist redesigned (WP-LIFT-A, owner, 4 Nov 2026)

Owner, 4 Nov 2026: redesign the case pages and the others. The Case page top and the checklist are rebuilt as one calm status card and a checklist that leads the page. Every element that was on the screen is still there; what changed is recorded here and in `apps/web/src/lib/ccd/approved-changes.ts` under "WP-LIFT-A entries". The comparison test (`parity-case.test.tsx`) passes with those entries and nothing else.

| What changed | Before | Now | Why |
|---|---|---|---|
| Three summaries become one | A dark Next Step slab, five chips and a ring in a grey box, with the same fact said seven times and two different counts ("Fix 4" and "Missing required 3") | One Case Status Panel: the Next Step (or the changed-case alert) beside Evidence Progress (a big "6 of 12" and a bar), the counts, the attention chips and the stage bar. The Next Step, the chip, the sentence and the checklist group all read the same count of items to fix | Numbers must agree |
| Chip wording | "N required items missing" | "N required items to fix" (singular "1 required item to fix") | Same count as the Next Step |
| Sentence under the overall state | "N requirement(s) still needed" | "N required items still needed" (singular correct) | Plain words |
| Counts note | "The ring counts required items..." | "The bar counts required items..." | There is no ring on this page now |
| Count names | On file, Missing required, Needs Review, Unknown applicability, Not applicable, Optional not provided | On File, Missing, Out of Date or Two Values, To Confirm, Not Applicable, Optional Not Provided (names of counts, not counted by the test) | Title Case, plain |
| Changed-case alert | "This case has changed since it was last acknowledged." and "A material edit invalidated the previous sign-off. Capture a new snapshot and acknowledge it again before relying on this case as submission-ready." | "Something changed after you confirmed this case." and "Take a new snapshot and confirm it again before you rely on this case." (same snapshot button, same list of what changed) | No engineering words |
| A case with no checklist | Green "Nothing needs attention right now"; an empty grey ring; "Pick a Checklist" even when none can be picked | Neutral "Nothing is checked yet: this case has no checklist" (the green all-clear stays for a case that has a checklist); an empty panel that offers "Pick a Checklist" only when one can be picked, otherwise "Add Evidence" | False all-clear and a pick that cannot be made |
| Checklist action | "Provide Evidence ↓" (and "Resolve on Profile →") as underlined links | "Provide Evidence" (and "Resolve on Profile") as one button per row; same addresses | One clear action |
| Source link in a row | "source" | "View Source", inside the row's "More About This Item" fold (same address) | Meaningful link name |
| Stage tracker | Ten radio dots; "Only the current state is marked..." line | A stage bar: "Stage 2 of 9", numbered steps, only the current one filled (earlier steps are never ticked); Cancelled shown apart; the explanation folded under "About Stages" | Same list, same words |
| Level | Checklist at Browse | Checklist at Glance; the six counts, chips and stage bar stay at Browse (the Glance sentence in the depth switch says so) | The checklist is the heart of the page |
| Where things sit | Trip Date Checks and Sources for This Checklist in the main column | Passed to the rail (`tripChecks`, `sources`); the working grid reads: checklist, rail, rest | Package B places them |

Not removed or merged: every heading (Evidence Progress stays an h2), every link address, every summary name, the "Preparing a file is not the same as submitting it" line (every level), the self-reviewed note, the traveller confirmation line, "Readiness is completeness only - never an approval likelihood", "Completeness is not an approval probability". The last two lines and the counts note now sit in one fold, "How This Is Counted". One primary button remains in the card. The ring component still serves Home and the agency pages (Package C).

## Lift Package C: the other signed-in screens (4 Nov 2026, owner: redesign the case pages and the others)

Owner, 4 Nov 2026: redesign the case pages and the others. Package C draws Home, Documents, Evidence Requests, Agency Clients, Sharing and the start forms in the same language as the redesigned Case page (cards, a number first, status in words and a mark, one filled button to a region). Every element that existed is still on the screen with the same words and the same address, except the one wording change below. Structure that changed without changing a name:

| Screen | What changed | Counted elements |
|---|---|---|
| 03 Traveller home | The Next Step banner is shorter and keeps its dark ground (one dark block, as the owner asked on 28 Oct). The three counts are tiles with the number first. A case with a checklist shows a thin bar with its words; other cases are action rows with a tile. Needs Your Attention rows are action rows with a tile. Essentials and details meters are drawn as pictures with a name. | Same links, same words, same levels. One new line on a case row with no checklist yet ("Pick a checklist to see what is ready"), recorded against the traveller screen in `approved-changes.ts` (WP-LIFT-C entries). |
| 05 Documents | At 767px and under every row is one column (file names no longer squeezed to a letter a line). The four filters are tiles (number first, chosen tile tinted with a 2px edge). Each row has a file tile and its safety words as a pill. The "no kind set" notice is an information banner with a short title and the same sentence under it. | The "Show It" and "Show Them" button is kept. New: one title line on the banner. |
| 10 Evidence Requests (traveller) | The waiting notice is a warning banner. Each request is its own card with a tile, the agency's reason on a light band, 56px choice rows with a file tile, and a pill for Received (information blue) that is never the colour of Reviewed (success green). Requests that need a reply or are being checked come first; Received, Reviewed and closed requests follow a small Finished heading. | New: the Finished heading, shown only when something finished sits under something that still needs a reply. Order change only: finished requests are listed last. |
| Agency Clients | Inviting and requesting are one card, Add People and Requests, with the three disclosures as action rows (Pending Invitations with its count, Invite a Client, Ask for a Field or Document). The status filters are one segmented control with a count on each. Each request is a block; the copy that was sent sits on the light brand tint with a file tile, a monospace fingerprint and the not-scanned warning with an alert mark. Accept (filled) and Needs Replacement stay in view; Start Review, Contradiction, Propose Correction and Cancel Request are under More Decisions. Received is information blue, Accepted is success green. | The Clients and Request Evidence headings are level 3 inside the new card (level 2 before). The Intake and Collect labels and both sentences are kept. More Decisions is a new summary. |
| 11 Sharing | Each grant is a card with a tile, its name and its state in words. Pause and Resume are quiet; Revoke is an outlined danger button and is filled only in its confirmation ("Yes, Revoke Access"). Ended grants sit under Ended Access (n). The revoke warning stays visible at every level. The scope-expansion box is an information box. The access summary stacks each name above its value. The access log filters fold under Filter the Log (open while a filter is in use). | New: the Ended Access summary and the Filter the Log summary. Nothing removed. |
| Cases (08) and Start a Trip | The empty state of Cases keeps its component and is drawn like an empty panel (dashed edge, tile, same words, the Start a Case link is a quiet button). Each question of a start form is a numbered card (numbers come from a counter, never from words); the one filled button sits in the sticky action bar. | Same words, same links. |

Level plan: no level changed. Upcoming and Recent Activity stay at Everything on Home, so a phone at Glance is one screen (844px measured).

### 09. Case: review fixes (WP-LIFT-A, owner, 4 Nov 2026: redesign the case pages)

| What changed | Before | Now | Why |
|---|---|---|---|
| Changed-case chip | "1 Changed Since Confirmed" (Title Case) | "1 changed since confirmed" (same address, `#snapshots`) | Reads like its siblings ("2 need a check") |
| Welcome note shown (a case made in the last hour) | Evidence Progress offered "Pick a Checklist" (or "Add Evidence") and the reason line again under the welcome note's own button | The empty Evidence Progress says only what a checklist is; the welcome note keeps the one way forward. The "Pick a Checklist" link (`#pack`) that the old ring offered is left to the welcome note in that state (a removal, Owner, 4 Nov 2026: one way forward, shown once). The parity test has no such state, so the entry in `approved-changes.ts` is recorded but not exercised | No duplicate calls to action |
| Link names | "source" (cited page), "Resolve on Profile →" | "View Source", "Resolve on Profile" (same addresses); an approved rule for the case screen, because the parity states carry no source address | A link name must stand alone |
| Stage bar | Ten steps always drawn | "Stage 2 of 9 - In Progress" and a strip at every width; the full numbered steps show when "About Stages" is opened on a wide screen | Height; the same words are on the page |
| The six counts | Beside the bar | Inside "How This Is Counted" with the notes (same words, same numbers) | Height; Glance and Browse keep the number, the bar and the sentence |
| Traveller confirmation, Self-reviewed | Under the chips | In the Evidence Progress column | One place for how far and who checked |
| Next Step edge | Red edge for what needs fixing | Brand blue edge always; the status is in the words and the pill | An error stripe on an information panel |
| Checklist fold | "1 More Item" hid a single row | Every row shows when only one would be folded | Nothing is folded for one row |
| Working grid | The rail shared two rows, leaving a gap above "More for This Case" | Two rows, the second takes the rest | Layout |


## 05. Documents: the plain pass (5 Nov 2026, owner: no page should have more than 30 words)

Owner, 5 Nov 2026: no page should have more than 30 words while being exceptionally intuitive. He showed the live Documents screen on his phone: a wall of text, two identical "We could not tell what..." cards, a long Placed Automatically paragraph, four filter chips on two rows, four tiles, a grey paragraph about files with no kind, and a file name squeezed into a sliver with a pill and "Format Checked" on every row. The guard is `apps/web/src/lib/prose-budget.test.ts` (the definition is in `prose-budget.test-support.ts`): a registered screen shows at most 30 words of explanation at its phone default depth (Glance). Documents is registered; where every other screen stands is in `prose-budget.baseline.json`. Measured with the guard on the same four states (owner's phone state, a few documents, a link between two files and a suggested kind, nothing added yet): 111, 49, 78 and 23 words before; 0, 7, 7 and 13 now.

Nothing was deleted without a way back: every sentence that left the first view is still in the page, behind a closed disclosure (the guard checks this), or was a pure duplicate (the same question asked once per file).

Level plan: the list, the four numbers, the lists tabs and the no-kind row are now at Glance, with the document's own screen (the details a tap opens) at every level; only search and categories wait for Browse. The Glance screen used to show no document at all. Everything now matches Browse (the section it once held, adding documents, left the page on 3 Nov).

| What changed | Before | Now | Why |
|---|---|---|---|
| Page sentence | "Keep reusable evidence together..." under the heading | The same sentence in the closed "About Documents" at the end | Words |
| Depth switch sentence | One sentence under the switch ("Everything: adding new documents." was no longer true) | Behind the round i beside the switch; the three sentences now say what each level shows | Words |
| Header buttons | See Document Insights and Add Documents | The same two; on a phone the always-there Add button is the one primary, so the header copy of it steps aside | One primary |
| Files nobody could name | One card per file with the same sentence and its own button | One heading ("We Could Not Tell What These Are") over one row per file: the file name and one Choose What It Is. "We Are Not Sure What These Are" and "Check These Suggestions" are groups the same way | Identical items are one list |
| Needs One Decision sentences | "Most files are sorted on their own..." and, for held files, "These files were added for several people at once..." | In the closed "About These Choices" in the same card, with "A suggestion is only a guess. Nothing is saved until you accept it." when a suggestion is waiting. A suggested link between two files keeps its one sentence and keeps what Confirm does behind "What Happens Next"; findings raised on arrival keep their sentence with the advice behind "What You Can Do" | Words; the safety promise stays one tap away |
| "Nothing needs a decision right now." | A line in the card when only sorted files were listed | Gone: with nothing to decide the card is not shown | Nothing to say |
| Placed Automatically | A heading, a paragraph and one long card per file | One closed row, "Sorted for You (2)"; inside, the same sentences and the same Change buttons | Words |
| Linked Copies | A heading inside the decision card | Its own small card with the same list | Layout |
| Four tiles | Two rows of two tiles | One row of four numbers (number over name); none at all while the wallet is empty | One row at 390 |
| Lists (Current, Archived, Recently Deleted) | A row of tabs that wrapped, with Removal Records as a fourth tab | Compact tabs; Removal Records is a quiet link after them. The tabs are at Glance | One row |
| Files with no kind | A banner with a paragraph and a Show Them button | One row, "2 Need a Kind", with Why? (the old paragraph) and Show Them; once shown, the button reads Show All | Words |
| Category and search | Two labelled fields with a long hint | Two fields side by side, the labels read aloud only ("Search" as the hint). Hidden while the wallet is empty | Space |
| "7 documents match. Page 1 of 2." | A line of words above the list | Read aloud only; the list ends with Previous, the place ("1 of 2") and Next | Counts, not sentences |
| A row | A file tile, the name squeezed beside a "Needs Review" pill and "Format Checked", kind, category and version, "Updated 4 Nov 2026", then a Manage button of its own | The name has the whole line and ends in an ellipsis; under it one pill only when something is not normal, then the kind and the date; the whole row opens the file; Manage is a small round control at the end of the row with the same menu. A normal file shows no pill and no "Format Checked" (how it was checked is in its details). The category and "Version 1" are no longer on the row | One tap target, no sliver |
| The opened document's three notes | Three paragraphs above and below its details | In one closed "About This File"; when the preview is blocked the reason stays visible | Words |
| Empty list | A 38-word explanation and a reason | "No Documents Yet", "Add each paper once.", "Then use it on every case." and Add a Document | One short thing and one button |
| Still being checked | A 26-word paragraph | "Checking your files. This page updates itself." (the long text is in About Documents) | Words |

Approved changes (apps/web/src/lib/ccd/approved-changes.ts, all citing the owner, 5 Nov 2026): the four row buttons of the parity states (the new text of a row), the empty-state sentences, and the four zeros and two fields of an empty wallet. Not covered by a parity state, so recorded here only: every needs-decision change above.

Not built: the opened document's details (the card with its reading, dates and safe copy) are not held to the rule yet; on a phone that is a separate full screen, on a desktop the side panel.

## PLAIN-P2: the 30-word rule on the main signed-in screens (Owner, 5 Nov 2026: no page should have more than 30 words)

Owner, 5 Nov 2026: no page should have more than 30 words. At the phone default (Glance) a screen shows one status line, its data and one primary action. Every sentence of explanation moved behind a one-tap fold ("About This", "Why This Step", "About Revoking" and similar, a native details element with a chevron), so nothing is deleted: the same words stay in the markup and are one tap away. Sentences that a safety or truth rule needs stay on the screen in one short line, with the full wording in the fold beside it. The three-way level switch keeps its sentence for screen readers only on a phone (hidden by style, not removed), because the three buttons speak for themselves. No level changed. P2 covers the Case, Home, Evidence Requests, Agency Clients, Sharing, Start a Case, Start a Trip, Cases, Group Trips, My Profile, Dates and Expiry and Notifications screens; the Documents screen and the word guard belong to P1.

| Screen | What moved, and what stays on the screen | Counted elements |
|---|---|---|
| 09 Case | Next Step: the title and one short line ("First to fix: {item}.") stay; the reason moves under "Why This Step". Evidence Progress: the sentence under the bar and "Traveller confirmation" move into "How This Is Counted". The journey reminder ("Preparing a file is not the same as submitting it. VisaStack does not submit applications or predict decisions.") sits under "About This Case". A checklist row keeps its name, tag, status word and one action; the sentence on what to do next is the first line under "More About This Item". Category counts read "0 of 2". The changed-case alert keeps its one sentence and the filled button; the list of changes sits under "What Changed". The welcome note shows one short line; the longer words sit under "About This". The empty Evidence Progress says only "No Checklist Yet" and a fold. The phone bar reads "6 of 12 · 4 to fix". | Same words, same places in the markup (folded). New short lines: "First to fix: {item}.", the welcome lead, "{n} to fix". Rule: the old one-paragraph "First to fix: X. Some required items are missing..." is now two sentences (approved rule). |
| 03 Traveller home | The status line under the name is one short sentence ("4 items need a look." or "Nothing is waiting for you."). The Next Step's reason sits under "Why This Step" (also on Home, the trip page and Add Documents, which share the card). | Approved: the two old status sentences. The reason keeps its words inside the fold. |
| 10 Evidence Requests (traveller) | What a request is (and is not) sits under "About Requests". The banner keeps its count; "Reply to each one below." is gone (a repeat of the page). A request with no reason from the agency says nothing about it (the same sentence was on every card). The sending sentence is short beside the button ("Sending shares this exact copy."); the full consent wording and the hint sit under "About Sending". The empty state is its title and one button, with the words under "About This". | Approved removal: "The agency did not add a reason. Ask them if you are unsure." (repeated line). All other words stay in folds. |
| Agency Clients | "About Invitations", "About Requests" and "About Cases" hold the three explanations. The empty states are their title and one button. "Received is not Accepted." stays as one line (the Accept and Needs Replacement buttons are the next step); "Not scanned for viruses" wording stays visible; the download note sits under "About Downloading". Two field hints are shorter ("Only that email address can accept.", "Only if access is limited to one case."). | Approved: "Received is not Accepted. Accept it or send it back below." is now "Received is not Accepted." (the second sentence repeated the two buttons). |
| 11 Sharing | The description, how grants are labelled, and what Pause and Revoke do sit under "About Sharing" (once, no longer under every grant). The revoke warning stays visible at every level as one line ("Revoking stops access now; copies already downloaded cannot be erased.") with the full wording under "About Revoking". The count is "1 active grant." | Approved: the count sentences ("N active grants. Pending, paused and ended grants are labelled separately below." is now "N active grants."), and the repeated Pause and Revoke note (removed under each grant, kept once under "About Sharing"). |
| Cases (08) and Start a Case | "About Cases" holds the description. The empty state is its title and one button. The destination hint is one short line; the sentence on linking a checklist sits under "About Checklists". | None (the words moved unchanged). |
| Start a Trip, Start a Group Trip, Group Trips, one trip | The descriptions and the explanations under the forms sit under "About ..." folds ("About Starting a Trip", "About Group Trips", "About Travellers", "Travelling With an Adult?", "About Shared Documents"). A trip's line under its name is "{destination} for {purpose}." | None (not parity screens). |
| 04 My Profile | The description and "Personal profile. Fact assurance is shown beside each field." sit under "About This Profile". "This does not verify identity." stays; the rest of the essentials sentence sits under "About Essentials". A conflict alert keeps one short line ("1 field has conflicting values."); the full sentence sits under "What to Do". "AI suggestions wait for your approval." stays; the full sentence sits under "About Suggestions". | None (the words moved unchanged). |
| 06 Dates and Expiry | The description sits under "About These Dates". The empty Deadline Clock is its title and one button. | None. |
| 07 Notifications | The empty state is its title and one button. | None. |

Level plan: no level changed. Not changed on purpose: the text of a notification, the agency's own reason for a request and the request's decision reason are the content a person came to read, not instructions about the screen, so they are shown as they are.

Guards updated (only expected words and places, nothing weakened): the Lift CSS tail guard now allows later marked blocks (WP-PLAIN-*) after the last Lift block; the case page outline lists the new folds; page, phone bar, sharing, evidence copy, traveller composition and Sharing parity tests read the new words.

## PLAIN-P3B: the 30-word rule on the agency screens (Owner, 5 Nov 2026: no page should have more than 30 words)

Owner, 5 Nov 2026: no page should have more than 30 words. Agency Overview and Agency Cases now show 30 words or fewer of explanation in every state at the phone default. Explanations moved behind a one-tap fold, so nothing is deleted. No level changed.

| Screen | What moved, and what stays on the screen | Counted elements |
|---|---|---|
| Both agency screens: page heading | The line "Your clients, cases and team in one place." is gone: it was the same on every agency page and only restated the page name and the section bar. "Powered by VisaStack" stays, as a name. | Approved removal (both screens): the line above. |
| Both agency screens: level switch | The one sentence about the chosen level sits behind the small round "i" beside the switch (the same control the Documents screen uses). | The three sentences are unchanged and still on the page. |
| 14 Agency Overview | Do Next: the line on how the list is sorted (and "For the cases in your current view.") sits under "How This Is Sorted". Each item keeps its owner and the traveller and case as short data; its reason stays visible. Under Cases and Attention, "Cases that need action come first." and the sentence on what search covers sit together under "About This List". The count under Pending Requests ("1 waiting on a traveller, 1 waiting on you"), "Not set" and "Nothing" in the case table are marked as data. "N more need you. Choose Browse to see them." and "No cases match that search." stay. | None (the words moved unchanged). |
| 15 Agency Cases | The line on what this person can do on cases ("Assign a team member and leave case notes ...") sits under "About Cases", with the "Choose a case to open its workspace ..." line. The empty list ("Once a client accepts ..." sits under its own "About This", through a new EmptyState option that folds only the reason) keeps its title, the sentence that says why it is empty (an administrator: a traveller must grant this organization access; a member: ask an administrator to assign you) and, for an administrator, the Invite a Client button. The "Needs you" line for an administrator keeps every item but names the missing owner shorter: "... and an owner." | The "Needs you" wording is new (not in the baseline); no approved change needed. |

Desktop: the two agency-cases states with no cases dropped under 30 and lost their ceiling; the other states keep lowered ceilings (prose-limits.json). Still over 30 on a desktop: Agency Overview in every state (the Do Next list repeats one reason per item and the side cards carry sentences) and Agency Cases with a case open.

## PLAIN-P3A: the traveller screens under the 30-word guard (5 Nov 2026)

Owner, 5 Nov 2026: no page should have more than 30 words. Every traveller-side state of Home, a traveller's page, the case page, Documents (including the opened document), Privacy, Sharing and My Profile now shows 30 or fewer words of explanation at the phone default. The Documents screen is held to 30 on a desktop as well. The words are moved behind one tap, not deleted.

| Screen | What moved, and what stays on the screen | Counted elements |
|---|---|---|
| All seven | The one sentence about the chosen level sits behind the small round "i" beside the level switch (the same control Documents already had). | Words, same place in the markup, closed. |
| Home | The line under the heading is "Signed in as {email}". "What needs you across every traveller on this account, with your agency work and the permissions you control." sits under "About This". Permissions: the paragraph about turning permissions on and off and the full meaning of every permission sit under "About Permissions". A permission that sends something out keeps one short line on its row ("Sends document text to an AI service.", "Sends scan pictures to an AI service.", "An agency may contact the issuer."); the others carry a one-word chip (Needed, Optional). | Approved: the old two-sentence line under the heading. Permission names are data. |
| Traveller page | The three one-line notes under the total tiles sit under "About These Totals". | Approved rule: a tile link is its name and number. |
| Case page | Only the level sentence moved. | None. |
| Documents, opened document and side panel | The file's facts stay as short data. The checking truth is one short line ("File type checked. Not scanned for viruses." and the matching short line for every other check state). The preview-blocked reason is "Preview is blocked for this file."; a file with no reading status keeps one short next step ("We could not check this file. Upload it again."). Under "About This File": the full checking sentence, the full blocked reason, the full next step, the iPhone photo note and the Document Date hint. | The old long sentences are kept word for word in the fold. |
| Privacy | The line under the heading sits under "About This". | Words. |
| Sharing | Only the level sentence moved. | None. |
| My Profile | The nationality and created-date line and the title of "You Decide What Becomes a Fact" are marked as data / label. | None. |

Safety and consent wording shortened on a screen (full wording one tap away): the permission meanings above, the checking line, the preview-blocked reason and the failed-file next step. Every other consent, warning, "not scanned" and error line is unchanged.

## 09. Case: package 0 of the case page plan (9 Nov 2026)

| Was | Now | Level |
|---|---|---|
| "Traveller has not confirmed yet", "Confirmed by the traveller on <date>", "Traveller confirmation:" | "You have not confirmed this case yet", "You confirmed this case on <date>", "Your confirmation:" | always |
| Header buttons Start a New Case from This One and Take a Snapshot at every level | Browse and deeper (still in More on a phone and in the page); Add Evidence stays at every level | Browse |
| The 8-link section row at every level | Row hidden at Glance; each link carries the level of its section | Browse |
| "Requested by Your Agency" on an agency-added line with no agency on the case | "Added by an Agency" (with an agency on the case it still reads "Requested by Your Agency"); starter lines read "Starter List, Not Official" | always |
