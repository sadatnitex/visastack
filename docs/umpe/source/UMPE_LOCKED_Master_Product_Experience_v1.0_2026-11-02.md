# VisaStack UMPE -- Unified Master Product & Experience Contract

**Status:** LOCKED PRODUCT DIRECTION · Single-file consolidation of four binding contracts  
**Consolidated:** 2 November 2026 · **Master version:** 1.0  
**Product:** VisaStack · **Primary implementation repository at the time of the source audits:** `sadatnitex/visastack`  
**Engineering baseline referenced by the source documents:** `ab6ce2a8b4f83623befac4b2aea68628385406bf` (2 November 2026). This is a historical **source-code inspection** checkpoint, not live runtime certification or a guarantee it is still HEAD.

> **Master lock:** VisaStack lets people put unsorted travel documents in with minimal effort, automatically builds and maintains a source-attributed personal travel record, and prepares destination/route/purpose-specific packages for each traveller. Agencies can request, collect and review exact evidence through elegant branded links, including from customers who do not create accounts. Source-governed requirements, precise historical versioning, context-aware updates and privacy-conscious outcome observations make the service more useful over time. No previously implemented product capability is silently lost.

## 0. What this master file contains and how it must be used

This file has **two complementary layers**:

1. **Integrated control contract (Sections 1–12):** a unified reading of the decisions, terminology, overlap rules, user journeys, engineering scope and acceptance obligations. This is the practical starting point for the product/engineering team and coding agents.
2. **The four original binding documents, reproduced word-for-word and byte-for-byte after the Annex heading:** complete authoritative clauses, details and acceptance scenarios. Their full text is retained; the concise master is **not** a license to omit their requirements.

**Preservation and scope rules:**
- All four sources are cumulative. More detailed clauses govern their particular workflows. Nothing here cancels a prior no-loss, privacy, consent, version, document-safety or historical-record invariant.
- Where an earlier experience description gave trip packages or cases *secondary prominence*, the later explicit traveller experience lock makes **intelligent record ingestion and trip-package preparation two co-primary user promises**. This revises *navigation/product emphasis*, not the continued existence, user rights or canonical identity of existing cases/missions.
- Agency-initiated guest collection is **an additive new route**; it does not replace or silently loosen the existing email-bound authenticated client-invitation flow. The technical implementation must maintain distinct semantics and authorization.
- The phrase “no trace for a guest” means **no permanent traveller-owned VisaStack profile, reusable wallet or personal timeline**. It does **not** mean an agency can function without agency-side receipts, request files, submission records, review history, retention limits or deletion obligations.
- “Automatic” means automated processing to the extent actually supported and source-grounded, with human review for consequential uncertainty. It never means AI can silently confirm facts, certify a document, decide legal eligibility or make official authority claims.
- “Saturday auto-update” means automatically **check, detect and propose**. Substantive authoritative rule publication remains verified, approved and versioned. Check **source fetch time**, **substantive verification time** and **legal effective time** separately; urgent final-handoff checks are not limited to Saturday.
- “Commercially targeted” describes product strategy and execution priority. It is **not** evidence that unverified configurations, document safety or live processing journeys have been validated. Existing protections remain; risky unsupported operations require explicit containment, not silent bypass.
- The earlier `VisaStack_Field_Workflows_and_Document_Journeys_LOCKED_v1_2026-11-01.md` (working baseline v1.1) remains a **separate underlying field-research source**, not counted among or replaced by these four locks. This master contains all **four** requested locked contracts, not that separate research baseline.
- This master does **not** modify the repository, create scheduler jobs, change deployment flags, activate third-party services, approve security exceptions or claim launch acceptance.

## 1. Canonical product identity and exclusions

**Identity:** Traveller-owned travel-document, source-attributed personal information, declaration history and evidence-sharing infrastructure, with efficient agency document-request, collection and review capabilities. Its main value is reducing the work between *unsorted existing files* and *an accurate, reviewable package for a particular application*.

**Explicit exclusions:** An enquiry/lead/quotation CRM, agent marketplace, government application-submission integration without actual authorization, visa approval prediction, unsupported claims of official validation, and an unnecessarily complex manual filing or version-management experience. Already-built agency case, billing, administration, advanced record and application features must remain working even when not primary.

## 2. The four connected user journeys

| Journey | Who initiates | Minimal human action | VisaStack's responsibility | Historical boundary |
|---|---|---|---|---|
| **A · Put documents in** | Traveller/account holder | Drop files/folders, take photos or choose files | Validate, store, recognize, organize, assign person when grounded, extract source-backed proposals, connect versions/periods, detect uncertainty | Originals and prior facts/documents remain traceable |
| **B · Prepare a trip** | Traveller/account holder | Specify destination, purpose and participants; answer material gaps | Resolve supported official route, build per-person checklist, match exact eligible evidence, present gaps/alternatives, prepare handoff | Selected copies and confirmations are version-pinned |
| **C · Agency-initiated collection** | Authorized agency | Choose destination/route/purpose/tentative date, edit checklist, send branded link | Version the request; offer email/WhatsApp sharing; support account reuse, registration and truly guest submission; classify and match uploads; agency review/corrections | Agency receipts and request revisions persist; no guest personal wallet unless explicitly created |
| **D · Ongoing correctness and learning** | System and authorized actors | Respond only to consequential questions | Monitor requirement sources on Saturdays, recheck at handoff, detect affected packages, notify selectively, accumulate carefully attributed outcomes | No silent alteration of approved/shared/submitted history; reports must disclose missingness |

**Person, role and consent model:** One account holder may manage authorized family/minor profiles; group trips contain separate independently evaluated participant packages and optionally common evidence. Agency organization membership never confers unrestricted access to a traveller record. Guest intake has request-scoped authority, not an invisible account or broad grant. Contributor access is strictly limited to the authorized task. Existing actor/tenant boundaries govern all journeys.

## 3. Document intake and progressive Master Profile

**Universal input:** One prominent **Add Documents** interaction, supporting multi-file drop, file selection, camera/photo and folder selection **when device/browser permits**, with fallback. Mixed batches of 80+ supported files must queue/chunk/recover safely: do not lose the 21st file; report limits, per-file states, failures, retries and unknown outcomes honestly. Do not misrepresent a dispatched upload as stored and processed. Keep existing per-file validation/processing restrictions unless separately and appropriately changed.

**Automatic evidence operations:** Recognize type/subtype → generate clear user-facing name → assign to correct authorized person when substantiated → extract source-observed facts with provenance → map to canonical document and Master Profile structures → relate exact duplicates, corrected scans, new statement periods and renewed documents correctly → detect technical quality, expiry, conflicts and route-specific freshness → retain originals and historical relationships. Use established upload/AI/validation/stored-version services; do not create a second traveller profile or document taxonomy. Do not mistake folder name or email match for proof of document ownership.

**Four truth states:** Clearly identified and automatically organized; needs one targeted user decision; safely unclassified; failed/unsupported with recovery guidance. User reviews exceptions, not every routine categorization. Existing fact-approval and protected-document AI consent remain enforced. A source-observed value does not silently become a traveller-confirmed declaration. Preserve manual editing and all previously built profile/history tools.

**Do not conflate:** duplicate bytes / scan revision / material replacement / new time period / renewed identity document / document attached to multiple requirements / exact version previously shared or reviewed. Surface everyday language (*Current copy, Earlier copy, Shared, Reviewed*) while retaining exact technical identifiers in the record.

## 4. Route-specific requirements, MECE classification and honest necessity

**Taxonomy:** One universal, MECE-oriented **classification** of possible needs (identity, travel status, finance, work/business, education, family/sponsor, itinerary, medical, legal, application procedure and route-specific exceptions). A source-backed requirement has one canonical identity; **one document can satisfy multiple requirements**, one obligation can be satisfied by legitimate alternatives and one purpose must not inherit unrelated sensitive demands.

**Applicability is specific:** destination and competent authority; visa/subroute; purpose; nationality; residence; consular/application location; age/guardian and personal status; date/duration; funding/host; conditional exceptions. If conditions or route are unknown, classify as **needs verification**, not not-applicable or ready. A destination+purpose pair alone is insufficient for universal correctness.

**Necessity labels (not interchangeable):**

| Label | Interpretation and effect |
|---|---|
| **Mandatory** | Relevant source-backed requirement; unresolved blocks positive requirement-complete status |
| **Mandatory if applicable** | Blocks when condition is established true; unknown must be resolved |
| **Accepted alternative(s)** | At least one accepted option satisfies the applicable obligation; OR is not AND |
| **Recommended / Good to have** | Potentially helpful but not an official obligation; absent does not block |
| **Optional** | Voluntary; absent does not block |
| **Agency-added / authority-requested** | Separate provenance; actual authority-specific demands may require resolution, agency preference never automatically becomes official law |
| **Not applicable / Needs verification** | Only use not applicable when rule actually evaluates false; otherwise preserve unresolved status |

Each rule needs applicable route/conditions, evidence types and alternatives, timing, original/copy/translation format, citations/source rank, official excerpt versus VisaStack interpretation, effective and check/verification dates, reviewer and immutable revision. Reuse and extend current `packs` / `packVersions` / `packRequirements`, typed condition evaluator, Pack Studio and readiness mapping; never create a competing official checklist DB.

## 5. Trip-package assembly and family travel

**Traveller prompts:** *Where are you going? Why? Who is travelling?* Ask for missing dates, precise route, consular jurisdiction, funding or special circumstances **only when relevant**. Keep task-first entry; don't gate first usefulness on exhaustive profile completion.

**Packages:** Individually compute each traveller's applicability; match current eligible exact document/fact versions; present missing, stale, conflicting and alternative evidence; allow add, replace, choose another copy, exclude optional and explain external originals/forms/appointments. **Never silently revise historical selected/shared/reviewed evidence.** Group trips share an itinerary and authorized common evidence, not a merged personal data store. Customer action label: **Add Travellers**; question: **Who's travelling?**.

**Plain-language readiness:** **Needs attention → Ready for final review → Prepared for handoff.** These are UX interpretations of existing case readiness/acknowledgment machinery, not a license to replace existing states or assert formal government filing. Handoff is an exact-version selection with unresolved caveats visible. *Submitted to Agency* is not *Submitted to Authority*. Document extraction and checklist completion do not establish authenticity or visa approval.

**Ongoing matching:** Relevant changes in documents, approved facts, expiry, package composition, dates, participant eligibility, verified requirement packs and agency requests trigger targeted, bounded reevaluation of **active** packages. Nonmaterial updates remain quiet; material updates generate one precise next action. Previously approved/shared/reported-submitted snapshots are never rewritten or silently re-shared.

## 6. Agency checklist request, invitation and branded collection desk

**Agency action:** An authorized operator picks destination, specific purpose/route (or marks it uncertain), tentative travel dates, known nationality/residence/application place and optional assignee/due date. The platform proposes the suitable cited version; agency can annotate, reorder, add agency-specific requests and accepted alternatives, save a template and **issue an immutable request-checklist revision**. Do not require a previous traveller `applicantId`, full mission or CRM opportunity merely to invite evidence.

**Invitation delivery:** Support private copyable link/ordinary WhatsApp share and email using the configured outbox; a copied link is not proof of WhatsApp delivery and provider-accepted mail is not proof of inbox receipt. Each request has expiry, revocation, recipient-verification and anti-replay semantics; never reveal account existence to the agency.

**Customer-facing design:** A sophisticated, responsive, accessible **agency-branded Document Collection Desk**, using the *existing* verified organization name, approved logo/initials and accessible accent. Provide the exact requested checklist, clear necessity classes and progress, effortless file drop, per-item mapping/correction, and a restrained **Powered by VisaStack** identifier. Public unverified views disclose only safe agency/request information; agency verification is not government accreditation. The primary visual identity belongs to the service agency, not a VisaStack signup advertisement.

**Three recipient branches:**

1. **Existing account:** sign in with authorized intended identity, select their own managed profile, reuse the vault, fill gaps, review exact-version selected package and knowingly share only scoped evidence with that agency. Opening a link alone must grant nothing.
2. **New registration:** optional task-first sign-up or sign-in, return to same invitation, create a reusable record and submit. No mandatory full-profile setup and no signup pressure if a guest route is offered.
3. **Guest:** genuinely no account and no traveller-owned reusable profile or history. Perform secure bounded recipient verification/session, receive files in multiple attempts, auto-classify/match within a *request-scoped agency intake*, let guest correct the inferred mappings, show exactly what will go, then explicitly **Submit Documents**. Agency receives an immutable exact-file manifest and per-item review/receipt history, not unsent drafts by default. Corrections create appended submitted revisions. Guest data obeys stated agency/request retention, access, erasure and legal holds. Avoid silently claiming guest data by a future account using email matching alone.

**Security clarification:** A forwarded WhatsApp link alone does not authenticate the customer or authorize access to old drafts. Prefer low-friction one-time recipient email verification **without creating a VisaStack account**, or explicitly approved equivalent independent proof. A secure high-entropy link, short-lived request scope, limited disclosure, rate limiting, server-side session controls and token revocation are required. Existing scanner/intake and storage protections cannot simply be bypassed for the guest route; unsupported risky file operations must be controlled accurately.

**Agency review queue:** Draft → Sent / Awaiting Customer → customer working (only non-sensitive status if allowed) → Submitted for Review → Needs Correction → Accepted → Closed; retain Expired/Revoked. Staff see exactly what was submitted and which file version was reviewed/accepted, with explanation and response events. A material official-rule update flags affected requests but does not silently rewrite the agency-issued checklist. Agency may explicitly issue a new version with clear recipient notice. Maintain existing agency tasks/notes/case features and the existing authenticated client-invitation flow separately.

## 7. Official-source monitoring, governed changes and user correction suggestions

**Every Saturday (Asia/Dhaka):** the scheduled pipeline checks registered source URLs/feeds/APIs/PDFs for **supported routes**. Record source identity, fetch status, checked time, fingerprints, effective date and semantic changes; distinguish last fetched from last substantively verified. Produce structured candidate changes and assign reviewer/editor work. Existing distinct author/reviewer controls govern substantive source-backed pack publication. Missing/blocked sources do **not** mean deleted requirements; conflicts remain visible. Provide safe retry, manual run, alerting and route impact analysis. Never claim all countries are automatically covered.

**Outside Saturday:** route freshness and newly known urgent changes are checked at package creation, final review and handoff. Historical checklists stay pinned. A verified new requirement may trigger review of active individual packages or pending agency requests, with focused notifications rather than silent edits.

**Customizations:** Personal selected evidence, agency overlays and verified global official rules remain separate layers. Users may add/remove their optional selections, substitute permitted alternatives, attach personal notes, or ask to remove items **from the package** without deleting legal obligations from the master catalogue. A known mandatory gap remains disclosed. **Suggest a Checklist Correction** flows to a moderated, cited review queue and can only affect global rules after verified publication--not from a single unverified user edit.

## 8. Field-outcome intelligence: observations, not visa predictions

**Data chain:** Route/applicant-context class → requirement-pack + individual agency overlay version → exact chosen/submitted evidence and checklist-state snapshot → correction and additional authority request events → *self-reported vs independently substantiated* external submission → *recorded vs evidenced* authority outcome → privacy-minimized aggregated observations.

**Distinguish denominators:** invited, upload-started, prepared, shared, submitted to agency, reported submitted to authority, proven authority receipt (only if observed), pending decision, confirmed/evidenced approval or refusal, withdrawn, cancelled, unknown. Never treat prepared as submitted, or agency acceptance as consular approval. Report source, period, N, missingness, selection bias, data quality and non-reidentification safeguards. Sensitive categories, small samples and cross-agency data must not be casually exposed.

**Allowed insights:** Commonly requested missing documents, frequent correction causes, route-specific evidence presentation patterns, turnaround/operational issues, locations of apparent published-rule gaps. Correlations do **not** show approval causation. Report as **Observed in VisaStack cases**, separate from **Official requirement**; never promote an observed pattern to a legal requirement without authoritative source review. Start with an internal quality/coverage dashboard; external reporting only after appropriate data rights, thresholds and governance.

## 9. Experience architecture and visibility

- **Traveller's prominent entry points:** **My Documents**, **My Trips**, **Sharing & Requests**. These are preferred experience categories, not automatic destructive renames/removals. Existing Record, Master Profile, Dates/Expiry, Cases/Missions, Application Memory, AI settings, billings, exports, and extended options remain discoverable through secondary contextual paths.
- **Agency:** document requests and response triage first; existing case/assignment/notes/export capabilities retained as needed; no general sales CRM.
- **Contributors:** minimal evidence-specific consented task, preserving narrow access.
- **Editors/admins:** Pack Studio, monitoring/verification queue, field data quality and coverage, AI provider settings, billing and control plane preserved.
- Show expiry, mismatches, reclassification, new evidence, source changes and updates **only when relevant** to action, but ensure urgent alerts and full records remain discoverable.

## 10. Non-negotiable no-loss, security and history constraints

1. Retain existing roles, screens, missions, workflows, AI, uploads, history, legal deletion and retention, consent, granular grants, device/browser fallbacks, snapshots, notifications, payments and administration. Preserve old endpoints/deep links while changing emphasis; use additive migrations with rollback.
2. No replatforming, duplicate `Case` vs `Mission` truth store, duplicate `Profile`, rival documents ontology, replacement Pack Studio, separate authorization policy engine, broad category sharing by invitation or fabricated guest wallet.
3. Exact selected document/fact versions and their provenance are pinned at request issuance, agency handoff/review, case acknowledgement and report of external submission, wherever the event asserts a specific copy. Old historical records missing exact-version identifiers remain marked uncertain rather than retroactively fabricated.
4. Keep distinguished: *permission granted*, *authorized access*, *successful retrieval*, *recipient acknowledgement*, *agency review*, *agency acceptance*, *submitted to agency*, *reported submitted externally*, *authority receipt*, *authority decision*. Never infer one event from another.
5. Existing core access controls and safe file-serving boundaries cannot be weakened to make a feature appear complete. Intentionally deferred improvements are tracked with risk and operational truth; no scanner success claim without actual scanning and no blanket blocker on unrelated safe capability.
6. Real client documents and guest uploads demand strict tenant isolation, explicit recipient verification, bounded retention, secure storage, lawful processing and truthful protection disclosure. If an operation cannot be safely supported with the deployed protections, constrain that operation specifically rather than quietly accepting unprotected data.
7. No claim that 100% classification, worldwide official-route coverage, zero visa gaps, application submission or visa approval are guaranteed. Make unsupported/unknown conditions visible. Hardening, performance and rule coverage must be demonstrated by tests and source evidence, not promotional prose.

## 11. Implementation order and integrated acceptance gates

**Preferred dependency-aware execution (additive, not four separate rewrites):**

| Workstream | Product-delivery unit | Preconditions / required proof |
|---|---|---|
| **I. Foundation and audit** | Inventory current routes, schemas, storage/scan/AI, requests/invitations, sharing, pack models, missions and tests; prove production-relevant baseline | Preserve role/data/privacy invariants and identify already-working vs missing pieces |
| **II. Intelligent ingestion + profile continuity** | Universal file/folder entry, large mixed-batch processing, source-backed organization/assignment and exception-only review | Mixed-person and partial-upload tests, idempotency, provenance, no false approval of profile facts |
| **III. Requirement and package correctness** | Necessity/alternative model, route applicability, per-person matching, exact-version handoff and targeted change-impact checks | Mandatories not hidden, recommended not blocking, unknown route not green, old snapshots immutable |
| **IV. Agency-branded request and guest path** | Versioned request creation without applicant, link/email and WhatsApp copy, guest session, account reuse, branded intake/review/correction | No false account claims, no guest wallet, no draft disclosure, exact receipt, tenant/recipient isolation |
| **V. Source governance and field intelligence** | Saturday monitor and editorial pipeline, personal correction suggestions, outcomes provenance and private data-quality reporting | Automated checks not unauthorized auto-publication; verified official source evidence; no misleading approval analytics |

**Notes:** Workstreams II/III may run in parallel where interfaces are stable. Source governance begins as soon as supported official packs are used for package readiness; final-handoff freshness checks must not be deferred until worldwide source coverage. Agency request can reuse minimal route packs and a visibly agency/manual checklist where official coverage is incomplete. Continuous matching is part of III and extends through IV/V. Multi-traveller packages must be delivered using existing per-person mission semantics and permission boundaries. Split work into reviewable PRs with rollback and regression evidence, not one destructive release.

**Acceptance scenarios inherited without dilution:** All 12 Record-to-Trip scenarios (Source L2), all checklist/source/outcome tests (Source L3), and all 20 agency-collection cases (Source L4), plus the no-loss criteria of L1. Passing a source code check alone does not certify real inbox/phone/browser experience. Acceptance must distinguish source implementation, tests, signed-in runtime, production configuration and real operator usage.

## 12. Decisions still requiring engineering validation (not permission to invent product behaviour)

- Actual supported browser/mobile folder APIs, upload batch chunk sizes, file formats, quotas, OCR behavior and safe scanning/storage arrangements.
- Canonical schema relationships for guest request/session/manifests, request-specific applicant identity hints, single-use verification and conversion consent; no guest foreign key to a fabricated `applicantId`.
- Data source coverage and administrative maintenance cost for official rules, including jurisdiction-specific pages, policy changes and citation/effective-date management.
- Exact per-person/group trip abstraction over existing mission IDs and itinerary references; data grants/guardian proof remain enforced.
- Agency operator permissions and existing invitation semantics before migration; confirm consent, link expiry, recipient binding and brand behavior against current code.
- Actual analytics coverage, outcome provenance, lawful processing and report thresholds; no invented visa-success correlations.
- Performance/cost/latency budgets, browser-accessibility and visual quality, real client usability; monetization and adoption are **unproven hypotheses** until measured.

**Interpretation rule:** Resolve engineering-specific unknowns by auditing actual code and tests and choosing the smallest compatible implementation. Escalate genuine legal/permission/business trade-offs for explicit owner decision. Do not treat an unknown as proof of a missing feature or invent a different product to avoid an implementation difficulty.

---

# Original Locked Contracts -- Lossless Source Annexes

The following four texts are embedded unchanged. The SHA-256 fingerprints in the manifest confirm the exact original bytes included at the time of consolidation. If a later edit changes an original source clause, that must be an explicit new version of this master, not a silent overwrite.

### Source manifest

| ID | Source contract | File | Original SHA-256 |
|---|---|---|---|
| L1 | Product Identity, Version Handling, Commercial Direction and No-Loss Preservation | `VisaStack_Product_Decision_Lock_No_Loss_Commercial_Direction_2026-11-02.md` | `fef4d7e10f1e9a030a45c1133bd3423502285fc4b7f59e853ce84417d0926dbe` |
| L2 | Intelligent Record-to-Trip Experience | `VisaStack_Intelligent_Record_to_Trip_Experience_LOCK_ADDENDUM_2026-11-02.md` | `6b3c9d1996323b0adcb8672d61f885183684a1f0fbdde5e635035e0ea17aa132` |
| L3 | Requirements, Checklists, Saturday Monitoring and Field-Outcome Intelligence | `VisaStack_Checklist_Requirements_and_Field_Intelligence_LOCKED_2026-11-02.md` | `32f8299a84dddbb170bc5afee32af3d626a202da43b9e995d1be6f787af34aed` |
| L4 | Agency-Initiated Checklist Collection and Branded Client Experience | `VisaStack_Agency_Initiated_Checklist_Collection_Experience_LOCK_ADDENDUM_2026-11-02.md` | `3365ad018a959e88fbeca8de2e10ff5746241ac64339f33cc786517d752eb410` |

---

<!-- EXACT SOURCE START L1: VisaStack_Product_Decision_Lock_No_Loss_Commercial_Direction_2026-11-02.md -->
# VisaStack -- Product Direction & No-Loss Preservation Lock
**Decision lock:** 2 November 2026  
**Authority:** Explicit owner direction in the OGS/TR/VS conversation  
**Related field baseline (left unchanged):** `VisaStack_Field_Workflows_and_Document_Journeys_LOCKED_v1_2026-11-01.md` (v1.1)  
**Purpose:** Set the product boundary and a non-regression contract. This is a *product and delivery decision*, not a declaration that any unverified production security measure or real-user journey has passed acceptance.

## 1. One-sentence product definition (locked)
VisaStack is **traveller-owned travel-document and declaration-history infrastructure**, enabling people to keep reliable, current records, recover what they previously declared, and exchange precisely identified documents and information with authorized agencies and contributors--while enabling agencies to request, collect, review, request corrections, and work with the right evidence.

It is **not** an agency lead-generation or enquiry CRM, visa consultancy marketplace, or government filing system. Visa service and official submission normally occur outside VisaStack. Existing case, preparation, snapshot, and submission-report functions are retained as supporting capabilities, not deleted.

## 2. Three user experiences (locked priorities)
1. **Traveller -- enduring record first.** Find and add documents and facts, know what is current, notice expiry or change, answer agency document requests, control the scope of sharing, see what was shared and with whom, and revisit past declarations and reported applications. No case or complete profile required just to add a file or answer a request.
2. **Agency -- document work first.** Request specific evidence from an existing customer, see what is waiting/received/needs correction/accepted, communicate precise deficiencies, and refer back to the exact document copy used in a review. Other case tools remain available but secondary; do not introduce general sales CRM.
3. **Contributor -- narrowly assigned evidence.** Supply a named item or complete a specifically authorized review with only the necessary information and a proportionate entry/sign-in experience. Existing security protections and contributor permissions remain.

## 3. Version tracking principle (locked)
> **Do not teach people version control. Eliminate the confusion that makes it necessary.**

- Automatic technical version and provenance tracking remains part of the underlying system; do not replace it with a complex user-facing version-management product.
- Ordinary language is **Current copy**, **Earlier copy**, **Updated**, **Shared with**, **Received**, **Reviewed**, **Accepted for this request**, **Needs correction**, **Reported as submitted**. Use 'version' only in expandable detail or when a dispute requires precision.
- A document *record*, file *version*, related but distinct period/source document, case selection, grant, access, agency review, and external submission are different objects and events. Do not merge them to simplify the data model.
- A clearer scan may be another file version; a new bank statement period is distinct evidence; a renewed passport is a separate passport record linked to historical identity. Do not impose a single universal 'replace' rule.
- Shared or reviewed historical evidence must not silently turn into the latest file when the traveller adds another copy. The recipient's scope and the agency's reviewed/accepted copy must be explicit.
- Distinguish **permission granted**, **access authorized**, **file actually retrieved**, **recipient explicitly acknowledged**, **review decision**, and **reported external submission**. Do not claim proof of an event that the system did not observe. An external downloaded copy cannot be recalled.
- Prior case snapshots and declared fact versions remain historically intelligible and appropriately protected from silent rewriting; legally valid deletion and retention boundaries still apply.

## 4. Functional preservation: absolute non-regression rule
**A new direction is not authority to delete, disable, replace, or silently hide features already implemented.** Treat this as additive simplification and focused correction; keep existing capabilities functional and accessible through appropriate context, secondary navigation, or administrative surfaces. 'Not central' never means 'remove'.

Preserve, at minimum, the existing implemented families and their relevant data, authorizations, tests and UI routes:
- Traveller account, person/family/guarded-minor records; manual editable facts, immutable fact versions and comparison history.
- Document vault and upload flows, categorization, naming, original/preview controls, automatic and manual interpretation, OCR/AI suggestions with human approval, file versions, reference codes, date/expiry/reminders.
- Document archive/restore, replacement, duplicates, recently deleted, removal requests, retention/legal holds and recovery semantics.
- Existing application/mission/case creation, requirements packs, evidence selection, completeness/readiness, tasks, appointments, snapshots, confirmations, reported submissions, outcomes and Application Memory (even where not in primary navigation).
- Agency organization admission, membership, verified standing, client and team invitations, evidence requests, request item clarification, review/decision states, assigned-case coordination and existing exports.
- Person/org sharing, grants, scope, purpose, expiry, invitations, case exceptions, pause/revoke/resume, access transparency, authorization, audit and consent.
- Contributor requests and access controls, including narrow third-party uploads.
- Profile and visa photos, selected outputs, safe-copy/redaction structures and relevant file processing.
- Notifications, scheduled jobs, customer/account communications, configured AI provider management, AI connector, admin/control plane, legal/privacy and account-export capabilities.
- Existing billing, plans, invoices, refunds, entitlements, operational accounting and administration--even if sales activation is deferred or UI priority changes.
- Existing identity, isolation, private storage, cryptographic protections, logs, safe preview pipeline, controls and tests; existing GitHub/Vercel/Neon/R2/Resend integrations or equivalent retained adapters.

**Implementation guardrails:** No destructive DB migrations, data rewriting, route removal, permission broadening, deletion of tests, blanket feature flags, stealth deprecation, or removal of existing access paths merely to satisfy an aesthetic redesign. Before any change, inventory affected call sites, tests, migrations, user roles, state transitions and in-flight records. Use additive, backward-compatible changes and explicit migration/rollback paths where changes are necessary. Preserve older case/snapshot formats and accurately mark unknown older provenance.

## 5. Product boundary and experience priority
- **Primary:** enduring personal records; documents and freshness; document request/collection; permissioned sharing; exact-copy coordination; historic declarations and application memory.
- **Secondary but preserved:** destination cases, readiness checklists, review, form/packet preparations, reported submissions/outcomes, agency case operations and existing commercial infrastructure.
- **Not a growth mandate:** inquiry sourcing, lead capture, CRM pipelines, consultative sales/quotes, generic agent workforce software, marketplace brokering, visa approval predictions or guaranteed government integrations.
- **UX instruction:** Present one next useful document/information action to each actor. Retain deep functionality by progressive disclosure; simplify prominence, grouping, terminology and the common path, not by amputating underlying options.

## 6. Commercial direction (owner decision) versus readiness claims
**Commercial is now the product and operating target.** Do not repeatedly frame product strategy, UX or commercial planning around an incubating/pilot identity, and do not treat every planned hardening improvement as a reason to stop useful product development or ordinary low-risk functionality. Prioritize acquisition, value, paid adoption and execution.

**Do not falsify operational state.** The repository and deployment may still expose actual feature flags, compliance gaps, configuration limitations and tested/untested journeys. The product strategy decision does not magically prove real-data acceptance, change a deployment flag or certify security. Do not remove warnings, misstate file safety, claim privacy/security compliance, or hide known unresolved issues simply to display 'commercial'.

**Defer upgrades proportionately, not essential protections.** Features can remain in operation while enhancements to scanning, key management, independent recovery, payments, legal materials or security assurance are planned, subject to deliberate owner risk decisions. Existing authentication, tenant separation, purpose-bounded permissions/consent, private data handling, safe file-serving, audit and erasure safeguards must **not** be weakened or disabled. A structural file checker is not antivirus. If an unmitigated risk attaches to a particular operation (for example, accepting/serving an untrusted executable or active document), contain or restrict that risky operation while keeping unaffected product functions available. Record remaining risk and owner decisions accurately. No unconditional assurance of sensitive-data safety without evidence.

**Not in scope of this lock:** making environment changes, enabling real applicant data, bypassing a security gate, changing financial switches, asserting legal compliance, or approving a launch. Those are separate operational decisions.

## 7. Focused work, without re-platforming
1. **Exact-copy exchange contract:** Audit and correct version semantics across document grants, requests, agency decisions, file-access events and immutable histories. Prefer existing IDs, services, audit and storage; add the smallest necessary references/events. Ensure an exact-copy share does not silently grow with a new upload; explicitly preserve intentional broad-access modes where already supported. Prove old and new pathways by tests.
2. **Natural everyday paths:** Verify an agency can request a customer's documents without an unnecessary full visa case; a traveller can respond without unnecessary setup; a contributor can supply a named document; and a traveller can record earlier external applications without inventing a past VisaStack submission. Fix gaps additively.
3. **Experience calibration:** Record-first traveller home and document-work-first agency workspace, with existing advanced functions still discoverable; accurate 'current vs shared vs reviewed' language, low-friction corrections and progress. Avoid large redesign before evaluating current UI and role journeys.
4. **Commercial operations:** Measure actual agency collection time saved, corrections per file, case-document handoff accuracy, retention, paid conversion and support burden. Do not treat new registrations as revenue.

## 8. Acceptance criteria for all subsequent implementations
A proposed change passes only if:
- Nothing previously working is lost, inaccessible, less authorized than intended, or semantically changed without an explicit decision and migration plan.
- Existing unit, integration, access-policy, lifecycle, UI and historical-recovery tests remain green, plus new tests for any changed behavior.
- A traveller can add/update/retrieve own evidence; answer an agency request; understand which exact copy was shared and what the agency actually did with it.
- An agency can request/review/return evidence and distinguish the copy reviewed from a newer upload, without seeing unrelated traveller records.
- Historical facts and previous declarations remain discoverable, with accurate source/certainty labels and a real historical-entry path where applicable.
- Security/privacy protections already implemented remain active; any unverified or deferred production hardening is candidly documented, not asserted completed.
- No marketing or UI claims an authority verified or received something solely because VisaStack stored or forwarded a file.

## 9. Change-control instruction for engineers/agents
**READ → INVENTORY → TEST EXISTING → DESIGN MINIMUM ADDITIVE CHANGE → IMPLEMENT → REGRESSION CHECK → REPORT EVIDENCE.**
Never interpret 'simpler product' as 'smaller codebase at any cost'. No rewriting working parts to satisfy a new metaphor. Any proposal to remove/hide/replace an existing behavior must identify that behavior, its users and dependencies and obtain a separate explicit owner decision. The required report has four columns: **Existing preserved | Exact change | Evidence/test | Residual risk**.

## 10. Decision status
**LOCKED PRODUCT INTENT; NOT A CODE CHANGE OR LAUNCH CERTIFICATION.**
This document supersedes previous assistant proposals that positioned VisaStack as a travel-agency inquiry/CRM or a mandatory application-preparation service. It does **not** supersede the v1.1 research baseline, versioned application facts, legal requirements, safety invariants or actual production configuration.
<!-- EXACT SOURCE END L1: VisaStack_Product_Decision_Lock_No_Loss_Commercial_Direction_2026-11-02.md -->

---

<!-- EXACT SOURCE START L2: VisaStack_Intelligent_Record_to_Trip_Experience_LOCK_ADDENDUM_2026-11-02.md -->
# VisaStack -- Intelligent Record-to-Trip Experience
**BINDING PRODUCT-EXPERIENCE ADDENDUM · 2 November 2026 · v1.0**

**Source:** Owner-provided ten-section statement, “VisaStack -- From a Document Vault to an Intelligent Travel Record,” reproduced in the conversation on 2 November 2026. This addendum resolves omissions identified by comparing that statement to the previously locked documents.  
**Decision status:** LOCKED PRODUCT INTENT; not evidence that a capability has been implemented, tested or released.  
**Preservation/precedence:** Additive to, not a replacement for:
1. `VisaStack_Product_Decision_Lock_No_Loss_Commercial_Direction_2026-11-02.md`
2. `VisaStack_Checklist_Requirements_and_Field_Intelligence_LOCKED_2026-11-02.md`
3. `VisaStack_Field_Workflows_and_Document_Journeys_LOCKED_v1_2026-11-01.md`

Where the documents cover distinct concerns, all govern. Where experience semantics need clarification, this addendum is more specific about ingestion, Master Profile assembly, continuous package matching, grouped travellers and navigation, **without** weakening existing security/permission/version/history or requirements-source rules. No destructive refactoring or deletion is authorized. Existing route, pack, case, document, profile, AI, sharing, billing and admin capabilities remain functional. Commercial deployment is the operating target; do not falsify the operational state or deactivate safety controls to meet it.

## A. The two non-negotiable user promises

1. **Put everything in.** A person drops files and folders (or selects files/takes photos), with no required prior categorization, naming, master-profile completion or visa-case creation. VisaStack organizes what it can support, associates it with appropriate records, and asks only essential clarifications.
2. **Get what's needed out.** The person specifies destination, purpose and travellers. VisaStack selects the correct **supported official route**, uses current source-verified requirements, matches authorized evidence and confirmed facts, and prepares separately reviewable per-traveller packages with explicit unresolved gaps. A user can choose evidence, add/change/remove their own selection, approve and share an exact-version package without rewriting the past.

**Operating principle:** The traveller manages intentions and consequential decisions; VisaStack does the repetitive document work. The product is judged by minimal effort from messy files to accurate, explainable handoff--not by a crowded feature catalogue.

## B. Intelligent ingestion -- full functional contract (previously incomplete)

### B1. Entry and import
- Provide a universal **Add Documents** entry and drag-and-drop area without category hunting. Preserve current person-scoped upload pages, camera capture and optional manual document-type selection for those who want them.
- Support mixed-file batches and **folder ingestion where browser/device APIs permit**; provide an equivalent multi-select fallback where folder selection is unsupported. Avoid promising native folder access on every mobile browser.
- Handle an unsorted batch of 80+ files without silently discarding files beyond the existing 20-per-drop cap; use explicit queue/chunk processing, robust per-file progress, controllable resource budgets, and continuation/retry. This is an experience requirement, not an instruction to discard current per-file or upload-safety limits.
- Apply reliable idempotency/deduplication of retries and resume/unknown-outcome handling. Report per-file results accurately: waiting, received, processing, organized, needs decision, not supported, failed, and unresolved; never claim upload/scan completed just because the browser dispatched a request.
- Treat unsupported formats or oversized files explicitly; maintain safe quarantine/format policy and existing private-file/authorization invariants. Do not change file-size or PDF/scanner gates without a separate verified deployment design.

### B2. Processing pipeline and record semantics
For each accepted file, orchestrate the **existing** safe intake, extraction, classification, AI suggestions, naming, document, fact, audit and lifecycle services. Add orchestration, not a parallel truth store.

Each result should support, where evidence permits:
1. **Identify** document category and subtype using deterministic recognition first, optionally assisted by approved AI configuration; label uncertainty.
2. **Name** using person, document type, issuer/period/date where verified; never invent an identity, official status, date or missing field. Avoid collisions while retaining original filenames and reference IDs.
3. **Assign** to the correct managed person **only where supported by sufficient source evidence or explicit choice**; uncertain or conflicting ownership stays unassigned/awaiting decision. Never use folder path or filename alone as proof of identity or permission.
4. **Extract** source-backed candidate profile values, repeating records, dates, identifiers and document relationships. Retain document/file/version/page provenance where available; do not silently convert unapproved extraction into a user's confirmed declaration.
5. **Organize** using canonical Master Profile and document catalogues; no separate invented profile schema, duplicate mutable identity record or mandatory manual re-entry.
6. **Relate** exact byte duplicates, new scan of same underlying item, revised evidence, different statement periods, renewed passports, historical application forms and cross-referenced documents without conflating distinct real-world documents.
7. **Check** document readability/quality, completeness when detectable, date and period consistency, expiry, ambiguous identity, contradictions and stale evidence; distinguish *document itself expired* from *ineligible under a specific route's freshness rule*.
8. **Preserve** originals, access provenance, previous versions, historical fact states and authorized lifecycle/removal protections; do not allow an updated copy to silently mutate a previously shared/approved/submitted snapshot.

### B3. No premature demand for perfect classification
- **Clearly identified:** Automatically file, name and relate the source, without gratuitous confirmation of metadata that is objectively grounded. Still follow existing approval requirements for profile truth or protected information.
- **One decision needed:** Ask one focused question about an ambiguous person, date, document type or conflicting important fact, ideally with source evidence shown securely.
- **Not confidently understood:** Retain safely in an intelligible unclassified area; do not invent category, owner, document identity or profile data.
- **Processing failed/unsupported:** Show the true failure and recovery path; never represent an unparsed file as verified and organized.
- Review UI is an **exception queue**, not a requirement to inspect/approve every file and every extracted field. Existing consent, protected-document AI choices, manual fallback and actual fact-approval controls remain.

### B4. Progressive Master Profile
- Current source-observed facts, traveller-confirmed facts, historical facts, superseded values and conflicting statements remain distinguishable by state and provenance. One user's data cannot be merged into another person's facts based only on similar names.
- A newly added employment letter, financial statement, renewed passport or marriage certificate may **propose** updates, connect historical periods or identify conflicts; the old source and the old time-valid statement remain accessible, subject to lawful retention.
- Master Profile remains editable manually. Someone who never uploads any document can still use existing forms and workflows.
- The record should answer: *What does current evidence establish? What is uncertain? What changed? What did I declare for a previous application? Which source and exact version supported it?*

## C. Trip preparation and package composition -- exact experience

### C1. From an intention, not from an empty case form
- **Minimum conversational/form intent:** destination, purpose, travellers; obtain dates, application place, route/subroute, nationality/residence, duration, funding/host and other critical conditions from confirmed records where possible, then ask only unresolved applicability questions.
- Never guess between different official visa routes or silently equate country+purpose with a legally correct checklist. Unsupported/uncertain route = appropriately explained **manual verification**, not fake completeness.
- Reuse existing published `packVersions`, requirements, typed conditions, `missions`, evidence selections, snapshots, acknowledgment and Application Memory. Do not invent a duplicate parallel `cases` table to implement a new label.
- Compose **official mandatory**, **conditional**, **accepted alternatives**, **recommended/good-to-have**, **optional**, **user-added** and **specific agency/authority requests** in separate semantic layers, as in the requirements lock.
- Match exact current eligible fact/document versions, with validity periods, source evidence, route freshness constraints, conditions and exceptions. Newer is not always right. Shared/common evidence can satisfy multiple requirements without duplicated bytes.
- Preserve choices such as **Use this copy**, **Choose another**, **Add**, **Replace**, **Provide original externally**, **Not available**, and **Exclude optional item**. Altering a case package never deletes the canonical rule or rewrites historical submissions.
- Prepare a faithful, reviewable exact-version handoff packet and checklist. Clearly identify external steps: official forms, portals, appointments, biometrics, payment, translations, original-document presentation and any authority-specific tasks.

### C2. Three primary readiness phrases
1. **Needs attention:** At least one applicable mandatory gap, unresolved applicability, material source uncertainty, conflicting/stale evidence or missing required confirmation remains. Recommended-only missing evidence does **not** block.
2. **Ready for final review:** For a supported, sufficiently verified route, known required evidence/conditions are covered and available technical/consistency checks have passed to the extent observable. This is not authority acceptance or filing.
3. **Prepared for handoff:** Traveller has selected/confirmed an exact package and identified remaining external procedures and caveats. This does not mean submitted or officially received.

Existing backend mission readiness statuses and state transitions are **preserved**. These are customer-facing derived concepts only; map carefully to actual services without claiming scanners, official certification or external submission that did not occur.

### C3. Exact version and exchange contract
- A prepared package's chosen fact versions, document versions, hashes/references (where available) and requirement-pack version are frozen/traceable.
- A later upload, updated fact or newly published official requirement must **not** silently rewrite a prepared or shared packet. A fresh version/review decision is needed for a changed handoff.
- Distinguish granted permission, link generation, served bytes, explicit recipient acknowledgement, request review, acceptance and traveller-/agency-reported external submission; label events only when evidence for that specific event exists. Already downloaded external copies cannot be revoked.

## D. Group trips and family packages -- complete contract

- In the UI ask **Who's travelling?** and offer **Add Travellers**; use a dropdown/list of people actually managed or explicitly available through valid authorization. Do not imply every household member has identical ownership/consent.
- One **Trip** is the shared travel intention and itinerary. Each participant has an independent **mission/application package** and per-person snapshot, identity, requirements, permissions and outcome. Link to existing `itineraryRef` and missions without destroying the existing single-person journey.
- A single trip may involve different nationalities/residences, ages, routes, application offices, sponsorship conditions and required documents. Derive requirements separately for each traveller; a child's consent/guardian requirements cannot simply copy an adult's checklist.
- Accommodation, shared bookings, invitations and sponsor evidence may be referenced by multiple eligible packages. Reuse storage where access and retention rules permit without copying or exposing other people's unrelated private data.
- Coordinated changes to trip dates or itinerary should trigger assessment of all affected packages. A change to one person's passport or facts affects that person's package and only other packages where the change genuinely affects shared requirements.
- Adding/removing a participant never gives that participant default access to another person's profile or document vault. Preserve existing guardian, consent, source-scoped sharing and document-access boundaries.

## E. Continuous matching and context-aware notifications -- mandatory

**Event sources:** new upload, processing/classification completion, approved fact change, relevant document replacement, document expiry/aging, changed travel dates or participants, newly verified requirement version, withdrawal/uncertainty of an official source, and specific agency/authority evidence requests.

For each changed event:
1. Find only impacted **active** trips, person packages, requirements and affected document assignments; use indexed, bounded/idempotent background work, not expensive global rescans.
2. Re-evaluate relevant rules and source freshness against the specific traveller/case; compare previous versus candidate matching and evidence validity.
3. If non-material, update internal derivation and do not interrupt the user. If material, produce a **precise suggested action** (e.g. “Newer statement available for your Japan trip; review before sharing”).
4. Never silently change a previously chosen, acknowledged, shared or reported-submitted exact version or give an agency automatic access to a new file unless an existing permission explicitly and legitimately covers that evolution; even then, describe scope faithfully.
5. Keep historical outcomes and case snapshots stable, record how and when a warning was generated, and deduplicate related notifications.

Expiry and document validity already built stay functional, but surface **in context when useful**, not as permanent clutter. Important urgent alerts remain accessible; users can inspect full detail on demand.

## F. Navigation: three prominent user entry points, all existing functionality retained

**Primary experience categories (subject to parity-aware UX mapping):**
1. **My Documents** -- add/find documents, current-versus-historical records, source-backed profile growth, and contextual access to Master Profile/manual editing.
2. **My Trips** -- express intention, add travellers, prepare/adjust individual packages, view readiness and historical journeys.
3. **Sharing & Requests** -- share exact evidence, review recipients and prior access, answer agency requests and corrections.

These are **information-architecture priorities, not authorization to rename/delete old routes or hide working features.** Map all current traveller/agency/contributor/admin roles, account features, history, billing, AI, templates, previews, outputs, notifications, profile editing, advanced cases and existing deep links. Preserve discoverable advanced workflows and existing navigation functionality until UX acceptance and parity checks pass. Agency home remains document-collection first; not a sales CRM. Keep supported manual-only or agency-specific workflows accessible.

## G. Explicit delivery dependencies and scope controls

- **E1 Intake:** universal drop/import, queues, organization, person assignment, source-grounded profile proposals and exception review. Can be delivered without waiting for the entire global visa-rule catalogue.
- **E2 Trip/package orchestration:** requires the existing mission/pack baseline plus the relevant necessity, route applicability and evidence-matching improvements from **R1** of the checklist contract; does not need all countries supported on day one.
- **E3 Family packages:** builds on E2 with shared trip and cross-package coordination; preserve individual mission invariants.
- **E4 Continuous matching:** extend from E1/E2; shipping targeted change-impact recalculation is part of the end-to-end experience, not merely a later marketing feature.
- **R2 Saturday official-source monitoring:** develops alongside E2; governed publication is mandatory; final-review freshness checks remain important even before full monitoring coverage.
- **R3 User additions and correction suggestions; R4/R5 field outcome intelligence:** continue as per the companion locked contract, using case snapshots and genuine recorded submissions/outcomes, never an assumed visa decision.

Commercial priority: demonstrate the low-effort import → record reuse → route-accurate package → review/handoff cycle on a bounded set of supported routes before expanding to every geography, document format or edge case. Track processing success, critical identity-assignment errors, effort/time-to-first-useful-result, manual clarification burden, document matching correctness, source coverage and currentness, package readiness/handoff, repeat use, agency rework, storage/AI processing cost and eventual paid conversion. These are **metrics to measure**, not asserted traction or target attainment.

## H. Acceptance scenarios (binding, testable)

1. **80 mixed files:** A signed-in owner drops/selects 80+ mixed files including folders (where supported). The app queues all accepted supported files without silently losing the 21st onward; statuses and retries are truthful; unchanged duplicate retries do not create duplicate records; permitted limits and fail-closed file handling remain.
2. **Three-person folder:** Documents for adult A, adult B and child C are mixed. Correctly grounded identities are associated only with the right authorized person; two similar surnames do not cause silent cross-person merging; uncertain files remain unassigned pending a concise question.
3. **Near-duplicate vs different evidence:** Two scans of one passport, an older and renewed passport, a corrected employer letter, and monthly bank statements are not treated as the same type of replacement. Originals/history remain traceable, no silent deletion.
4. **Profile growth:** Upload supported evidence of name/DOB/employment/marriage; the system surfaces source-backed candidate facts and required approval, flags conflict with an existing confirmed fact, and keeps older time-valid values.
5. **No-case import:** A traveller can import files with no existing case, category selection or completed profile. The user sees a real useful organized result without first completing optional onboarding.
6. **Route accuracy:** The same adult gets genuinely different checklists for tourism, business and medical travel on distinct supported routes; irrelevant sensitive medical items are absent; mandatory/conditional/alternatives/recommendations are distinct and source-supported.
7. **Family trip:** A shared trip with adult A, adult B and child C generates separate person-specific packages with appropriate nationality/guardian conditions, legitimate shared itinerary evidence and no privacy leakage.
8. **Relevance change:** After preparing a package, the owner adds a newer bank statement; the affected live package receives a focused review suggestion, while its previous approved/shared packet remains frozen and outside recipients do not silently acquire the new copy.
9. **Requirement update:** Saturday source monitoring detects a genuine change and queues a verifiable candidate. Before substantive publication a reviewer approves it; previously prepared packages retain their old rule version; affected active packages receive an impact check, not silent edits.
10. **Readiness truth:** A missing mandatory item blocks a positive assessment; a recommended-only missing item does not; unknown conditions/source coverage cannot appear as officially complete; a packet prepared for handoff is not described as filed.
11. **Continuity/no loss:** All old role journeys, current UI routes, invoices/plans, providers, AI toggles, raw storage, existing cases, snapshots, access policies, record history, agency flows, exports and legal lifecycle remain available and tested; no hidden removal for a prettier homepage.
12. **Field intelligence integrity:** An evidenced approved outcome, a self-reported refusal, a pending application and a prepared but unsubmitted package count in distinct groups. Comparative reports disclose denominators, provenance and missing outcomes, and never infer that optional evidence caused visa approval.

## I. Required engineering audit and reporting

Before implementation, map existing services and client routes for upload, OCR/extraction, AI approval, person relationships, facts, documents, lifecycle, packs, missions, snapshots, evidence selection, family `itineraryRef`, grants, notifications, case outcome tracking and UX navigation. Identify which acceptance scenarios already pass, which are partly supported, and which are net-new; avoid implementing what already exists. Prove baselines; make additive changes with safe migrations, access tests, error handling and performance bounds. On completion report:

`Existing preserved | Code changes | Data/permission changes | Acceptance evidence | Unverified edges | Rollback`.

**Not authorized:** deleting existing capabilities; duplicate master-profile/case/vault storage; treating AI text as verified truth; falsely claiming 100% automatic accuracy; globalizing a family's access; silently updating submitted evidence; synthesizing official checklist rules without sources; auto-publishing substantive requirements; hiding source uncertainty; redefining a successful upload as an approved visa application; claiming commercial safety gates passed without evidence.

## J. Final locked summary

> **VisaStack turns unsorted evidence into an enduring, source-attributed personal travel record, and turns a specific travel intention into accurate, editable, individually evaluated trip packages. Documents and rules evolve; past shares and submissions do not silently change. The system asks humans only for consequential decisions, makes necessary alerts contextual, preserves all implemented functions and learns from outcomes only with dependable provenance and appropriate privacy controls.**

**STATUS: BINDING ADDENDUM TO EXISTING LOCKED CONTRACTS; NO REPO CHANGES MADE.**
<!-- EXACT SOURCE END L2: VisaStack_Intelligent_Record_to_Trip_Experience_LOCK_ADDENDUM_2026-11-02.md -->

---

<!-- EXACT SOURCE START L3: VisaStack_Checklist_Requirements_and_Field_Intelligence_LOCKED_2026-11-02.md -->
# VisaStack -- Intelligent Requirements, Checklist & Field-Outcome Intelligence
**PRODUCT DECISION LOCK · 2 November 2026 · v1.0**

**Decision owner:** Product owner, OGS/TR/VS project.  
**Status:** **LOCKED PRODUCT CONTRACT -- proposed additions, not implemented code or evidence of readiness.**  
**Relationship to prior decisions:** **Additive companion** to `VisaStack_Product_Decision_Lock_No_Loss_Commercial_Direction_2026-11-02.md` and `VisaStack_Field_Workflows_and_Document_Journeys_LOCKED_v1_2026-11-01.md`. It **does not** supersede, erase, or reduce those contracts or existing implemented functions.  
**Inspected repository baseline:** `sadatnitex/visastack`, `main` SHA `ab6ce2a8b4f83623befac4b2aea68628385406bf` (2 November 2026). This is source inspection, not a full authenticated production test.

## 0. The permanent product proposition

VisaStack is enduring **traveller-owned document and declaration-history infrastructure**, connecting organized records to **destination-, route-, purpose-, and person-specific application checklists**. The person uploads documents with minimal sorting; VisaStack builds a source-attributed record, identifies which evidence can be reused, and helps assemble reviewable, precise packages for each traveller. An agency can request and review the exact evidence shared, without VisaStack becoming an inquiry/sales CRM or an official government submission channel.

**Commitments:**
1. **One governed requirements catalogue, many individualized checklists.** Maintain a broad MECE-organized taxonomy of requirement types, while the actual requirements are route- and circumstance-dependent. Do **not** display the entire taxonomy for each trip.
2. **Mandatory versus good to have must be unmistakable.** Preserve whether something is an official requirement, a conditional requirement, optional guidance, an alternative way of fulfilling a requirement, a case-specific request, or a user-added item.
3. **Review official sources every Saturday** through scheduled, traceable source monitoring, with appropriate change triage, governed publication, and active-case impact evaluation. A fetch is not proof of legal correctness.
4. **Travellers can customize each trip's checklist** without rewriting or falsifying the canonical rule library, and can suggest corrections for VisaStack's editorial review.
5. **Learn from real field outcomes, transparently.** Record what VisaStack's users actually prepared, what they report submitting, any independently evidenced external decision, and how the route/context relates to outcomes. Make aggregate, privacy-safe reports and improve advisory guidance, without treating correlation as proof that a document caused a visa approval.
6. **Protect existing functionality absolutely.** Extend existing facts, document lifecycle, person/family, missions, immutable pack versions, readiness states, sharing and access, audit, billing, administration and exports. No destructive data or permission changes are authorized by this lock.

## 1. Catalogue structure: MECE for taxonomy, not forced exclusivity of evidence

Use one canonical classification hierarchy with no duplicated definition identity:
- Identity / nationality / passport and travel documents
- Immigration status, visas and travel history
- Applicant declarations, personal circumstances and legal/background records
- Financial means and evidence of funds
- Employment, professional, corporate and business activity
- Education, research and academic admission
- Family, relationships, guardianship, host and sponsorship
- Journey purpose, itinerary, accommodation and transport
- Medical and health-related documentation (only where a particular route actually requires it)
- Application forms, photos, translations, attestations, appointment, payment and submission procedures
- Other exceptional route-specific evidence, governed with named taxonomy ownership

**A single requirement gets one primary category and stable logical identifier.** The same document may satisfy multiple requirements; a requirement may accept alternative documents. No duplicate upload is demanded because two sections reference one file. Categories are for organization; users need not navigate them to upload.

**Do not confuse:** (a) field/information needed, (b) document/evidence needed, (c) formatting and attestation instructions, (d) a step in the application process, and (e) advice to improve explanation or clarity. Existing `FIELD`/`DOCUMENT` pack requirements are retained; any new requirement kinds or linked guidance must be additive and backward-compatible.

### 1.1 Exact necessity labels and semantics

| Label shown to the user | Source status and meaning | Effect on package |
| --- | --- | --- |
| **Mandatory** | Reliable applicable source explicitly requires item for this route and applicant | Missing/unacceptable evidence remains a blocking gap; user cannot mark it satisfied by removing it from their display |
| **Mandatory if applicable** | Official requirement triggered by conditions (e.g., minor, sponsor, treatment) | Required only after conditions established; unknown conditions need a clarification, not silent exclusion |
| **One of these is required** | Officially accepted alternative means (OR-group) | Satisfy by a valid permitted alternative; not by all alternatives |
| **Recommended / Good to have** | Legitimate, source-attributed guidance or separately identified VisaStack field observation; **not** an official universal mandate | Non-blocking; show only where materially helpful, with reason and provenance |
| **Optional** | User/agency may add it, but no established requirement | Non-blocking, not positioned as a prerequisite |
| **Additional request** | Specific documented request from an authorized application centre, consular authority, or agency | Show identity/date/requester, distinguish authority from agency practice; authority-specific mandatory implications require evidence |
| **Not applicable** | Conditions explicitly do not apply | Hidden from ordinary checklist or viewable in details; never treated as missing |
| **Needs clarification / source not verified** | Applicant context/source is incomplete or contested | No fake green readiness; ask a bounded question or refer for manual verification |

**Important:** "Recommended" is not the same as "mandatory"; frequent submission of a file or association with approved applications does not change the official classification. Conversely, a document missing from observed successful cases cannot invalidate an official mandatory rule.

### 1.2 Canonical rule record (minimum model semantics)

Each requirement has: stable logical key; primary category; evidence/field/procedural subtype; destination; legal visa route/subroute and purpose; applicant nationality and residence applicability; place-of-application/consular jurisdiction; passport/status/age/guardian and relevant circumstances; exact obligation / conditional AST; alternative-group relationship; accepted evidence types; document time/validity rules; required originals/translations/certifications/format; source URL/publisher/excerpt and independent VisaStack interpretation; source rank/authority and jurisdiction; source last checked, last **verified**, publication/effective/withdrawal dates; rule revision; review owner; immutable package/pack references; exception and override metadata. Preserve older pack versions and their source snapshots (subject to legitimate retention/deletion rules).

Apply a **typed, bounded conditional-rule engine** (extend existing `rule-conditions.ts`, never arbitrary executable logic). Unknown values are **unknown**, not "does not apply". Never infer an undisclosed medical diagnosis or sensitive circumstance simply because evidence is present.

## 2. Checklist generation and exact package assembly

### 2.1 Minimum input

The traveller says **where**, **why**, and **who is travelling**. Read confirmed, authorized person records for nationality/residence/passport context. Ask only questions that change rule applicability or necessary evidence: application location, precise visa route, dates/duration, purpose, funding/host, age/guardian, relevant status and circumstances. Ask progressively, not a full onboarding questionnaire.

### 2.2 Build for each traveller

1. Identify a **supported route**, using verified official route rules. If route selection is ambiguous, present alternatives or ask; never auto-pick a wrong route. Explicitly label unsupported or partially covered routes **manual verification required**.
2. Freeze the selected **published pack version** into the case/mission context and evaluate all conditions, OR-groups, dates, freshness and exceptions.
3. Generate a short applicable checklist, grouping **Mandatory**, **Mandatory if applicable**, **Recommended / Good to have**, and **My additional items**; process steps remain visually distinct from document uploads.
4. Match against that person's approved current facts, eligible document instances, and historical evidence; select exact file versions, not whatever later becomes latest by accident. Do not turn unapproved AI extracts into confirmed facts.
5. Prefer the newest eligible evidence when demonstrably valid for the route; newer is **not automatically** correct (e.g., statements cover different periods; renewed passport is a separate record). Surface conflicts, questionable sources, unreadable scans, expiry/period gaps, unsupported evidence and unresolved conditions.
6. Allow one-tap **Use this copy**, **Choose another**, **Add**, **Replace**, **I'll provide the original/externally**, or **Not available**, as appropriate. User edits do not rewrite official rules or prior case snapshots.
7. Produce a **reviewable exact-version package** for the chosen traveller; preserve existing acknowledgements, immutable snapshots, version receipts, sharing and external-submission-report distinctions. Recheck material change before any claim of readiness or handoff.
8. Explain the checklist's source checked/verified dates and show an explicit **verify final requirements with official authority or agency** disclaimer; no guarantee of approval, official filing or absence of later requests.

**Readiness is completeness/consistency against the *supported and verified* rules, never a predicted visa-approval probability.** Unsupported coverage, missing official route selection or unresolved applicable mandatory items prevent a universal "ready to submit" claim. Distinguish **Ready for applicant review**, **Prepared for handoff**, and **Officially submitted (reported/evidenced only)**. Preparation may still omit tasks that must be done externally (portals, biometrics, appointment, physical originals).

### 2.3 Group trip / family

Customer-facing label: **Add Travellers** (prompt: **Who's travelling?**). Link one shared trip/itinerary and independent mission/package per authorized person. Recalculate requirements for *each* participant's nationality, residence, age, status and purpose. Connect genuinely shared accommodation/sponsor/travel evidence without duplicating stored bytes or exposing one person's unrelated information to another. Enforce existing guardian, family, consent, ownership and recipient permissions. Never infer cross-person authorization just because the account operator manages both records. Preserve existing single-person missions and `itineraryRef` behaviour.

## 3. Saturday source monitoring and publication

**Cadence:** A scheduled job runs **every Saturday in Asia/Dhaka**; exact job time is configurable and must be converted reliably to the scheduler's time zone. Include manual **Run now**, safe retry, idempotency, per-source execution history and missed-run alerting. It monitors **registered authoritative sources for supported routes**; do not promise universal worldwide coverage merely because a scheduler exists.

### 3.1 Source hierarchy

Prioritize competent governmental immigration authorities, embassies/consulates, official visa portals and current route-specific published instructions. Recognized visa application centres may provide practical local filing/appointment evidence within their actual delegated scope. A lawyer, agency, blog or community report is **a lead for verification**, not a legal authority. Sources can disagree; present material unresolved conflicts for review. Respect access terms, site rate limits, safe fetching and source content provenance; never send traveller private files or facts to public-source crawlers.

### 3.2 Workflow

`Source registry → Fetch/observe → Hash/snapshot → Semantic comparison → Propose structured change → Source and route verification → Approved immutable pack version → Affected-package impact assessment → Targeted notices`

For each check, persist source identity, URL, retrieval method, checked time, fetch result/status, content fingerprint or bounded source excerpt, detected semantic change, relevant route, certainty, effective date, and reviewer decision; separate **last fetched** from **last substantively verified**. Broken access does not mean a requirement disappeared. Layout-only edits do not create fake legal changes. Expiry/fee/forms/dates/conditions require specific checks.

**Autonomy boundary:** Automatically record unchanged checks, monitoring metadata and detected candidate revisions. **Do not silently publish substantive official requirement changes based solely on a classifier or LLM.** Retain existing separate author/reviewer approval for authoritative packs. Provide expedited priority-review workflow for official, material or immediate changes. If verification is pending, mark affected route information as **under review** and make that visible before handoff. Already prepared/historically approved packages retain their exact rule-version provenance; currently active ones receive an impact alert and opt-in review, not silent replacement.

**Freshness beyond Saturday:** On package creation, final review and prior to handoff, test source review age, route support, applicable effective dates and any known urgent change; trigger targeted or on-demand checks where necessary. Source failures or unreviewed changes must not be disguised as "updated Saturday".

## 4. Traveller checklist customization and feedback

Keep **three separate logical layers**:

- **A. VisaStack verified route requirements:** published immutable official-source-backed pack requirements.
- **B. Personal package choices:** item-level additions, selected alternatives, comments, excluded optional items, evidence substitutions, physical/original-to-bring notes. Allow removal from *chosen evidence set* while keeping the official mandatory gap visible. Never mutate canonical route rules.
- **C. Agency/authority-specific requests:** source-attributed, recipient/issuer/date-specific additional items, distinguished by agency judgment versus actual official demand.

**Suggest a correction:** An item or checklist exposes "Suggest a correction" with category (missing, outdated, wrong applicability, wrong necessity level, alternative accepted, source discrepancy, other), source URL or supporting evidence, affected destination/route and optional detail. Keep the submission separate from the traveller's private files unless they explicitly attach relevant redacted evidence. Rate-limit and de-duplicate; protect against malicious URLs, prompt injection and sensitive-information disclosure. Review queue records received → triaged → awaiting evidence → accepted/rejected → published/closed, with accountable editor/reviewer and change notes. A user suggestion never publishes automatically. Significant approved corrections trigger rule-version publication, affected-case impact analysis and optional contributor feedback.

## 5. Field-outcome intelligence -- the additional locked capability

### 5.1 Scope and purpose

VisaStack should **learn what happens in the field** when real users prepare packages, submit applications and record results, so that it can (a) identify missing or confusing requirements, (b) report what supplementary documents were commonly requested or used in observed cases, (c) improve usability and requirement-review priorities, and (d) offer clearly labeled **non-authoritative field insights**, where sample quality permits.

**Do not optimize or market an approval-probability engine.** A checklist's quality is judged first against up-to-date official sources, appropriate evidence and process outcomes; it is *not* defined by whether particular profile types appear to receive visas in a self-selected user sample. Visa decisions reflect applicant eligibility and official discretion, not only document selection.

### 5.2 Track the full observable funnel, not only positive outcomes

| Dimension | Captured event / unit | Interpretation |
| --- | --- | --- |
| Trip/package created | Applicant × unique application attempt × destination/route × pack version | Interest/work started, **not submitted** |
| Package prepared | Rule result summary, issues, selected exact document/fact versions, user-added choices | Evidence readiness **in VisaStack**, not authority acceptance |
| Shared / reviewed | Permissioned, exact-version handoff; agency requests/replacement reasons | Operational evidence, not official decision |
| Externally submitted | User/agency report of submission, submission date/channel/reference and supporting proof where provided | **Reported** unless independently evidenced; avoid treating export/download as submission |
| Additional documents requested | Who requested what, on what date, source authority level, relevance to previous pack | Field gap signal; distinguish official request from agency suggestion |
| Outcome captured | Approved / refused / withdrawn / cancelled / other / pending / unknown; decision date and provenance | A **reported result**, not necessarily authority-verified |
| Outcome evidence status | Self-reported; document-supported; independently verified if a genuine verification channel exists | Evidence quality; never auto-mark a decision letter "authority verified" solely because AI read it |
| Changes and subsequent attempts | Reapplication, appeal, new visa route, package revision and outcome sequence | Separate attempts and decisions; avoid double counting |

Use existing `missionOutcomes`, `missionSubmissions`, mission snapshots and `recordProductEvent` where semantically sound, **without changing their meaning**. Add the minimum new bounded event/association tables required to link an **application attempt**, its **as-submitted exact-version package**, its **route/pack version**, extra requests and its **reported outcome**. Preserve existing outcome event types `APPROVED`, `REFUSED`, `WITHDRAWN`, `CANCELLED`, `OTHER`, and distinguish unknown/no-response/pending **without fabricating a new visa decision**. Historical cases before VisaStack can be recorded as attributed imports with uncertain/missing evidence clearly labelled; do not manufacture a historical VisaStack submission.

### 5.3 What the analysis may legitimately discover

Examples of acceptable questions (always scoped to **observed users/cases**, reliable data, date windows and route/consulate context):
- Of cases with known, evidenced outcomes, which destinations/routes/purposes are represented, and what are their outcome counts?
- Which **non-mandatory documents** were added and later appeared in submitted packages, and what authority/agency requests prompted those additions?
- Which published requirements repeatedly generate corrections, missing items, rejections at document review, or extra-document requests?
- How frequently did travellers prepare a package, report submission, respond to follow-up, or record an outcome?
- How did one route's source revisions change package completeness or operational correction rates before versus after the change?
- Which applicant-context groups (e.g., self-funded, sponsored, student, business visitor, family; only sufficiently large, relevant, consented cohorts) reported particular procedural issues or additional-evidence requests?

Do **not** claim “adding property documents increases approval by X%” or “this passport/profile has an 85% chance of approval” from observational app data. Do not infer why a consular decision occurred unless an actual decision communication specifies reasons; keep official wording distinct from agency/user interpretations. Association is not causation.

### 5.4 Minimum denominator, quality and statistical rules

Any aggregate report must disclose:
- Population/route/destination/filing office and time window; requirements version and known policy-change periods.
- **N packages started, N prepared, N reported submitted, N with known decisions, N evidenced decisions, N unknown/pending**, and follow-up coverage/attrition.
- Source quality breakdown (self-report vs document-supported vs independently verified); missing-data and reporting-selection warnings.
- Whether observations include one or multiple attempts by the same traveller; deduplicate at **application-attempt** level and use per-person grouping where comparisons require it.
- Confidence/uncertainty, small-sample restrictions and suppressions; do not report cross-cohort comparisons where denominator or comparability is inadequate.

If showing a descriptive fraction, label it literally **“among recorded decisions for VisaStack users in this sample”**, not “approval probability,” “visa success prediction,” or a population-level visa approval rate. Prefer counts, experience trends, requirement-friction signals and source-confirmed procedural changes. Separate **package preparation success**, **reported submission completion** and **authority-decision outcome**.

### 5.5 Privacy and ethics: by-design, not a later bolt-on

- Default operational telemetry is minimized; **secondary aggregated research / benchmark / advisory use must have a documented lawful basis, transparent notice and appropriate consent or other validated legal grounds** before activation. Do not assume agency sharing permission includes consent for global analytics.
- Do not pool raw documents, passport numbers, full names, refusal letters, medical details or unbounded free-text into reports, model training or external benchmarks.
- Analytics primarily uses derived, structured, minimized categories and aggregated operational signals; access controlled by purpose and role. Keep raw personal documents behind existing grants/tenant boundaries.
- Special-category medical, biometric, minor, and other sensitive facts require heightened handling; exclude from comparative modelling by default unless a separate, justified and authorized method is approved.
- Suppress small identifiable cohorts and high-risk combinations. Use configurable minimum-cell thresholds; no claim that aggregation alone guarantees anonymity. Avoid exposing one agency's clients, commercial pipeline, or quality metrics to competing agencies.
- Define retention, erasure propagation, opt-out consequences and backup handling; do not resurrect erased data through a permanent analytics warehouse. Do not create opaque individual eligibility scores or exploit nationality/family/health-based profiling.
- **Transparency:** Field data may inform *nonbinding suggestions* and route-priority research; it never overrides a verified official requirement or silently changes a traveller's official profile.

### 5.6 Feedback into the checklist system

Use a strict evidence ladder:

1. **Authority-backed requirements:** updated only through verified official publication and governed pack-version release.
2. **Authority-backed procedural guidance:** similarly sourced and approved, but not necessarily mandatory evidence.
3. **Field observation:** appropriately reported and aggregated patterns of additional requests, corrections and optional evidence; labelled **Observed in VisaStack cases**, including sample size/coverage and uncertainty.
4. **Personal/agency preference:** case-specific suggestions that never become mandatory by repetition.

Candidate discoveries enter **Editorial Review**, not live automatic rule mutation. Use analysis to prioritize which official sources/routes need checking and which UX prompts are causing unnecessary errors. A suggestive correlation is not sufficient to reclassify an optional document as mandatory.

## 6. Experience contract

**Traveller:**
- Add a set of files without category hunting; the existing AI/extraction/consent/approval system suggests profile fields and document identities, never silently confirming unknowns.
- State destination and purpose, then **Add Travellers**; see short separate checklists and matched documents per participant.
- Read explicit **Mandatory** and **Recommended / Good to have** labels, with source links and explanations available on demand.
- Select an accepted alternative, update evidence, add personal items or submit a correction suggestion.
- See source freshness alerts only when material, and receive an exact-version handoff package with accurate claims about what is--and is not--officially done.
- Optionally record external requests/outcomes with attributed evidence; this is not a requirement for continued use.

**Agency:**
- Receive/share exact document versions, issue evidence requests and corrections, add agency-specific items separate from official route rules, and review what the traveller actually submitted.
- Access aggregate intelligence only where privacy, purpose and permission allow; no competitor/customer leakage.

**Editor/admin:**
- Source roster with priority, fetch status, semantic changes, unresolved conflicts, packs due for review, suggestions, publication audit, coverage and data-quality reporting.

No need to surface taxonomy tree, raw version IDs, AI confidence scores or scheduler machinery to ordinary travellers.

## 7. Implementation boundary, in order, without loss

**Phase R1 -- Classify necessities precisely**
- Inventory pack, requirement, readiness, case and agency UI call sites. Extend necessity / alternatives / condition semantics additively to the current `packRequirements` model; keep `optional` and all historical records compatible. Add tests for mandatory, conditional, alternatives, recommended and not applicable across person-specific scenarios. Cross-reference canonical document and profile catalogues.

**Phase R2 -- Saturday source governance**
- Add a registry/adapter and weekly scheduler with bounded fetches, persistent source-check outcomes, retry/alerting, structural and semantic comparisons, draft proposals, editor decisions and reviewed publication using existing author/reviewer separation. Do not auto-approve substantial official changes. Add urgent/at-handoff checks and impact notifications.

**Phase R3 -- Traveller/agency checklist customization and proposals**
- Personal, mission-scoped checklist overlay; explicit official-vs-user-vs-agency provenance; suggestion review queue; consistent status labels; no hidden deletion of mandatory requirements or global publication from one user edit. Preserve existing UI pathways and grants.

**Phase R4 -- Outcome capture and insight foundation**
- Reuse existing outcomes, external submissions, snapshots and product-event machinery. Establish attempt-level and evidence provenance, source-quality classes, optional after-journey follow-up, additional-evidence-request events and privacy-minimized analytics. No need for approval prediction. Ship a **private, internal data-quality dashboard first**, not public benchmarks.

**Phase R5 -- Responsible field insights**
- Only after adequate sample quality, governance and thresholds: descriptive, route-specific optional-evidence and procedural-friction insights labelled separately from official guidance. Review, verify and version every editorial promotion.

**Adjacent previously locked work** (intelligent batch ingestion, Master Profile population, coordinated family packages and exact-copy sharing) remains in scope as a coherent product direction; this contract does not claim those journeys have all been implemented or tested. Phase dependencies must be coordinated; do not duplicate existing upload, mission, snapshot or sharing infrastructure.

## 8. Non-negotiable regression and acceptance tests

**Requirements correctness:**
- One item appears once in canonical taxonomy; one evidence file can satisfy multiple requirements; alternative A OR B never becomes A AND B; missing conditional fact does not become "not applicable".
- Tourism omits irrelevant deep-medical evidence; medical route includes only source-backed relevant medical evidence. Minor/guardian and mixed-nationality family checklists are evaluated separately.
- A recommended item cannot block readiness; an official mandatory item cannot be suppressed by an applicant's UI deletion.
- Every displayed mandatory item cites an applicable authoritative source and effective context; unsupported routes do not claim full completeness.

**Source governance:**
- Scheduled Saturday run is idempotent, records all attempts, distinguishes fetch from verification, tolerates outages and source markup changes, detects material edits, and refuses silent substantive publication.
- Old case snapshots retain frozen pack versions; active cases receive accurate impact flags; urgent change/source withdrawal prevents misleading green claims.

**Outcome integrity:**
- Export/share/package-ready never equals submitted; self-reported submission never equals independently verified receipt; document-reading never equals authority verification.
- Known approvals/refusals remain separate from pending, missing outcome, cancelled and withdrawn; numerator/denominator never silently omit cases or hide missingness.
- No feature claims an approval probability or cause-and-effect based on an observational association; report includes scope, N, date window and evidence quality.
- Minor, medical, agency data and low-N cohorts never leak through aggregation; removal/retention/legal holds remain consistent.

**No-loss:**
- Existing traveller, agency, contributor, profile, upload, document lifecycle, immutable facts/snapshots, sharing, audit, AI/provider controls, payments/plans, access, admin and history flows remain functional with current auth/policy behaviour.
- Unit/integration/role-access tests and end-to-end representative paths pass before merging; changed capabilities have exact tests and migration/rollback plans.

## 9. Engineering instruction

**READ EXISTING CODE → MAP CALL SITES AND CURRENT STATES → PROVE BASELINE → DESIGN MINIMUM ADDITIVE CHANGE → IMPLEMENT WITH TESTS → VERIFY FULL REGRESSIONS → REPORT:** `What existed | Exact additive change | Evidence | Remaining uncertainty | Data migration and rollback`.

No destructive replacement of schemas/packs, no arbitrary AI-produced official rules, no data-use consent assumptions, no removing features to simplify UI, and no misrepresenting commercial operation or launch safeguards.

## 10. Final product lock

> **The system organizes the universe of possible evidence. The applicant sees only what is relevant, with a visible distinction between required and helpful. Official sources control mandatory requirements; each traveller controls case-specific choices. Every Saturday the system looks for authoritative changes and routes them through trustworthy verification. Real user outcomes build a carefully governed field-evidence observatory, not an approval-prediction machine.**

**Status: LOCKED AS PRODUCT DECISION; IMPLEMENTATION AND RELEASE EVIDENCE TO FOLLOW SEPARATELY.**
<!-- EXACT SOURCE END L3: VisaStack_Checklist_Requirements_and_Field_Intelligence_LOCKED_2026-11-02.md -->

---

<!-- EXACT SOURCE START L4: VisaStack_Agency_Initiated_Checklist_Collection_Experience_LOCK_ADDENDUM_2026-11-02.md -->
# VisaStack -- Agency-Initiated Checklist Collection & Branded Client Experience
## BINDING PRODUCT ADDENDUM · LOCKED 2 November 2026 · Version 1.0

**Status:** Product decision and implementation contract. **Not** a claim that the new guest intake flow has been deployed. No repository files, database records, settings, or production infrastructure were changed by the creation of this addendum.

## 0. Status, precedence, and no-loss rule

This addendum is cumulative with, and does **not** replace:

1. `VisaStack_Field_Workflows_and_Document_Journeys_LOCKED_v1_2026-11-01.md` (the field workflow foundation);
2. `VisaStack_Product_Decision_Lock_No_Loss_Commercial_Direction_2026-11-02.md`;
3. `VisaStack_Checklist_Requirements_and_Field_Intelligence_LOCKED_2026-11-02.md`; and
4. `VisaStack_Intelligent_Record_to_Trip_Experience_LOCK_ADDENDUM_2026-11-02.md`.

The combined product remains a traveller-owned reusable record and evidence-sharing infrastructure, with an agency document collection surface. **Not a generic enquiry/quotation/sales CRM.** No existing feature, screen, data model, permission, consent, scanner gate, retention protection, subscription function, agency collaboration function, history, or record is authorized for deletion or weakening. Prefer an additive, interoperable experience over a new parallel platform. Existing agency client invitations and permissions are not silently redefined by this addendum.

### Core promise

**Agency:** “Create the right document request for this destination and purpose. Send your customer one link. Receive clearly organized, reviewable documents.”

**Traveller with VisaStack:** “Open the agency's request, reuse the right documents, confirm the specific package, and share only the selected copies.”

**Traveller without VisaStack:** “Open the same agency-branded request, submit documents in one or several visits without registering, and receive clear corrections if anything needs attention.”

The business outcome to measure is less staff chasing, fewer incorrect/outdated copies, faster collection and review, and customer willingness to use the agency's process; do not invent savings or conversion rates.

## 1. Two valid recipient identities, three execution paths

The link opens the **same agency-branded landing experience**, but the underlying workflows differ:

| Mode | Required user account? | Record ownership | What happens to documents | History after completion |
|---|---:|---|---|---|
| A. Existing VisaStack account | Yes | Traveller owns their existing applicant/master profile | Existing vault evidence is **selected and explicitly shared** as an exact-version, request-scoped package; missing documents may be added to the authorized person's vault | Traveller and agency each see their appropriately permissioned record and event history |
| B. New user choosing to register | Creates one | Newly registered traveller owns their new record | Direct task-first entry, upload/import, organize, prepare and approve the package; preserve normal future reuse | Traveller gets a reusable profile, vault and traceable future history |
| C. Guest without registration | **No** | No traveller account/master profile or durable reusable personal wallet is created | Files are stored in a **request-scoped agency intake** for review and handoff; organize/classify in a temporary workspace without manufacturing an applicant-owned vault | **No traveller-account history exists** because no account was created. Agency retains only request/submission/correction records under appropriate retention and erasure controls |

Guest mode is not an invisible account, shadow profile, or permanently reusable applicant identity. Guest-mode document extraction may power a **temporary intake working view**, not confirmed Master Profile facts. Never attach guest data to a later registered account merely because an email matches. An optional later import/claim requires genuine identity proof, specific consent, explicitly selected records, and an audited transfer/copy without rewriting the earlier agency submission.

### Important meaning of “no trace for the user”

It means **no VisaStack traveller profile, personal vault, personal timeline, or ongoing document/history feature associated with that guest as an account-holder**. It cannot mean “no records anywhere”: the agency needs the submitted copies, timestamps, review/correction events and retention controls to deliver its service. Avoid saying the guest's uploads were not stored; disclose the agency and VisaStack service retention and who can access the submitted files. Minimize visitor telemetry and do not populate a cross-customer personal data graph without an appropriate lawful basis, purpose and consent.

## 2. Agency: create a request in minutes, not a CRM pipeline

### 2.1 Initial inputs

The authorized agency operator chooses:

- Destination country / jurisdiction;
- Intended purpose (tourism, business, medical, study, work, family, transit, residence or another supported purpose) and **specific visa/application route** where known;
- Tentative travel dates or date range, with “not yet decided” permitted;
- Place of application/residence and applicant nationality where known; otherwise mark applicability unresolved instead of guessing;
- One named person or an identified group where needed; traveller identities not known at request creation can be provided later;
- Optional agency owner/team assignee, response due date, short customer instruction, preferred contact channel and whether originals/translation are externally required;
- **Checklist source:** latest suitable published VisaStack version; if no adequately supported route exists, a clearly labelled agency/manual checklist, not a fake official pack.

No existing traveller account is required to create a **pending collection request**. Do not create placeholder accounts, claim an existing wallet by email, preemptively acquire a broad sharing grant, or force full mission creation just to request documents. The agency may link a request to an authorized existing case when one genuinely exists; an authenticated owner may link/convert it into a mission after the necessary consent and authorization.

### 2.2 Checklist proposal and agency edit

The engine produces the most applicable *known* checklist with the established taxonomy: **Mandatory; Mandatory if applicable; Accepted alternative(s); Recommended / Good to have; Optional; Agency-added items; Specific authority requests; Needs verification**. Keep procedural steps distinct from required files. Apply source URL, publisher, rule version, checked and verified dates, effective date, evidence type, original/copy/translation rules, and expiry/freshness conditions.

The agency can review, reorder for client readability, annotate, add context-specific items, choose accepted alternatives when properly supported, hide or defer nonessential collection items for this *request*, set due dates and save request templates. Distinguish **official source-backed requirements** from **agency requests/practice**. The agency cannot alter global official packs, convert recommended into legally mandatory without grounded official support, or mark a known mandatory official item nonmandatory globally. If the agency elects not to collect an official item, label it **not requested by this agency / unresolved for official completeness**, not satisfied. Preserve the global, versioned rule record.

### 2.3 Snapshot before sending

On sending, create an immutable **request-checklist snapshot** referencing exact pack version, applicable route/conditions, the agency's overlays/notes, sender identity, invitation recipient/channel, issue time, and link expiry. Preserve the initial transmitted version. Subsequent agency edits create a **new revision** and visible change history. If weekly official-rule monitoring changes a published pack, compare the existing request to that new version, alert the agency/traveller where material, and offer explicit review/upgrade; do not silently mutate the checklist a recipient already saw.

### 2.4 Sending

Offer (a) **copy private link**, (b) **share to WhatsApp** via ordinary native share/deep link or copy-ready message, and (c) **send email** using the existing configured email/outbox service. Do **not** claim automatic WhatsApp Business API delivery without a connected authorized WhatsApp sender. Agency can send through WhatsApp manually without entering a client email, subject to guest/link safeguards below. If email is provided, send a clear invitation with the agency identity, intended request and one action link. Do not disclose whether the email belongs to an existing VisaStack account.

Messages must be accurate about provider accepted / delivered / opened / started / submitted; one status never implies another. Allow resend, expiration, revocation, replacement links and a contact-correction workflow without breaking submitted history. Rate-limit sending.

## 3. One sophisticated agency-branded intake page

### Brand and architecture

Reuse the live existing agency organization identity and brand primitives: approved logo (or elegant initials fallback), agency name, accessible accent colour and existing preview/logo infrastructure. New brand-kit fields, if developed later, extend that system instead of introducing a second brand store. Show a restrained **“Powered by VisaStack”** footer and clear service/agency roles. Platform approval is not government accreditation and must never be presented as such. Unreviewed/suspended agencies must not receive falsely trusted branding or create active sensitive collection links.

The page must feel like the **agency's professional client document desk**, not a VisaStack signup advert. Visual contract: premium editorial typography, clear hierarchy, white/neutral background, very restrained agency accent, high legibility, elegant empty states, polished native file-zone interactions and deliberate responsive geometry; no gratuitous gradients, marketing popups, 3D illustrations, mascot art, dense dashboards or distracting nav. Mobile/WhatsApp is first-class; also test desktop drag-and-drop, 200% zoom, screen readers and slow connections. Brand customization must not let agency HTML/CSS/scripts compromise isolation or counterfeit trusted platform affordances.

Suggested composition, not a new page framework:

1. **Top:** agency logo/name, clear title **“Your Document Checklist”**, short request context after access checks, agency contact/support, small platform attribution;
2. **Context:** destination, purpose, tentative dates, who requested documents, due date and checklist/source status;
3. **Primary task:** **“Add Your Documents”** prominent drop zone -- files/folders or mobile photos; add now or later, no mandatory document-category selection;
4. **Live checklist:** mandatory first, conditional when relevant, recommended second, agency-added separately; per-item evidence matching and unfilled gaps;
5. **Review:** preview selected documents, adjust misclassification, person association and file version; state uncertainties concisely;
6. **One primary CTA:** **“Submit Documents to [Agency Name]”**, with an explicit disclosure of exactly what will be shared and retained;
7. **After submission:** honest receipt, submitted exact-copy manifest, any pending processing and response/correction channel; guest access subject to the same authorization and link/retention rules.

Before recipient verification, public link-preview information must remain neutral. Do not expose client's name/email, personal document names, sensitive route details, file content, package progress or whether a particular person is registered. After authorization, show only the pertinent request. Agency support contacts displayed must be verified agency-managed fields, not applicant-private data.

Use plain, confidence-building content: **“Add your files. We'll organize them for this request.”** Do not promise zero errors, government submission or visa approval.

## 4. Existing account: link, reuse, consent, submit

- Link retains the intended request through sign-in or signup return paths, using the current Neon Auth session mechanism. An existing signed-in account should not log in again unnecessarily.
- Where an agency email invitation is recipient-bound, the verified sign-in email must match. A forwarded link does not give a stranger the invitee's profile. Never give the agency account-existence information during creation.
- Traveller explicitly chooses **which managed person/profile** to use; agency cannot select/claim the wallet based on a name, email or phone. Group travellers get independent applicable checklists and controlled shared evidence.
- Match uploaded and existing vault documents to exact request items; check selected evidence, freshness, identities and unresolved conditions. Never assume permission to expose the entire wallet.
- Display the selected exact copies and proposed scope before **“Share with [Agency]”**. Grant **only the intended request/package and authorized actions**, not blanket portfolio access. Reuse the existing grant and policy infrastructure and intentionally preserve separate existing full-client invitation semantics when those are explicitly chosen by the user.
- Record sent/shared, viewed/downloaded when truly evidenced, needs correction, accepted and later agency-reported submission as distinct events. Preserve previous versions; uploading a newer copy never silently rewrites an earlier receipt/review/submission.
- Missing files can be added to that person's vault and matched; any inferred profile values remain source-observed until correctly approved.

## 5. Registered new traveller: account setup as an optional path

New recipient can choose **“Create a Free VisaStack Account”** (where that is a truthful available offering) for enduring record reuse and history. Keep registration task-first; on verified account creation, return to the exact pending invitation and prepare the chosen person's package. Their documents populate the normal personal library under the already-locked intelligent ingestion and provenance conditions. **Do not force full profile completion before allowing the requested document task.** They approve the exact selected share just like an existing traveller.

No conversion dark patterns: the same agency document-submission service must remain available in guest mode wherever the agency enabled it. Marketing permission is separate from processing/sharing consents.

## 6. Guest collection: genuinely account-free, resumable and accurate

### 6.1 Request-scoped temporary intake

The guest may continue without VisaStack account. Create only a bounded **agency-request intake session**, not a traveller account, person wallet, agency-wide auto-grant, fake `applicantId`, or unowned canonical mission. Its documents are accessible only under the authorized request and appropriate agency review privileges. Reuse canonical file validation, storage, scanning/processing where configured, OCR/classification and audit primitives; do not create a second unprotected uploader or independent file-processing system.

Guest can add files/folders now, leave, return and add more in later sessions until expiration/submission/closure. Persist progress in the request-scoped session (not only browser memory), including partial failures, per-file status and resumable/retry-safe object references. Use explicit retention for abandoned drafts; ensure completed submitted evidence remains according to agency contractual/legal retention policy and deletion obligations. Do not promise that an unfinished upload is irrevocably saved until confirmation.

### 6.2 Identity/link control

A forwarded WhatsApp URL is **not** proof that the viewer is the intended traveller. The public agency branded screen can open from a private high-entropy, time-limited, revocable link, but accessing personal checklist details, saved drafts, private documents, or submission history requires appropriate recipient verification or a sufficiently restricted one-time claim/session protocol. Preferred low-friction default: one-time email verification **without account creation**, even when the link arrived via WhatsApp, with a purpose-scoped secure session. If email access is impossible, an alternative must be explicitly designed with an independently delivered agency access code or a properly configured verified-channel mechanism; do not assume an SMS/WhatsApp OTP service exists. A bare link must never enable unrestricted reading of stored sensitive documents. Link scanners/prefetchers must not consume invitations or submit files.

Make link/session expiration, resume, revocation, role changes, agency suspension, anti-replay, upload-size and usage caps, file validation, malware-state honesty, authorization, rate limiting, cross-tenant isolation and abuse controls explicit. Existing platform gates are not silently bypassed; unsupported file types are explained as such. When scanning is intentionally not configured, never label files malware-cleared; use only upload/processing states that the deployed system can actually support.

### 6.3 Intelligent guest classification and reconciliation

Every upload goes through: **Receive → Validate/Stage → Classify → Extract source-observed facts → Find exact duplicates or related copies → Match document and person to checklist → Check date/legibility/conflicts → Display clear status → Ask only for material uncertainty**. Retain original filename and bytes; generate a professional display name. Distinguish improved scan of same evidence, corrected replacement, new statement period and entirely different source. Show document identity and evidence position without demanding categorical tagging. Unknown/unreadable/ambiguous files remain visible as **Needs Your Review**, never get silently misfiled, ignored or counted as satisfying a mandatory item. Cases with multiple people require an explicit person-selection/identity confirmation for ambiguous files; agency staff cannot see private records unrelated to this collection.

The guest can see **Requested / Matched / Needs Updated Copy / Missing / Optional / Not Applicable / Processing**. Auto-matching is a proposal with defensible confidence and exact evidence references, not certification of authenticity or applicant truth. Manual correction, replacing, removing a draft file, attaching one file to appropriate multiple checklist items, and viewing original/organized file names must be possible.

### 6.4 Submission and repeated correction

The guest chooses **Submit Documents** after a final review of what the agency receives; this closes or versions that submitted batch as an **immutable agency-facing submission manifest**, holding exact file versions and agency-checklist snapshot/revision, applicable person references *within the request*, submitter assertion, timestamps and any disclosed unresolved items. “Submitted to Agency” **is not** “Submitted to Embassy/Authority.” Distinguish file accepted by storage, uploaded, reviewed by traveller, submitted to agency, agency received/processed, agency requested correction, and agency accepted. The agency can return exact per-item deficiencies and guest can use their verified request link/session to add a corrected copy, producing an append-only new revision rather than replacing what was received before. Return visits obey expiry, revocation and retention controls.

**Agency cannot see a guest's unsent draft by default.** Make that explicit to the guest; the service may process drafts privately to build the checklist. If an agency-assisted-save mode is someday added, it requires specific user disclosure and authorization, not a silent default. Confirm actual agency-side receipt only when the transaction commits and access becomes available, not merely when a file's upload request finishes.

## 7. Agency intake desk: operationally simple

The agency should have a clear collection queue, not a CRM pipeline:

**Draft request → Sent / Awaiting Customer → Customer Uploading (if status may be disclosed) → Submitted for Review → Needs Correction → Accepted → Closed**, with Expired/Revoked where relevant. Distinguish saved but not submitted uploads from real agency receipts; default no visibility into draft file contents. Search/filter by assigned staff, due date, destination/route and status. Each checklist item has requested necessity, current submitted copy, agency-review result, exact version, reason for correction and response history. Support explicit batch acceptance, per-file acceptance, question/answer, corrections, notifications and authorized export/handoff. Existing case tasks, notes, agency review, billing and related advanced features remain available and unchanged.

Use an agency-only bounded operational reference even when the traveller has no account. Do not force a mission record whose foreign-key design requires an existing applicant merely to represent a pending guest intake. Attach the intake to an existing authorized mission only when legitimate; conversion/linkage must be explicit, permissioned and historically faithful.

## 8. Source and checklist changes during an open request

- The **sent checklist** is version-pinned and agency-overlaid; this is the binding collection request as issued. The system keeps access to current official pack and detects substantive differences.
- Source monitoring on Saturdays and any urgent/final-preparation checks may flag a new official requirement. Surface **“Requirements have changed since this request was sent”** with exact changes, source review evidence and affected mandatory status.
- Only authorized agency action publishes a revised *agency request*; official pack publication continues through existing governed source-review workflow. Send recipient a clear revision notice; do not silently rewrite the initially sent request or previously submitted files.
- Traveller's own additions/deletions to their selected package remain request-specific and cannot falsify official mandatory status. An agency-reported additional item stays explicitly labeled as agency practice unless verified as official.
- Feedback **“Suggest a Checklist Correction”** is allowed from the customer or agency, follows the separate global editorial review pipeline, and never directly edits every published pack.

## 9. Relation to the already-locked product and field intelligence

- Existing reusable profile/vault/history governs account-holders; agency guest intake remains deliberately temporary and agency-scoped.
- Existing `missionOutcomes` describe recorded real-world visa outcomes, not agency intake status. Guest completion, agency receipt and agency acceptance are not visa approvals; do not merge these metrics.
- The user's existing form/version declarations and agency-reviewed exact versions stay historically independent. Link real application attempts and evidenced outcomes to exact package snapshots only with appropriate authority and clear provenance.
- Guest aggregate metrics may count process facts (invites, starts, uploads, corrections, completion) in privacy-minimized form. Do not silently assemble guest identity-linked traveller profiles or monetize guest personal data. Application/visa outcome intelligence requires legitimate data collection rights, status-provenance labels, adequate aggregation thresholds, selection-bias disclosure and suppression of reidentifiable small groups.
- Agency branding is customer presentation, not unrestricted access or a promise that VisaStack endorses the agency's visa advice.

## 10. Verified code baseline at locking time (source inspection, not runtime acceptance)

Repository inspected: `sadatnitex/visastack`, default `main` commit **`ab6ce2a8b4f83623befac4b2aea68628385406bf`** (2 November 2026 at inspection).

| Existing asset | Verified finding | Required change/interpretation |
|---|---|---|
| `packages/services/src/client-invitations.ts` | Agency email-bound client invitation; intended recipient must authenticate; acceptance picks an existing/new applicant, creates mission and accepted default grant. | **Preserve** this flow; new document-request invitations must be separate or an explicitly compatible extension, not a stealth change of its grant semantics. |
| `apps/web/src/app/app/agency/[orgId]/client-invitation-form.tsx` | Captures traveller name, valid email, optional free-text requested route and case owner. | Add agency-first destination, purpose, tentative dates, checklist editor/snapshot and WhatsApp copy option in the correct new flow; don't pretend these inputs already exist. |
| `apps/web/src/app/invitation/client-invitation-offer.tsx` | Public, agency-branded invitation; existing logo/accent and explicit account/sign-in invitation. | Reuse visual and invitation patterns; add real task-first branded checklist and guest choice as an explicitly new experience. |
| `packages/services/src/branding.ts` + `apps/web/src/lib/agency-brand.ts` | Agency name, approved logo, accessible accent; "Powered by VisaStack" requirement. | Extend, never duplicate; avoid phishing/implied government accreditation. |
| `packages/services/src/agency.ts` and `packages/db/src/schema.ts` (`evidenceRequests`, `evidenceRequestDecisions`) | Existing agency requests reference an **existing applicant**; responses and decisions carry document IDs, not necessarily immutable document-version IDs. | Reuse upon legitimate link; add minimal guest request scope and exact-version receipt/review associations. |
| Existing upload/intake, AI reading, packs, mission, sharing, outbox services | Established building blocks. | Reuse adapters and processing, preserve safety/consent/authorization requirements; ensure no parallel wallet/mission/policy subsystem or unsafe unauthenticated upload bypass. |
| New guest multi-file intake | **Not verified as implemented**; prior programme instructions specifically excluded guest intake. | Scope and build this separately, subject to security and lifecycle review. |

This is a **source-code inspection**, not proof of deployed guest flows, inbox delivery, real-time UX or agency pilot adoption. Re-audit repository HEAD before editing; these line-level observations may become stale.

## 11. Minimum new architecture, not a competing platform

The engineering implementer must first map actual schema, services, auth/consent, invitation/email, brand and workflow dependencies before proposing migration or API changes. If truly missing, add narrow structures for:

1. **Agency collection request** (org, operator, intended contact/channel, scope, destination/purpose/date context, authorization status and lifecycle);
2. **Request checklist revision/snapshot** (published pack version and per-request agency overlays, reason for change, issued/seen/accepted timestamps);
3. **Guest access proof + private session** (non-account authentication/verified claim, token hashes, expiry/revocation/replay controls; zero plaintext token logs);
4. **Request-scoped guest intake files** (staged files, protected objects, inferred/matched metadata, originals and processing outcomes), reusing existing processing and storage contracts;
5. **Exact submitted manifest + review events** (immutable documentVersionId or equivalent exact storage-version identity, agency decisions/replacement history, scoped retention/erasure);
6. **Dispatch/outcome events** (email queued/delivery-confirmed, WhatsApp copy/share intent versus actual receipt unknown, link opened, started, submitted, reviewed, corrected, accepted) using existing event/outbox conventions where semantically valid.

Do not introduce a new general-purpose customer CRM, separate document vocabulary, separate permission rules engine, shadow applicant, or second official requirement-pack model. Idempotency and transactional boundaries must make retries and double-clicks harmless. No agency-side visibility of another agency's guest link or file; users/guests cannot enumerate tokens/recipients or infer account existence.

## 12. Commercial operational measurement

Track: requests created; links created/copied; email accepted by provider vs independently confirmed delivery; guest/account path choice; recipient completion; time from invitation to first submitted document; percent of requested mandatory items satisfied at first review; per-request correction cycles; time from first submission to agency acceptance; per-file/AI processing cost; agency staff effort where measurable; repeat agency adoption and actually collected revenue. Do not equate a generated link with a delivered invitation, a saved draft with a submission, a completed checklist with official filing, or a trial account with paid customer.

If user and agency experience conflict, prioritize: (1) truth/consent/privacy, (2) genuinely quick document exchange, (3) exact version accountability, (4) professional brand trust, then (5) optional enhancements.

## 13. Binding acceptance scenarios

**A01. Agency no-known-client request.** Agency can select destination, purpose, tentative date, choose an appropriate source-backed version, customize and create a request without an existing `applicantId` or unrelated CRM fields.

**A02. Incomplete route context.** Agency doesn't know nationality/residence/application office: system marks applicability unknown and asks the recipient relevant questions later; does not issue a falsely complete official checklist.

**A03. Honest necessity levels.** Mandatory, conditional, alternatives, recommended and agency-added items are distinct. Agency choice to defer an official mandatory document cannot count as officially satisfied.

**A04. Checklist freeze.** Editing after send generates a new visible revision; sent version remains recoverable. New official Saturday pack does not mutate an existing invitation.

**A05. Two delivery channels.** Agent can copy/share to WhatsApp without claiming WhatsApp API transmission; agency can enter email for a queued invitation using existing Resend outbox and delivery-state semantics.

**A06. Branded page.** Agency A displays only Agency A's approved logo/accent and accessible content; Agency B can never supply or read Agency A assets; unreviewed agencies cannot impersonate endorsed brands. Responsive mobile and desktop acceptance.

**A07. Existing account.** Signed-in traveller uses only an explicitly selected/authorized applicant profile; only selected exact evidence goes to that agency; no blanket wallet access created by opening a link.

**A08. New signup.** New traveller can register task-first and build an enduring vault/profile, retaining the invitation and correct checklist; does not need complete profile before first useful upload.

**A09. No-account guest.** Guest can choose "Continue Without an Account," verify a bounded intake session, upload multiple times, submit, and leave with **no new VisaStack traveller profile or personal history**; agency retains its legitimate receipt and review.

**A10. Forwarded WhatsApp link.** Unverified holder cannot read prior drafts, personal information or submissions; expired/revoked/replayed link refused with neutral disclosure.

**A11. 80-file mixed batch.** Various document types, multiple people, repeated statement periods, identical copies, corrected scans, illegible/unsupported files: classify and match where supported, flag uncertainty, avoid false required-item satisfaction; partial uploads recoverable.

**A12. Guest review edits.** Guest can change suggested category, person, document mapping, dates, replace files, add more, mark eligible optional evidence and review exactly what they will send.

**A13. No silent draft sharing.** Agency cannot read guest's unfinished draft files by default. Submit creates exact-version manifest and only then agency-facing receipts.

**A14. Corrections.** Agency can request a precise replacement; guest's second submission keeps the first submitted version and reviewer reason; the agency sees which exact copy it accepted.

**A15. External submission honesty.** "Submitted to [Agency]" never triggers visa/authority outcome or government-submission state automatically. Separate outcome evidence and event vocabulary preserved.

**A16. Requirements change after invitation.** New source-backed rule is proposed/reviewed and relevant open requests flagged; historic sent checklist intact; explicit agency update and recipient notice.

**A17. No cross-tenant or cross-person leakage.** Guest sessions, account-holders, family participants, multiple agencies, invited email changes and agency staff role changes are isolated and appropriately authorized.

**A18. Retention/erasure.** Guest abandonment and agency-submitted evidence follow explicit retention, deletion and legal hold rules; deletion cannot leave publicly accessible blobs or misrepresent data removal.

**A19. Existing features survive.** All preexisting agency invitations, ordinary authenticated evidence requests, mission snapshots, applicant facts/versions, review, grant, export, billing, admin, AI and lifecycle paths pass regression checks. Existing app links keep working.

**A20. Honest runtime verification.** Check real account and guest flow on desktop and mobile, actual configured email outcomes, privacy/session boundaries, file process/validation, and agency acceptance with controlled test data. Source inspection and unit tests alone do not prove production acceptance.

## 14. Implementation order

1. **Reuse-and-gap audit:** map current invitations, agency brand, request/pack semantics, file/AI/upload processing, authentication, permissions and lifecycle. Produce concrete `reuse / extend / new / do not change` ledger tied to source functions and tests.
2. **Agency request builder and snapshot:** publish-backed checklist with agency overlays; source and necessity hierarchy; sendable private request with brand and editable revision semantics.
3. **Account-holder completion:** return-to-task auth and permissioned vault selection; exact-version package share; no broad default grant.
4. **Guest request-scoped processing:** verifiable bounded guest sessions, repeat upload, smart classification/matching, final submitted manifest, reviewer corrections, retention.
5. **Brand/customer polish and production validation:** responsive mobile-first agency page, agency desk triage, real email, negative authorization tests, source-check/revision links and commercial metrics.

Deliver functionality in vertical, interoperable slices, not five unrelated feature demos. Avoid insisting that every visa country or file type be supported at launch. The request and its capability limits must be clear.

## 15. Decision close

**Locked:** Agencies can generate and customize destination/purpose/date-specific document checklists, issue a beautiful and trusted agency-branded request by email or WhatsApp-compatible private link, and receive accurate, structured submissions from either an account-holder or an authorized guest. Registered clients reuse their lifelong VisaStack records; guests can supply documents without forming a permanent traveller record. Both get minimally effortful intelligent upload, clear missing-item guidance and controlled correction cycles. Every agency receipt and review remains exact-version faithful; official rule updates, permission boundaries, file processing, guest privacy and all existing functionality remain intact.

**Not authorized:** claim current guest availability; imply guest files are stored nowhere; silently identify/link private wallets by email; treat a copied WhatsApp link as verified ownership; make an official mandatory rule disappear through agency editing; grant full-wallet access by merely opening the invitation; auto-submit to government; bypass established document upload protections; automatically publish substantive official rule changes; overpromise perfect AI accuracy; silently erase previous submissions or overhaul existing invitation semantics.
<!-- EXACT SOURCE END L4: VisaStack_Agency_Initiated_Checklist_Collection_Experience_LOCK_ADDENDUM_2026-11-02.md -->

---

