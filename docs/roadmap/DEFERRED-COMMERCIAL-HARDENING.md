# Deferred commercial hardening register

Authoritative list of controls that are kept in the architecture but intentionally not built, or not switched on, for the first 100 to 1,000 users. Owner instructions of 26 October 2026; architecture freeze the same day.

Execution plan: [SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md](SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md). Background: [SMALL-COMMERCIAL-V1.md](SMALL-COMMERCIAL-V1.md).

## Rules

- Nothing here is deleted from the architecture or the requirements ledger. Each item names the seam that keeps it buildable.
- Deferral never covers basic protection against direct exposure of passports, financial evidence or cross-agency data. Those controls are commercial-minimum (part 1) and must pass before real data is switched on.
- An item leaves this register when its trigger is met or the owner says so. The session that acts on it records the date and the evidence here (append, never rewrite history).
- "Measure during pilot" means no responsible number exists yet; the pilot must produce one.

## Part 1. Commercial-minimum (never deferred)

| # | Control | State on main `174ae1a` (26 Oct 2026) | Closed by |
|---|---|---|---|
| M01 | HTTPS and a per-request content security policy | Live | Done |
| M02 | Private document storage | Live (private R2 plus private mirror) | Done |
| M03 | Encryption already depended on (protected fields with pgcrypto, envelope-encrypted provider keys, encrypted backups) | Live | Done |
| M04 | Central access gate, tenant isolation, revocable sharing with per-case exceptions, append-only audit | Live, with suites in CI | Done; re-run in acceptance (S24) |
| M05 | Basic backup of database and documents | Weekly encrypted database backup and an isolated restore drill have passed. Neon Free keeps only 6 hours of point-in-time restore. Document objects also live in the private mirror, but restoring a document from it has never been tested | S27: daily encrypted backup. S24: one verified document restore from the mirror. Owner action O3: Neon Launch plan for a longer restore window |
| M06 | Real malware scanning of uploads | Structural checks only. The ClamAV GitHub worker exists, but its real run failed at install (`clamdscan` missing). Readiness cannot report the `github_clamav` scanner as available | S4 |
| M07 | Protected secrets and a recoverable application key | Secrets in Vercel; the master key has no verified offline copy | Owner action O5 before real data |
| M08 | Second sign-in factor for platform staff | Built 26 Oct 2026 (S3), switch `STAFF_SECOND_FACTOR` off until the owner has set up the app and run migration 0092; then set to `required`. Neon Auth itself still has no two-step sign-in, so it is an app-level check | S3 (app-level authenticator codes for platform roles) |
| M09 | Safe download | Downloads are decided per document, need step-up, and use replay-checked access tokens | Done |
| M10 | Payment callbacks validated server to server, idempotent, never trusting the browser | Not built | S11 (ADR 0020) |
| M11 | The AI connector cannot reach anything beyond the person's own record (or, for agency connections, beyond the traveller's grant with AI tools allowed) and the chosen scope | Not built | S8, S13 to S16, S20 to S22 (ADR 0021) |
| M12 | AI reading entry points bind the document version to the applicant | Closed 26 Oct 2026 (S2): every entry point proves version to document to applicant; a mismatch reads as not found; reuse of earlier readings stays inside one applicant | S2 (ADR 0019 point 5) |
| M13 | Cross-tenant admin reads limited to the roles that need them | Closed 26 Oct 2026 (S2): both reads take a staff scope (compliance administrator and security administrator) checked inside the service | S2 |
| M14 | Support grants cannot be created without the right role | Closed 26 Oct 2026 (S2): `createSupportGrant` takes the security administrator's staff scope as approver | S2 |
| M15 | Hosting plan allows commercial use | Neon is on Free (checked 26 Oct). Vercel's plan name was not returned by the API; the personal team and the daily deployment limit indicate Hobby, which is for non-commercial use | Owner action O3 |
| M16 | Repository not publicly readable while the product is proprietary | Public, temporarily (owner, 26 Oct 2026: to be made private soon). Full-history secret scan on 26 Oct (gitleaks, 867 commits, all branches): no real credential, 11 false positives | Owner action O1 |
| M17 | Every launch checklist is maintained and reviewed; unmaintained routes run in manual mode with no automated readiness claim | One published checklist exists ("UK Visitor1": 2 requirements, not authoritative, review date passed 23 Oct 2026, used by no case) | Owner action O7, then S24 |
| M18 | Real key management for protected fields in commercial mode | Local master key only; the code refuses it in commercial mode and the readiness gate is hard-coded false | S26 plus owner action O16 |
| M19 | Honest commercial-readiness checks | The AI gate only knows the old OpenAI path; the scanner gate ignores `github_clamav`; the penetration-test gate cannot record the owner's deferral | S27 plus owner action O17 |

## Part 2. Deferred security and compliance hardening

Owner, 26 Oct 2026: payments, the AI connector and product features are built now; only security and compliance items are deferred. Items that were here and are now built are listed in part 4.

| # | Control | Present state | Why deferred | Accepted risk | Trigger | Existing seam | Likely implementation |
|---|---|---|---|---|---|---|---|
| H01 | External penetration test | Independent code and security reviews per change; tenant-isolation and permission suites | Cost out of proportion at pilot scale | Flaw classes found only by outside testers | First enterprise contract, 500 active travellers, or an insurer or regulator request | `docs/security/` | Scoped web, API and connector test; fix and retest |
| H02 | SOC or SIEM programme | Audit trail, product events, Vercel logs | No staff to watch alerts | Slower detection | Paid security staff or 1,000 active users | `audit_events`, log drains | Log drain with alert rules |
| H03 | Multi-region redundancy | Single region | Cost | Regional outage means downtime | Contractual uptime commitment | Storage and database ports | Replica or second region, failover runbook |
| H04 | Independent key escrow and dual custody beyond the managed key service (the key service itself is M18, S26) | Envelope encryption with key ids; no rotation tool | Needs custody process | Losing the key loses protected fields (M07 covers the minimum) | Enterprise contract or 1,000 users | `KeyManagementPort` | KMS keys, rotation job, dual custody |
| H05 | 15-minute RPO and measured RTO | Weekly database backup plus Neon point-in-time window | Continuous capture costs more than the pilot needs | Up to the PITR window of changes at risk | Over 10 paying agencies or a contractual RPO | Backup workflows | Daily logical backup, measured drills |
| H06 | Passkeys or hardware keys for staff | M08 adds authenticator codes | Few staff | Phishing of a code-based factor | More than 3 staff or any targeted attempt | Step-up proof | WebAuthn for platform roles |
| H07 | Enterprise SSO for agencies | Neon Auth email sign-in | No buyer needs it | None now | First contract requiring it | Session layer | SSO through the identity provider |
| H08 | Certifications (ISO 27001, SOC 2) | Legal drafts only | Cost and time | Some buyers will not sign | Enterprise pipeline demands it | `docs/governance/` | Readiness project |
| H09 | Vendor compliance automation | Provider data-terms records, cost register | Few processors | Missed terms change | More than 10 processors | `ai_provider_config_terms` | Scheduled review reminders |
| H10 | Advanced abuse and fraud detection | Rate limits, quotas, entitlements, step-up, payment risk hold | No abuse volume | Manual handling | Abuse reports or payment fraud | Product events | Anomaly rules |
| H13 | Enterprise privacy workflows | Account export, erasure, consent | Manual handling suffices | Slower responses | Over 20 privacy requests a month | `export.ts`, erasure jobs | Request tracking |
| H14 | Training guard on | Built, off by owner decision (25 Oct) | Free and low-cost tiers allowed for now | Inputs may train some free-tier models | Real applicant data on with a provider whose terms allow training, an enterprise contract, or regulator guidance | `ai_data_rule_settings`, data-terms records | Switch on; refuse providers without no-training terms |
| H20 | Moving the remaining ~313 older service functions behind the access gate | Every web caller was checked: owner checks inside services, organization membership enforced in the web layer, platform roles inside services or in every admin action. Only M12 to M14 were real gaps | Consolidation, not exposure, once M12 to M14 close | A future careless caller could skip a web-layer check | Any new caller outside `apps/web` (API, connector, worker), a new agency surface, or a confirmed miss | `requireAccess`, ratchet baseline (may only shrink) | Shadow mode first, one module per PR, agency organization reads first |
| H21 | Signed step-up proof replacing caller-supplied booleans | Every web call site passing `true` was checked: each is preceded by a real recent sign-in check | Structural, not a current hole | A new caller could pass `true` without checking | Next new privileged action, or any non-web caller | `StepUpProof` already used by `requireAccess` and case exceptions | Convert one module at a time; test that no literal `true` reaches a service |
| H27 | Membership checks inside agency organization read functions | Enforced consistently in the web layer (`loadOrgAccess`) | Covered by H20's order | Same as H20 | Same as H20 | `agency.ts` | Gate them first under H20 |
| H15 | AI destructive or outward actions (delete, submit, share, acknowledge, change permissions or case status, pay) | AI suggestion tools only create pending suggestions, drafts and reminders (ADR 0021 extensions) | Safety boundary: these act on the person's behalf outside their review | None | Never without a new owner decision and a per-action confirmation design | Tool registry, `withAiConnection` | One action per change, each confirmed by the person inside VisaStack |
| H16 | Tax engine and statutory invoice formats (VAT, withholding) | Invoices carry no tax lines (ADR 0020) | Compliance: needs an accountant's rules | Tax handled outside VisaStack | Owner and accountant define the rules, or a customer requires tax invoices | `invoices`, `invoice_payments` | Tax lines and statutory layout |

## Part 3. Scaling triggers (measure first; not features)

| # | Change | Present state | Trigger | Seam | Likely implementation |
|---|---|---|---|---|---|
| H11 | Dedicated reading worker or always-on clamd and OCR host | GitHub worker scans and reads in batches | Upload-to-readable over 10 minutes at the daily peak for 3 days, or Actions minutes over 70 percent of the plan | `MalwareScannerPort` (`clamav` adapter already speaks clamd), `DocumentConverterPort` | Small always-on host running clamd and Tesseract |
| H17 | Five-minute or hourly job scheduling | Upload-driven triggers plus daily backstop | Any job type waiting over 15 minutes at peak | Optional Worker trigger | Deploy the Worker and measure |
| H24 | Tesseract inside the Vercel function | Private OCR runs in the worker only | H11 rejected and worker delay unacceptable | `DocumentConverterPort` | WASM OCR with page and time caps |

## Part 4. Moved from this register to the build list (owner, 26 Oct 2026)

| Former item | Now built in | Contract |
|---|---|---|
| H12 Real redaction | S23 | ADR 0022 |
| H15 (part) AI suggestion tools and agency-side AI connectors | S21, S22 | ADR 0021 extensions |
| H16 (part) Recurring period invoices, reminders, overdue handling, automatic reactivation, refunds | S17, S18 | ADR 0020 Phase 2 |
| H22 Original document files through the AI connector | S20 | ADR 0021 extensions |
| H23 Dynamic Client Registration for AI apps | S13 | ADR 0021 extensions |
| H25 Payment receipt upload | S12 | ADR 0020 |
| H26 Second payment provider | S19 (provider chosen by the owner, O14) | ADR 0020 Phase 2 |
| H18 Bangla and all translation | S25, last, only on the owner's word (standing rule: after the rest of the product is done) | `packages/i18n` |
| H28 Broader country and route coverage | Content programme, owner-led (O7): each route needs official sources and a qualified reviewer; no code change | Pack Studio |
| H19 Native mobile apps | Not in scope: the owner's 26 Oct programme lists dedicated mobile apps under "avoid"; the responsive web app serves phones | Same services |
