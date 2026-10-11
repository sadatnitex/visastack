# VisaStack Commercial Launch — Build-Ready PRD v1.1 (3 pages)

> Imported executive product contract. Source of truth alongside
> [`build-spec-v1.1.md`](build-spec-v1.1.md). Text extracted from the
> supplied `.docx`; if it disagrees with the original, the original wins.

**Owner:** OGS / VisaStack · **Initial operator:** Travel Router + approved
agencies · **Launch users:** Travelers, families and agencies · **Build:**
Claude Code + GitHub + Vercel + Neon

**Core promise:** Upload once. Confirm and maintain once. Reuse across
missions. Share only what is needed, with the right person, for the right
purpose and time — and revoke future access at any time.

---

## Page 1 — Product and lifecycle

### 1. Non-negotiable product laws
- The applicant owns the record; organizations receive scoped access, never ownership.
- Default deny. Organization membership alone never exposes applicant data.
- AI proposes, explains and drafts; it cannot silently write, verify authenticity, grant access, submit or predict visa approval.
- Every current value is manually editable, source-linked and versioned. Old missions retain immutable snapshots.
- Show 'Who can see this?' and 'What changed?' wherever sensitive data is viewed or changed.
- No permanent public document links, sensitive browser persistence, fake progress, hidden failures or production data in dev/test.
- Calm, positive, mobile-first UX; manual completion remains available during AI/provider failure.

### 2. Public product surface
- **Master Profile** — universal facts, repeating records, effective dates, statuses and history.
- **Document Vault** — private originals/versions, processing, preview, expiry and permissioned downloads.
- **Mission Workspace** — one or parallel country/purpose applications with tasks, evidence and reviewer collaboration.
- **Secure Sharing & Delegation** — person/org/application/category/action/purpose/expiry grants with acceptance and revocation.
- **Readiness, Review & Pack** — evidence coverage, contradictions, stale items, grounded letters/translations and one-click packet/export.
- **Agency Desk** is a role-based view over the same applicant-owned records — not a duplicate database.
- **Internal Pack Studio** manages the canonical field registry and versioned profile, purpose, funding, host, route and special-circumstance packs.

### 3. End-to-end user lifecycle
1. **Account & consent** — verify email; explain ownership, core processing, optional AI extraction and sharing. Agency staff require MFA.
2. **Applicant record** — create self, family member or authorized minor/guardian relationship.
3. **Populate profile** — enter manually or upload/scan evidence; no AI is required to continue.
4. **Process evidence** — quarantine, scan, parse, classify, name and propose field mappings.
5. **Review & approve** — approve selected data, edit first, reject, link as evidence only or create a repeating record.
6. **Create mission** — destination/route, purpose, profile, funding and host; multiple missions may run in parallel.
7. **Activate requirements** — apply a published, cited and versioned pack; no silent rule update.
8. **Collaborate** — invite an agency/reviewer, accept scope, request missing evidence and exchange notes inside the mission.
9. **Assess readiness** — show coverage/consistency and remedies — never approval probability.
10. **Review & produce** — human-check generated letters/translations, compile selected evidence and lock the mission snapshot.
11. **Preview/download/share** — permitted single files, redacted copies, profile exports, bulk ZIP or application pack.
12. **Maintain/exit** — reconfirm stale facts, replace expiring evidence, revoke grants, export data or request deletion subject to retention/legal hold.

### 4. Commercial-launch scope
- Traveler groups: regular tourists, business tourists, travelling professionals and medical tourists/patient attendants.
- Initial UI languages: English and Bangla; architecture must support international names, scripts, dates, currencies and time zones.
- Global from day one: universal core plus composable packs for any country, purpose and profile.

### 5. Explicitly out of scope for v1
- Autonomous submission, visa-slot activity, approval scoring, embassy impersonation and outcome guarantees.
- Employer/law-firm/service-provider portals, official-form automation and broad marketplace features; the policy model must allow later addition.
- Sensitive offline/PWA caching and public evidence links.

---

## Page 2 — Evidence, AI and profile control

### 6. Supported intake and processing state
- Camera scan; PDF; DOCX/DOC; JPG/JPEG, PNG, WEBP, HEIC/TIFF; TXT and Markdown. Password-protected/corrupt files show a recoverable error.
- State machine: `UPLOADING → QUARANTINED → SCANNING → NORMALIZING → EXTRACTING → AWAITING_REVIEW → APPROVED / NEEDS_ATTENTION / FAILED / REJECTED`.
- Preserve original bytes, original filename, uploader, source, upload time and SHA-256 hash. The immutable storage key is never the display filename.
- Validate magic bytes, MIME/extension, size/page limits, macros/scripts, archive bombs and malware. Convert legacy formats in an isolated worker.
- Run deterministic extraction first: MRZ, embedded text, tables, dates, amounts, statement periods and metadata. OCR/model processing receives only necessary content.
- Deduplicate by content hash but allow a user to retain legitimate separate versions.

### 7. Automatic naming — approval required
- Pattern: `Document Type - Primary Subject - Issuer or Context - Relevant Date or Period [ - vN].ext`
- Examples: `Passport - Nazmus Sadat - Bangladesh - Expires 2031-04-16.pdf`; `Bank Statement - Nazmus Sadat - BRAC Bank - 2026-01 to 2026-06.pdf`.
- Normalize Unicode, punctuation, spacing and title case while preserving legal names, diacritics and approved acronym dictionary (NID, TIN, VAT, IELTS, TOEFL).
- Replace unsafe/control characters, prevent path traversal and limit display-name length. Duplicate approved names use a controlled version suffix.
- Show original name and proposed name together. User may edit before approval and rename later; each approved display name is versioned with actor/time.
- If subject/type/date is uncertain, label 'Review required'; never silently rename or infer unsupported identity.

### 8. Field-proposal review
- Each proposal contains canonical field ID, target record, current value, proposed value, normalized value, source document/version/page/region, evidence excerpt, confidence, sensitivity and effective date.
- Proposal types: `NEW`, `MATCH`, `UPDATE`, `CONFLICT`, `UNMAPPED` and `UNCERTAIN`.
- Actions: approve; approve selected; edit then approve; reject; not applicable; link evidence without changing the fact; attach to an existing repeating record; create a new record; report extraction error.
- Bulk approval is permitted only when no value is overwritten, no conflict exists and no restricted field requires individual confirmation.
- Approval commits document name, selected fact versions, evidence links and audit event atomically. Partial failure commits nothing.
- AI can only use field IDs supplied by the Schema Registry. Organization custom fields remain organization-scoped until formally promoted.

### 9. Manual editing, provenance and time
- Every field remains manually editable by an authorized user. A manual edit creates a new `FactVersion`; history is never invisibly overwritten.
- Store timestamps in UTC and display in the user's locale/time zone: `createdAt`, `observedAt`, `proposedAt`, `approvedAt`, `effectiveFrom`, `validUntil`, `lastConfirmedAt`, `updatedAt` and `supersededAt` as applicable.
- Record actor, role, method, reason, source evidence, mission context, model/prompt/schema versions and review state.
- Statuses: Declared, Extracted-Pending, Applicant-Confirmed, Document-Supported, Agency-Reviewed, Conflicted, Stale and Superseded. Avoid generic 'Verified' without a defined verifier and scope.
- Opening a field shows current value, supporting sources, conflicting sources, complete history, restore/correct controls and missions that used each version.
- A mission snapshot permanently preserves the exact fact/document/requirement versions and generated outputs used at pack or submission lock.

### 10. AI runtime policy — commercial launch
- Standard model: GPT-5.6 Terra through the server-only Responses API, using strict Structured Outputs and the lowest reasoning level that passes evaluation. Lock model configuration; use a pinned snapshot when available.
- No direct browser/provider call and no consumer ChatGPT processing. The AI Gateway enforces minimum-data selection, retention mode, task schema, prompt version, token/cost ceiling, timeout, retry limit and audit.
- Deterministic parsers remain first. Terra proposes classification, naming, field mapping, contradiction explanation and grounded drafts; it is never the system of record.
- Do not auto-downshift at launch. Introduce Luna only after task-specific benchmark parity; Sol or qualified human review requires explicit escalation for exceptional cases.
- Cache by content/input/rule/prompt hash, never rerun unchanged evidence, and stop after bounded retries. Manual workflow remains fully usable during model outage.
- Real applicant data requires reviewed business API terms, approved subprocessor/region/retention configuration and clear user disclosure; synthetic/redacted data only in development.

### 11. Requirements, readiness and production
- Pack order: Universal Applicant Core → Profile/Profession → Purpose → Funding → Host/Sponsor → Destination/Visa Route → Special Circumstance.
- Each requirement has source, jurisdiction, route, effective date, version, evidence type, applicability logic and admin approval. A weekly source-monitoring job may propose changes; only an approved version becomes visible.
- Readiness is explainable evidence coverage, validity and consistency — not likelihood of visa approval. Show missing, stale, contradictory and unsupported items with an action path.
- Generated letters/translations cite confirmed facts internally, expose unsupported claims and require applicant/authorized reviewer approval before use.
- One-click pack generation creates a document index, selected files/redacted copies, approved letters, profile snapshot and manifest/checksums. Regeneration creates a new pack version.
- The interface uses genuine job progress and recoverable errors; no fake timers or success messages before persistence completes.

---

## Page 3 — Access, trust, architecture and release

### 12. Authorization and delegation
- Authorization evaluates actor + applicant + organization membership + relationship + mission + document/category + action + purpose + time + context. Default deny.
- Actions: `VIEW_METADATA`, `PREVIEW`, `COMMENT`, `PROPOSE_EDIT`, `APPROVE_EDIT`, `DOWNLOAD_ORIGINAL`, `DOWNLOAD_REDACTED`, `DOWNLOAD_PACK`, `EXPORT_PROFILE`, `SHARE` and `MANAGE`.
- Applicant grants are explicit, accepted by the recipient, purpose-bound and time-limited; applicant can pause/revoke. Expiry and revoked membership block the next request immediately.
- Agency organization onboarding is pending until platform approval. No self-upgrade to provider status. Agency staff see only assigned applicants/missions within the granted scope.
- Support access is just-in-time, reasoned, approved, time-limited and visible to the applicant; platform admins cannot browse content by default.
- Every sensitive screen exposes 'Who can see this?' and an understandable change/access history.

### 13. Preview and download interface
- All user types receive the same permission-aware interface: approved name, original name, type, subject, issuer, date/period, version, size, pages, status, source, expiry, preview, history and permitted actions.
- Support version selection, single-file preview/download, redacted download, authorized bulk ZIP, profile export and generated application pack. Show progress and recoverable errors.
- At click time, the server rechecks effective permission and step-up authentication where required, writes the audit event, then streams or issues a short-lived operation-specific URL with `Content-Disposition` using the approved filename.
- Restricted previews may be watermarked with viewer/time. A recipient granted preview does not automatically receive original download.
- Log actor, organization, applicant, document/version, mission, grant, action, time, IP/device and result. If a required audit record cannot commit, deny the restricted download.
- Revocation prevents future access; clearly state that a copy already downloaded cannot be remotely erased.

### 14. Security and privacy
- One identity/session system; verified email, passkeys, MFA for agency/staff and step-up for sharing, export and restricted download.
- Private storage; public access blocked; quarantine and clean zones; encryption in transit/at rest and KMS-backed envelope encryption for restricted classes.
- No sensitive localStorage, service-worker/offline cache, logs, analytics payloads, email attachments or public links.
- Separate consent for core processing, optional AI extraction, sharing and marketing/case study. Provide manual no-AI path.
- User export and deletion workflow; live-system purge target within 30 days and backup expiry within 90 days, except legal hold/fraud/security requirements; final policy requires legal approval.
- Production data never copied into preview/dev. Secrets in managed vault, rotated; dependency/SAST/IaC/secret scans and rate/abuse controls in CI/runtime.

### 15. Reliability and experience
- Target 99.9% monthly availability for authenticated core; manual/profile/download core degrades safely when AI/jobs fail.
- p95 interactive API <800 ms excluding file/AI work; status appears within 2 s; typical clean ≤10-page document processes within 90 s p95.
- Idempotent jobs, bounded retries, dead-letter handling and real progress. No duplicate profile updates.
- Backups/PITR, documented RPO ≤15 min and RTO ≤4 h; restore drill before launch and quarterly.
- WCAG 2.2 AA, keyboard/screen-reader support, mobile scan quality checks, low-bandwidth behavior, English/Bangla and locale-ready formatting.
- Incident runbook, breach workflow, status communication, on-call ownership and quarterly access review.

### 16. Production baseline
- Next.js App Router + TypeScript on Vercel; server-side protected data and no-store responses.
- Neon PostgreSQL is the only canonical writable store; Drizzle ORM; reviewed migrations, row/object authorization and isolated synthetic preview branches.
- WorkOS AuthKit for users/organizations/passkeys/MFA; VisaStack policy engine remains authoritative for applicant-resource access.
- Private AWS S3 quarantine/clean buckets + KMS + versioning; signed upload/download only after VisaStack authorization.
- Durable SQS/worker pipeline for scan, conversion, OCR, AI and pack jobs; OpenAI via provider-neutral AI Gateway.
- GitHub protected main, required PR review/checks, preview deployments, migration tests, canary/smoke/rollback; Claude Code works only through scoped repository permissions.

### 17. Release acceptance gates
- 100%: no profile/document rename or fact mutation without authorized approval; no cross-tenant discovery/access; no download without effective action permission.
- Benchmark: ≥95% document-type accuracy and ≥95% precision on launch-critical identity/date fields for clean supported documents; all uncertain/high-risk fields remain review-required.
- Filename proposal accepted without edit in ≥90% of supported benchmark cases; original filename and full name history always retained.
- Permission matrix, tenant isolation, object ownership, revocation, session termination, upload security, duplicate job and snapshot regression tests pass.
- No unresolved Critical/High security findings; independent penetration test, dependency/license review, privacy/subprocessor review and threat model approved.
- Backup restore, incident tabletop, audit integrity, account export/deletion, accessibility and English/Bangla critical-path tests pass.

### 18. Delivery sequence and definition of done
1. **Foundation:** threat model, data classification, canonical schema, auth, policy engine, audit, private storage, environments and CI.
2. **Core:** applicant/family, Master Profile, manual editing/history, Vault, preview/download and account export/deletion.
3. **Intelligence:** safe pipeline, classification/naming, field proposals, approval transaction, correction dataset and cost controls.
4. **Missions:** pack engine, requirements governance, parallel Mission Workspace, readiness, review and versioned packet generation.
5. **Collaboration:** verified agencies, assignments, grants, notes, access transparency and permissioned bulk export.
6. **Launch:** closed Travel Router pilot → selected agencies → public travelers only after benchmarks, recovery and external security gates pass.

**Definition of done:** implemented, tested, documented, observable, supportable, reversible and proven against acceptance criteria — not merely deployed.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
