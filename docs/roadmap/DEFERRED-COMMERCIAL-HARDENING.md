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
| M04 | Central access gate, tenant isolation, revocable sharing with per-case exceptions, append-only audit | Live, with suites in CI | Done; re-run in acceptance (S17) |
| M05 | Basic backup of database and documents | Weekly encrypted database backup and an isolated restore drill have passed. Document objects also live in the private mirror, but restoring a document from it has never been tested | S17: one verified document restore from the mirror; record Neon point-in-time window |
| M06 | Real malware scanning of uploads | Structural checks only. The ClamAV GitHub worker exists, but its real run failed at install (`clamdscan` missing). Readiness cannot report the `github_clamav` scanner as available | S4 |
| M07 | Protected secrets and a recoverable application key | Secrets in Vercel; the master key has no verified offline copy | Owner action O5 before real data |
| M08 | Second sign-in factor for platform staff | Neon Auth's managed service has no two-step sign-in. Step-up only re-checks the password. No MFA anywhere in code | S3 (app-level authenticator codes for platform roles) |
| M09 | Safe download | Downloads are decided per document, need step-up, and use replay-checked access tokens | Done |
| M10 | Payment callbacks validated server to server, idempotent, never trusting the browser | Not built | S11 (ADR 0020) |
| M11 | The AI connector cannot reach anything beyond the person's own record and chosen scope | Not built | S8, S13 to S16 (ADR 0021) |
| M12 | AI reading entry points bind the document version to the applicant | Not bound: only the applicant's ownership is checked | S2 (ADR 0019 point 5) |
| M13 | Cross-tenant admin reads limited to the roles that need them | `listAllApplicants` and `listRecentAuditEvents` are open to any platform role | S2 |
| M14 | Support grants cannot be created without the right role | `createSupportGrant` has no role check (no caller today) | S2 |
| M15 | Hosting plan allows commercial use | Vercel's daily deployment limit suggests the Hobby plan, which is for non-commercial use | Owner action O3 |
| M16 | Repository not publicly readable while the product is proprietary | The repository is **public**; the owner (26 Oct 2026) says this is temporary and it will be made private soon. No live credential was found in the current tree; history was not scanned | Owner action O1 |
| M17 | Every launch checklist is maintained and reviewed; unmaintained routes run in manual mode with no automated readiness claim | One published checklist exists ("UK Visitor1": 2 requirements, not authoritative, review date passed 23 Oct 2026, used by no case) | Owner action O7, then S17 |

## Part 2. Deferred hardening

| # | Control | Present state | Why deferred | Accepted risk | Trigger | Existing seam | Likely implementation |
|---|---|---|---|---|---|---|---|
| H01 | External penetration test | Independent code and security reviews per change; tenant-isolation and permission suites | Cost out of proportion at pilot scale | Flaw classes found only by outside testers | First enterprise contract, 500 active travellers, or an insurer or regulator request | `docs/security/` | Scoped web, API and connector test; fix and retest |
| H02 | SOC or SIEM programme | Audit trail, product events, Vercel logs | No staff to watch alerts | Slower detection | Paid security staff or 1,000 active users | `audit_events`, log drains | Log drain with alert rules |
| H03 | Multi-region redundancy | Single region | Cost | Regional outage means downtime | Contractual uptime commitment | Storage and database ports | Replica or second region, failover runbook |
| H04 | Independent key escrow, KMS and rotation tooling | Envelope encryption with key ids; no rotation tool | Needs custody process | Losing the key loses protected fields (M07 covers the minimum) | Enterprise contract or 1,000 users | `KeyManagementPort` | KMS keys, rotation job, dual custody |
| H05 | 15-minute RPO and measured RTO | Weekly database backup plus Neon point-in-time window | Continuous capture costs more than the pilot needs | Up to the PITR window of changes at risk | Over 10 paying agencies or a contractual RPO | Backup workflows | Daily logical backup, measured drills |
| H06 | Passkeys or hardware keys for staff | M08 adds authenticator codes | Few staff | Phishing of a code-based factor | More than 3 staff or any targeted attempt | Step-up proof | WebAuthn for platform roles |
| H07 | Enterprise SSO for agencies | Neon Auth email sign-in | No buyer needs it | None now | First contract requiring it | Session layer | SSO through the identity provider |
| H08 | Certifications (ISO 27001, SOC 2) | Legal drafts only | Cost and time | Some buyers will not sign | Enterprise pipeline demands it | `docs/governance/` | Readiness project |
| H09 | Vendor compliance automation | Provider data-terms records, cost register | Few processors | Missed terms change | More than 10 processors | `ai_provider_config_terms` | Scheduled review reminders |
| H10 | Advanced abuse and fraud detection | Rate limits, quotas, entitlements, step-up, payment risk hold | No abuse volume | Manual handling | Abuse reports or payment fraud | Product events | Anomaly rules |
| H11 | Dedicated reading worker or always-on clamd and OCR host | GitHub worker scans and reads in batches | Worker exists and is free on a public repository | Minutes of delay after upload | Upload-to-readable over 10 minutes at the daily peak for 3 days, or Actions minutes over 70 percent of the plan | `MalwareScannerPort` (`clamav` adapter already speaks clamd), `DocumentConverterPort` | Small always-on host running clamd and Tesseract |
| H12 | Real redaction | Safe copies cover visa photo sizes only | Owner parked it | Recipients get originals only when given Download Original | Owner says start | `DOWNLOAD_REDACTED`, `/api/blob` fails closed | Redaction pipeline with review |
| H13 | Enterprise privacy workflows | Account export, erasure, consent | Manual handling suffices | Slower responses | Over 20 privacy requests a month | `export.ts`, erasure jobs | Request tracking |
| H14 | Training guard on | Built, off by owner decision (25 Oct) | Free and low-cost tiers allowed for now | Inputs may train some free-tier models | Real applicant data on with a provider whose terms allow training, an enterprise contract, or regulator guidance | `ai_data_rule_settings`, data-terms records | Switch on; refuse providers without no-training terms |
| H15 | AI write tools and agency-side AI connectors | Connector is read-only and owner-only (ADR 0021) | Read-only first | None | Validated demand, one tool at a time, each with explicit confirmation | Tool registry, `withAiConnection` | One write tool per change with confirmation |
| H16 | Recurring billing, renewals, dunning, tax, refunds automation, automatic reactivation after payment | Invoice-by-invoice payment (ADR 0020) | Not needed for a few agencies | Manual chasing and manual reactivation | Over 200 invoices a month or card subscriptions requested | `PaymentPort`, `invoice_payments` (`REFUND` kind reserved) | Recurring provider, dunning, refund ledger rows |
| H17 | Five-minute or hourly job scheduling | Upload-driven triggers plus daily backstop | Free plan limits | A missed trigger waits for the daily run | Any job type waiting over 15 minutes at peak | Optional Worker trigger | Deploy the Worker and measure |
| H18 | Bangla and all translation | Deferred by the owner | Product first | English only | Owner says the rest is done | `packages/i18n` | Translation programme |
| H19 | Native mobile apps | Responsive web | Web suffices | None | Usage shows need | Same services | Native shell |
| H20 | Moving the remaining ~313 older service functions behind the access gate | Every web caller was checked: owner checks inside services, organization membership enforced in the web layer, platform roles inside services or in every admin action. Only M12 to M14 were real gaps | Consolidation, not exposure, once M12 to M14 close | A future careless caller could skip a web-layer check | Any new caller outside `apps/web` (API, connector, worker), a new agency surface, or a confirmed miss | `requireAccess`, ratchet baseline (may only shrink) | Shadow mode first, one module per PR, agency organization reads first |
| H21 | Signed step-up proof replacing caller-supplied booleans | Every web call site passing `true` was checked: each is preceded by a real recent sign-in check | Structural, not a current hole | A new caller could pass `true` without checking | Next new privileged action, or any non-web caller | `StepUpProof` already used by `requireAccess` and case exceptions | Convert one module at a time; test that no literal `true` reaches a service |
| H22 | Original document files through the AI connector | Not offered; text and facts only (ADR 0021) | Highest-risk data to an outside app | AI cannot see layout-dependent details | Clear user demand plus a reviewed per-document consent design | Document access tokens, `withAiConnection` | Per-document, short-lived, watermark-free signed fetch with its own consent |
| H23 | Dynamic Client Registration for AI apps | CIMD only, with an allowlist (ADR 0021) | DCR is deprecated in MCP and creates unbounded client records | AI apps without CIMD cannot connect | A requested app supports only DCR | Authorization server metadata | Registration endpoint with rate limits and expiry |
| H24 | Tesseract inside the Vercel function | Private OCR runs in the worker only | Binary size, cold starts, memory | Scans wait for the worker or use AI with consent | H11 rejected and worker delay unacceptable | `DocumentConverterPort` | WASM OCR with page and time caps |
| H25 | Payment receipt image upload | Manual claims carry a reference, not a file | A new document type and review flow | Admin checks the reference against the bank statement | Admins report reference-only checking is too slow | Documents pipeline | Receipt as a billing document type |
| H26 | Second payment provider (bKash direct, Stripe) | One adapter (SSLCOMMERZ) | One gateway covers cards and mobile wallets in Bangladesh | Provider outage blocks online payment (manual path remains) | Customer demand or a provider outage longer than a day | `PaymentPort` | Another adapter |
| H27 | Membership checks inside agency organization read functions | Enforced consistently in the web layer (`loadOrgAccess`) | Covered by H20's order | Same as H20 | Same as H20 | `agency.ts` | Gate them first under H20 |
| H28 | Broad country and route coverage | Manual mode for any route without a maintained checklist | Content needs sources and review | Fewer routes with automated readiness | Paying agencies ask for a route repeatedly | Pack Studio, `packs`, `pack_versions` | One reviewed checklist per demanded route |
