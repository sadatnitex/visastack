# One name per thing

Approved by the owner on 2026-10-28 (decision D3). Applies to user-facing words: menus, titles, buttons, notifications, emails that name pages, help text. Routes and file names do not change. Status column: Done means built and tested; Planned names the package.

| Thing | Canonical name | Retire | Status |
|---|---|---|---|
| Account home | Home, heading "Welcome back, {first name}" (no name: "Welcome back") | "Welcome Back" alone, "Overview" for travellers | **Heading done (CCD-2 slice 2a).** The menu and eyebrow still say "Account Overview" because each traveller's tab is also "Home"; owner to decide (see known issues 28 Oct) |
| One traveller's home | eyebrow "Home", heading = the traveller's full name | "Welcome, {name}", "Your Space", "Traveller Overview" | **Done (CCD-2 slice 2b)**; the browser tab title is now "Home" |
| Record sub-pages | All Records, My Profile, Documents, Dates & Expiry, History; eyebrow "Record" | "Your Canonical Record", "Your Private Wallet", "Expiry Centre", "Expiry & Freshness", "Expiry" | **Done** (CCD-3): Documents, My Profile, Dates & Expiry, All Records, History; links that said Expiry Centre renamed |
| Cases list | Cases; eyebrow = traveller name; section "All Cases" | "Visa Cases", "Your Cases", "Active & Past" | Done everywhere: the Cases page (CCD-4), the traveller page tile "Active Cases" and the empty state "Start a Case" (CCD-7 slice 7a); no menu says "Visa Cases" |
| Start a case | Start a Case | "New Visa Case", "Start a Visa Case" | Done everywhere (CCD-2 slice 2b, CCD-4, CCD-7 slice 7a) |
| Alerts | Notifications | "Alerts", "Updates on Your Cases" | Done (CCD-5 slice 5a); the page finder too (CCD-7 slice 7a) |
| Requests to the traveller | Evidence Requests | "Requests from Agencies" | Done (CCD-5 slice 5b) |
| Sharing | Sharing | "Sharing & Access" | Done (CCD-5 slice 5b) |
| Privacy page | Privacy & Consent | "Your Data Rights" | Done (CCD-5 slice 5a); the page finder too (CCD-7 slice 7a) |
| Account page | Your Account, the email shown under the heading | email as the heading | **Done (CCD-1)** |
| Downloads on Privacy | "Download Export (JSON)" and "Download Export (CSV/ZIP)" | the lower-case variant | Done (CCD-5 slice 5a) |
| Agency invite | Invite a Client | "Invite Traveller" | Done (CCD-6 slice 6a) |
| Agency pages | eyebrow = agency name, H1 = page name | agency name as H1 on every page | Done (CCD-6 slice 6a) |
| Issuer checks | Issuer Confirmations | "Issuer confirmations (EVI-05)" | Done (Dates & Expiry already used it; Agency Cases in CCD-6 slice 6b) |
| Person with a record | traveller, in user-facing text | "applicant" in user-facing text | Done in the signed-in product and agency pages (CCD-7 slice 7a); staff screens and the landing pilot notice unchanged; routes and code names keep "applicant" |
| A masked copy of a document (ADR 0022) | Safe Copy; permission "Download Safe Copies" | "Redacted Copy", "Blacked-Out Copy" (the status page name is now "Downloading Safe Copies") | **Done (S23, 29 Oct 2026)** |
| Owner action that opens the box editor | Prepare Safe Copy (Change Safe Copy once one is saved) | "Redact", "Edit Masks" | **Done (S23)** |
| Getting the masked copy | Download Safe Copy | "Download Redacted" | **Done (S23)**: Documents and the shared record |
| Not yet masked | Not Prepared Yet, as the state "Safe Copy: Not Prepared Yet" | "Unavailable", "Pending" | **Done (S23)** |
| The explicit choice to mask nothing | Nothing to Hide on This Document | "No Redaction", "Skip" | **Done (S23)** |
| A saved copy still being drawn | Preparing, as the state "Safe Copy: Preparing"; the action to carry on is Continue Preparing | "Processing", "Rendering" | **Done (S23 review fixes)** |
| A file a safe copy cannot be made from | Safe Copy Not Available for This File (owner screen: "Safe Copy: Not Available") | "Unsupported", "Error" | **Done (S23 review fixes)**: shared record |
| The platform's billing rules page (ADR 0020 Phase 2) | Billing Rules; buttons "Save Billing Rules" and "Manage Billing Rules" | "Billing Settings", "Overdue Policy", "Dunning" | **New (S17, 29 Oct 2026)** |
| An agency's billing status after a missed payment, before suspension | Grace | "Grace Period" as a status name, "Warning", "Past Due" | **New (S17)**; the existing status label |
| An agency's billing status that pauses adding cases, team members and files | Suspended | "Blocked", "Locked", "Disabled" | **New (S17)**; the existing status label |
| An unpaid invoice past its due date | Overdue (in sentences: "past its due date") | "Late", "Delinquent", "Arrears" | **New (S17)** |
| The action in invoice emails and reminders | Pay Invoice (status notices: Open Invoices) | "Pay Now", "Settle", "Make Payment" | **New (S17)** |

Every rename is also an approved change in `apps/web/src/lib/ccd/approved-changes.ts`, so the parity test knows it is intended. Tests that assert an old name (`navigation.test.ts`, `labels.test.ts` and others) change only the expected word, never their strength.
