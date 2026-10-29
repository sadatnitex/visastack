# Privacy Data Map

Authority: master directive Part 7 §10 (PRD §15, "Privacy retention and
exit"). PRV-01 in `requirements-ledger.md`.

**This document does not claim GDPR, Bangladesh Data Protection Act, or any
other regime's compliance.** Per the directive's own instruction ("Do not
claim GDPR/Bangladesh compliance without qualified legal review... Mark
legal decisions requiring counsel as BLOCKED, not 'done'"), every genuinely
legal/business decision below is marked **BLOCKED** rather than answered
with an invented-but-plausible value. A confident-sounding guess here would
be worse than an honest gap: it would read as a decision someone made, when
no one has.

This is an inventory of what the system actually does today, cross-checked
directly against the code and configuration that implements it (cited by
file/line throughout), not a description of what a mature privacy program
would eventually look like.

## 1. Legal entity, roles, jurisdiction

These require a human legal/business decision. None of the mechanisms this
codebase implements (consent capture, retention, erasure, access control)
substitute for making them.

| Decision | Status | Note |
|---|---|---|
| Operating legal entity | **BLOCKED** | Not decided in this repository. |
| Controller/processor roles (per traveller-owned wallet data vs. per agency-managed case data -- these are plausibly different roles for the same platform) | **BLOCKED** | The product distinguishes traveller-owned data (`applicants.ownerAccountId`) from agency-accessed data (`grants`) structurally, but which party is "controller" and which is "processor" under an actual data-protection regime is a legal characterization, not a schema fact. |
| Jurisdiction(s) of operation / primary regulatory regime(s) | **BLOCKED** | The product serves a Bangladesh/Singapore fashion-tech and visa-services context per its own product framing, but which regime(s) actually apply (Bangladesh's data protection framework, GDPR for EU-bound applicants, others) has not been legally assessed. |
| Lawful basis per processing purpose | **BLOCKED** | `consents` (`packages/db/src/schema.ts`) records that CORE_PROCESSING/AI_EXTRACTION/SHARING/MARKETING consent was captured and by whom -- a genuine, auditable UX/product mechanism. It does not itself establish which lawful basis (consent, contract necessity, legitimate interest, etc.) a regulator would recognize for each processing purpose; that mapping has not been done. |
| Children/guardian handling | **Product mechanism exists; legal sufficiency BLOCKED** | `applicants.relationship = 'MINOR_GUARDIAN'` plus `authorityConfirmedAt` (IAM-04) records who acts for a minor traveller and that the acting adult's authority was confirmed at the point of use. Whether this mechanism satisfies applicable children's-data law in every jurisdiction of operation is a legal question this mechanism's existence does not answer. |
| Cross-border transfers (Bangladesh/Singapore-based travellers and agencies; US/EU-region infrastructure -- see §2) | **BLOCKED** | No transfer mechanism (standard contractual clauses, an adequacy decision, or another basis) has been assessed, chosen, or documented. |
| Subprocessor disclosure/agreements | **BLOCKED** | §2 below lists WHO the technical subprocessors are (a factual inventory). The legal artifact a controller maintains -- subprocessor agreements, a public subprocessor list, breach-notification terms -- does not exist. |

## 2. Per-service inventory

"Region" is marked **operator-configured** where the actual data-residency
region is a deployment-time choice (a Vercel project setting, a Neon
project's region) rather than something encoded in this repository -- citing
a specific region here without checking the live deployment would be a
guess, not a fact. An operator completing this document for a specific
deployment should replace those cells with the actual configured region.

| Service | Provider (as configured) | Data class | Purpose | Region | Retention | Deletion | Exit |
|---|---|---|---|---|---|---|---|
| Host | Vercel (`apps/web`, Next.js) | No persistent data of its own -- compute only | Serves the application and API routes | Operator-configured (Vercel project region/edge network) | N/A (stateless) | N/A | Redeploy elsewhere; no data to migrate |
| Database | Neon Postgres (`DATABASE_PROVIDER=neon`, `providers.ts`) | All structured data: accounts, applicants, facts, documents metadata, missions, audit events, everything this product persists | System of record for every entity in `packages/db/src/schema.ts` | Operator-configured (Neon project region) | Per-class, see `retention_policies` table and directive §11 (tracked separately: `docs/commercial-v1/known-issues.md`, most classes not yet independently configurable -- see PRV-02) | `erasure.ts`'s durable outbox for row-level erasure; full DB migration for platform exit | Standard `pg_dump`/Neon branch export; schema is reproducible from `main` (`docs/operations/recovery.md`) |
| Object storage (documents/evidence bytes) | Vercel Blob or Neon-backed blob storage (`STORAGE_PROVIDER=vercel_blob \| neon`, `providers.ts`) | Uploaded document files (passports, financial evidence, etc.) -- the most sensitive data class this product handles | Evidence storage for visa applications | Operator-configured (tied to the storage provider's own region for the deployment) | Same lifecycle as the owning document (`documentVersions`); no independent timer | `erasure.ts`'s verified delete-then-confirm outbox (`docs/security/erasure-and-retention-boundary.md`) | Bulk object export via the provider's own API; `exportAccount` does not currently include original bytes (tracked: PRV-04) |
| Identity provider | WorkOS AuthKit (`IDENTITY_PROVIDER=workos`) | Authentication identity: email, WorkOS user ID, session/MFA state | Sign-in, session management, step-up reauthentication | WorkOS's own infrastructure (not this deployment's choice; see WorkOS's own data-processing terms) | Governed by WorkOS's own session/account lifecycle, not this codebase | Deleting the local account does not delete the WorkOS-side identity; that requires a separate WorkOS-side action (not automated by this codebase today) | WorkOS's own account export/deletion tooling, outside this codebase |
| Key management | `LocalEnvelopeKeyProvider` (`KMS_PROVIDER=local`, `packages/adapters/src/key-management.ts`) | Envelope-encryption keys protecting field-level sensitive data | Encryption-at-rest for RESTRICTED-sensitivity profile fields | Same process/environment as the application (not a separate managed KMS) | N/A (keys, not personal data) | N/A | **Local-only; not yet a commercial-grade managed KMS** -- a genuine, already-flagged gap distinct from PRV-01's own scope (see `docs/commercial-v1/known-issues.md` and `commercial-readiness.ts`'s KMS gate) |
| Malware scanner | ClamAV (`MALWARE_SCANNER_PROVIDER=clamav`) or a builtin heuristic fallback | Transient: scans uploaded file bytes; does not retain them | Malware/safety scanning of uploaded evidence before it is trusted | In-process/in-cluster with the application; no separate data store | Scan results (`scanResults`) persist as metadata; the scanned bytes themselves are not retained separately by the scanner | Scan result rows follow their owning document's lifecycle | N/A -- no independent data set to export |
| OCR / AI extraction | OpenAI (`AI_PROVIDER=openai`) | Document text/images sent for field extraction; extracted field proposals | Draft-field extraction, document-type suggestion, inconsistency flagging (AI gateway, Part 8 scope) | OpenAI's own infrastructure/region for API processing | `aiExtractionRuns`/`fieldProposals` currently have no independent age-based expiry (directive's own "AI cache: <=30d later" default -- tracked as a gap, PRV-02) | Cascades with the owning applicant's deletion (`onDelete: cascade`) | Not included in `exportAccount` beyond the proposal rows themselves (`docs/security/erasure-and-retention-boundary.md`'s own "what this does NOT yet cover") |
| Email | Resend (`EMAIL_PROVIDER=resend`) or no-op (`EMAIL_PROVIDER=none`/unset) | Recipient address, message content (notifications, invitations) | Transactional notification delivery | Resend's own infrastructure/region | Not retained by this codebase beyond the `notifications` row describing that a send was attempted; Resend's own retention of sent-message content is governed by Resend's terms, not this codebase | N/A from this codebase's side beyond ceasing to send | N/A |
| Monitoring / observability | `ConsoleObservabilityPort` -> Vercel's own log viewer (`OBSERVABILITY_PROVIDER=console`) | Structured application logs (never raw PII by design -- see `session.ts`'s `subjectRef`, a salted-free truncated hash, never a raw email, in log lines) | Operational monitoring, error diagnosis | Vercel's own log infrastructure/region | Governed by Vercel's own log retention window, not independently configured by this codebase | N/A | N/A |
| Backups | Neon continuous WAL / point-in-time restore (`docs/operations/recovery.md`) | Full point-in-time copies of the Postgres database, including everything in the "Database" row above | Disaster recovery (RPO <=5 min, RTO <=60 min target) | Same region as the primary Neon project | Neon's own PITR retention window (operator-configured in the Neon project settings; not encoded in this codebase) | Erasure/retention deletions are NOT currently replayed against backups or reconciled after a restore -- **this is a real, tracked gap**, not silently assumed solved (directive §15 "backup resurrection protection"; tracked as PRV-04's own open item, `docs/commercial-v1/known-issues.md`) | Standard Neon project export |
| Payments | None by default (`PAYMENT_PROVIDER=none`); SSLCOMMERZ when the owner configures it (`PAYMENT_PROVIDER=sslcommerz`, ADR 0020, `docs/operations/online-payments.md`) | When a payer starts an online invoice payment: the agency name, the paying person's email address, the invoice reference and the amount are sent to SSLCOMMERZ. Card or wallet details are entered on SSLCOMMERZ's own page and never reach this codebase. Nothing about travellers is sent | Collecting an agency's invoice payment | SSLCOMMERZ's own infrastructure/region (Bangladesh gateway; not a claim about data location) | `payment_attempts` (gateway ids, status, amount; no card data) and the append-only `invoice_payments` ledger are kept as financial records. SSLCOMMERZ's retention is governed by its terms | Financial records are not removed with an account; they carry no personal content beyond the payer account id | N/A |

## 3. Cross-reference to existing control documentation

This data map inventories *what exists and where*; it does not duplicate
the *how it is enforced* detail already maintained elsewhere:

- [`docs/security/erasure-and-retention-boundary.md`](../security/erasure-and-retention-boundary.md) -- the control-to-test map for the erasure outbox, legal-hold race-closing, and account deletion/export mechanics.
- [`docs/security/tenant-isolation-matrix.md`](../security/tenant-isolation-matrix.md) -- cross-tenant access boundaries.
- [`docs/security/threat-model.md`](../security/threat-model.md) -- the broader threat model this data map's own subprocessor/transfer gaps feed into.
- [`docs/operations/recovery.md`](../operations/recovery.md) -- backup/restore procedure and RPO/RTO targets.

## 4. Known gaps against directive Part 7 §§11-15

Tracked in full in `docs/commercial-v1/known-issues.md`; not restated here
in duplicate. In summary, as of this document's own audit (2026-09-26):
retention genuinely covers only one of the eight classes the directive
names (per-docType, via `retention_policies`); the deletion-request UX
covers steps 1, 7, and 8 of the directive's 8-step flow but not 2-6 (scope
preview, retained-exception explanation, export offer, processing
revocation at request time); legal holds have real, race-safe enforcement
but no review/expiry field at all; export has no original file bytes, no
manifest, and no CSV; and backup-resurrection protection (tombstone/
revocation replay after a restore) has no design or code yet. These are
PRV-02/03/04's own scope, not this document's.

## 5. Maintenance

Update this document whenever a `*_PROVIDER` env var in
`apps/web/src/lib/providers.ts` gains a new supported value, a new
subprocessor is introduced, or a §1 legal decision is actually made (move
the row from BLOCKED to the decision, cite who made it and when -- never
silently delete the BLOCKED history).


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance. Production uses private R2 storage; database-only encrypted archive recovery is verified, while complete document/key/lifecycle recovery remains open.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.

## Backup retention correction (2026-10-29, S27)

This supersedes the "Backups" row above for the encrypted SQL archives; Neon's own point-in-time restore window is separate and unchanged.

| Service | Provider (as configured) | Data class | Purpose | Region | Retention | Deletion | Exit |
|---|---|---|---|---|---|---|---|
| Encrypted database archives | GitHub Actions `pg_dump` (`.github/workflows/database-backup.yml`), stored encrypted (AES-256-GCM, separate backup key) in private Cloudflare R2 under `database/` | A full copy of the Postgres database, including everything in the "Database" row: account, traveller and case records, and any field-level encrypted values as ciphertext | Independent disaster recovery copy | The R2 bucket's location | **Until the owner sets `BACKUP_PRUNE=on`: indefinite**, nothing is deleted automatically. **Once it is on:** every daily archive for 35 days, plus the newest archive of each of the 12 weeks before that (so the oldest copy is at most about 35 days plus 12 weeks, about 119 days, old), plus always the newest 7 complete archives, which can be older if captures stopped | Erasure in the live database does not reach archives already taken. Erased records can therefore survive in archives for as long as those archives are kept: indefinitely until pruning is on, then up to about 119 days (longer only if captures stop, because the newest 7 complete archives are always kept). Restores replay erasure tombstones before access (`docs/operations/r2-encrypted-backups.md`) | Download and decrypt with the backup key; the format is documented in `packages/adapters/src/backup-encryption.ts` |
