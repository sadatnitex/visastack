# Owner actions for Small Commercial V1 (prepared 26 Oct 2026)

Each item lists: what is already done for you, the steps only you can take, and what happens until you do them. **Nothing here blocks building.** Every package is built and tested without these steps. A missing step only keeps that one capability switched off or in test mode, with a plain message in the product. You can do the steps one by one, in any order, except where noted.

**Owner decision, 26 Oct 2026:** O1 (repository private), O3 (Vercel and Neon upgrades) and O4 (virus scanner switch) will be done later, at the owner's own risk. **The plan and its order do not change.** Every package proceeds; S4 is still built and tested, and only its switch-on waits for O4. Real data stays off until these are done (the readiness checks enforce it).

Plan: [SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md](SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md). Each item's ID (O1 to O17) matches the handoff's section L.

## Status at 29 Oct 2026

**Waiting for you** (none of these blocks building; each switches one thing on):

| Action | What it unlocks | Where you do it |
|---|---|---|
| Turn on backup pruning after a few good daily backups: `BACKUP_PRUNE` = `on` | Old encrypted backups are deleted by the retention rules (last 35 days, one per week for 12 weeks, never the newest 7), so the free 10 GB of storage is not used up. Until then nothing is deleted | GitHub: the repository, then Settings, then Secrets and variables, then Actions, then the Variables tab: new repository variable (not a secret, not Vercel) |
| Approve the S23 database change once S23 merges | Safe copies of documents with masks (redacted download). Until it runs, the feature says "not available yet" | Chat: reply "migrate S23" (migration 0102) |
| Update 29 Oct: the S23 database change above is done (migration 0102 applied with your word) | Safe copies of documents with masks | Nothing more to do |
| Approve the S17 database change once S17 merges | Recurring invoices, reminders and the Billing Rules page. Until it runs, no invoice is made automatically, Billing Rules says "not available yet", and every billing action works as today. Before it runs, the check in [billing-cycle.md](../operations/billing-cycle.md) must find no duplicate invoices | Chat: reply "migrate S17" (migration 0103) |
| Set the overdue policy and decide on traveller uploads (O13) | Automatic Grace and Suspended for unpaid invoices. Until then it stays off: reminders still go out, and only an admin changes a billing status | `/app/admin/billing` (Billing Rules), after migration 0103, or reply with your numbers |
| Optional: record the penetration test deferral (O17) | The external penetration test gate shows "Deferred by Owner (H01)" and counts as passing. It matters only when you switch real data on (O11) | Vercel: the project, then Settings, then Environment Variables, Production: `COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST` = `H01`, then a redeploy |
| Try the AI connector with a made-up traveller | Proof that a real Claude or ChatGPT connection works end to end (not verified yet) | In your AI app: add a connector with the address `https://vs.obsidianglobal.studio/mcp` (Claude: a custom connector; ChatGPT: developer mode), sign in as a test traveller and choose what it may read. Turn it off afterwards on the Sharing page |
| Name a payment provider | S19 (second provider) and the provider-facing parts of S17 and S18 can be tested. SSLCOMMERZ online payment also still needs O6 | Chat: reply with the provider (O14), and O6 for SSLCOMMERZ |
| Staff authenticator codes (O8 for S3 is done) | Every staff account must enter an authenticator code. Enrol staff first ([staff-second-factor.md](../operations/staff-second-factor.md)) | Vercel Production: `STAFF_SECOND_FACTOR` = `required`, then a redeploy. It stays `off` until you set it |
| Update 30 Oct: the S17 database change above is done (migration 0103 applied 29 Oct with your word, run 40894153710) | Recurring invoices, reminders and Billing Rules | Nothing more to do |
| Approve the S18 database change once S18 merges | Refunds, credits from held payments, refunds made outside VisaStack and the monthly accounting file's refund rows. Until it runs, the refund card says "Refunds are not available yet."; the monthly file already works. Before it runs, the check in [refunds-and-ledger-export.md](../operations/refunds-and-ledger-export.md) must return 0 | Chat: reply "migrate S18" (migration 0104) |
| Decide how live refunds reach SSLCOMMERZ (O18, new) | Refunds sent from VisaStack to SSLCOMMERZ. SSLCOMMERZ accepts refund calls only from a registered fixed address, which Vercel does not have by default. Until then, refund in the SSLCOMMERZ panel and record it in VisaStack | Chat: reply "static IPs", "relay" or "manual refunds only" (see O18) |
| Note D1 (S18): refunds, credits and the accounting file are yours alone | Only the platform owner can refund, apply a credit, record a refund or download the ledger, each with a fresh sign-in check. A separate billing staff role can be added later if you want one | Nothing to do now; say so if you want a billing staff role |

Also still open as written below: O1 (private repository), O3 (paid Vercel and Neon plans), O4 (virus scanner switch; readiness still says scanning is not configured), O5 (offline copy of the master key), O6 (SSLCOMMERZ), O7 (launch routes and reviewer), O10 (legal review), O11 and O12 (real data and release, after S24), O13 (overdue policy, needed for S17's automatic Grace and Suspended), O16 (AWS key service).

**Done:**

- O8 database changes: S3 (0092), S26 (0093) and S10 (0094) are recorded as applied in the handoff's section M; S13 (0100, AI connections) and the live calendar link (0101) were each run with your word. S11 (0096) and S12 (0097) are applied too (verified 29 Oct 2026 on Neon: drizzle.__drizzle_migrations holds 100 rows, equal to the 100 journal entries, newest = 0101). Nothing is pending.
- O8 update, 29 Oct afternoon: S23 (0102, safe copy masks) was applied on 29 Oct with your word. Next: S17 (0103), once S17 merges.
- O8 update, 30 Oct: S17 (0103, recurring invoices and billing rules) was applied on 29 Oct with your word (run 40894153710). Next: S18 (0104), once S18 merges.
- O9 step 3: you switched the AI connector on in production on 28 Oct (`AI_CONNECTOR_ENABLED=true`), ahead of S24, for the pilot with made-up data. It is checked live: the sign-in discovery address answers and readiness says the connector is available.
- `SUPPORT_EMAIL` set in Vercel Production (its value is not written here).

## O1. Repository: make it private; full-history secret scan

- **Already done:**
  - Full-history secret scan run on 26 Oct 2026 with gitleaks 8.18.4: 867 commits across all branches, 11 matches.
  - All 11 matches are false positives: checklist keys such as `australia.visitor_600`, test storage keys, and the Svix documentation example secret used in a test.
  - **No real credential has ever been committed.**
  - The current tree was also clean.
- **You:**
  1. GitHub, then the repository, then Settings, then General, then Danger Zone: Change visibility to Private.
  2. In Settings, then Code security, switch on Secret Protection and Push Protection if your plan offers them. They are free for public repositories; private repositories need GitHub's paid security add-on.
- **Until then:** nothing is blocked.
- **After you switch:**
  - CodeQL stops unless you buy the security add-on. Sessions then report it as skipped.
  - GitHub Actions minutes become metered against your plan.
  - The virus-scanning worker (after S4) and CI use those minutes. Watch usage in Settings, then Billing.

## O2. Approve the plan

- **Already done:**
  - The handoff, ADRs 0019 to 0022, the deferred register (security and compliance only) and this list.
- **You:**
  - Reply "plan approved", or name what to change.
  - The plan doesn't need your approval to start: S1 to S4 are already-approved Programme X and security work.
- **Until then:** the session builds S1 to S4 and pauses before S5 for your word.

## O3. Hosting: Vercel and Neon plans

- **Already checked (26 Oct 2026, read-only):**
  - **Neon:**
    - **Free plan** (`free_v3`), region US East.
    - Compute up to 0.25 units.
    - 1 GB database per branch.
    - **Only 6 hours of point-in-time restore**.
    - 10 branches at most.
  - **Vercel:**
    - The team is the personal "Nazmus Sadat's projects" account.
    - The API did not return the plan name.
    - The account name and the daily deployment limit point to **Hobby**, which Vercel's terms reserve for non-commercial use.
- **You:**
  1. Vercel, then Settings, then Billing: confirm the plan. Before charging anyone, move to **Pro**. This also removes the daily deployment limit that forced previews off.
  2. Neon, then Billing: move to the **Launch** plan before real data. It gives longer restore history, more storage and steadier compute. Check the current limits on Neon's pricing page.
- **Until then:**
  - Everything works for the pilot.
  - The commercial-readiness check keeps real data off (O11).
  - Backups stay as they are, and S27 makes the encrypted backup daily.

## O4. Virus scanner: switch on after S4

- **Prepared:**
  - S4 fixes the scanning worker and adds a readiness signal.
  - The GitHub Actions variables and secrets it needs were already set by you earlier (current-platform.md).
- **You (after S4 merges):**
  1. Vercel, then the project, then Settings, then Environment Variables, Production: set `MALWARE_SCANNER_PROVIDER` to `github_clamav`.
  2. GitHub, then Actions, then "Private document scanning and processing", then Run workflow, mode `verify-synthetic`. The session may run this if you allow it.
  3. Redeploy (the session can trigger the next merge).
- **Until then:**
  - Uploads keep the current structural safety checks.
  - Readiness says scanning is not configured.
  - Real data stays off (M06).

## O5. Master key: keep an offline copy, then move to a key service

- **Found:**
  - Protected fields (passport numbers, incomes) are wrapped by `KMS_LOCAL_MASTER_KEY_BASE64`.
  - The code refuses that local key in commercial mode, so a real key service is required before real data. That work is new package S26.
- **You (now):**
  1. Copy the value of `KMS_LOCAL_MASTER_KEY_BASE64` from Vercel Production into your password manager. Add a second copy on paper, sealed and stored somewhere other than your laptop.
  2. Never paste it into chat, email or a document in the repository.
- **You (for S26, see O16):** an AWS account for AWS KMS.
- **Until then:** the pilot keeps working with the local key, and real data stays off.

## O6. SSLCOMMERZ: sandbox, then live

- **Prepared:**
  - The online payment flow, ADR 0020, built against a test double and the SSLCOMMERZ sandbox.
- **You:**
  1. **Sandbox first:** register a sandbox store at SSLCOMMERZ's developer site. You get a store ID and a store password. Give them to the session through Vercel environment variables, never in chat:
     - `PAYMENT_PROVIDER=sslcommerz`
     - `SSLCOMMERZ_MODE=sandbox`
     - `SSLCOMMERZ_STORE_ID`
     - `SSLCOMMERZ_STORE_PASSWORD`
  2. **Live:** apply for a merchant account. SSLCOMMERZ asks for business documents such as a trade licence, bank details and website details. Ask them for the current fee per transaction for cards, mobile wallets and internet banking, and for the settlement time.
  3. In the SSLCOMMERZ merchant panel, set the IPN listener URL to `https://vs.obsidianglobal.studio/api/payments/sslcommerz/ipn`.
  4. Set `SSLCOMMERZ_MODE=live` only when you tell the session "go live".
- **Until then:**
  - "Pay Online" is hidden and readiness says payments are not configured.
  - **"I Paid Another Way" works**, and invoices can still be paid by bank transfer or bKash and confirmed by an admin.

## O7. Launch routes and a qualified reviewer

- **Found:** the only live checklist is a test ("UK Visitor1", 2 requirements, review overdue, unused).
- **You:**
  1. Pick the one or two routes your first agencies file most. For example, Bangladesh to UK Standard Visitor, or Bangladesh to a Schengen country for a short stay.
  2. Name a qualified reviewer, an immigration adviser who checks requirements against official sources, distinct from the author.
  3. Decide whether to withdraw the test checklist.
- **Until then:**
  - Cases run in manual mode, with no automated readiness claim.
  - Acceptance (S24) uses a clearly labelled synthetic checklist for testing.

## O8. Production database changes

- **Prepared:**
  - Each package that needs a database change says so in its PR, with a one-line summary.
  - The new code tolerates the change not having run yet.
- **You:** after each merge, reply "migrate <package>", for example "migrate S3".
- **Upcoming changes:**

  | Package | Change |
  |---|---|
  | S3 | Staff second factor |
  | S10 to S12 | Payment ledger, attempts, claims, receipts |
  | S13 | AI connections and sign-in tokens |
  | S17 | Recurring invoices and billing settings |
  | S17 (detail, 29 Oct) | Recurring invoices and billing rules (migration 0103): one row of billing rules, a cause on each billing status change, one live invoice per agency, plan and period. Before running it, the duplicate check in [billing-cycle.md](../operations/billing-cycle.md) must return no rows |
  | S18 | Refund requests, if needed |
  | S18 (detail, 30 Oct) | Refunds and credits (migration 0104): a `REFUNDED` payment attempt status, a `refund_requests` table with a guard (no deletes, money and source fixed, final rows frozen), and two indexes. Before running it, `select count(*) from invoice_payments where kind in ('REFUND', 'CREDIT')` must return 0 ([refunds-and-ledger-export.md](../operations/refunds-and-ledger-export.md)) |
  | S19 | Saved payment methods |
  | S20 | Original-file choices |
  | S22 | Agency AI permission |
  | S23 | Redaction masks (migration 0102) |
  | S23 (29 Oct) | Migration 0102 applied 29 Oct 2026 |
  | S26 | Key-service re-wrap tracking, if needed |

- **Until then:** the merged feature shows "not available yet" instead of breaking.

## O9. AI: production provider, training rule, connector

- **Prepared:**
  - Provider switching, data-terms records, budgets and the emergency stop already exist in `/app/admin/ai-settings`.
  - The training guard is built and off.
  - The AI connector is built behind `AI_CONNECTOR_ENABLED`, off by default.
- **You:**
  1. Choose the production provider. Prefer one whose terms say inputs are not used for training on your plan (paid tiers of the major providers usually say so; check the current terms). Record the terms on the AI settings page.
  2. Decide whether to switch on "Only Use AI Providers That Do Not Train on Inputs". Recommended: on, before real data.
  3. When S24 passes, set `AI_CONNECTOR_ENABLED=true` in Vercel Production. **Done early, 28 Oct 2026**, by your decision, for the pilot with made-up data.
- **Until then:**
  - AI reading works only where a provider is active and the person has consented.
  - Everything else works without AI.
  - The connector stays off for real users and is testable in the pilot.

## O10. Legal review: privacy notice and terms

- **Prepared:**
  - [docs/legal/2026-10-26-small-commercial-v1-changes-for-counsel.md](../legal/2026-10-26-small-commercial-v1-changes-for-counsel.md) lists every new kind of processing, processor and choice, for your lawyer.
- **You:** send it to a qualified lawyer and return the approved wording.
- **Until then:** features are built and tested with draft wording, and real data stays off.

## O11. Real data: switch it on

- **Prepared:**
  - S27 reconciles the commercial-readiness checks with this plan.
  - S24 produces the evidence for each check.
- **You (after S24):**
  1. Set each `COMMERCIAL_READINESS_ATTEST_*` value the S24 report lists as evidenced. They include sign-in production, tenant isolation, the permission matrix, privacy consent, backup and restore, production journeys, the incident owner, terms and privacy, and no critical or high findings.
  2. Set `DEPLOYMENT_MODE=commercial`.
  3. The penetration test is deferred by your decision, so S27 lets you record that deferral (`COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST=H01`; corrected 29 Oct, the code reads this exact name) instead of faking an attestation.
- **Until then:** the product stays a controlled pilot with made-up data.

## O12. Release decision

- **Prepared:** the S24 report, with what passed, what is deferred and what is not verified.
- **You:** reply "release approved" after reading it.
- **Until then:** the release PR is not merged.

## O13. Overdue policy

- **Recommended defaults** (change freely):
  - payment due 7 days after the invoice;
  - Grace 7 days after the due date;
  - Suspended 30 days after the due date.
- **You:** reply with your numbers, or "use the defaults".
- **Prepared (S17, 29 Oct 2026):** the Billing Rules page (`/app/admin/billing`, platform owner only, with a fresh sign-in check) holds these numbers and the On/Off switch. Before it switches on, it says how many agencies it would move that day, so old unpaid invoices are seen first. How it works: [billing-cycle.md](../operations/billing-cycle.md).
- **You (from S17, 29 Oct; supersedes the line above):**
  1. Set your numbers on the Billing Rules page, or reply with them, or "use the defaults".
  2. **Decide on traveller uploads first.** Today, while an agency is Suspended, a traveller who shares records with that agency also cannot add new files (their existing files stay visible and nothing is deleted). S17 keeps this unchanged. Reply "keep traveller uploads blocked" or "let travellers upload while an agency is suspended" (the second is a small follow-up change).
  3. Switch "Automatic Grace and Suspended" on.
- **Until then:**
  - S17 sends reminders.
  - Since S17 (29 Oct), it also sends the period invoices themselves.
  - Automatic Grace and Suspended stay **off**; billing status changes only by an admin, as today.

## O14. Second payment provider and the entity that holds it

- **Options:**

  | Option | Good for | Needs |
  |---|---|---|
  | Stripe | International cards and USD invoices; saved cards for automatic charging | A legal entity in a country Stripe supports, for example a Singapore company. Stripe does not support Bangladesh-registered businesses |
  | Direct bKash payment gateway | Lower fees for bKash-heavy customers | A bKash merchant agreement |
  | Another Bangladesh gateway | Redundancy if SSLCOMMERZ is down | That gateway's merchant account |

- **Recommended:** Stripe through a Singapore entity, if you have one, for international agencies. SSLCOMMERZ already covers local cards and wallets.
- **You:** reply with the provider and entity; then put its test keys in Vercel.
- **Until then:** S19 is skipped and later packages continue. SSLCOMMERZ and manual payment cover everything.

## O15. Bangla

- **You:** reply "start Bangla" when the rest of the product is done.
- **Until then:** English only (your standing rule).

## O16. AWS account for the key service (new)

- **Prepared:** S26 builds the AWS KMS adapter and a re-wrap job, tested against a test double.
- **You:**
  1. Create an AWS account, or use an existing one.
  2. The session gives you a short script to create one KMS key in the same region as Neon (US East), with automatic yearly rotation, and an access identity limited to encrypting and decrypting with that key.
  3. Put its values in Vercel (production only): `KMS_PROVIDER=aws_kms`, `KMS_KEY_ID`, `KMS_AWS_REGION`, `KMS_AWS_ACCESS_KEY_ID`, `KMS_AWS_SECRET_ACCESS_KEY`. These names are our own because the hosting platform keeps the plain `AWS_*` names. Keep `KMS_LOCAL_MASTER_KEY_BASE64` for now. The full steps, including the data key move, are in `docs/operations/key-management.md`.
- **Until then:** the pilot keeps the local key, and real data stays off.
- **Cost:** roughly one US dollar a month per key plus small per-request fees (check AWS's current KMS pricing).

## O17. Commercial-readiness deferral record (new)

- **You:** when you switch real data on, confirm in writing that the external penetration test is deferred (register H01, with its trigger). S27 makes this a recorded, visible deferral rather than a hidden pass.

## O18. Live refunds through SSLCOMMERZ: a fixed outbound address (new, 30 Oct 2026)

- **Prepared (S18):** VisaStack can ask SSLCOMMERZ to refund a payment and confirm it later, and every refund made in the SSLCOMMERZ panel can be recorded in VisaStack with its reference. Both are built and tested against a fake gateway; nothing has been sent to SSLCOMMERZ.
- **Why you are asked:** SSLCOMMERZ accepts refund calls only from a server address registered with it. Vercel functions do not have a fixed outbound address by default.
- **You choose one:**
  1. **Static IPs:** turn on Vercel's fixed outbound addresses for the project (a paid Vercel feature; check its current price), then register those addresses with SSLCOMMERZ.
  2. **Relay:** a small server with a fixed address that forwards only the refund calls. More to run and secure.
  3. **Manual refunds only:** refund in the SSLCOMMERZ panel and record each one in VisaStack ("Record a Refund Made Outside VisaStack"). Nothing more to set up; the gateway refund button simply stays unused.
- **Until then:** option 3 is how refunds work. Live refunds also still need O6 (the live store credentials).
- **Then switch it on:** set `PAYMENT_REFUNDS_VIA_GATEWAY=true` in Vercel Production (then a redeploy) after the fixed address is registered with SSLCOMMERZ. It is off until you set it, and nothing else changes while it is off.
- **Also noted (D1):** refunds, credits and the monthly accounting file are platform owner only. Tell us if you want a separate billing staff role.

## S21 owner decisions and O8 for migration 0105 (added 30 Oct 2026)

- **O8, migration 0105 (S21, AI app suggestions):** after S21 merges, give your word for this one run (workflow db-migrate.yml, confirm "migrate"). It adds three tables (drafts from AI apps, the private mark on reminders AI apps add, and the AI Features switches). It also lets a suggestion have no document, only when an AI app made it. No existing table gains a column and no existing row changes, and it is safe to run again. Until it runs, the three suggestion tools answer "not available yet" and everything else works as before. If S18 merges first, it is renumbered 0105 before the merge.
- **AI Features switch (new):** AI App Suggestions is **off by default**. After migration 0105 runs, turn it on in Admin, Settings, AI Features, when you want people's AI apps to be able to leave suggestions, drafts and reminders. Turning it off later never removes anything people already have.
- **Decided by you on 30 Oct 2026, recorded here:**
  1. **Daily limit:** 15 a day per person, across all their apps and all three tools, and 15 per connection. You can lower it (never raise it above the plan) as Daily Limit per Person on AI Features.
  2. **Only when the person asks:** the tools tell the app to use them only when the person explicitly asks for the change; VisaStack never creates these on its own; the audit records each write as requested by the person through the app.
  3. **Reminders are private:** a reminder an AI app adds is seen only by the person, never by an agency, even on a shared case. This replaces the earlier plan that agencies would see AI-added reminders like any other task.
  4. **Plans later:** today everyone gets the free tier (AI App Suggestions, 15 a day). A paid plan can later include more AI features or more use; everyone keeps the free tier. Where this plugs in is recorded in ADR 0021's 30 Oct amendment.
- **Still yours to confirm:** the deviation from ADR 0021 that a reminder always needs a case (tasks belong to a case; there is no record-level task), and drafts living on the Sharing page beside AI Connections.

## S20 owner actions: O8-S20 for migration 0106 and the AI App Original Files switch (added 30 Oct 2026)

- **O8-S20, migration 0106 (S20, AI app original files):** after S20 merges, give your word for this one run (workflow db-migrate.yml, confirm "migrate"). It adds one table: which documents a person ticked under Original Files for each AI app, and whether as a Safe Copy or the Original. No existing table gains a column and no existing row changes, and it is safe to run again. Until it runs, nothing can be ticked and the file tool answers "not available yet"; everything else works as before. If another migration takes number 0106 first, this one is renumbered 0107 before the merge (a rename only).
- **AI Features switch (new):** **AI App Original Files** is **off by default**. After migration 0106 runs, turn it on in Admin, Settings, AI Features, when you want people to be able to give their AI apps the files they tick. The free tier allows 30 files a day per person; you can lower it there. Turning it off later stops new files at once and removes nothing.
- **Decided for you on 30 Oct 2026 (orchestrator decisions O1 to O5), for your review:** files up to 3 MB (your 10 MB needs a streamed answer and is deferred); passports, identity, money and health documents are never given, not even as a Safe Copy (you can open this later); 30 a day per person; PDF, PNG and JPEG only; Original Files need List of My Documents.
- **Correction, 30 Oct 2026 (S20 review round 2):** this migration has its own action ID, **O8-S20**, so its word is never confused with another package's O8 run. Give the word for O8-S20 (migration 0106) on its own.

## S29 owner actions and decisions of 30 Oct 2026: plans, test payments, O13, O14, backup pruning (added 30 Oct 2026)

- **O8-S29, migration 0107 (S29, plans and test payments):** after S29 merges, give your word for this one run (workflow db-migrate.yml, confirm "migrate"). Before it, run the four checks in [plans-and-entitlements.md](../operations/plans-and-entitlements.md) ("Before the database update"): each shows no rows, or you confirm what it shows. What it does: each plan gets "who it is for" (agencies, or travellers for Traveller Free) and Founding Access is marked as the plan that lifts every limit; every plan's limits are copied into a new rules table, exactly as they are today, and its price into a new price history; every online payment so far, and the ledger rows that came from them, are marked Test Payment (production payments were never switched on); every other ledger row is marked as real money. It is safe to run again. Until it runs, plans cannot be changed (the Plans page says so), online payment cannot be started, and everything else works as before.
- **O13, decided 30 Oct 2026:** Grace 7 days after the due date, Suspended 30 days after it. **You:** set these on Admin > Billing Rules (`/app/admin/billing`): Grace 7, Suspended 30, tick Automatic Grace and Suspended, save, then confirm the preview of who it moves today. Travellers keep uploading: while an agency is Suspended, travellers who share records with it still add their own files; only that agency's own team is paused (built in S29). Nothing else to decide for O13.
- **O14, decided 30 Oct 2026:** SSLCOMMERZ is the payment provider. bKash, Rocket and Nagad are offered through SSLCOMMERZ's own checkout, so one integration covers cards and all three wallets. Direct bKash, Nagad or Rocket integrations are optional later entries in the provider registry (S19 step 0), not built now. Stripe through another entity is not pursued for now. What remains is O6 (the SSLCOMMERZ store, sandbox first, then live).
- **Test payments (S29):** while `SSLCOMMERZ_MODE` is `sandbox`, online payment is in test mode. Only you can make a test payment (pay an invoice of an agency you belong to); it marks the invoice paid, is labelled Test Payment everywhere, and is left out of the Monthly Accounting File. Agencies see "Online payment is being tested right now". Billing Rules shows the mode. Switch to `live` only after O6 is complete, and only when no payment is open (an open payment from the other mode is closed as expired).
- **Backup pruning, approved 30 Oct 2026, waiting for your setting:** set the GitHub repository variable `BACKUP_PRUNE` to `on` (GitHub > Settings > Secrets and variables > Actions > Variables). Tools cannot set Actions variables, so this is yours to do. Until then pruning only reports what it would remove.
- **Plans page (new):** Admin > Settings > Plans (`/app/admin/plans`), owner only, a fresh sign-in check for every save. Create plans, set limits, AI features and prices, and retire plans. A new price applies from each agency's next billing period. How it works: [plans-and-entitlements.md](../operations/plans-and-entitlements.md).

## S19 step 0: payment provider registry (added 30 Oct 2026)

- **O14, recorded in code:** SSLCOMMERZ is the one provider in the payment provider registry. Cards, bKash, Rocket and Nagad are all paid through its checkout; nothing more to set for them. Nothing changes for agencies or for you today: the same settings, the same SSLCOMMERZ addresses (`/api/payments/sslcommerz/ipn` and `/return`), the same screens.
- **New, optional now, recommended before going live:** set `PAYMENT_RESULT_SIGNING_SECRET` in Vercel Production to a random value of at least 32 characters (it signs the "your payment" result link). Until you do, the link is signed with a key made from the sign-in cookie secret, which also works.
- **New, optional:** `PAYMENT_PROVIDERS=sslcommerz` does the same as today's `PAYMENT_PROVIDER=sslcommerz`. You only need it once there is a second provider.
- **Adding bKash, Nagad or Rocket directly later** (not built now; only if you decide SSLCOMMERZ's checkout is not enough): ask for a package "add <name> to the payment provider registry". It builds one adapter and one registry entry. Then you: (1) set `PAYMENT_PROVIDERS=sslcommerz,<name>` in Vercel Production; (2) set that provider's settings, starting with its mode as `sandbox`; (3) register `https://vs.obsidianglobal.studio/api/payments/<name>/ipn` and `/return` in its merchant panel; (4) make one small test payment yourself; (5) give your word to switch it to `live`. Full steps: "Adding a Payment Provider" in [online-payments.md](../operations/online-payments.md).
- **O2 (later package, nothing for you to do):** links to the payment result page signed the old way stop being accepted in a later package, at least 7 days after this one is live. Each link lives one hour, so nobody notices.

## S19 step 0, round 2 (30 Oct 2026)

- **O2 closed, nothing for you to do:** result page links signed with the SSLCOMMERZ store password are no longer accepted at all. SSLCOMMERZ was never set up in production, so no such link exists, and accepting them would only have let whoever holds the store password make one.
- **If you set `PAYMENT_RESULT_SIGNING_SECRET`, make it at least 32 characters.** A shorter one now makes the readiness check fail until it is fixed.
- **If you choose a payment provider, set all its settings in the same change.** A provider with a setting missing now makes the readiness check and the daily payment check fail and name the missing setting, instead of quietly staying off.

## S28 owner decisions: AI feature controls (added 30 Oct 2026)

Nothing changes for anyone on deploy: the six AI features that worked before are on, included in the Traveller plan and counted without a limit. No migration. Where: Admin > Settings > AI Settings (`/app/admin/ai`); how it works: [ai-feature-controls.md](../operations/ai-feature-controls.md).

- **O3, AI_ENABLED with a database provider (your decision):** today `AI_ENABLED` only governs the AI provider set in the deployment's own settings, on a fresh install. Once a provider is saved on AI Settings, the database decides and `AI_ENABLED` is not read. S28 keeps that exactly. Decide whether `AI_ENABLED=false` should also stop a database provider (a hard stop for the whole site). First check in Vercel which value production has (Vercel > project > Settings > Environment Variables; tools cannot read it), because if it is unset or `false` while a provider is active, making it a hard stop would turn AI off on the next deploy. Until you decide, the platform-wide stop is the Emergency Disable button on AI Settings, or each switch under AI Features.
- **O4, real daily limits after deploy:** after S28 is live, decide how much of each AI feature a traveller may use a day (Plans > Traveller Free, each AI feature), and whether to lower any for everyone (AI Settings > AI Features). Watch each person's AI Use Today and the spend first; the standard is counted without a limit. Limits start again at 6 AM Bangladesh time.
- **O5, AI Allowance stays shown only:** the plan's AI Allowance number is displayed but not enforced for travellers (enforcing it on travellers would repeat the agency-limit leak fixed in M5). Agency enforcement comes with S22. Confirm, or say if you want it enforced.

## S22 owner actions: agency AI connectors (added 31 Oct 2026)

Nothing changes for anyone on deploy: Agency AI Tools is off, every agency's setting is off, and every traveller's grant keeps exactly what it allowed. Built on local branch `s22-wip` (not merged, not live). How to turn it on: [ai-feature-controls.md](../operations/ai-feature-controls.md), "Turning on agency AI tools".

- **O8-S22, migrations 0108 and 0109 (your word for each run, in this order):** after S22 merges, run db-migrate.yml and confirm "migrate". 0108 adds only the new sharing permission (Let This Agency Use AI Tools on What I Share); 0109 adds the agency setting, the agency connection link and a rule that a connection names a record or an agency. Until they run, the screens say "Available After the Next Update" and nothing else changes.
- **O10, legal wording for agency AI processing:** approve or replace the two drafts in `apps/web/src/lib/agency-ai.ts`: what the traveller reads beside the box ("When this is on, staff at {Agency} can ask an AI app they choose ... it stops the next request.") and what an agency confirms before turning it on ("By turning this on, {Agency} confirms it has a lawful basis and a written agreement with each AI provider it connects ..."). Keep Agency AI Tools off (Admin > AI Settings > AI Features) until you approve.
- **Your decision (no action needed to stay safe): case-only grants.** Agencies' grants from client invitations cover one case, so the AI app reads the case (state, dates, readiness) but none of the traveller's profile or documents. Say if you want the invitation to offer the whole record too; that is a separate package.
- **Your decision: who may connect.** Only owners and admins today (D1). Say if case managers should, later; their reach would then be only their assigned cases.

## S22 round 2 notes for O10 (added 31 Oct 2026)

- **Corrected draft wording (replaces the traveller note above for O10).** The first draft said "Full document numbers and files are never sent to it", which promised more than VisaStack enforces: a number written inside another document's text is not hidden unless it is one of the ID numbers saved in the traveller's profile. The draft you are asked to approve now reads: "When this is on, staff at {Agency} can ask an AI app they choose, such as ChatGPT or Claude, to read what you already share with {Agency}, to help with your cases. It reads nothing more. {Agency} runs that app under its own agreement with the app's provider and is responsible for how that provider handles your information. Files are never sent to it. The text of passport, ID, money and health documents is never read, and the ID numbers saved in your profile are shortened wherever they appear. Turn this off at any time; it stops the next request." The agency statement is unchanged.
- **What a client invitation gives the AI app (for your O10 decision).** A grant made by accepting an agency's client invitation covers one case only. So the agency's AI app sees that case's summary and readiness, but no profile details and no documents, unless the traveller shares more with the agency (for example their whole record).

## Paid traveller plans: decisions before build (added 31 Oct 2026)

Design: `docs/adr/0025-paid-traveller-plans.md`. Decided 31 Oct 2026: the owner chose the recommended defaults D1 to D14 ("use the defaults"). The ones that cannot be defaulted away: the Plus price (set on the Plans page), the accountant's VAT answer before live selling (D7), the lawyer's review of the sale, renewal and refund wording (D12), and the "go live" word after O6.

## Paid traveller plans T1: O8 for migration 0110 (added 31 Oct 2026)

After the T1 pull request merges: give the go-ahead to run migration 0110 (runbook: `docs/operations/traveller-plans.md`). It only adds, nothing visible changes, and today's code is unaffected either way. T2 waits for it. Migration numbers follow merge order: if the payment provider package (S19) reaches main first with its own migration, T1's is renumbered before merging.
