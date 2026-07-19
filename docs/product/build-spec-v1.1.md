# VisaStack Commercial Launch - Build Specification v1.1

**Status:** Build contract companion to the exact three-page PRD  
**Date:** 19 July 2026  
**Product owner:** OGS / VisaStack  
**Initial operating environment:** Travel Router and approved travel agencies  
**Implementation method:** Claude Code + GitHub + Vercel + Neon, with managed identity, private object storage and durable workers

---

## 0. Binding decisions

1. VisaStack is an **applicant-controlled mobility-data and evidence network**, not an agency CRM and not a ticket shop.
2. The five public modules are **Master Profile, Document Vault, Mission Workspace, Secure Sharing & Delegation, and Readiness/Review/Pack**.
3. **Agency Desk is a role-based view over the same records**, not a second database.
4. Commercial launch covers regular tourists, business tourists, travelling professionals and medical tourists/patient attendants.
5. The architecture is global from day one through a **Universal Applicant Core + composable packs**.
6. The standard launch AI model is **GPT-5.6 Terra** through a server-only provider-neutral AI Gateway. Deterministic parsing runs first.
7. AI may propose classifications, filenames, field updates, contradictions, letters and translations. It may not silently persist facts, authenticate evidence, grant access, submit applications or predict approval.
8. Every profile field and approved display filename is manually editable with immutable history, provenance and timestamps.
9. All user types may preview or download only when the effective permission grants the exact action.
10. The legacy repository is a research/failure archive only. Authentication, authorization, storage, delegation, audit and document processing are rebuilt.

---

## 1. Product promise and experience laws

### Promise
Upload once. Confirm and maintain once. Reuse across missions. Share only what is necessary, with the right person, for the right purpose and time, and revoke future access at any time.

### UX laws
- Calm, hopeful and low cognitive load; avoid fear-based labels and unexplained scores.
- Mobile-first, but fully usable on desktop by agencies.
- Show real persistence and processing states. Never use fake progress timers.
- Every error has an understandable cause, state and recovery action.
- Manual completion remains possible when AI or background processing is unavailable.
- On sensitive screens, always expose **Who can see this?** and **What changed?**

---

## 2. Actors and organization lifecycle

### Applicant / record owner
- Owns the applicant record and decides who can access it.
- May create their own profile or a family member/minor profile where authority is recorded.
- Can grant, pause, revoke, export and request deletion.

### Family manager / guardian
- Must have a named relationship and defined authority.
- Access is applicant-specific and scope-specific, not global.

### Agency organization
Statuses: `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `REJECTED`, `CLOSED`.

- An agency cannot self-upgrade into an approved provider.
- Platform approval is required before an organization can receive applicant grants.
- Membership does not expose applicant records.
- Roles may include Owner, Admin, Case Manager and Reviewer; resource permissions still come from applicant/mission scope.
- Removing/suspending a member terminates their active access and sessions.

### Agency staff / reviewer
- Sees only assigned applicants and missions covered by an effective grant.
- Can comment, propose edits, review evidence or download only if the grant includes those actions.

### Platform security/support admin
- Has infrastructure and incident responsibilities but no default browsing access.
- Any content access must be just-in-time, reasoned, approved, time-limited and visible in audit/transparency views.

### Future actors
Employer, law firm and service provider are not public-launch portals. The relationship and policy model must allow them later without schema duplication.

---

## 3. End-to-end journey

1. **Account creation:** email verification, privacy notice, terms, region/time zone/language and security enrollment.
2. **Consent:** separate records for core processing, optional AI-assisted extraction, sharing, and marketing/case-study use.
3. **Applicant creation:** self/family/minor; record relationship and authority.
4. **Master Profile:** enter manually, import previously exported data or start from documents.
5. **Evidence intake:** scan/upload; private quarantine; safety pipeline; extraction and naming proposal.
6. **Applicant review:** approve selected values, edit first, reject, link as evidence only or create a repeating record.
7. **Mission creation:** destination/route, purpose, applicant profile, funding, host/sponsor and special circumstances; multiple parallel missions supported.
8. **Requirement activation:** attach a cited, approved, versioned requirement pack.
9. **Collaboration:** invite an agency/reviewer, define scope/actions/expiry, recipient accepts, agency requests evidence and leaves notes.
10. **Readiness:** show evidence coverage, validity, consistency and concrete remedies without predicting approval.
11. **Review and outputs:** human review; evidence-grounded letters/translations; selected pack generation.
12. **Snapshot lock:** preserve exact fact, document, requirement and generated-output versions.
13. **Preview/download/share:** permission-aware document interface, single/bulk/redacted/profile/pack exports.
14. **Ongoing maintenance:** expiry reminders, stale-fact confirmation, replacement evidence and controlled reprocessing.
15. **Exit:** revoke grants, export account, close missions, request deletion and receive status.

---

## 4. Module requirements

### 4.1 Master Profile
- Canonical fields are defined in `FieldDefinition`.
- Supports single and repeating records: names, passports, addresses, education, employment, business, finances, travel history, refusals, hosts/sponsors, dependants, medical-travel data and other activated packs.
- Each definition includes data type, validation, sensitivity, applicability, pack ownership, allowed evidence types and display rules.
- Organization custom fields are namespace-scoped. AI cannot invent canonical fields.
- Current value is a pointer to an immutable `FactVersion`.
- Every field is manually editable by an authorized actor.
- Field detail shows sources, conflicts, versions, effective/valid dates, confirmation status and missions that used the version.
- Staleness rules are field-specific; users can confirm unchanged values without uploading a new file.

### 4.2 Document Vault
- Original bytes are immutable and private.
- `Document` is the logical item; `DocumentVersion` is the uploaded/generated version; `StorageObject` is the encrypted object.
- Shows approved name, original name, version, type, subject, issuer/context, date/period, source, uploader, size/pages, hash, safety status, processing status, expiry and permissions.
- Supports replacement/versioning without destroying prior mission snapshots.
- Supports duplicate detection by content hash and user decision.
- Supports preview, authorized original download, redacted download and evidence linking.

### 4.3 Mission Workspace
- A mission is a destination/route/purpose-specific workspace.
- Parallel missions are first-class.
- Contains requirements, tasks, selected evidence, requests, comments, review decisions, generated outputs and snapshot history.
- Mission state: `DRAFT`, `IN_PROGRESS`, `READY_FOR_REVIEW`, `UNDER_REVIEW`, `READY_TO_EXPORT`, `LOCKED`, `CLOSED`, `CANCELLED`.
- Closing a mission does not delete the Master Profile or Vault.
- A mission may use a fact/document version that later becomes superseded; history remains unchanged.

### 4.4 Secure Sharing and Delegation
- Grant dimensions: owner applicant, recipient person/organization, relationship, mission, category/document, action, purpose, start, expiry and constraints.
- Recipient acceptance required.
- Pause, revoke, expire and membership/session invalidation are immediate for the next request.
- Sharing never creates ownership or a hidden permanent copy.
- Applicant sees a clear access map and access/change history.

### 4.5 Readiness, Review and Pack
- Readiness is deterministic and explainable: requirement coverage, validity, consistency, evidence support and unresolved review items.
- Do not show likelihood of approval.
- Human reviewer can request information, accept evidence for a requirement, flag a contradiction and record rationale.
- Letters/translations are evidence-grounded drafts and require human approval.
- Pack output includes index, selected evidence/redacted copies, approved outputs, profile snapshot, requirement version and manifest/checksums.
- Pack regeneration creates a new version.

---

## 5. Global pack and rule architecture

Application order:

1. Universal Applicant Core
2. Profile / profession pack
3. Purpose pack
4. Funding pack
5. Host / sponsor pack
6. Destination / visa-route pack
7. Special-circumstance pack

### Pack Studio
Internal-only authoring and governance interface.

Each pack/requirement contains:
- ID and semantic version
- jurisdiction and route
- profile/purpose/funding/host applicability logic
- required or optional state
- accepted evidence types
- validity/recency rules
- source authority and citation
- source publication/effective date
- internal reviewer
- publication approval and date
- superseded version
- user-facing explanation and remedy

A weekly source-monitoring process, default Friday, may propose changes. Nothing becomes user-visible until a designated admin approves a version. Existing mission snapshots remain on their prior version unless a user deliberately upgrades.

---

## 6. Document intake and security pipeline

### Supported commercial-launch formats
- Camera scan
- PDF
- DOCX and DOC
- JPG/JPEG, PNG, WEBP, HEIC and TIFF
- TXT and Markdown

### State machine
`UPLOADING -> QUARANTINED -> SCANNING -> NORMALIZING -> EXTRACTING -> AWAITING_REVIEW -> APPROVED | NEEDS_ATTENTION | FAILED | REJECTED`

### Intake
- Server issues one-time upload authorization for an expected applicant/document and maximum size.
- Upload goes to private quarantine.
- Record original filename, uploader, source, time, size and upload checksum.
- Client claims are untrusted.

### Safety
- Magic-byte/type validation.
- Extension/MIME agreement.
- Size, page and pixel limits.
- Malware scan.
- Macro, JavaScript and embedded active-content detection.
- Archive-bomb and decompression limits.
- Corruption/password protection handling.
- Isolated conversion for DOC/legacy formats.
- Optional content-disarm-and-reconstruction for risky PDF/office documents.
- Safe copy moves to clean storage; quarantine is not previewable/downloadable.

### Deterministic parsing
Run before AI:
- MRZ and machine-readable identity zones
- Embedded PDF text
- DOCX text/tables
- Standard dates, amounts, currencies, phones and emails
- Bank-statement periods and page metadata
- Hash/deduplication
- Existing profile comparison

### Failure behavior
- Do not show success before the database transaction is complete.
- Retries are bounded and idempotent.
- User can retry, replace, download original if safe/authorized, or complete manually.

---

## 7. Automatic naming

### Pattern
`Document Type - Primary Subject - Issuer or Context - Relevant Date or Period [ - vN].ext`

### Examples
- `Passport - Nazmus Sadat - Bangladesh - Expires 2031-04-16.pdf`
- `Bank Statement - Nazmus Sadat - BRAC Bank - 2026-01 to 2026-06.pdf`
- `Employment Certificate - Nazmus Sadat - NITEX Limited - 2026-07-03.pdf`

### Rules
- AI proposes name only; user approves or edits before it becomes the display/download name.
- Preserve original filename permanently.
- Immutable storage object key is a UUID and never changes on rename.
- Normalize Unicode to NFC, spacing and punctuation.
- Preserve legal names, apostrophes, hyphens, diacritics and scripts.
- Use a governed acronym dictionary.
- Replace path separators, control characters and platform-forbidden characters.
- Limit display name to a safe length while retaining extension.
- A duplicate logical version uses a controlled `vN` suffix.
- Uncertain subject/type/date causes `Review required`, not silent inference.
- Later rename creates `DocumentNameVersion` with actor, reason and time.

---

## 8. Field extraction and approval

### AI output contract
Every proposal must contain:
- document classification and confidence
- proposed display filename components and confidence
- canonical field ID
- target applicant and repeating-record ID/candidate
- current value
- extracted raw value
- normalized proposed value
- proposal type
- source document/version/page/region
- evidence excerpt or coordinates
- confidence
- sensitivity
- observed/effective/valid date candidates
- warnings and unresolved data

### Proposal types
- `NEW`
- `MATCH`
- `UPDATE`
- `CONFLICT`
- `UNMAPPED`
- `UNCERTAIN`

### User actions
- Approve
- Approve selected
- Edit then approve
- Reject
- Not applicable
- Link evidence without changing a fact
- Attach to an existing repeating record
- Create a new repeating record
- Report extraction error
- Save for later

### Bulk approval guard
Allowed only when:
- no current value is overwritten
- no conflict exists
- all confidence rules pass
- no individually restricted field exists
- target repeating records are unambiguous

### Atomic persistence
Approved document name, selected `FactVersion` rows, `EvidenceLink` rows, current-fact pointers, confirmation and audit event commit in one transaction. Any failure rolls back all changes.

---

## 9. Fact history and timestamps

### Statuses
- Declared
- Extracted-Pending
- Applicant-Confirmed
- Document-Supported
- Agency-Reviewed
- Conflicted
- Stale
- Superseded

Do not use generic `Verified` without defining verifier, evidence and scope.

### Timestamps
Store UTC; display local:
- `createdAt`
- `observedAt`
- `proposedAt`
- `approvedAt`
- `effectiveFrom`
- `validUntil`
- `lastConfirmedAt`
- `updatedAt`
- `supersededAt`

### Change metadata
- actor/account
- acting role and organization
- method: manual/document/API/system
- reason
- source evidence
- mission context
- model, prompt, parser and schema versions
- IP/device for security-relevant changes

### Snapshot rules
Updating the current Master Profile never changes:
- a prior mission snapshot
- a prior pack
- a prior letter/translation
- a prior download manifest
- the source evidence/version used at that time

---

## 10. AI Gateway

### Standard model
`gpt-5.6-terra` as the commercial-launch standard, with the lowest reasoning setting that meets the evaluation threshold.

### Model governance
- Server-only Responses API.
- Provider-neutral task interface.
- Use a pinned snapshot when available; otherwise lock model ID/configuration and require regression evaluation before change.
- No direct client-to-provider calls.
- No consumer ChatGPT or staff copy/paste of real applicant files.
- No unrestricted agent loop.

### Request policy
Each task defines:
- purpose
- allowed data classes
- minimum input
- schema
- prompt/version
- maximum tokens and cost
- timeout
- maximum retries
- retention/storage mode
- human approval requirement
- fallback
- evaluation threshold

### Cost controls
- deterministic processing first
- relevant pages/fields only
- redact/minimize non-required identifiers
- cache by content/input/rule/prompt hash
- do not rerun unchanged documents
- batch non-urgent evaluation where appropriate
- per-document/user/org budget
- usage ledger and alerts

### Escalation
- Terra is the default.
- Do not automatically use a cheaper model at launch.
- Luna may replace specific low-risk tasks only after benchmark parity.
- Sol or qualified human review requires explicit escalation for exceptional complexity.

### Privacy
- Business API terms and subprocessor review.
- Approved region/retention configuration.
- No provider training use under the selected contract/configuration.
- Clear applicant disclosure and manual no-AI path.
- Synthetic or irreversibly redacted data only in dev/test.

---

## 11. Permission model

### Evaluation inputs
Actor, user status, organization membership, applicant relationship, mission assignment, document/category, requested action, purpose, grant start/expiry, risk context and step-up status.

### Actions
- `VIEW_METADATA`
- `PREVIEW`
- `COMMENT`
- `PROPOSE_EDIT`
- `APPROVE_EDIT`
- `DOWNLOAD_ORIGINAL`
- `DOWNLOAD_REDACTED`
- `DOWNLOAD_PACK`
- `EXPORT_PROFILE`
- `SHARE`
- `MANAGE`

### Laws
- Default deny.
- Metadata access is not implied by organization membership.
- Preview does not imply download.
- Redacted download does not imply original download.
- Mission access does not imply the whole Vault/Profile.
- Expired/revoked access fails the next server request.
- Recipient acceptance is required.
- Support/admin access is not an ordinary role permission.

---

## 12. Preview and downloads

### Common interface
Every authorized actor sees:
- approved display name
- original filename
- type
- subject
- issuer/context
- date/period
- document version
- size/pages
- safety/processing status
- source/uploader
- expiry/validity
- evidence links
- permission summary
- preview
- history
- permitted actions

### Outputs
- Single original
- Redacted copy
- Selected version
- Authorized bulk ZIP
- Master Profile export
- Mission/application pack

### Enforcement
1. User clicks an action.
2. Server re-authenticates session and step-up state.
3. Policy engine re-evaluates permission.
4. Required audit event is committed.
5. Server streams the file or issues a very short-lived operation-specific signed URL.
6. `Content-Disposition` uses the approved filename.
7. Result is logged.

### Security/experience
- Restricted previews may include viewer/time watermark.
- Bulk ZIP/pack is an asynchronous job with real progress.
- No permanent public URL.
- Revocation stops future access.
- UI clearly states that copies already downloaded cannot be remotely deleted.

---

## 13. Consent, privacy, retention and account exit

### Separate consents
- Core service processing
- Optional AI-assisted extraction
- Sharing/delegation
- Marketing/case study

### User rights/workflows
- See all active grants and access history.
- Export profile, documents, facts/history and mission manifests in human-readable and machine-readable formats.
- Revoke access.
- Request correction.
- Request deletion/closure and see progress.

### Proposed launch retention
Subject to final legal review:
- Active account data remains until the applicant deletes or policy/legal basis expires.
- Deleted items enter a short recovery state.
- Purge from live systems within 30 days.
- Backup copies expire within 90 days.
- Legal hold, fraud prevention and security evidence are separately recorded and narrowly retained.
- Organization retention cannot silently override the applicant's disclosed policy.

No sensitive files are sent as email attachments. Notifications link back to authenticated VisaStack.

---

## 14. Security and trust requirements

- Follow a formal threat model and security control matrix.
- One identity/session system only.
- Verified email.
- Passkeys supported.
- MFA required for agency, reviewer and support roles.
- Step-up authentication for sharing, profile export, original bulk download and restricted categories.
- Session list, revoke-all and device/session termination.
- Private storage with public access blocked.
- Separate quarantine and clean buckets.
- KMS-backed encryption/envelope encryption by sensitivity class.
- Secret management and rotation.
- No sensitive data in URLs, logs, analytics or error messages.
- `Cache-Control: no-store` for protected responses.
- No sensitive localStorage/IndexedDB/service-worker cache.
- Production data never copied to dev/preview/test.
- Dependency, secret, static-analysis, IaC and license scans.
- Rate limiting, upload quotas, anti-automation and abuse monitoring.
- Append-only/tamper-evident audit pipeline; restricted operations fail closed if required audit cannot persist.
- External penetration test and remediation before public launch.
- Incident response, breach assessment and applicant communication workflow.

---

## 15. Production architecture baseline

### Application
- Current stable Next.js App Router + TypeScript.
- Vercel production, staging and preview environments.
- Protected data is server-rendered/fetched; no sensitive browser persistence.
- Zod validation and standardized error envelope.

### Database
- Neon PostgreSQL is the only canonical writable data store.
- Drizzle ORM.
- Reviewed, reversible migrations.
- Production branch protected.
- Preview branches contain synthetic/sanitized data only.
- Row/object authorization enforced in service layer and tested across every resource.

### Authentication
- WorkOS AuthKit for user authentication, organizations, passkeys and MFA.
- VisaStack's policy engine is authoritative for applicant resources.
- No parallel custom session or localStorage bearer-token system.

### File storage
- Private AWS S3 quarantine and clean buckets.
- Block Public Access.
- KMS.
- Object versioning and lifecycle.
- One-time presigned upload; short-lived authorized download/stream.

### Jobs
- AWS SQS plus isolated Lambda/container workers for:
  - malware scan
  - conversion
  - OCR
  - deterministic parsing
  - AI extraction
  - pack generation
- Idempotency keys, bounded retries and dead-letter queue.

### AI
- Server-only AI Gateway.
- OpenAI Responses API.
- Structured Outputs.
- Model/task registry, cost ledger and evaluation suite.

### Observability
- Structured application/security logs without document contents.
- Sentry or equivalent error/performance monitoring.
- Job metrics, queue depth, model usage/cost, policy denials and security alerts.
- Separate append-only audit storage/sink.

### GitHub and Claude delivery
- Protected `main`.
- Feature branches and pull requests.
- Required code owner/review for auth, policy, schema, storage and migration changes.
- CI: type, lint, unit, integration, migration, tenant-isolation, policy, upload, dependency, secret and E2E tests.
- Preview deployment uses synthetic data.
- Claude Code receives repository-scoped permissions only; never bypass permissions or write directly to production.
- Canary/smoke/rollback procedure.

---

## 16. Non-functional requirements

### Availability and graceful degradation
- Target 99.9% monthly availability for the authenticated core.
- Master Profile, Vault metadata and permitted downloads remain usable when AI is down.
- Background failures expose true state and retry/recovery.

### Performance
- p95 interactive API under 800 ms excluding file/AI jobs.
- Processing state visible within 2 seconds.
- Typical clean supported document up to 10 pages completes within 90 seconds p95.
- Large jobs do not block interactive requests.

### Recovery
- RPO <=15 minutes.
- RTO <=4 hours.
- Point-in-time recovery and independent backup plan.
- Restore drill before launch and quarterly.

### Accessibility/localization
- WCAG 2.2 AA.
- Keyboard, screen reader, focus and contrast testing.
- English and Bangla launch UI.
- Locale-ready names, scripts, dates, currencies, addresses and time zones.
- Mobile camera quality guidance and low-bandwidth behavior.
- No sensitive offline cache.

### Scalability/cost
- Stateless web/API.
- Asynchronous file jobs.
- Per-tenant/user quotas.
- Cost dashboard for storage, processing and AI.
- Storage and AI adapters prevent vendor lock-in.

---

## 17. Notifications

Notify inside the product and by non-sensitive email for:
- upload completed/failed
- review required
- proposal awaiting approval
- access invitation/acceptance
- access expiry/revocation
- agency evidence request
- reviewer comment
- document expiry/stale fact
- pack ready
- security-sensitive sign-in/share/download
- deletion/export status

Email must not contain passport numbers, bank balances, medical details or files.

---

## 18. Admin and governance

### Platform controls
- organization verification/suspension
- user/membership/session management
- support access approvals
- field and pack governance
- source-update proposals and publication approval
- AI task/model/prompt/schema registry
- benchmark results
- cost and abuse limits
- audit/security investigation
- data-subject export/deletion queue
- incident and maintenance status

### Separation of duties
No single ordinary support user can both approve support access and access the data. Security-sensitive configuration changes require elevated approval and audit.

---

## 19. Acceptance criteria

### Absolute
- 100% of profile mutations and approved name changes require authorized approval or explicit manual edit.
- 100% of cross-tenant attempts are denied and logged without data leakage.
- 100% of preview/download/export actions require effective action permission at request time.
- 100% of application snapshots retain exact historic versions.
- 0 permanent public document URLs.
- 0 sensitive auth tokens/profile/document data in localStorage, service-worker cache or analytics.

### AI/document benchmark
On the approved launch dataset:
- document-type accuracy >=95%
- precision >=95% for launch-critical identity/date fields on clean supported documents
- proposed filename accepted without edit >=90%
- all low-confidence, conflicting and restricted items are review-required
- no unsupported field ID can be persisted
- no unapproved data mutation

### Security/reliability
- Tenant isolation and permission matrix tests pass.
- Upload security tests include spoofed MIME, malware fixture, macro/active PDF, corrupt/password file, oversized image, duplicate retry and archive bomb.
- Independent penetration test has no unresolved Critical/High.
- Backup restore and incident tabletop pass.
- Account export/deletion passes.
- Accessibility and English/Bangla critical paths pass.
- No production deployment if migration/rollback or smoke tests fail.

---

## 20. Delivery plan

### Phase 0 - Trust foundation
Threat model, classification, privacy/retention, schema, policy engine, auth, audit, storage, CI and environments.

### Phase 1 - Applicant core
Account, consent, applicant/family relationships, Master Profile, manual editing/history, Vault metadata, preview/download and export/deletion.

### Phase 2 - Document intelligence
Safe upload, conversion/OCR/parsing, Terra classification/naming/field proposals, approval transaction, correction feedback and cost controls.

### Phase 3 - Missions and packs
Pack Studio, versioned requirements, parallel Mission Workspace, readiness, reviewer workflow, letters/translations and packet generation.

### Phase 4 - Agencies and sharing
Organization verification, assignments, grants, access transparency, notes, requests and bulk downloads.

### Phase 5 - Controlled launch
Internal synthetic testing -> Travel Router real-data pilot -> selected agencies -> public travelers only after security, accuracy, recovery and privacy gates.

---

## 21. Deferred but architecture-compatible

- Employer portal
- Law-firm/service-provider portal
- Corporate mobility
- Official online/offline form completion
- Appointment/slot intelligence
- Settlement pathways
- Predictive intelligence that does not imply approval
- Broader marketplace/integrations
- Mobile native applications

These may not bypass the canonical evidence, permission, audit and snapshot model.
