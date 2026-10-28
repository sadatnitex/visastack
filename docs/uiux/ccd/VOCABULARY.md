# One name per thing

Approved by the owner on 2026-10-28 (decision D3). Applies to user-facing words: menus, titles, buttons, notifications, emails that name pages, help text. Routes and file names do not change. Status column: Done means built and tested; Planned names the package.

| Thing | Canonical name | Retire | Status |
|---|---|---|---|
| Account home | Home, heading "Welcome back, {first name}" (no name: "Welcome back") | "Welcome Back" alone, "Overview" for travellers | **Heading done (CCD-2 slice 2a).** The menu and eyebrow still say "Account Overview" because each traveller's tab is also "Home"; owner to decide (see known issues 28 Oct) |
| One traveller's home | eyebrow "Home", heading = the traveller's full name | "Welcome, {name}", "Your Space", "Traveller Overview" | **Done (CCD-2 slice 2b)**; the browser tab title is now "Home" |
| Record sub-pages | All Records, My Profile, Documents, Dates & Expiry, History; eyebrow "Record" | "Your Canonical Record", "Your Private Wallet", "Expiry Centre", "Expiry & Freshness", "Expiry" | Planned CCD-3 |
| Cases list | Cases; eyebrow = traveller name; section "All Cases" | "Visa Cases", "Your Cases", "Active & Past" | Planned CCD-4 |
| Start a case | Start a Case | "New Visa Case", "Start a Visa Case" | Traveller page done (CCD-2 slice 2b); the Cases screen follows in CCD-4 |
| Alerts | Notifications | "Alerts", "Updates on Your Cases" | Planned CCD-5 |
| Requests to the traveller | Evidence Requests | "Requests from Agencies" | Planned CCD-5 |
| Sharing | Sharing | "Sharing & Access" | Planned CCD-5 |
| Privacy page | Privacy & Consent | "Your Data Rights" | Planned CCD-5 |
| Account page | Your Account, the email shown under the heading | email as the heading | **Done (CCD-1)** |
| Downloads on Privacy | "Download Export (JSON)" and "Download Export (CSV/ZIP)" | the lower-case variant | Planned CCD-5 |
| Agency invite | Invite a Client | "Invite Traveller" | Planned CCD-6 |
| Agency pages | eyebrow = agency name, H1 = page name | agency name as H1 on every page | Planned CCD-6 |
| Issuer checks | Issuer confirmations | "Issuer confirmations (EVI-05)" | Planned CCD-3 and CCD-6 |
| Person with a record | traveller, in user-facing text | "applicant" in user-facing text | Planned with each screen; no contract exception found |

Every rename is also an approved change in `apps/web/src/lib/ccd/approved-changes.ts`, so the parity test knows it is intended. Tests that assert an old name (`navigation.test.ts`, `labels.test.ts` and others) change only the expected word, never their strength.
