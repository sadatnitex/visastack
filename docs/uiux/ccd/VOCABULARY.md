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
| The platform's billing rules page (ADR 0020 Phase 2) | Billing Rules; buttons "Save Billing Rules" and "Manage Billing Rules"; the switch "Move Unpaid Agencies to Grace and Suspended Automatically" | "Billing Settings", "Overdue Policy", "Dunning" | **New (S17, 29 Oct 2026)** |
| An agency's billing status after a missed payment, before suspension | Grace Period as the status label (the existing one); "Grace" in sentences and day-count fields | "Warning", "Past Due" | **New (S17)** |
| An agency's billing status that pauses adding cases, team members and files | Suspended | "Blocked", "Locked", "Disabled" | **New (S17)**; the existing status label |
| An unpaid invoice past its due date | Overdue (in sentences: "past its due date") | "Late", "Delinquent", "Arrears" | **New (S17)** |
| The action in invoice emails and reminders | Pay Invoice (status notices: Open Invoices) | "Pay Now", "Settle", "Make Payment" | **New (S17)** |
| Money given back to an agency (ADR 0020 S18 amendment) | Refund; states Waiting to Send, Sent (Waiting for Confirmation), Refunded, Not Completed, Cancelled; staff actions Refund, Record a Refund Made Outside VisaStack, Send Again, Cancel This Refund, Check Now; invoice states Refunded and Partly Refunded | "Reversal", "Chargeback", "Write-off", "Rebate" | **New (S18, 30 Oct 2026)** |
| Held money counted towards another invoice | Credit; staff action Apply to Next Invoice; on the agency's invoice "Credit from an earlier payment"; held payments are listed as Payments Needing a Check | "Carry Forward", "Balance Transfer", "Wallet" | **New (S18)** |
| The monthly file of ledger rows for the accountant | Accounting File; button Download Ledger CSV | "Export", "Report" | **New (S18)** |
| The monthly file of ledger rows for the accountant (supersedes the row above, S18 round 2) | Monthly Accounting File; button Download Accounting File (CSV) | "Download Ledger CSV", "Export", "Report" | **New (S18 round 2, 30 Oct 2026)** |
| Settling a refund whose sending could not be confirmed | It Went Through (with the panel's refund reference and day); It Did Not Go Through (cancels it); a refund the ledger refused shows as Needs a Check | "Cancel This Refund", "Force Confirm", "Void Refund" | **New (S18 round 2)** |
| What an agency kept on a refunded invoice | Kept After Refunds (instead of Paid So Far); no due date on a refunded invoice | "Net Paid", "Balance After Reversal" | **New (S18 round 2)** |
| Downloading an invoice or a receipt as a file (S30) | Download Invoice (PDF), Download Receipt (PDF); the file is called VisaStack-Invoice-{number}.pdf or VisaStack-Receipt-{number}.pdf | "Print", "Export Invoice", "Invoice PDF", "Get Receipt" | **New (S30, 30 Oct 2026)** |
| An agency's billing status after a missed payment, before suspension (supersedes the S17 row above) | Grace, as the status label and in sentences; the stored value stays GRACE | "Grace Period" in visible text, "Warning", "Past Due" | **New (S30)** |
| An invoice that still has money owed and is not cancelled | Open, everywhere (agency and platform screens, documents); its markers Overdue (from the Bangladesh day after the due date) and Due Today | "Unpaid" as a status, "Late", "Outstanding" | **New (S30)** |
| The staff action for a refund whose sending could not be confirmed (correction of the S18 refund row, which still listed "Cancel This Refund" as an action) | It Did Not Go Through; the product has no "Cancel This Refund" button | "Cancel This Refund", "Void Refund" | **New (S30)**: the S18 round 2 row was right, the earlier row is superseded |
| The notice at the top of Plan and Usage, Invoices and the agency home (S30, audit M4) | "Your Agency Is in Grace", "Your Agency Is Suspended"; the one action Pay Invoice | "Account on Hold", "Billing Alert", "Past Due" | **New (S30)** |
| What a plan includes, on Plan and Usage | the card "What Your Plan Includes" headed Usage; Team Members, New Cases, Open Cases, Storage, AI Allowance | "Entitlements", "Meters", "Active seats", "Concurrent open cases", "Retained storage" | **New (S30)** |
| Billing notices in the app (their titles) | New Invoice, Invoice Due Soon, Invoice Due Today, Invoice Overdue, Invoice Still Overdue (the 7-day reminder), Your Agency Is in Grace, Your Agency Is Suspended, Your Agency Is Active Again, Refund Made, Credit Applied; every notice opens with the agency's name | the sentence-case titles ("New invoice", "Invoice overdue") | **New (S30)** |
| Platform staff actions on a plan and an invoice | End Subscription, Cancel Downgrade, Cancel Invoice (an invoice cancelled shows as Cancelled) | "End subscription", "Cancel downgrade", "Void" | **New (S30)** |
| The platform's Organizations tab on a phone | Organizations, shown whole (on a phone the tabs share the bar by what they hold); the page and menu name do not change | "Organizati...", "Orgs" | **New (S30)** |

Every rename is also an approved change in `apps/web/src/lib/ccd/approved-changes.ts`, so the parity test knows it is intended. Tests that assert an old name (`navigation.test.ts`, `labels.test.ts` and others) change only the expected word, never their strength.

Added 30 Oct 2026 (S21, AI app suggestion tools):

| Thing | Canonical name | Retire | Status |
|---|---|---|---|
| The consent choice that lets an AI app leave suggestions, drafts and reminders | Suggest Changes (in the group "Changes") | "Write Access", "Edit Access", "Allow Changes" | **New (S21)** |
| Profile suggestions from a person's AI apps, on My Profile | Suggestions from AI Apps | "AI Edits", "Pending Changes" | **New (S21)** |
| The label on a suggestion an AI app made | Suggested by {app name} ({address}); no name stored: "an AI App" | "From Connector", "AI Proposal" | **New (S21)** |
| Drafts an AI app saved, on the Sharing page | Drafts from AI Apps; actions Show Draft, Copy Draft, Delete Draft | "AI Notes", "Generated Drafts" | **New (S21)** |
| The label on a reminder an AI app added to a case | Added by {app name} | "AI Task", "Bot Reminder" | **New (S21)** |
| The platform owner's page of AI switches | AI Features; one feature "AI App Suggestions"; fields On and Daily Limit per Person | "AI Toggles", "Feature Flags" | **New (S21)** |
| A feature that is off, wherever it would have been | "This AI feature is turned off right now. Everything else works as usual." | "Disabled", "Unavailable" | **New (S21)** |

Added 30 Oct 2026 (S20, AI app original files):

| Thing | Canonical name | Retire | Status |
|---|---|---|---|
| The consent group that lets an AI app receive the files of ticked documents | Original Files; each row Share This File, with Safe Copy (the default) or Original | "Attachments", "File Access", "Raw Files" | **New (S20)** |
| How a ticked file is given | Safe Copy (the masked copy, as on Documents); Original (the file as uploaded) | "Redacted", "Unredacted", "Full File" | **New (S20)** |
| The platform owner's switch for it | AI App Original Files (on AI Features) | "File Sharing for AI", "Connector Files" | **New (S20)** |
| How many files a connection has, on the Sharing page | Original Files: {n} Files ({m} Originals), or (Safe Copies) | "Attachments: n" | **New (S20)** |
| The protected types, wherever files are offered | "Passports, identity, money and health documents are protected and never shared with AI apps." | "Restricted", "Blocked" | **New (S20)** |
