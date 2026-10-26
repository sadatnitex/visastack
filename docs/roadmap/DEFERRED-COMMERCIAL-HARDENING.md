# Deferred commercial hardening register

Authoritative list of controls that are kept in the architecture but intentionally not built (or not switched on) for the first 100 to 1,000 users. Owner instruction of 26 October 2026. Plan: [SMALL-COMMERCIAL-V1.md](SMALL-COMMERCIAL-V1.md).

Rules: nothing here may be deleted from the architecture or the requirements ledger. Deferral never covers basic protection against direct exposure of passports, financial evidence or cross-agency data; those stay commercial-minimum (listed at the end). Moving an item out of this register needs its trigger to be met or the owner's word.

## Deferred items

| # | Requirement | Present state | Why deferred | Accepted initial risk | Activation trigger | Existing seam | Future implementation | Effort |
|---|---|---|---|---|---|---|---|---|
| H01 | External penetration test | Internal code and security reviews per change; tenant-isolation and permission suites | Cost out of proportion at pilot scale | Unknown classes of flaw found only by outside testers | First enterprise agency contract, 500 active travellers, or a regulator or insurer request | Security docs in `docs/security/` | Commission a scoped web and API test; fix and retest | Medium (vendor) |
| H02 | SOC or SIEM programme | Audit trail, product events, Vercel logs | No staff to watch alerts | Slower detection of a live attack | Paid security staff, or 1,000 active users | `audit_events`, log drains | Log drain to a SIEM with alert rules | Medium |
| H03 | Multi-region redundancy | Single region Neon and Vercel, private R2 | Cost and complexity | Regional outage means downtime | Contractual uptime commitment | Storage and database ports | Read replica or second region; failover runbook | High |
| H04 | Independent key escrow and rotation tooling | Application master key in protected configuration; backup key separate | Needs custody process and tooling | Losing the key loses protected fields | Before real applicant data (simple owner-held offline copy is commercial-minimum, see M07); full escrow at first enterprise contract | Envelope encryption with key ids | KMS-backed keys, rotation job, dual custody | Medium |
| H05 | Aggressive RPO and RTO (15 minutes) | Weekly encrypted database backup; isolated restore drill passed | Continuous backup costs more than the pilot needs | Up to a week of database changes at risk until M05 lands | Paying agencies over 10, or a contractual RPO | `backup-*` workflows, Neon point-in-time restore | Neon PITR window plus daily logical backup and measured drills | Medium |
| H06 | Hardware-key enforcement for staff | Step-up proof; staff MFA acceptance open | Few staff; MFA itself is commercial-minimum (M08) | Phishing of a staff session | More than 3 staff, or any breach attempt | Step-up proof, platform roles | Passkey or security-key only sign-in for platform roles | Low |
| H07 | Enterprise SAML or SSO for agencies | Neon Auth email sign-in | No enterprise buyer yet | None at this scale | First agency that requires SSO in a contract | Identity port in `apps/web/src/lib/session.ts` | SSO through the identity provider | Medium |
| H08 | Certification programmes (ISO 27001, SOC 2) | Legal drafts in `docs/legal/` | Cost and time | Some buyers will not sign | Enterprise pipeline demands it | Governance docs | Readiness project | High |
| H09 | Vendor compliance automation | Provider data-terms records, cost register | Manual review is enough for few vendors | Missed terms change | More than 10 processors | `ai_provider_config_terms`, cost register | Scheduled terms review with reminders | Low |
| H10 | Advanced abuse and fraud detection | Rate limits, quotas, entitlement caps, step-up | No abuse volume yet | Manual handling of abuse | Abuse reports or payment fraud events | Quotas, product events | Anomaly rules on events, payment risk scoring | Medium |
| H11 | High-volume OCR infrastructure | Private OCR in the scanner worker; AI OCR with caps | Volume is low | Slower reading at peaks | Intake queue over 15 minutes for 3 days | `processing_jobs`, `OcrPort` | Dedicated OCR worker with autoscaling | Medium |
| H12 | Real redaction engine | "Download Safe Copies" covers visa photo sizes; redacted download reports disabled | Owner parked it | Recipients get originals only when given Download Original | Owner says start, or an agency workflow needs masked copies | `DOWNLOAD_REDACTED` permission, `/api/blob` fails closed | Redaction pipeline with review | High |
| H13 | Enterprise privacy workflows (DPA automation, DSR portal) | Account export, erasure workflow, consent records | Manual handling is enough | Slower responses to requests | Over 20 privacy requests a month or enterprise contract | `export.ts`, erasure jobs | Self-service request tracking | Medium |
| H14 | AI training guard on by default | Built and off by owner decision (25 Oct) | Free and low-cost tiers allowed for the pilot | Inputs may be used for training under some free tiers | Real applicant data on with a provider whose terms allow training, an enterprise contract, or a regulator view | `ai_data_rule_settings`, data-terms records | Switch on; refuse providers without no-training terms | Low |
| H15 | Sophisticated autonomous AI controls and AI write tools | AI suggestions need a person's approval; connector is read-only (planned) | Read-only first | None | Validated user demand for an AI action | Proposal tables, connector tool registry | One write tool at a time, each with explicit confirmation | Medium per tool |
| H16 | Recurring billing, renewals, dunning, tax, multi-currency, refund automation | Plans, subscriptions, invoices, manual and (planned) hosted payment per invoice | Invoice-by-invoice is enough | Manual chasing of payments | Over 200 invoices a month, or card subscriptions requested | `PaymentPort`, `billing.ts` | Recurring provider, dunning schedule | High |
| H17 | Five-minute or hourly job scheduling | Upload-driven processing with a daily backstop | Free plan limits | A failed trigger waits until the daily run | Intake waits over 15 minutes at peak | Optional Worker trigger | Deploy the Worker and measure | Low |
| H18 | Bangla and all translation | Deferred by the owner | Product first | English only | Owner says the rest is done | `packages/i18n` | Translation programme | Medium |
| H19 | Dedicated mobile apps | Responsive web | Web is enough | None | Usage data shows need | Same services | Native shell | High |

## Commercial-minimum (never deferred)

| # | Control | State at 26 Oct 2026 | Closing package |
|---|---|---|---|
| M01 | HTTPS, per-request security policy | Live | Done |
| M02 | Private document storage | Live (R2 with private mirror) | Done |
| M03 | Encryption already implemented (protected fields, encrypted keys and archives) | Live | Done |
| M04 | Access control, tenant isolation, revocable sharing, audit trail | Live; suites in CI | Done; re-run in acceptance |
| M05 | Basic backup of database and documents | Database weekly backup and restore drill passed; document object recovery unverified | Acceptance step: daily database backup and one verified document restore |
| M06 | Real malware scanning on uploads | Structural scan only; ClamAV worker not accepted | Scanner worker fix (plan step 3) |
| M07 | Protected secrets and a recoverable application key | Secrets in protected configuration; key has no verified offline copy | Owner-held offline copy, recorded in the runbook, before real data |
| M08 | Privileged account safeguards | Step-up built; staff MFA acceptance open | Acceptance step |
| M09 | Safe download | Downloads checked one document at a time, step-up, access-context tokens | Done |
| M10 | Payment callbacks validated on the server | Not built | Payments package (plan step 6) |
| M11 | AI connector cannot reach data beyond the person's grant | Not built | AI Context Gateway (plan step 7) |
