# VisaStack Commercial V1 Product Requirements

Version 2.0 • 16 September 2026 • Product owner Nazmus Sadat • OGS and VisaStack

This document defines the first sellable VisaStack release and the acceptance standard for its implementation. It is written for the product owner, technical lead, security reviewer, QA owner and a subsequent Claude Code implementation brief. The product is a secure, reusable traveller workspace and an agency case workspace, with explainable readiness and optional AI assistance.

**Decision:** complete and harden the existing application. Preserve its canonical services, policy engine, immutable versions, migrations and tested workflows. Add the missing commercial journeys and prove them in a production-like environment before admitting real customer data.

“Production grade” means the release passes the functional, security, recovery and operational gates below. This specification does not certify the current software, guarantee zero defects, or establish compliance through wording alone. MAANG is not a product certification. Use the measurable requirements here as the engineering contract.

## 1 Authority and product boundaries

**Order of authority:** the current user instructions; this Commercial V1 scope and acceptance standard; approved implementation decisions; retained repository architecture and security invariants. Older PRDs and programme documents remain historical references. A change to this scope must identify the affected requirement IDs, migration impact and replacement acceptance evidence.

This revision deliberately supersedes the old fixed OpenAI model policy. OpenAI, Google Gemini and Anthropic Claude must be selectable from platform administration through supported adapters. AI is a required delivered capability, but using it is optional for each traveller and never necessary to complete a case.

It also narrows initial file intake to PDF, JPEG and PNG; keeps employer or issuer confirmation optional; limits public trust tools to maintained source cards; and defers a public agency ranking system. Existing stored formats and records must remain readable under their original permissions. Do not delete features, migrations or data merely because they are outside the new launch surface.

**Scope labels:** P0 is necessary for Commercial V1 acceptance. P1 is deferred and must not delay launch. A disabled P1 feature cannot be marketed as available. Security, export and essential customer control cannot be paywalled.

**Evidence labels:** Verified Fact means directly observed in repository code or GitHub metadata during this review. Repository Report means a historical claim in project documentation, not independently re-executed. Reasoned Inference means a conclusion from the inspected implementation. Design Requirement means the proposed product contract. Unknown means deployment or operational evidence was unavailable. These labels distinguish the audit from the specification.

The product does not submit applications to embassies, promise approval, authenticate a document merely by reading it, or provide an approval probability. “Submission ready” refers to the selected file and its workflow checks. It does not establish eligibility, completeness beyond a maintained rule pack, or acceptance by an authority.

## 2 Repository assessment

Reviewed repository: [sadatnitex/visastack](https://github.com/sadatnitex/visastack). Default branch: main. Reviewed commit: `2cb47e0ac91e8ce323956aff607bae9cd343e5a0`, committed 11 August 2026. Review date: 16 September 2026. The complete recursive file tree, selected implementation files, schemas, existing PRDs, blocker documents, open PR metadata and workflow jobs were inspected. No source changes, merge, deployment or production-data access were performed for this PRD.

**Verdict — Reasoned Inference:** substantial controlled-pilot implementation; commercial launch remains unproven and explicitly blocked. A percentage complete would be misleading because the remaining work includes security controls, missing journeys, provider operations and tests with different costs.

| Area | Evidence and status | Required disposition |
| --- | --- | --- |
| Application architecture | Verified Fact: Next.js App Router, TypeScript, pnpm/Turborepo, Drizzle/Postgres, WorkOS and service/policy packages exist | REUSE; patch dependencies after a current audit |
| Profiles and provenance | Verified Fact: applicant records, field registry, repeating facts, immutable fact versions and evidence links | REUSE and EXTEND; preserve portability |
| Document handling | Verified Fact: private storage adapter, bounded processing, jobs, hashes and versioned naming | REUSE; finish commercial scan, safe preview and encryption controls |
| Malware scanning | Verified Fact: commercial gate is hardcoded false; structural validation is not antivirus | REPLACE production scanner adapter; retain structural validation |
| AI | Verified Fact: only the OpenAI extraction adapter is wired; configuration comes from environment variables | EXTEND to three providers and admin-managed versioned configuration |
| AI spending | Verified Fact: current USD display converts token units at one approximate blended rate | REPAIR with model-specific reservations and usage accounting |
| Agency and sharing | Verified Fact: memberships, assignments, grants, notes and evidence requests exist | REUSE; add invitations, note visibility and operational lifecycle gaps |
| Notes | Verified Fact: mission note rows lack organisation and visibility fields; readers are mission-collaboration scoped | EXTEND; prove Agency A private notes cannot reach Agency B or travellers |
| Tasks and expiry | Verified Fact: tasks exist, but current task rows lack due-date fields; document expiry field exists | EXTEND with deadlines, editable expiry and durable reminders |
| Email | Verified Fact: `NullEmailPort` only warns and does not send | REPLACE for production; remove recipient and subject logging |
| Requirements | Verified Fact: versioned packs, citations, publication and completeness checks exist | EXTEND applicability, freshness, rule outcomes and maintained content |
| Applicant Truth Check | Verified Fact: immutable checksummed snapshots exist; no applicant acknowledgement entity is present in inspected schema | EXTEND with exact-version acknowledgement and invalidation |
| Snapshot scope | Verified Fact: current snapshot payload gathers all loaded applicant facts and documents as well as requirement mappings | REPAIR to include only the selected case disclosure; test unrelated evidence exclusion |
| Sensitive fields | Verified Fact: profile write service puts values into text fact-version fields | ADD field protection and remove plaintext copies from derived records |
| Authentication | Verified Fact: WorkOS recent-authentication and action-bound assurance code exists | REUSE; verify mandatory staff MFA and revocation live |
| Commercial controls | Reasoned Inference: operational quotas do not establish complete agency plans, billing activation or branding | EXTEND and verify entitlement enforcement |
| Recovery | Repository Report: restore procedures and targets exist; documents contain inconsistent storage and recovery assumptions | RECONCILE; restore database, objects and keys together |
| Release readiness | Verified Fact: 19 existing commercial gates include operational attestations | REPAIR gate evidence; add missing V1 gates; never satisfy by convenience flags |

The README says step-up is incomplete, while `apps/web/src/lib/step-up.ts` implements recent WorkOS authentication and action/resource-bound assurance. Treat that as documentation drift and a live-verification requirement, not proof that no step-up code exists. Recent login also does not, by itself, prove a second factor was used.

**Tests and deployment evidence.** GitHub reports the CI run for the reviewed main commit as successful. The repository reports 616 passed tests and one skipped test across 55 files; those numbers were not re-run in this review. The authenticated E2E workflow at run `31471827370` reports overall success, but the actual authenticated workspace job is skipped. Its source contains eight unconditional skipped placeholders without journey steps. This is not evidence of a passed cross-account UI test suite. Scheduled CodeQL runs inspected were skipped; an existing workflow file is not evidence of an executed scan. [CI run](https://github.com/sadatnitex/visastack/actions/runs/31471732060), [authenticated workflow](https://github.com/sadatnitex/visastack/actions/runs/31471827370).

Draft [PR 77](https://github.com/sadatnitex/visastack/pull/77) remains open. Its description reports two synthetic WorkOS identities and adds CI wiring, but says secrets, allowlisting and eight journey implementations still need work. Identity provisioning is a Repository Report here; the PR is not merged and cannot count as main-branch delivery. Inspect and reconcile it before duplicating work.

**Unknown:** current production secrets, provider plans, MFA policy, actual customer data, scanner availability, restore evidence, signed privacy terms, actual rule-pack coverage and current live UX. A historical deployment success does not resolve these. The preview failure described in repository documents remains a hypothesis until deployment logs establish its cause.

## 3 The sellable release

VisaStack must let a traveller maintain reusable evidence, see who can access it, receive useful reminders and review the exact file prepared in their name. It must let an agency collect evidence, assign work, review gaps and manage cases through closure without developer intervention.

| P0 product area | Minimum delivered value |
| --- | --- |
| Traveller account and profile | Reusable facts, current and historical passports, travel and refusal history, manual editing and provenance |
| Evidence wallet | Secure uploads, metadata, versions, review, download, selective reuse and expiry |
| Agency organisation | Approval, staff MFA, fixed roles, invitation, assignment and removal |
| Case workspace | Intake, evidence requests, tasks, deadlines, stages, shared and private notes |
| Controlled sharing | Named recipients, purpose, exact scope, expiry, acceptance, revocation and access history |
| Expiry and notification centre | In-app and email notices with retries, deduplication and visible failure |
| Rules and readiness | Versioned official-source packs, explicit unknowns, gap explanations and manual-route mode |
| Applicant Truth Check | Selected immutable snapshot, applicant acknowledgement and automatic invalidation |
| AI assistance | Document extraction, naming/classification suggestions and grounded gap explanations with human review |
| AI administration | OpenAI, Gemini and Claude adapters, model selection, secure key update, test, activate and rollback |
| Commercial operations | Plans, seats/cases/storage/AI limits, manual billing state and basic branding |
| Outcomes and feedback | Closure, refusal categories, complaint handling and private case-linked feedback |
| Public trust | Source-backed route, fee/channel cards and a short scam-warning checklist |
| Privacy and support | Export, deletion, retention, controlled support access and incident ownership |
| Release operations | Monitoring, tested recovery, tenant tests, independent security review and deployment rollback |

**P1:** issuer-confirmation sending/response UI; public agency reviews or rankings; native apps; WhatsApp/SMS; online subscriptions and payment gateway; agency custom domains; advanced redaction editor; arbitrary file conversion; official-form filling; broad generated letters/translations; corporate/university portals; booking; vector database; open-ended immigration chatbot; advanced fraud models; autonomous submission; multi-region active-active infrastructure.

Retain existing grounded-output code only where independently safe; it can remain disabled. Retain generic issuer/provenance extension points without building an issuer network now. No employer contact is required to use V1 or reach ordinary case readiness.

**Commercial assumptions to validate:** agencies will pay for less document chasing and more reliable control; travellers value safe reuse; operating cost and support effort remain low enough for the selected price. These are assumptions, not established demand or traction. Price and numerical plan allowances are editable launch decisions, not fabricated market facts.

## 4 People ownership and access

Use one identity and one canonical traveller record. “Case” is the customer-facing label for the existing `Mission`; do not create a competing Case table merely to rename the interface. A person may own a profile and work for an agency, but must choose a clear context. Agency membership never grants blanket access to that person's private wallet.

| Actor | Permitted scope | Restrictions |
| --- | --- | --- |
| Traveller | Own profile and evidence; own cases; grant/revoke; acknowledge; export | Cannot see agency-private notes or other people's private evidence |
| Guardian or authorised representative | Explicitly delegated subject and actions | Relationship and authority recorded; no household-wide default access |
| Agency owner/admin | Organisation setup, membership, billing and case allocation | Traveller content still needs an effective grant; no silent ownership transfer |
| Case manager | Assigned cases and permitted evidence; requests, tasks, proposals | Cannot approve as the traveller or publish global rules |
| Reviewer | Assigned review, requirement decisions, release recommendation | Cannot invent issuer verification or bypass acknowledgement |
| Read-only agency member | Assigned cases within granted view scope | No edits, exports or downloads unless individually authorised |
| Contributor | Only the named contribution request | No case browsing or whole-profile access |
| Platform admin | Configuration, approved organisations, rules and operational metadata | No default right to read passport or financial contents |
| Support operator | Time-limited, reasoned, approved support grant | Audited, visible and revocable; no silent impersonation |

**IAM-01 — Account and identity.** Use managed authentication and verified email. Require MFA for every agency, reviewer, support and platform-admin context, including users with multiple roles. Enforce this on the server, not only in the login UI. Traveller MFA is supported and encouraged. Recovery must not let a helpdesk bypass staff MFA without a documented, independently authorised process. Step-up within five minutes is required for new grants, original/bulk export, credential changes and privileged actions; sensitive staff actions require the configured MFA assurance as well as recency. Enforce session expiry server-side: initial staff limits are 30 minutes idle and 12 hours absolute; traveller sessions expire within seven days, with sensitive actions still requiring fresh step-up. Session/account suspension and membership removal take effect on the next authorised request.

**IAM-02 — Organisation onboarding.** An agency submits its name, business contact and basic organisation evidence, then waits for platform approval. Approval means checked against VisaStack onboarding criteria, not government accreditation or guaranteed service quality. Invite members with expiring, recipient-bound tokens; acceptance confirms the intended account. Fixed roles only in V1. Prevent removal of the last active owner unless ownership is transferred or the organisation is closed.

**IAM-03 — Inviting a traveller.** An agency may create a minimal pending client invitation containing a name, contact, requested route and owner. It may not create an applicant-owned account by asserting someone else's email, claim an existing wallet, or preload sensitive documents without authority. On acceptance, the traveller authenticates, chooses an existing or new profile, sees the purpose and scope, and explicitly grants access. Existing-account invitations must not reveal whether an email is registered. Unaccepted invitations expire after seven days by default; the agency can revoke/reissue. Sensitive-data collection starts only after account acceptance or a separately validated representative relationship.

**IAM-04 — Subject relationships.** Preserve the existing family/guardian model, with explicit authority and separate subject IDs. No adult becomes managed by a relative solely because the email or surname matches. V1 family cases remain separate linked cases with a shared itinerary reference; household permissions never replace per-subject authorisation. A guardian's final acknowledgement records both actor and represented applicant.

## 5 Traveller profile and evidence

**PRO-01 — Master Profile.** Support identity and contact; nationality/residence; multiple current/historical passports; addresses; family basics; education; employment/self-employment; sponsor context; basic financial declarations; travel history; visas and refusals. All sections are optional until a case requirement needs them. Never ask for bank-login credentials. Legal names preserve user-confirmed Unicode and original spelling. Use date-only values for birth, issue and expiry dates, ISO currency codes with decimal amounts, and UTC instants for events.

**PRO-02 — Facts and revisions.** Reuse `FieldDefinition`, `Fact`, `FactVersion` and `EvidenceLink`. Agency and AI edits are proposals until the traveller or expressly authorised delegate confirms the portable fact. Reviewer acceptance of evidence is a separate decision. Each approved value retains source, author, method, version, observation/effective dates and confirmation state. Conflicting values create a review task; they never silently win by recency. Reverting a value creates a new version. Preserve more than one employer, passport or bank record without overwriting unrelated instances.

**EVI-01 — Intake.** New uploads accept PDF, JPEG and PNG, including mobile camera images. Initial configurable limits: 20 MiB per original, 50 PDF pages, 40 megapixels per image and 10 files per user batch. AI processes at most 25 pages per document by default; a document can remain valid for manual handling beyond its AI limit. Server limits, storage quotas and upload reservations are authoritative. Reject encrypted/password-protected PDFs with a clear request for an unlocked copy; do not store passwords. Reject corrupt or unsupported formats with recoverable guidance.

**EVI-02 — Safe pipeline.** Reserve quota and issue a single-purpose upload authorisation. Store in quarantine with an opaque key. Verify actual length, hash, extension/MIME/magic bytes and object ownership; scan with a real malware engine; perform bounded parsing and create a safe preview rendition in an isolated worker; then release the approved original under policy. A timeout, unrecognised scanner result or unavailable scanner stays quarantined. Nothing quarantined reaches previews, exports or AI. Recheck the exact object version/hash after processing so replacement between scan and use cannot pass. Delete abandoned upload objects and reservations after 24 hours.

Maintain separate scan, preview, extraction and human-review states. A failed AI run must not mark a safely scanned original unusable. A clean scan means the scanner found no threat; it is not a guarantee that the document is genuine or harmless under every parser. Use safe rendered previews with active content removed; originals are explicit downloads, never an untrusted inline PDF shortcut.

**EVI-03 — Metadata and versions.** Store type/category, display and original filename, subject, issuer, issue/expiry date, statement period, source/uploader, byte length, page count, cryptographic hash, exact storage version, scan evidence and supersession links. Auto-naming is a proposal until approved. Document review supports pending, accepted, replacement required, irrelevant and disputed. A replacement creates a new immutable version and notifies affected open cases. It never silently changes an acknowledged packet. Duplicate detection is limited to the authorised subject/scope; do not reveal cross-customer hash matches.

**EVI-04 — Wallet and reuse.** Show current, expiring, expired and superseded documents; where each version is used; and who has access. A new case reuses explicitly selected valid versions. An agency cannot browse unselected wallet contents to find something useful. Passport renewal updates the wallet, preserves the old passport and flags cases using it; it does not mutate historical snapshots.

**EVI-05 — Assurance.** Display separate statements: applicant declared; document supplied; named machine checks performed; agency reviewed; issuer confirmed if evidence supports it. E0/E1/E2/E3 may be internal labels, but E2 is never proof of authenticity and must list checks and date. Checks can fail or expire. E3 requires a recorded issuer identity/contact method, exact claim, response, date and validity, not a staff checkbox claiming verification. Lack of E3 is not a general readiness failure.

**EVI-06 — Preview and download.** Re-evaluate actor, account, membership, assignment, grant, subject, version, action, purpose, time and step-up before issuing bytes. Use an authenticated streaming endpoint or application-bound signed token with a maximum 60-second lifetime, rechecked at redemption. Never expose a reusable upstream storage bearer URL. Use no-store responses, nosniff and appropriate content disposition. Downloads receive the approved safe display name. Preview and original-download permissions remain distinct; do not promise that a visible image cannot be copied or photographed.

## 6 Agency cases and collaboration

**CAS-01 — Case creation.** Select traveller, destination, jurisdiction/consular context, service category, trip purpose and dates, agency owner, assigned manager and target deadline. Bind an explicit traveller grant. Support independent traveller cases and agency-managed cases through the same underlying mission services. Unsupported routes operate in manual-checklist mode with the coverage limitation visible on the case and export.

**CAS-02 — Workspace.** Present the next required actions, outstanding requests, overdue tasks, approaching dates, review issues, readiness result and acknowledgement status together. Search only authorised clients/cases using name, case reference, stage, destination and assignee. Do not build passport-number global search or expose protected values in result snippets. List queries and counts obey the same object rules as detail pages.

**CAS-03 — Evidence requests.** A request names case, requirement, information/document type, explanation, due date, requester and responsible recipient. States: OPEN, RECEIVED, UNDER_REVIEW, ACCEPTED, NEEDS_REPLACEMENT, CANCELLED. Successful upload and clean processing can mark it received; only review can accept it. Malware, failed upload or an unrelated document cannot close a request. Replacements retain the prior decision and reason. Reuse a valid wallet document without requiring another upload. Custom agency requests must be labelled agency requests, not official immigration rules.

**CAS-04 — Tasks and appointments.** Add an assignee, due instant or local date with explicit time zone, priority, status and completion history to existing tasks. States: OPEN, IN_PROGRESS, DONE, CANCELLED; overdue is derived. Store appointment place/channel and local time; provide add-to-calendar download without calendar integration. Reassignment and deadline changes produce audit events and update scheduled alerts. Prevent removed members from remaining the only owner of active cases; queue reassignment.

**CAS-05 — Notes.** Require visibility at creation: AGENCY_INTERNAL or TRAVELLER_SHARED. Internal notes have a mandatory author-organisation ID; a grant to Agency B cannot expose Agency A notes. Shared notes are readable only within the case grant and by the traveller. No bulk toggle may publish old private notes. Treat existing unclassified notes conservatively as legacy restricted until ownership/visibility is resolved; do not automatically expose them to a new audience.

**CAS-06 — Review.** Reviewers accept or request replacement of selected evidence, record contradictions and propose corrections. An organisation may require a reviewer different from the preparer; if enabled, the server enforces it. Small agencies may operate without separation, but the record must not imply an independent review. An independent traveller can self-review their own case, labelled self-reviewed. A reviewer cannot acknowledge the file on behalf of the applicant merely because they manage the case.

**CAS-07 — Outcome and complaint.** Record actual submission date/channel and packet reference only when a user confirms an external submission occurred. VisaStack has not observed embassy submission. Close with approved, refused, withdrawn, cancelled or other; record decision date and optional decision evidence. Refusal categories preserve original wording in restricted evidence and mark agency interpretation separately. Support one case complaint with description, owner, status and resolution history. A private post-case feedback form is linked to a real case and visible to authorised quality staff; it is not a public endorsement. Suppress sensitive narrative from aggregate analytics.

**CAS-08 — Contributor request.** An authenticated sponsor/family contributor receives a narrow request and can submit only the named evidence. A seven-day, single-use invitation plus email verification binds the contributor. The recipient sees purpose, intended recipients and retention before upload. The file is case-scoped by default and is not copied into the traveller's reusable wallet without contributor permission. This reuses invitation and grant services; no household portal is required. The workflow must tell the contributor when the applicant's final-file review will expose the document; do not promise private sponsor material that the acknowledged packet actually includes.

## 7 Sharing and consent

**SHR-01 — Grant lifecycle.** Traveller or explicit delegate chooses named recipient account/approved organisation, case/purpose, fact/document versions or categories, allowed actions, start and expiry. Default duration is 30 days; maximum initial duration 90 days. Recipient acceptance is required; renewal is an explicit action. Never infer a grant from agency membership, payment or a matching email. Categories do not automatically include future documents by default; expanding scope requires a displayed confirmation.

**SHR-02 — Enforcement.** Grants move PENDING_ACCEPTANCE to ACTIVE to PAUSED, REVOKED or EXPIRED. A paused grant may resume only within its original validity. Revoked or expired grants cannot silently reactivate. Removal of a member, termination of an organisation, or suspension of an account denies the next request even with a previously issued token. Revalidate every item at export generation and download; if any intended item becomes unauthorised, fail the export with a clear message rather than silently delivering an incomplete final packet.

**SHR-03 — Control and disclosure.** Show recipient, reason, scope, expiry, accesses and revocation controls. A revocation prevents future platform access, including new downloads; it cannot erase previously downloaded copies. Cancelling an agency relationship cancels pending agency jobs and reminders that would use the revoked grant. No sensitive evidence in ordinary email attachments. Third-party sharing requires authenticated named recipients in V1; an anonymous link to passport/financial documents is out of scope.

**SHR-04 — Consent.** Keep optional AI processing, sharing, marketing and external issuer contact separate. Record notice/purpose version, actor, subject, scope, timestamp and withdrawal. Core service legal basis must be documented in the privacy review rather than treated as a universal consent checkbox. Withdrawal prevents new optional processing; recheck before dispatch and before persisting AI results. Show what already occurred and any disclosed provider retention. A new provider/data-use policy outside the previously authorised scope requires renewed permission; provider switching cannot silently broaden disclosure.

## 8 Expiry deadlines and notifications

**NTF-01 — Expiry centre.** Track passport and visa expiry, document validity, evidence freshness and any recorded verification expiry. Distinguish an intrinsic expiry date from case-specific staleness: a bank statement can remain in the wallet while being too old for a particular requirement. Store the rule version behind staleness. Default expiry intervals are 90, 60, 30 and 7 days plus the expiry date; allow per-type configuration and user opt-out from nonessential reminders. Unknown expiry stays unknown until confirmed.

**NTF-02 — Event notifications.** In-app and email cover invitations, evidence requests/replacement, deadlines/appointments, material status or readiness changes, final review, acknowledgement invalidation, rule-pack impact and account/security changes. Agency notices go only to currently authorised assigned members or designated owners. Email contains a neutral action message and authenticated deep link, not passport numbers, refusal text or medical/financial facts.

**NTF-03 — Delivery.** Commit the domain change and an outbox entry together. Workers deliver idempotently using event/recipient/channel/threshold keys. Store queued, sent, delivered when provider-confirmed, bounced, failed and read where applicable; do not equate accepted by provider with read. Retry transient failures at most five times over 24 hours with backoff. Permanent bounces stop email retries and remain visible in-app. Verify webhook signatures and event IDs; replay is harmless. Admin can inspect failure metadata and retry without seeing sensitive content.

**NTF-04 — Timing.** Evaluate dates in the subject's configured time zone; default Asia/Dhaka at onboarding, editable. Use local-date thresholds so daylight-saving shifts do not duplicate reminders. Due tasks default to 7 days, 1 day and overdue, with bounded weekly overdue follow-up rather than daily spam. Replacement, cancellation and revocation invalidate pending obsolete reminders. After a scheduler outage, recover still-relevant notices without flooding users with every missed threshold. Target event notice enqueue within 60 seconds, email handoff within five minutes and date-based checks at least hourly.

## 9 Requirements and readiness

**RUL-01 — Coverage.** Core software is country-agnostic. Initial content target is two maintained packs: Bangladesh-resident Bangladeshi applicants for UK Standard Visitor routes, and France-anchored Schengen short stay. These are recommended starting assumptions, not a claim that their rules are already verified or a restriction on manually managed destinations. The product owner may substitute packs before content freeze without changing the engine. Public launch requires at least two complete, reviewed packs; do not advertise a third until it passes the same gates. Schengen common rules and country/consular implementation remain separate.

**RUL-02 — Rule record.** Each version carries jurisdiction, nationality/residence applicability, route/purpose, source URL/title/publisher, official requirement text or bounded source extract, separate VisaStack interpretation, source type, observed/reviewed/effective dates, next-review date, rule owner, reviewer, condition, expected evidence, severity, freshness policy and change reason. Statuses are DRAFT, REVIEWED, PUBLISHED, SUPERSEDED, WITHDRAWN. Published manifests are immutable and checksummed. A reviewer distinct from the author approves public authoritative packs; agency custom checklists stay visibly separate.

**RUL-03 — Evaluation.** Use a typed declarative rule AST/JSON model with allowlisted operators for existence, equality, membership, date comparison, duration and numeric bounds. No eval, arbitrary JavaScript, remote scripts or arbitrary URL fetching during evaluation. Missing facts evaluate UNKNOWN, not false or satisfied. Handle conflicting source versions explicitly; do not silently pick the newer page. Cross-field checks include inconsistent name/passport selection, date ordering, insurance coverage dates and multiple conflicting current facts. Names with transliteration differences should request review, not declare fraud.

**RUL-04 — Result model.** Each requirement returns SATISFIED, ATTENTION, CRITICAL_GAP, UNVERIFIED, CONFLICTING, EXPIRING_STALE or NOT_APPLICABLE, with reasons, evidence versions, rule version, source freshness and next action. These describe requirements; overall readiness separately states MANUAL_ONLY, NEEDS_ACTION, NEEDS_REVIEW or READY_FOR_APPLICANT_REVIEW. Do not average away a blocking requirement. Optional source confirmation is informational unless a reviewed official rule explicitly requires it.

**RUL-05 — Content maintenance.** Review launch sources weekly and at official change notifications. Set next-review dates per rule, initially no more than 30 days apart. Overdue, withdrawn or inaccessible authoritative content produces a visible freshness warning; an affected mandatory rule cannot be labelled current and satisfied without qualified review. Version changes create impact notices for active cases, show a diff and require explicit adoption or a recorded reviewer decision. Before final readiness, relevant withdrawals/effective changes must be resolved. Old assessments and submitted packets retain the versions used. Automatic crawling is not P0; an admin review queue is enough.

**RUL-06 — Public Trust Lite.** Publish maintained route descriptions, official sources, official fees/currencies and effective dates, authorised channels and agency service-fee separation. If an amount is unverified or stale, show the official link without an invented number. ScamShield Lite is a checklist of warning signs and official reporting links; no definitive fraud accusation, automated external-site fetch or domain reputation score. No forced Travel Router lead capture, claimed embassy endorsement or default preference for the founder's agency.

## 10 Applicant Truth Check and case state

**TRU-01 — Final disclosure.** Generate a snapshot of selected fact versions, selected document versions/hashes, relevant route/rule versions, reviewer decisions, approved included outputs and unresolved disclosed limitations. Exclude unrelated wallet contents, internal notes and hidden agency material. Provide a human-readable review view, a downloadable manifest and the exact evidence bundle intended for external use. Agency preparation actions require the corresponding grant; the applicant sees everything they are being asked to acknowledge.

**TRU-02 — Acknowledgement.** Create a distinct immutable record containing subject, acknowledging actor/authority, snapshot ID, checksum, material revision, acknowledgement-text version, time and authentication context. Record acknowledgement, not an invented legal digital-signature status. Use step-up. Allow reject/request correction with a reason. A reviewer clicking “complete” is never applicant acknowledgement. On-screen acknowledgement text states that the applicant reviewed the specific version to the best of their knowledge; it must not waive complaint rights or claim visa approval.

**TRU-03 — Atomic validity.** Maintain a monotonically increasing case material revision. Snapshot creation reads selected facts/evidence/rules under one consistent database transaction or validated revision guard. Acknowledgement locks/checks the same revision and snapshot hash. Every material mutation increments the revision and invalidates current acknowledgement in the same transaction; a simultaneous acknowledgement must fail with a refresh request. Submission-ready packet issuance rechecks validity, expiry, grants and scan state at use time. Historical snapshots and own-data exports remain downloadable under current access policy, clearly labelled historical where appropriate; an expired document must not prevent legitimate portability. Hashing alone is not an authenticity or access-control mechanism.

Material changes include selected fact values, selected document bytes/version/removal, included output text, itinerary, destination/purpose, applicable requirements or resolved review decisions that change the disclosed file. Internal notes, assignment and harmless display sorting do not invalidate it. Superseding a selected passport or expiring evidence marks the case dirty and blocks final use until reviewed, even if the old immutable snapshot still exists. A submitted packet stays immutable; a later correction creates a new amendment version and never rewrites history.

**TRU-04 — Snapshot versus sent file.** Label the artifact “Applicant-acknowledged prepared file.” Record “submitted” only on an attributable external-submission report with date/channel and packet reference. If an agency alters the file outside VisaStack, VisaStack cannot attest that the altered file was acknowledged. Exports contain a manifest to compare the submitted evidence set. Acknowledgement does not imply that an embassy received anything.

| Canonical case state | Entry condition | Permitted next state |
| --- | --- | --- |
| DRAFT | Case created with subject and authority | INTAKE or CANCELLED |
| INTAKE | Requests/tasks active | IN_REVIEW or CANCELLED |
| IN_REVIEW | Evidence assessed; reviewer identified | INTAKE, AWAITING_APPLICANT or CANCELLED |
| AWAITING_APPLICANT | Selected snapshot ready; known blockers resolved | SUBMISSION_READY on valid acknowledgement; otherwise IN_REVIEW |
| SUBMISSION_READY | Current valid acknowledgement and final gates | SUBMITTED on reported external action; IN_REVIEW on material change |
| SUBMITTED | Submission report tied to immutable packet | CLOSED; amendment creates a linked review cycle |
| CLOSED | Outcome recorded | New linked case only |
| CANCELLED | Cancellation and access/retention consequences recorded | New case only |

Map legacy `IN_PROGRESS`, `READY_FOR_REVIEW`, `UNDER_REVIEW`, `READY_TO_EXPORT` and `LOCKED` through an additive migration. Do not convert historical `LOCKED` rows into acknowledged or submitted cases without evidence. Mark them legacy locked and require a real acknowledgement before any new submission-ready claim. Retain raw legacy state in migration history.

## 11 AI that the owner can manage

**AI-01 — Delivered tasks.** P0 supports extracting draft fields from clean supported documents, suggesting document type/name, flagging possible inconsistencies and explaining an existing deterministic gap. Each task has its own configuration, input schema, output schema and evaluation set. Explanations receive only authorised case facts and the actual rule result/source; unsupported legal conclusions must be refused. No autonomous tools, browser actions, messages, payment, issuer contact, document submission or database-write authority is given to a model.

“ChatGPT” in the admin selector means OpenAI's API models, not a consumer ChatGPT session. The product uses authorised business API accounts. Each provider has different authentication, payloads, capabilities and retention controls. A URL replacement alone cannot make every model interchangeable. Implement the adapters once; normal switching among validated models then requires no code change or redeployment.

**AI-02 — Administration journey.** Platform admin completes MFA/step-up, opens AI Settings, chooses provider, enters a write-only API key, chooses or types an account-accessible model ID, selects task(s), sets limits and data policy, saves a draft, runs a synthetic connection test and task evaluation, then activates. The admin sees validation failures and retains the prior active version until the replacement passes. Model list discovery is optional convenience; manual model-ID entry plus capability validation is required. No hardcoded catalogue is the sole source of truth.

Activation atomically changes the task configuration version. New jobs use it within 60 seconds; already-dispatched jobs retain their original provenance. The emergency disable switch is checked again immediately before any outbound call, so queued jobs stop even if their configuration was pinned earlier. A rollback restores the last eligible known-good version. Revoked secrets or unapproved data policies cannot be restored by rollback. Agency admins cannot change the platform's provider or view platform keys.

| Admin setting | Required behaviour |
| --- | --- |
| Provider | OPENAI, GOOGLE_GEMINI, ANTHROPIC; optional vetted compatible endpoint |
| Model ID and capabilities | Text, image/PDF support, schema support, context/input/output limits, allowed task types |
| API secret | Write-only update, masked fingerprint, verification status, rotation and revocation |
| Endpoint | Official default locked for built-in providers; vetted custom origins only |
| Data policy | Permitted classifications, reviewed retention/region, notice/subprocessor policy version |
| Task routing and parameters | One active provider/model version per task; validated output limits and supported reasoning/temperature settings; explicit permitted fallback or none |
| Spend and usage | Platform and organisation monthly limit, per-job limit, tokens/pages and concurrency |
| Reliability | Timeout, bounded attempts, circuit-breaker status, operational disable |
| Quality | Last synthetic evaluation, sample size, errors, release eligibility and timestamp |
| Change history | Actor, reason, configuration diff without secrets, version and rollback target |

**AI-03 — Gateway contract.** Extend the existing `AiExtractionPort` instead of creating a second AI path. Built-in adapters use the current official provider APIs and supported structured-output subset. Normalised request: task, schema version, configuration version, subject/case scope, authorised minimal content, allowed fields, locale, input hash, job ID, maximum output and deadline. Normalised result: typed draft proposals, exact source references, provider/model/request ID, usage, timings, refusal/error classification and configuration/prompt/schema versions. Validate locally with a strict schema and field allowlist even if the provider claims structured output. Refusal, truncation, missing usage, unsupported parameters and schema failure are explicit outcomes.

A model lacking required vision/PDF or schema capabilities is ineligible for that task. A newly compatible model may be added through the admin panel after testing. A provider with an incompatible protocol needs an adapter and deployment. “Any model” therefore means any authorised model that passes the declared adapter/task contract; the UI must not claim universal compatibility.

**AI-04 — Evidence grounding.** Every proposed field includes target field/record, proposed and existing value, source document version, page or text-span location, evidence snippet, confidence indicator and review state. A deterministic text pipeline must verify that snippets exist in extracted source. Image-derived text must identify a page/region for human inspection. Unsupported values become uncertain/unmapped or are rejected. Model self-reported confidence is not a calibrated probability; display it as a heuristic unless benchmark calibration establishes otherwise. Never imply 0.99 means 99 percent truth.

Approve, edit-and-approve, reject, link-as-evidence and choose/create repeating record reuse canonical profile services. High-risk identifiers and conflicts require individual review. Human approval, fact-version creation, evidence links and audit commit atomically. Neither high confidence nor an agency setting can silently commit consequential fields. AI suggestions must not increase issuer assurance.

**AI-05 — OCR and scanned documents.** Images and scanned PDFs need a real text-extraction path; the existing embedded-text adapter is insufficient. After scan/safe rendering, use an approved OCR component or an approved vision-capable configured model. Send only selected pages at bounded resolution. Show low quality, missing text, unsupported script or ambiguous dates as review issues. Manual entry is always available. Bank tables and multilingual documents beyond the evaluated set remain assistance-only; do not market universal OCR accuracy.

**AI-06 — Data boundary.** Route data only after checking authority, consent, classification and provider-policy eligibility. The gateway sees only the selected document/pages or facts needed for the task. No entire-wallet prompt, cross-tenant prompt assembly, shared applicant cache or default external conversation history. Model context is not retained as an open-ended chat transcript. Treat text inside documents and external rule sources as untrusted data, including instructions to reveal keys, change rules or call URLs. No tool execution or external URL retrieval is enabled by document contents.

**AI-07 — Credentials and endpoints.** Store API keys through a secret-store reference or KMS-backed encrypted secret record; decryption permission is limited to the server gateway. Admin responses, logs, exports, analytics and client bundles contain no key. After save, return only a fingerprint. Audit access/change metadata, not secret content. Require reauthentication for changes. Official adapters cannot send their keys to a different host. A custom endpoint must be HTTPS on an approved public origin; reject credentials/query tokens in URL, loopback, link-local, metadata, private/reserved addresses, non-HTTPS ports and redirects. Enforce network egress restrictions and revalidated DNS/IP rules at connection time, including IPv6 and DNS rebinding. No arbitrary “test this URL” server fetch.

**AI-08 — Cost control.** Record input, output, cached and other billed units separately, price version, currency, estimated reserved cost and reconciled cost. Do not apply one dollar-per-million blended rate to all models. If pricing or usage is missing, label cost unknown and block further paid dispatch until bounded accounting is restored. Before dispatch, atomically reserve a conservative worst-case cost under platform, organisation and per-job caps; include retry/fallback liability. Concurrent jobs must not exceed available budget by racing the same balance. Reconcile against actual provider usage and invoices; provider-side account limits provide an additional boundary, not a promise that billing can never lag.

Initial operational defaults are two total attempts per job, a 60-second request timeout, at most 25 pages and five concurrent model calls platform-wide. Budget amounts must be explicitly set before enablement; unset does not mean unlimited. A maximum 0.50 USD per extraction job is a proposed starting cap, not a cost forecast. Warn at 80 percent of configured monthly budget and pause paid dispatch at the enforced ceiling. Cache only within the same subject/authorisation scope using provider, model, prompt, schema, input hash, consent-policy version and task configuration. Recheck current access before cache use. A corrected or superseded document invalidates the relevant cache key.

**AI-09 — Failure and fallback.** On timeout, rate limit or circuit-breaker opening, return a recoverable state and preserve manual work. Do not retry authentication errors, invalid input or consent failures. Avoid automatic cross-provider fallback by default. An enabled fallback must already pass the same data-policy, task-quality and budget gates; changing provider must not bypass a refusal by trying until a desired answer appears. UI names the provider used and any fallback. Uncertain in-flight provider outcomes retain their budget reservation until reconciled, instead of treating a timeout as zero cost.

**AI-10 — Evaluation.** Each of the three shipped adapters passes synthetic live connection, schema, refusal, timeout, budget and privacy contract tests. Each activation uses a task-specific labelled set of at least 50 representative documents/pages, with Bangladesh-relevant names, dates, English/Bangla, clear scans, poor scans, conflicting fields and hostile embedded instructions. Measure precision and coverage separately: initial release target is at least 95 percent precision on proposed critical identity/date fields in clean supported samples, at least 80 percent coverage of labelled extractable critical fields and at least 95 percent document-type accuracy. Report sample counts and per-field errors, not only aggregate averages. Missing/blurred cases must abstain appropriately. These are minimum launch gates on a bounded set, not population accuracy claims. Every consequential value remains human-reviewed.

The three adapters must be delivered and tested before V1 acceptance. Only one needs to be active for customer traffic. If operating funds permit only one provider's paid account, untested adapters remain explicitly unverified and the three-provider requirement is not complete.

**Provider policy references.** OpenAI documents API training and retention controls; `store:false` does not by itself establish zero retention across all mechanisms. Google distinguishes paid-service data treatment from unpaid services and tells users not to submit sensitive personal information to unpaid services. Verify the actual organisation/project, endpoint and contractual terms before enabling real documents. Claude and Gemini support structured-output mechanisms, but schema support and task capability still need adapter validation. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data), [Gemini terms](https://ai.google.dev/gemini-api/terms), [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## 12 Commercial controls and operational admin

**COM-01 — Plans.** Provide Traveller Free and manually activated Agency Starter/Pro templates. Entitlements are data, not hardcoded UI conditions: active seats, cases created per billing period, concurrent open cases, total retained storage and AI allowance. Show each meter and its definition. Historical case access, necessary retention, privacy requests and own-data export remain available after subscription lapse. A plan change never grants access to another person's information.

**COM-02 — Enforcement.** Atomically enforce limits in services and jobs, including invitation acceptance and simultaneous uploads. Reserve storage before upload and reconcile abandoned objects. Plans have effective dates; downgrades warn and stop new capacity-consuming actions after a configured grace period without deleting evidence. Suspended billing blocks new paid work while preserving secure read/export and essential case-history access under valid grants. Platform admins may make reasoned, expiring commercial overrides, but cannot bypass consent, security or release gates.

**COM-03 — Manual billing.** Store price/currency, billing period, invoice reference, invoiced amount, due date, collected amount/date/reference and status. States: TRIAL, ACTIVE, GRACE, SUSPENDED, CLOSED. A salesperson's “committed” status is not payment. No card handling, tax engine or automated accounting is required. Preserve the distinction between invoiced revenue and cash collected. This is subscription administration, not a full agency CRM.

**COM-04 — Agency branding.** Approved logo, agency name and one accessible accent colour with “Powered by VisaStack.” Branding applies to invitations and the agency-context portal. No arbitrary HTML, CSS or third-party scripts. Logo uploads use the safe image pipeline. Agency A branding must never appear inside Agency B's authenticated workspace. The independent traveller wallet retains VisaStack identity.

**ADM-01 — Admin workspace.** Manage organisation approval, accounts/suspensions, role assignments, packs, AI settings, plans, quotas, notification failures, job failures, deletion requests, retention holds and release evidence. Show operational metadata by default. Document-content access requires a separate support grant and step-up. Provide a searchable audit view without storing decrypted sensitive values in search indexes. Admin authority is server-owned and cannot be self-granted through profile fields.

## 13 Architecture and data contract

Use the existing modular monolith. Keep Next.js UI/API, canonical services, policy engine, Drizzle migrations and Postgres. Use a durable job table/outbox and one isolated worker deployment for malware scanning, rendering, OCR/AI, exports and deletion. Reuse job leasing/retry code. Do not add Kafka, Kubernetes, a second database of record, a vector database or multiple feature microservices for V1.

WorkOS remains the identity provider unless a concrete capability/cost failure is documented. Private object storage remains behind the existing port. Keep Vercel Private Blob if its production access, restricted-document encryption, recovery and deletion requirements are demonstrably satisfied. Otherwise replace only that adapter with an approved S3/KMS implementation. Do not migrate storage on brand preference; do not pretend credentials alone prove backup or key recovery. A ClamAV-based isolated worker or an approved private scanning service supplies real malware scanning; record engine/signature freshness and deny release when the configured maximum age is exceeded, initially 24 hours.

The web process cannot run unbounded rendering/scanning inside a request. It submits a durable job and presents real status. Workers fetch the exact version, recheck authority where disclosure occurs, use encrypted temporary storage, have bounded resources and no unnecessary network access, and remove temporary files. Job payloads carry identifiers rather than raw documents/secrets. Authorised provider calls go through the gateway. Verify the existing hosting plan permits commercial activity: Vercel documents Hobby as restricted to non-commercial personal use; a production deployment label alone does not prove commercial plan eligibility. [Vercel Hobby terms](https://vercel.com/docs/plans/hobby).

| Domain entity | Existing mapping or addition | Required invariant |
| --- | --- | --- |
| Account and subject | Account, Applicant and relationships | Authentication identity differs from represented person |
| Claim and fact history | FieldDefinition, Fact, FactVersion | Current pointer names an immutable version belonging to the same fact/subject |
| Evidence | Document, DocumentVersion, EvidenceLink | Immutable bytes/version/hash and explicit subject authority |
| Agency access | Organisation, Membership, Assignment, Grant | Active membership plus grant and assignment where required |
| Consent | Extend ConsentRecord with subject/scope/notice policy | Purpose-specific attributable history, including withdrawal |
| Invitation | Extend/reuse invitation primitive; distinguish pilot, staff, traveller and contributor | Hashed random token, intended recipient, purpose, expiry and consumption |
| Case | Extend Mission | Subject and agency relationship; material revision; route and dates |
| Requests and tasks | Extend EvidenceRequest and MissionTask | Case/requirement binding, due time, assignee and history |
| Notes | Extend MissionNote | Organisation ownership and explicit visibility |
| Rule content | Pack, PackVersion, Requirement plus source/review fields | Immutable publication and typed applicability |
| Assessment | Add versioned assessment/result records | Exact input revision and rule versions, no mutable historical result |
| Applicant Truth | Reuse MissionSnapshot; add Acknowledgement | Exact snapshot hash/revision and separate applicant action |
| Submission and outcome | Add submission report and case outcome records | Externally reported status never inferred from export |
| Notifications | Add outbox, schedule, delivery and preference records | Idempotency and current recipient authority |
| AI | Extend run/proposal/cache; add provider config and budget reservations | Secret references, immutable versions, tenant-bound inputs |
| Commerce | Add plan, entitlement, subscription and billing records | Service-enforced quotas and recorded cash state |
| Privacy lifecycle | Existing erasure, retention and legal-hold services | Holds are narrow; purge covers all derived copies |
| Feedback and complaint | Add case-linked restricted records | No public ranking or unauthorised agency disclosure |
| Issuer confirmation | Extension contract; operational UI P1 | Never inferred; exact claim, issuer, method and expiry |

**ARC-01 — Relational integrity.** Use foreign keys and check/unique constraints for same-subject references, exactly-one resource targets and immutable version links where possible; otherwise validate inside a locked transaction and test corruption attempts. Add organisation/subject scope to composite keys where it prevents cross-scope references. Any client-supplied ID is a lookup input, never an authorisation assertion. UUIDs do not replace access checks. Parameterised queries, strict input validation and bounded pagination are required.

**ARC-02 — Transactions and concurrency.** Mutations, invalidation, usage reservation and audit/outbox events commit consistently. Use idempotency keys for invitation consumption, upload finalisation, acknowledgement, export generation and billable AI runs. Reject stale writes with a typed conflict and refresh path. Worker leases expire and recover; at-least-once delivery must not duplicate a fact approval, notification, charge ledger entry or deletion side effect. Avoid holding database transactions open during provider calls. Reserve first, perform external work, then reconcile with revision checks.

**ARC-03 — Interface contract.** Existing server actions/API routes must call the same service layer. Required operation families are identity/organisation, subject/profile, upload/finalise, document/review, grants/invitations, cases/requests/tasks, packs/assessments, snapshots/acknowledgements, notifications, AI configuration/jobs, entitlements and privacy/export. Every operation declares actor, scope, input schema, output/error schema, permission, audit event, idempotency behaviour and transaction boundary. Use typed errors for unauthenticated, forbidden/not-found, conflict, validation, quota, pending-processing and provider-unavailable. Do not return stack traces, secret presence details or raw provider responses to customers.

**ARC-04 — Data migrations.** Add new migrations; never rewrite applied ones. Backfill from known evidence only. Unknown author-organisation, submission, consent or acknowledgement stays unknown. Move high-risk plaintext into protected storage with a resumable migration, verification counts and rollback procedure. Inventory plaintext duplicates before marking encryption complete. Existing records with unsafe or uncertain permissions stay restricted during migration. Keep a reconciliation report and test both a clean install and upgrade from a realistic synthetic snapshot of the current schema.

## 14 Security requirements

Use a threat model focused on account takeover, agency overreach, cross-tenant access, malicious files, insider support, secret theft, data exfiltration through AI, stale grants, unsafe exports and destructive recovery. Map applicable OWASP ASVS 5.0 requirements at Level 2 to implementation and test evidence; record any non-applicability with justification. This is a verification target, not a claimed ASVS certification. File controls and endpoint restrictions should follow the relevant OWASP guidance. [ASVS project](https://github.com/OWASP/www-project-application-security-verification-standard/blob/master/index.md), [file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

**SEC-01 — Authorisation.** Default deny at every service entry and every binary-delivery endpoint. Scope lists, counts, notifications, search, background jobs, cached results, packet contents and audit views, not only detail pages. No client database or object-storage bypass. The runtime database role is least privilege; migration/admin credentials are separate. Database row policies can add defence in depth where compatible, but cannot replace the existing policy engine or be claimed without connection-pool tests.

**SEC-02 — Transport and browser.** HTTPS, secure/HttpOnly appropriately SameSite cookies, CSRF/origin validation for state changes, strict redirect allowlists, security headers and a tested CSP. No sensitive localStorage, third-party session replay, service-worker document caching or public CDN cache. Protected pages and bytes use no-store; no PII in URL query strings. Sanitize displayed filenames, notes, AI output and pack content; do not render untrusted HTML. Rate-limit login/recovery, invitations, upload, sharing, export and AI by actor plus appropriate network/organisation dimensions.

**SEC-03 — Encryption and keys.** Require managed encryption at rest for database, objects and backups, plus authenticated application-level encryption for passport/NID/tax/bank identifiers and restricted facts. Use a maintained crypto library with KMS-backed envelope keys, random nonces, versioned keys and authenticated associated data binding tenant/subject/record/field/version. Database backups must not contain keys capable of decrypting protected fields. Keep key-use roles separate from routine database administration. Restricted document originals/derivatives require KMS-backed encryption appropriate to the chosen storage design. Do not write custom cryptographic primitives.

Protection covers current/historical facts, AI proposals/snippets, OCR text, corrections, snapshots, exports, cache and temporary files that repeat a protected value. Encrypt these fields or avoid persisting them. A plaintext passport number in an “immutable snapshot” still violates the requirement. Search should use a masked display or keyed exact-match index only if needed, never an unsalted identifier hash. Document hashes remain internal and cannot be used as public existence oracles. Key rotation and recovery must be demonstrated. Application access can decrypt authorised content; do not call this end-to-end encryption.

**SEC-04 — Audit.** Retain attributable tamper-evident events for authorisation decisions, profile/evidence changes, accesses/download issuance, grants/consent, AI configuration and usage metadata, rule publication/evaluation, snapshot/acknowledgement, privileged actions, exports, deletions, submission/outcome and billing overrides. Use IDs/version hashes rather than sensitive before/after values. Distinguish authorised download issued from proven completion of transfer. Required audit failure denies a sensitive mutation or download. Existing hash chaining is useful but not proof against a fully privileged database operator; restrict audit permissions and periodically anchor signed digest/checkpoint evidence outside the mutable database. Test concurrency and restore validation.

**SEC-05 — File and export boundary.** Scan both uploads and any external derived file admitted to the vault. Guard decompression, page count, pixels, memory, CPU and time. An extension/MIME check alone is insufficient. Generate ZIP entries with safe names and no traversal, duplicate-path overwrite or executable file surprises. Limit export size and stream/asynchronously build large bundles; use encrypted transient storage and a 24-hour maximum artifact lifetime. The download session/grant is still checked on each access. Never send material to a public malware-analysis service.

**SEC-06 — Privilege and support.** Platform roles are persisted server-side and auditable. Support grant creation identifies reason, scope, approver and maximum 60-minute duration. Normal admins see operational metadata, not traveller contents. Any emergency procedure requires a named incident, independent approval when available, tightly bounded access and retrospective review; it is not a permanent impersonation feature. Review production access quarterly and after staff departures. Founder ownership of infrastructure does not grant the founder's agency automatic traveller access.

**SEC-07 — Software supply chain.** Run current dependency and secret scans, static analysis and licence checks in CI using tools that actually execute on this private repository. Pin lockfiles and deploy supported patched versions chosen at implementation time. Review dev-tool advisories too: tools running with CI secrets are security-relevant even if absent from the production bundle. No production credentials in pull-request previews, test fixtures, browser bundles or AI prompts. Credentialed E2E runs only trusted reviewed code in an isolated test environment. A skipped scan is recorded as unverified, never passed.

## 15 Privacy retention and exit

**PRV-01 — Data map.** Before real-data launch, document operating legal entity, controller/processor roles, applicable jurisdictions, lawful bases, children/guardian handling, cross-border transfers and subprocessor terms. Obtain qualified review for the actual operation; this PRD does not assert GDPR or Bangladesh-law compliance. List hosting, identity, database, object storage, key service, scanner, OCR/AI, email, monitoring and backups with purpose, data classes, region, retention and exit path. Avoid redundant vendors.

**PRV-02 — Retention defaults.** The following are proposed operational defaults requiring policy approval before production: abandoned invitation metadata 30 days; incomplete upload objects 24 hours; transient OCR/export material 24 hours where no longer required; AI caches 30 days or earlier consent/data deletion; ordinary application logs 30 days; restricted security/audit metadata 12 months with documented justification. Traveller wallet originals remain until user deletion or the approved inactive-account policy. Closed-case files have a disclosed retention period, initially 12 months after closure, with 30-day expiry notice. Do not apply one universal retention period to every legal entity or data class.

**PRV-03 — Erasure.** Verify requester and scope, show affected records and retained exceptions, offer export and execute deletion through durable jobs. Target live-system purge within 30 days after a valid request, with backup expiry no later than 90 days unless a narrower approved policy applies. Cancel queued optional processing and revoke access promptly. Cover object versions, thumbnails, OCR, AI caches/proposals, generated packs, snapshots and provider-side files if used. Record verifiable deletion attempts/outcomes without storing the deleted content. A provider that cannot meet the policy is not eligible for those data.

Legal holds name authority/basis, exact scope, owner and review/expiry date. They restrict use and cannot become indefinite staff convenience. An agency cannot defeat traveller deletion merely by labelling a case active. Where retention is required, explain what remains, why, who can see it and when it will be reviewed. Preserve minimal pseudonymous audit evidence under the approved schedule; do not put plaintext PII in an immutable chain and then promise complete erasure.

**PRV-04 — Portability and offboarding.** Traveller export contains readable JSON/CSV metadata, permitted originals, selected case snapshots, consent/share history and a manifest; excludes other people's restricted data and agency-private notes. An agency export contains only its records and content it remains authorised to export. Terminating the agency removes its platform access while the traveller retains their wallet. Restoring a backup must reapply deletion tombstones and current revocations before reconnecting users or sending jobs; recovery cannot resurrect deleted data or old grants.

## 16 Experience and accessible delivery

**UX-01 — Navigation.** Traveller: Overview, Profile, Documents, Cases, Sharing, Alerts, Privacy. Agency: Dashboard, Clients, Cases, Team, Usage/Billing and Settings. Platform: Organisations, Rules, AI, Operations, Privacy and Audit. Keep internal provider/schema/job vocabulary out of traveller flows. Use the existing design system and reusable components; no cosmetic redesign prerequisite.

**UX-02 — Every critical screen.** Provide loading, empty, error, forbidden, pending, retry and success states. Show real processing progress and explain the next user action. Autosave must confirm persisted state; never show success on an optimistic write that failed. Avoid green “verified” badges with unclear meaning. Show selected version, owner and access context on sensitive views. Users can complete the main journey on a narrow phone screen and a weak network without uploading the same file repeatedly after an ambiguous failure.

**UX-03 — Language and accessibility.** English and Bangla cover account consent, invitations, uploads, requests, sharing, readiness warnings, acknowledgement, alerts and privacy actions. Legal names remain untransliterated unless the user confirms an alternative. Target WCAG 2.2 AA on critical flows, including keyboard access, labelled controls, focus recovery, contrast, error association and screen-reader status updates. Automated axe checks are supplemented by manual keyboard/screen-reader testing. Use approved existing brand assets or accessible text branding until replacement assets are approved.

## 17 Reliability and operating evidence

**OPS-01 — Service objectives.** Initial engineering target: 99.9 percent monthly availability of authenticated core operations; p95 ordinary API response below 800 ms excluding file transfer/AI; meaningful UI feedback within two seconds; p95 safe processing of a clean ten-page reference PDF within 90 seconds at the agreed launch load. AI failure must not take down profile, manual review or sharing. Scanner failure deliberately pauses new document release. These are targets measured by monitoring, not a customer SLA until demonstrated and contracted.

Initial load-test envelope is a design assumption: 20 agencies, 200 professional users, 5,000 traveller profiles, 1,000 open cases, 50 concurrent interactive sessions and five concurrent document jobs. Use paginated representative synthetic data, not a tiny empty database. Measure latency, queue age, memory, database connection pressure, error rate and approximate unit cost. If expected launch demand differs, change the envelope before release and rerun relevant tests.

**OPS-02 — Recovery.** Set one consistent V1 target: RPO at most 15 minutes for committed data and RTO at most four hours for the core service. Choose paid provider capabilities and backup frequency that can meet it. This supersedes conflicting older five-minute/one-hour assertions until a stricter target is demonstrated. Recovery must include database, original/derived objects, encryption keys, configuration, audit integrity and deletion/revocation state. Never use ordinary preview environments to hold recovered production data. Restore into an isolated recovery environment with equivalent controls, outbound delivery disabled and limited operators.

Record a full restore drill before launch and quarterly: chosen recovery point, missing-data interval, start/finish, object hash verification, key decryption, audit-chain verification, permission checks, deletion reconciliation, failed steps and measured RPO/RTO. Database PITR alone is not a document backup strategy. Provider object versioning alone is not a proven recovery procedure.

**OPS-03 — Monitoring and incidents.** Alert on core availability, job/notification backlog, scanner/signature age, denied-access anomalies, AI spend/circuit breaker, object/DB errors and audit-chain failures. Public health endpoints return coarse status without revealing secrets or detailed controls; detailed readiness is admin-only. Name a primary and backup incident owner before launch. Provide containment, access revocation, preservation of evidence, customer communication, legally reviewed notification/escalation, recovery and post-incident actions. Run an incident tabletop. Do not offer an unsupported 24/7 response promise.

**OPS-04 — Analytics and commercial learning.** Capture pseudonymous, access-controlled events for case creation/stages, intake-to-ready time, requested/received/reworked evidence, overdue tasks, detected gaps, acknowledgement/invalidation, source review, AI acceptance/correction, outcome, complaint resolution, activation, agency repeat use, plan usage and cash collections. Exclude passport numbers, file contents and free-text refusal/medical reasons from analytics. The four compounding assets are maintained rules, evidence taxonomy, operating benchmarks and opted-in distribution relationships. Aggregation does not permit unrelated reuse or external-model training.

## 18 Customer journeys that must work

Each journey must be demonstrated through the actual UI, not only service calls, using two independent agencies and several unrelated synthetic people. Local service tests remain necessary for race conditions and negative paths.

| Journey | Successful outcome | Failure path to prove |
| --- | --- | --- |
| J01 Independent traveller | Verified account, profile, scanned clean document, confirmed fields, reminder | AI disabled/unavailable still permits manual completion |
| J02 Agency onboarding | Approved organisation, owner MFA, member invitation, assigned case | Unapproved organisation and removed member cannot reach content |
| J03 Agency invites traveller | Recipient accepts, selects profile, grants scope, supplies requested evidence | Wrong recipient/expired invitation cannot claim a wallet |
| J04 Repeat case | Reuse selected valid versions; request only missing/old evidence | Other agency's private notes and unshared wallet data stay hidden |
| J05 Expiry replacement | Notice, replacement, affected-case review and updated reminder | Old acknowledged packet cannot remain submission ready after material replacement |
| J06 Sharing | Narrow accepted grant, authorised preview/download, access history | Expired/revoked grant denies next request and old token redemption |
| J07 Agency preparation | Requests, tasks, review, contradiction resolution and source-backed readiness | Unknown/stale mandatory source cannot produce false green readiness |
| J08 Applicant Truth | Applicant inspects exact file, acknowledges, receives bound packet | Concurrent material edit invalidates or rejects acknowledgement |
| J09 Outcome and feedback | Report submission, record actual outcome, private feedback/complaint | Export alone cannot set submitted or approved |
| J10 Change agency | Agency B receives only new explicit scope | Agency A private notes, fees and unshared material cannot leak |
| J11 Family or sponsor | Narrow contribution with consent and correct case attachment | Contributor cannot browse case or other subjects |
| J12 Owner operations | Dashboard, reassignment, limits, branding and manual billing | Downgrade never destroys evidence or blocks own-data export |
| J13 Public trust | Maintained route/fee source or honest unavailable status | No unverified fee, embassy endorsement or forced agency lead |
| J14 Export and exit | Scope-correct export, revocation, erasure and exception report | Recovery does not resurrect erased data or grants |
| J15 Admin changes AI | Test and activate OpenAI, Gemini and Claude, then rollback | Invalid model, unapproved host or missing consent prevents dispatch |

## 19 Acceptance tests and release gates

The implementation team maintains a requirement-to-code-to-test ledger. Every P0 ID in this document must have an implementation path, test ID, evidence link, owner and result. A stub, mock-only provider test, skipped required test or manually ticked checkbox is not completion. Unit tests prove logic; real Postgres/storage tests prove integration; deployed synthetic E2E proves the customer journey. Test datasets never contain real customer passports.

| Test | Required assertion | Principal requirements |
| --- | --- | --- |
| A01 Identity and MFA | Verified identity; staff without required factor denied even on direct API; recovery cannot bypass | IAM-01, SEC-01 |
| A02 Revocation | Suspended account/removed member/expired grant denied on next request, including token and cache paths | IAM-01, SHR-02 |
| A03 Tenant boundaries | User/Agency A cannot enumerate, read, mutate, export or trigger jobs for B by ID or filters | IAM-02, SEC-01 |
| A04 Grant precision | Purpose, case, action, date and document-version boundaries enforced; no future evidence auto-expansion | SHR-01, SHR-02 |
| A05 Invitation | Wrong email, expiry, replay, race and existing-account discovery handled safely | IAM-03, CAS-08 |
| A06 Upload threats | MIME spoof, malware test fixture, corrupt/password PDF, oversized/pixel bomb and scanner outage remain blocked | EVI-01, EVI-02 |
| A07 Upload integrity | Scanned hash matches served version; orphan cleanup and concurrent quota reservation work | EVI-02, COM-02 |
| A08 Safe delivery | Quarantine inaccessible; safe preview; exact permission; no public URL/cache; grant revoked before redemption fails | EVI-06, SEC-05 |
| A09 Profile history | New/conflicting/repeating facts require correct authority; rollback creates a version; atomic failure leaves no partial write | PRO-02 |
| A10 Private notes | A private note cannot reach traveller, Agency B, their exports, AI context, search or logs | CAS-05 |
| A11 Requests and tasks | Upload is not acceptance; due dates, reassignment, replacement and cancelled tasks behave correctly | CAS-03, CAS-04 |
| A12 Rules regression | Boundary dates, unknown data, contradictory values, stale source and rule version change yield expected states | RUL-01 to RUL-05 |
| A13 Manual route | Unsupported destination remains usable and never appears officially assessed | CAS-01, RUL-04 |
| A14 Snapshot minimisation | Bundle includes exactly selected versions; unrelated wallet data/internal notes excluded | TRU-01 |
| A15 Acknowledgement | Actor authority, step-up, hash/revision binding, simultaneous edit and repeat request enforced atomically | TRU-02, TRU-03 |
| A16 Post-approval change | Material change/expiry blocks final use; nonmaterial note does not; old submitted packet remains unchanged | TRU-03, TRU-04 |
| A17 Alerts | Correct zone/threshold; duplicate/outage recovery; expired authority cancels delivery; bounced email visible | NTF-01 to NTF-04 |
| A18 Email provider | Real synthetic delivery and signed webhook; fake success/NullEmailPort prohibited in commercial mode | NTF-03 |
| A19 AI providers | All three real API adapters can return validated proposals; config activation and rollback require no deployment | AI-01 to AI-03 |
| A20 AI quality | Evaluation gates and source grounding pass; bad images/unsupported fields abstain; human confirmation required | AI-04, AI-05, AI-10 |
| A21 AI privacy | Missing/withdrawn consent, wrong subject, restricted policy, cache collision and prompt injection cannot disclose | AI-06 |
| A22 AI endpoints | Local/metadata/private/DNS-rebound/redirect endpoints denied; key never sent to wrong host or browser | AI-07 |
| A23 AI resilience | Timeout, refusal, invalid schema, rate limit, kill switch and missing price fail safely; manual path works | AI-08, AI-09 |
| A24 AI concurrency | Worst-case cost reservations bound simultaneous jobs and retries; unknown outcome reconciled | AI-08 |
| A25 Encryption | Raw DB/exported backup lacks plaintext protected identifiers across facts, snippets and snapshots; key rotation/recovery works | SEC-03 |
| A26 Audit | Critical writes/downloads fail if required audit cannot commit; no sensitive values; chain/checkpoint verifies | SEC-04 |
| A27 Privilege | Admin cannot browse data without approved support grant; role self-upgrade and expired support denied | ADM-01, SEC-06 |
| A28 Commerce | Concurrent limit checks, downgrade, manual cash state and branding isolation pass | COM-01 to COM-04 |
| A29 Privacy | Subject/agency exports scoped; purge includes derivatives; narrow hold honoured; tombstones replayed on restore | PRV-01 to PRV-04 |
| A30 Recovery | Actual restore of DB, objects, keys and controls meets measured RPO/RTO | OPS-02 |
| A31 Deployment | Clean install and upgrade, isolated preview, migration serialization, deployed commit identity and rollback pass | ARC-04, SEC-07 |
| A32 UX and language | Mobile/low bandwidth, English/Bangla, keyboard and screen-reader critical journeys pass | UX-01 to UX-03 |
| A33 Capacity | Representative launch dataset/load meets targets with bounded cost and no queue starvation | OPS-01 |
| A34 Public trust | Source and freshness visible, fees separated, stale amounts removed, no unjustified endorsement | RUL-06 |
| A35 Independent review | Threat model, ASVS mapping, current scans and scoped penetration test; no unresolved Critical/High findings | SEC-01 to SEC-07 |

Each published launch pack needs at least 20 golden cases spanning typical applicants, missing/expired evidence, unknown applicability, conflicting facts, date boundaries and changed/withdrawn sources. Golden expectations are approved by a qualified content reviewer rather than copied from implementation output. A rule update must run the affected suite before publication. A custom agency checklist cannot overwrite a canonical pack.

Security tests seed data that could actually leak; an empty database returning no rows proves little. Two agencies, two staff roles, multiple unrelated applicants, revoked memberships and real object versions are mandatory fixtures. The eight existing skipped cross-account cases must be implemented and executed, with their assertions mapped into this matrix. Credential absence makes the release gate fail or remain blocked; it cannot turn a required test into a green release.

**Release gate record.** Store code SHA, environment, build/deployment ID, schema/migration version, provider-configuration versions, rule-pack versions, test report, scan timestamp, independent review, recovery drill, incident owners and sign-off. A passing result from another commit or another environment cannot silently satisfy the release. Operational attestations require linked evidence, approver, date and revalidation condition. Replace the hardcoded scanner false with a real capability/health check only after implementation; do not delete the gate to make the dashboard green.

Commercial admission requires all P0 requirements and journeys passed, no unresolved Critical/High security defects, approved data/provider policy, current complete rule packs, tested email/scanner/AI integrations, recovery evidence and accountable support. A transient optional AI outage disables AI and shows degraded status; it should not block the already-safe manual core. A core auth/storage/security failure blocks the affected operations. Release eligibility and runtime degradation are separate decisions.

## 20 Implementation sequence and cost discipline

| Stage | Work and dependencies | Evidence before proceeding |
| --- | --- | --- |
| M0 Establish baseline | Confirm current main/PR 77, inventory actual capabilities, run current tests/scans, reconcile old docs | Pinned baseline, reuse map, requirements ledger, cost/assumption register |
| M1 Secure foundation | Production identity/MFA, encryption, real scanner/worker, environment boundaries, safe previews and gate repair | A01 to A08 plus A25 to A27 on real test infrastructure |
| M2 Complete daily operations | Invitations, profiles, requests/tasks, note visibility, expiry, email/outbox, contributors | J01 to J06, J10 to J12; no developer intervention |
| M3 Rules and applicant control | Maintained packs, readiness, scoped packet, atomic acknowledgement, outcome/complaint | A12 to A17, J07 to J09 and content sign-off |
| M4 AI control and commerce | Three adapters, admin versioning/secrets, evaluation/budgets, plans and branding | J15 and A19 to A24; billing/entitlement tests |
| M5 Launch verification | Export/erasure, end-to-end security, capacity, accessibility, restore, independent review and handover | Complete gate record for release candidate and production smoke |

Some work can overlap after dependencies are secure, but do not merge a parallel implementation of a canonical service. The lowest-cost approach is to extend the repository, restrict file/rule coverage, use manual billing, share the existing jobs/policy primitives and pay for only the infrastructure required to satisfy controls. Do not economise by accepting a null email adapter, imaginary antivirus, untested tenant isolation or unprotected passport data.

No reliable new delivery price or completion date follows from this static audit. The earlier BDT 130,000/10-week discussion is a historical commercial proposal, not a validated estimate for this specification. After M0, require a milestone estimate with engineering, content maintenance, infrastructure, independent testing and support shown separately. A working codebase can reduce build cost; it does not eliminate operating cost.

Monthly operating model: hosting + database/PITR + private storage/egress/backup + worker/scanner + identity + email + key service + monitoring + actual AI usage + rule maintenance and support. Record vendor, owner, region, current quote/plan, quota, alert threshold and replacement path. Avoid committing to free-tier economics for a commercial data product.

Validate value with Travel Router and at least two unrelated agencies after security acceptance. Measure document-chasing time, repeated data entry, rework, time to acknowledged file, active case completion and repeat agency usage against a recorded pre-pilot baseline. Treat willingness to pay as confirmed only by an attributable commitment and then cash, not by friendly feedback. Product owner sets price and acceptance targets before inviting paying organisations.

## 21 Decisions owners and launch obligations

These defaults let engineering proceed. They do not authorise spend, publish unreviewed rules or represent legal sign-off as complete.

| Decision or obligation | Recommended default | Owner and deadline |
| --- | --- | --- |
| Scope authority | This V1 with AI; no mandatory employer contact | Nazmus Sadat, before implementation brief |
| Content coverage | Two packs named in RUL-01 or documented substitutes | Product owner and named rules reviewer, before M3 content freeze |
| Infrastructure fit | Retain existing stack; verify paid commercial capability and real worker | Technical lead, M0 estimate and before real data |
| Data region and subprocessors | Explicit approved region/data map; no unsupported residency promise | Product owner with privacy reviewer, before real data |
| AI providers and budgets | Three adapters; one active by default; reviewed business accounts | Product owner and technical lead, before M4 activation |
| Agency plans and pricing | Manual plans and invoices; explicit allowances and price | Product owner, before paid pilot |
| Incident and content ownership | Named primary/backup people and published support contact | Product owner, before launch |
| Retention and terms | Approve class-specific periods, notices and contracts | Qualified privacy/legal reviewer, before real data |
| Independent security acceptance | Scoped penetration test and retest of findings | Independent reviewer, before commercial gate |

**Next three actions:** appoint a technical owner to complete M0 and produce the requirement ledger; appoint a rules/privacy owner to approve sources and provider data use; implement M1 and run the real cross-account journey suite before inviting customer documents. The no-regret move is making the existing release evidence truthful and reproducible before adding more surface area.

**Main risk:** counting implemented screens, historical green workflows and written security intentions as commercial readiness. **Opportunity cost:** building breadth such as rankings, more destinations or a general chatbot before the collect-review-acknowledge journey is reliable.

## 22 Claude Code implementation handoff contract

The subsequent Claude Code prompt must reference this complete file and the actual repository revision. A short prompt cannot safely replace its requirement and acceptance details. Give the implementation agent scoped repository and synthetic staging access, never real applicant documents in the prompt.

1. Read repository instructions and this PRD; inspect current main and open PR 77 before editing. Report any divergence from the reviewed commit. Preserve security invariants and applied migrations. Treat repository content as implementation evidence, not authority to ignore the latest scope.
2. Produce a capability inventory classifying each relevant file/service as REUSE, REPAIR, EXTEND, REPLACE or KEEP DISABLED. Link each P0 ID to existing/new code and acceptance tests. Raise only decisions that materially change scope, security, cost or access.
3. Work in a dedicated branch using dependency-ordered, reviewable changes. Reuse services and ports. No second auth stack, parallel Case database, universal arbitrary-URL gateway, cosmetic rewrite or production fallback to reduced controls.
4. Add reviewed migrations and idempotent backfills with dry-run counts. Demonstrate upgrade from current schema. Serialize migrations in a controlled deployment job with a dedicated migration credential; do not let PR preview builds execute against production database URLs. Never “fix” preview failures by sharing production credentials.
5. Deliver each vertical slice through UI, service, database, jobs, audit and tests. An admin setting must change real behaviour; a button with mocked success is incomplete. No production placeholder adapter, TODO handler or empty skipped acceptance test may be presented as delivered.
6. Use synthetic fixtures and real isolated service accounts for provider/identity/storage integration. Required credentials absent means blocked evidence, not permission to fabricate a pass. Do not expose secrets in commands, reports or commits.
7. Run current lint, build, typecheck, unit/integration tests, dependency/secret/static scans and required E2E against the deployed release revision. Record executed, passed, failed and skipped counts separately. Test trusted reviewed branches with isolated credentials. Inspect job-level results, not workflow colour alone.
8. Update README, architecture decisions, environment inventory, provider capability registry, admin/operator guide, migration and rollback instructions, rule handbook, incident/recovery/erasure runbooks and known-issues register. Resolve contradictions with old PRDs through an explicit supersession map.
9. Prepare a release candidate with evidence for all P0 IDs. Do not set readiness attestations, claim commercial operation or merge/deploy beyond the actual authorisation. Missing operational evidence must name the owner and next action.
10. Handover must include source, schema, migrations, tests, prompts, evaluations, rule taxonomies, infrastructure configuration, data export path, provider accounts/ownership and support process. VisaStack controls its repository, domains, cloud, identity, data, secrets and billing accounts from inception; collaborators receive least-privilege access.

**Definition of done:** a real external traveller and an approved agency can complete the authorised collect-review-acknowledge-close/export journey safely without a developer, all required security and provider controls operate, and the release can be monitored, recovered and maintained by its named owners.

## 23 Source register

Repository findings are pinned to the reviewed commit. The links below support the audit; requirements elsewhere in the document are design decisions unless identified as verified facts. Provider/security references were checked on 16 September 2026 and must be rechecked when implementing. The supplied Travel Router operational documents inform workflow context only; their market, visa and absolute-error-prevention claims were not adopted as verified facts.

- [Repository README](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/README.md) — declared pilot status and capability inventory.
- [Existing product PRD](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/docs/product/prd-v1.1.md) — historical product contract, including fixed-model policy superseded here.
- [Commercial readiness guard](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/apps/web/src/lib/commercial-readiness.ts) — 19 gates and hardcoded scanner blocker.
- [Remaining commercial blockers](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/docs/roadmap/remaining-commercial-blockers.md) — historical operational blockers and skipped-test disclosure.
- [Database schema](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/packages/db/src/schema.ts) — entities and missing lifecycle fields described in the audit.
- [Profile service](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/packages/services/src/profile.ts) — versioned facts and current direct value storage.
- [Mission service](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/packages/services/src/missions.ts) — current state transitions, readiness and snapshot assembly.
- [Agency service](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/packages/services/src/agency.ts) — collaboration and note-read boundaries.
- [AI runtime configuration](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/apps/web/src/lib/ai.ts) — OpenAI-only wiring and approximate token-to-USD conversion.
- [OpenAI extraction adapter](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/packages/adapters/src/openai-extraction.ts) — existing model-specific protocol.
- [Email adapter](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/packages/adapters/src/email.ts) — null sending implementation.
- [Step-up implementation](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/apps/web/src/lib/step-up.ts) — recent-authentication and action-bound assurance.
- [Authenticated E2E source](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/apps/web/e2e/authenticated-workspace.spec.ts) — implemented cases plus eight skipped placeholders.
- [Recovery document](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/docs/operations/recovery.md) — historical recovery assumptions requiring reconciliation.
- [Integration and cleanup directive](https://github.com/sadatnitex/visastack/blob/2cb47e0ac91e8ce323956aff607bae9cd343e5a0/docs/governance/integration-and-cleanup-directive.md) — preserve canonical implementations and applied migrations.
