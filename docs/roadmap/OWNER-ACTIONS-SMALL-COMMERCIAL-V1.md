# Owner actions for Small Commercial V1 (prepared 26 Oct 2026)

Each item lists: what is already done for you, the steps only you can take, and what happens until you do them. **Nothing here blocks building.** Every package is built and tested without these steps. A missing step only keeps that one capability switched off or in test mode, with a plain message in the product. You can do the steps one by one, in any order, except where noted.

**Owner decision, 26 Oct 2026:** O1 (repository private), O3 (Vercel and Neon upgrades) and O4 (virus scanner switch) will be done later, at the owner's own risk. **The plan and its order do not change.** Every package proceeds; S4 is still built and tested, and only its switch-on waits for O4. Real data stays off until these are done (the readiness checks enforce it).

Plan: [SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md](SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md). Each item's ID (O1 to O17) matches the handoff's section L.

## Status at 29 Oct 2026

**Waiting for you** (none of these blocks building; each switches one thing on):

| Action | What it unlocks | Where you do it |
|---|---|---|
| Turn on backup pruning after a few good daily backups: `BACKUP_PRUNE` = `on` | Old encrypted backups are deleted by the retention rules (last 35 days, one per week for 12 weeks, never the newest 7), so the free 10 GB of storage is not used up. Until then nothing is deleted | GitHub: the repository, then Settings, then Secrets and variables, then Actions, then the Variables tab: new repository variable (not a secret, not Vercel) |
| Approve the S17 database change once S17 merges | Recurring invoices, reminders and the Billing Rules page. Until it runs, no invoice is made automatically, Billing Rules says "not available yet", and every billing action works as today. Before it runs, the check in [billing-cycle.md](../operations/billing-cycle.md) must find no duplicate invoices | Chat: reply "migrate S17" (migration 0103) |
| Set the overdue policy and decide on traveller uploads (O13) | Automatic Grace and Suspended for unpaid invoices. Until then it stays off: reminders still go out, and only an admin changes a billing status | `/app/admin/billing` (Billing Rules), after migration 0103, or reply with your numbers |
| Optional: record the penetration test deferral (O17) | The external penetration test gate shows "Deferred by Owner (H01)" and counts as passing. It matters only when you switch real data on (O11) | Vercel: the project, then Settings, then Environment Variables, Production: `COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST` = `H01`, then a redeploy |
| Try the AI connector with a made-up traveller | Proof that a real Claude or ChatGPT connection works end to end (not verified yet) | In your AI app: add a connector with the address `https://vs.obsidianglobal.studio/mcp` (Claude: a custom connector; ChatGPT: developer mode), sign in as a test traveller and choose what it may read. Turn it off afterwards on the Sharing page |
| Name a payment provider | S19 (second provider) and the provider-facing parts of S17 and S18 can be tested. SSLCOMMERZ online payment also still needs O6 | Chat: reply with the provider (O14), and O6 for SSLCOMMERZ |
| Staff authenticator codes (O8 for S3 is done) | Every staff account must enter an authenticator code. Enrol staff first ([staff-second-factor.md](../operations/staff-second-factor.md)) | Vercel Production: `STAFF_SECOND_FACTOR` = `required`, then a redeploy. It stays `off` until you set it |

Also still open as written below: O1 (private repository), O3 (paid Vercel and Neon plans), O4 (virus scanner switch; readiness still says scanning is not configured), O5 (offline copy of the master key), O6 (SSLCOMMERZ), O7 (launch routes and reviewer), O10 (legal review), O11 and O12 (real data and release, after S24), O13 (overdue policy, needed for S17's automatic Grace and Suspended), O16 (AWS key service).

**Done:**

- O8 database changes: S3 (0092), S26 (0093) and S10 (0094) are recorded as applied in the handoff's section M; S13 (0100, AI connections) and the live calendar link (0101) were each run with your word. S11 (0096) and S12 (0097) are applied too (verified 29 Oct 2026 on Neon: drizzle.__drizzle_migrations holds 100 rows, equal to the 100 journal entries, newest = 0101). S23 (0102, safe copy masks) was applied on 29 Oct with your word. Next: S17 (0103), once S17 merges.
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
  | S17 | Recurring invoices and billing rules (migration 0103): one row of billing rules, a cause on each billing status change, one live invoice per agency, plan and period. Before running it, the duplicate check in [billing-cycle.md](../operations/billing-cycle.md) must return no rows |
  | S18 | Refund requests, if needed |
  | S19 | Saved payment methods |
  | S20 | Original-file choices |
  | S22 | Agency AI permission |
  | S23 | Redaction masks (migration 0102). **Applied 29 Oct 2026** |
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
- **Prepared (S17, 29 Oct 2026):** the Billing Rules page (`/app/admin/billing`, platform owner only, with a fresh sign-in check) holds these numbers and the On/Off switch. Before it switches on, it says how many agencies it would move that day, so old unpaid invoices are seen first. How it works: [billing-cycle.md](../operations/billing-cycle.md).
- **You:**
  1. Set your numbers on the Billing Rules page, or reply with them, or "use the defaults".
  2. **Decide on traveller uploads first.** Today, while an agency is Suspended, a traveller who shares records with that agency also cannot add new files (their existing files stay visible and nothing is deleted). S17 keeps this unchanged. Reply "keep traveller uploads blocked" or "let travellers upload while an agency is suspended" (the second is a small follow-up change).
  3. Switch "Automatic Grace and Suspended" on.
- **Until then:**
  - S17 sends invoices and reminders.
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
