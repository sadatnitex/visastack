# VisaStack upgrade.v1.2 execution plan

Prepared: 15 October 2026, Asia/Dhaka.

**Product scope:** all ten v1.1 upgrades, enriched by four bounded refinements E01-E04.  
**Delivery:** three cohesive PRs, six bounded coding sessions.  
**Evidence status:** consolidation complete; latest-repository verification BLOCKED.  
**Authorization:** planning only. No application implementation, push, merge, migration or deployment was performed.

## 1. Authority, evidence and how to use this plan

This is the consolidated successor to `upgrade.v1.1.md` and `upgrade.v1.1.execution.md` for the upgrade described here. Both original artifacts remain unchanged as historical records. The latest explicit owner decisions prevail. This plan carries forward all ten capabilities, ownership/version/security invariants, acceptance obligations and exclusions; it adds only E01-E04 below. It neither resets the wider product nor authorizes excluded experiments.

Read the session brief, relevant requirement definitions and affected code, not the entire conversation. Appendix B reproduces the inherited product requirements so a coding agent does not need the old documents to understand them. Use the coverage ledger to prevent omissions rather than repeatedly pasting all requirements.

### Current-code verification limit

On 15 October, the selected GitHub connection returned NOT_FOUND/404 for the supplied `sadatnitex/visastack` repository, main tree and main commit. An accessible replacement was not established. A public-page retrieval also failed. These results establish an access blocker, not that the repository was deleted or its code changed.

Last successfully inspected repository checkpoint: `363489045816ae53354caa06c5f1eb75bd99c9c8`, main, studied 12 October 2026. The original product contract used an earlier SHA; the execution companion supplied this later code checkpoint. Source observations in section 4 are HISTORICAL, not verified current deficiencies. No fresh current SHA, CI result, deployment state or completion percentage is claimed here. No tests were run to create this plan.

W0 is mandatory before implementation: restore repository access or provide a current source snapshot with commit identity, then reconcile every affected seam. Do not implement security fixes from old observations without verifying whether current code already satisfies the requirement. If access remains unavailable, finish only planning/status work and report the precise blocker. Never reset main to the historical checkpoint.

### Product outcome

VisaStack remains a traveller-controlled reusable mobility record serving travellers and agencies together. The primary loop is: receive a clear request, supply or reuse information, resolve specific gaps, produce a selected useful output, retain an accurate record for the next task. Goal planning supports that loop and does not dominate the product.

No tenfold claim, universal approval prediction, certification or zero-risk claim is introduced. The four refinements improve how existing capabilities work; they do not create four additional backend subsystems.

## 2. Scope and traceability

| ID | Preserved capability | v1.2 refinement | Delivery |
|---|---|---|---|
| U01 | Personal Record: organise, find, update and use | E01 starts from a task; useful partial record; confirmed history stays distinct from missing/uncertain entries | PR2 |
| U02 | Prepare again without starting again | Resume/renewal opens reusable, refresh/review and missing groups; no cloned approvals or grants | PR2 |
| U03 | One Needs Attention inbox and optional calendar export | E02 links actionable requests to the relevant item; existing reminders can open preparation/reuse | PR2 |
| U04 | Change once; see affected cases | Preserve invalidation and historical packets; E03 explains the change using dates and context | PR1 core, PR2 view |
| U05 | Explainable time-aware consistency | E03 shows previous declaration, current data, relevant dates, explanation and source | PR1 core, PR2 view |
| U06 | Application Memory | E03 compares exact selected prior versions; find acknowledgement/packet receipt without implying government submission | PR2 |
| U07 | Secure resumable agency intake and requests | E01 task-first entry; E02 agency triage, reusable request presets and clear item guidance | PR1 security, PR2 journey |
| U08 | Selected brief and handover pack | E01 first useful output; E04 copy-ready confirmed-information sheet using the same authorized projection | PR3 |
| U09 | Printable trip essentials pack | Audience-specific rendering of selected supplied content; no sensitive offline cache | PR3 |
| U10 | Purpose-specific minimized AI-context export | Same selected-output service; preview/copy/download; no live connector or compulsory AI call | PR3 |

All ten are required. A working first task does not substitute for the complete upgrade. PR order defines dependencies, not permission to omit a capability. All inherited behaviour in Appendix B remains required unless a narrower explicit E01-E04 change below says otherwise.

## 3. Four bounded refinements: exact functional contract

### E01. Task-first entry and first useful result

**Problem:** a complete-profile requirement delays useful work. **Affected requirements:** U01/U07/U08, with U02/U03 navigation reuse.

Offer a small number of contextual actions within the existing approved navigation: complete an agency request; prepare a selected brief; update/find a record. Direct invitation links open the requested task after identity and scope checks. Preserve the user's intended return destination across supported authentication; validate return paths and never introduce an open redirect.

Public landing/link previews remain neutral and contain no applicant metadata. Public entry does not mean unauthenticated passport/bank uploads. Use existing Neon Auth before sensitive account-bound persistence or access. Existing authorized sessions continue without redundant sign-in. No parallel guest staging/account-claim subsystem.

Request only what the selected task needs. Permit a useful partial personal record with no goal, passport, payment or full-profile prerequisite. Existing required information remains required for the actual selected action; do not fake readiness to eliminate friction. Reusable personal information follows the inherited master-save and case-attachment rules. Show accurately whether it is saved privately, attached/shared or still unsaved.

First useful result depends on the task: a successfully saved usable record; a clear request response/progress result with next action; or a previewable selected brief with explicit unknowns. Do not require a fabricated complete dossier to show value. When generating a preview/export, apply the same server authorization, safety and selected-version controls as U08. Deliver a partial-information brief only when clearly labelled and appropriate; it is not an approved final application packet.

PR2 must provide actual task completion/resume and useful persisted feedback. PR3 completes the consolidated selected-output preview; do not claim a missing PR3 renderer is already delivered in PR2.

**Acceptance:** new and returning users reach the intended task; invalid return URLs are rejected; saving partial input survives interruption; first output contains only selected permitted content; omitted information is explicit; no full-profile gate, public sensitive preview or compulsory extraction call.

### E02. Agency triage with actionable missing-item guidance

**Problem:** staff and travellers waste effort interpreting scattered case states and vague requests. **Affected requirements:** U07/U03/U05/U08.

Provide a case-level triage summary using existing evidence/request/review/readiness services. Present the applicable groups: Missing; Processing; Received/awaiting confirmation; Needs correction or clarification; Reviewed; Ready for review. Map existing states explicitly in W0; do not create a second case state machine or assign several incompatible statuses to an item. Use a primary item status plus separate indicators for freshness, sharing and safety processing where necessary.

Each actionable item identifies what is requested, the relevant period/content, why it is needed, a due date when actually set, and one direct action. Summaries can link to items; they must not expose unselected wallet content or private history to explain a hidden gap. Unknown/withheld information stays unknown, not an inferred refusal, weak profile or adverse score. Received does not mean reviewed; a readiness count does not estimate approval probability.

Allow authorized agency staff to choose an existing applicable requirement pack/request preset and adjust case-specific requests through current permitted actions. Preserve the exact pack/version and source/freshness status. No new global pack catalogue or unsupported destination rules. Preserve existing tenant configuration. Agency-specific instructions must be labelled as such rather than represented as official requirements.

Item guidance is short reviewed content: what to provide, common omission, and a correction example where useful. Prefer existing fields/content configuration. Static guide assets may be used if reviewed, accessible and synthetic; never another customer's document. Guide content must not teach fabrication, editing bank statements or disguising inconsistencies. Example formatting is not proof of document validity. No new content-management platform or model-generated advice dependency.

Use existing supported languages and approved copy conventions. Do not start a Bangla/i18n expansion if current owner/repo instructions still defer translation. Explanatory text and plain forms remain usable without sample images. Reuse item-specific clarification, retries, notification preferences and deduplication; no chat application or new queue.

**Acceptance:** summary and detail agree after receipt/replacement/correction; guide points to the actual item; invalid/unsafe uploads cannot become reviewed; unauthorized viewers cannot infer hidden evidence; reviewed templates retain provenance/version; missing date remains unknown; progress updates are retry-safe and no false Saved state appears.

### E03. Previous-versus-current declaration view

**Problem:** temporal consistency is technically correct only if users can understand and resolve it. **Affected requirements:** U04/U05/U06.

For an explicitly selected prior declaration/snapshot and current confirmed data, show: subject/field; previous declared value and exact packet/version; current value and version; effective/as-of/recorded dates where known; change classification; explanation and evidence references; review/resolution state and permitted next action.

Distinguish prior declaration from proven truth. Preserve prior packets even after correction. Use the inherited result vocabulary: Consistent, Legitimate change, Context difference, Needs clarification, Insufficient information. Never suppress a genuine unresolved material issue merely because a user supplied an explanation. An explanation is a recorded assertion, not independent proof.

Apply subject, time, currency and basis before comparing. Renewal, a later salary increase, gross versus net values, legitimate concurrent work, aliases and unknown dates are not automatically contradictions. Do not enforce zero employment gaps, infer entry/exit from a ticket, invent missing dates or silently normalize values. Preserve source strings and confirmed representations.

Historical encrypted values must use the existing authorized reveal path. Agency access to a current case does not authorize unrelated old declarations. Owner comparison may use their permitted history; an agency comparison requires explicit scope for both sides. Any deliberately shared prior packet must retain its original version/date label. A discrepancy label must not leak information from an inaccessible source.

Record resolution through suitable existing review/decision mechanisms; add a minimal representation only if W0 proves no existing fit. A relevant new material mutation invalidates prior live review/acknowledgement using existing transaction boundaries. Historical acknowledgements remain exact.

**Acceptance:** meaningful dated change is understandable; incompatible same-context data is actionable; unknown context remains insufficient information; old snapshots stay unchanged; access/revocation is enforced for both comparison sides; no inferred authenticity, fraud or approval score.

### E04. Copy-ready confirmed-information sheet

**Problem:** users repeatedly locate and retype information even after organizing it. **Affected requirements:** U08, with authorized U01/U06 inputs.

Add a purpose preset/renderer to the shared selected-output service. The user selects confirmed facts and, if wanted, confirmed travel/employment/address entries. Render clearly labelled copyable fields and a copy-all plain-text sheet with prepared date, selected as-of context and explicit unknowns. Avoid including empty fields in a way that appears to assert 'none'. Historical information is labelled historical.

Use existing field definitions and repeatable-record formatting. Preserve original names and values; any display-date formatting must be labelled and reversible. Do not silently strip characters or alter facts to fit a supposed government portal. A ticket alone does not confirm travel. Exclude unconfirmed extraction proposals, another person's data, private notes and unselected sensitive identifiers.

Default selection is minimal for the chosen purpose. IDs/contact/financial details are not indiscriminately preselected; their intentional inclusion uses existing authorized reveal and any required assurance, with preview. Build the permitted projection on the server before any value reaches the browser. Render text safely; escape HTML and apply spreadsheet-formula protections when existing CSV output is used.

Preview and output bind exact selected versions. Recheck authorization at every fetch/export; if relevant live revisions change between preview and generation, request refresh/reconfirmation rather than silently exporting a different packet. A deliberate historical export remains labelled with the selected old versions and permitted scope.

Copy is a deliberate user action; never copy on page load. Handle unavailable clipboard permissions with selectable text/download fallback. Do not claim to erase an OS clipboard or previously exported file on logout/revocation. Keep sensitive output out of persistent browser caches, logs and analytics. No browser extension, portal scraping, autofill, government submission or maintained portal-specific format library.

**Acceptance:** a user copies selected confirmed information without retyping; preview and delivered sheet match; unknowns/source dates are visible; unselected/private data is absent in the actual response; expired/revoked access prevents future retrieval; clipboard-denied fallback works; output contains no storage URLs or raw access tokens.

## 4. Historical code seams and mandatory W0 reconciliation

All paths below refer to the 12 October checkpoint. Service paths are under `packages/services/src/` unless stated. They are starting points for discovery, not instructions to overwrite current implementations.

| Area | Historical reuse evidence | Current-code question and minimal action |
|---|---|---|
| Invitation identity | `client-invitations.ts` allowed any signed-in token holder; preview included supplied name/route. `sharing-invitations.ts` had recipient checks and atomic acceptance | Check whether intended-recipient binding and neutral preview now exist. Reuse helpers inside canonical lifecycle; update obsolete token-holder tests only if still present |
| Case grants | `sharing.ts` generic recipient helper failed closed for mission facts/documents without mission context | Check current selected-evidence projection. Never widen to wallet scope to populate a page |
| Profile/time/history | `profile.ts` had immutable versions, effective dates and `revealFactVersionValue`; history page used raw values and creation time | Check unknown-effective-date semantics and authorized history projection; reuse encryption and bound/batch reads |
| Replacement/invalidation | `wallet.ts`, `documents.ts`, `material-revision.ts` and mission usage links | Verify every new edit/replacement calls canonical transactional invalidation and preserves snapshot versions |
| Consistency | Schema `conflicts` required an AI field proposal | Check current deterministic review/decision representation; do not create fake AI proposals to persist general conflicts |
| Requirements/triage | `missions.ts`, `packs.ts`, `agency.ts` evidence request lifecycle, assignments, notes and review | Verify existing summaries/presets/guidance before adding E02. Use pack version/source reviews and role-scoped evidence |
| Attention/calendar | `notification-sweep.ts`, `expiry.ts`, tasks/appointments; `apps/web/src/lib/ics.ts`; mission appointment ICS route | Reuse aggregation and optional serializer. No external calendar OAuth or duplicate reminder worker |
| Outputs | Existing selected evidence and grants; `export.ts`/`export-csv.ts` were broad account exports | Check for newer narrow output service; share one authorized projection across U08/U09/U10/E04. Never filter a full-account response only in UI |
| UI | `apps/web/src/lib/profile-fields.ts`, `profile-sections.ts`; applicant profile/evidence/history and mission pages | Preserve approved design composition/navigation. Add actions and views within current structure; no dashboard redesign |
| Learning | Operational events and current case/pack records | Use existing metadata-only instrumentation; no additional analytics system |

### W0 output and stop conditions

Produce one compact delta ledger before editing: requirement ID; current SHA; current file/symbol and test; existing/partial/missing/blocked; smallest remaining change; migration if unavoidable; acceptance evidence needed. Compare changed files since the historical SHA when accessible; inspect current code even if the comparison is unavailable. Record matching implementation as reused, not new work.

Check actual current auth/storage/email selection, operating mode, release acceptance, applicable instructions, migration state and flags through authorized evidence. Do not infer production configuration from source defaults or historical configuration. Current-source facts replace outdated path/gap assumptions but do not silently alter product requirements. If current branch is ahead, preserve it.

If the repo already implements part/all of v1.1 or these refinements, reduce the diff and attach passing evidence. Do not replay old migrations, reset flags or rebuild working services. Record red baseline checks separately and follow current repo instructions to resolve them before declaring a package complete.

## 5. Architecture and data/API decisions

Retain Next.js/TypeScript, existing pnpm/turbo monorepo, Neon/Drizzle, configured Neon Auth, Resend, private storage adapters, audit and durable job boundaries. Legacy provider code is not removed incidentally. Do not install a new auth, CMS, PDF, search/vector, notification or AI gateway system.

Mission is the canonical case. Master facts/wallet, case selection and frozen declaration snapshots remain separate layers. Ordinary metadata views can be composed through small query/projection functions; mutations call existing authorized services. E01-E04 need no compulsory model call. E02 guide copy uses reviewed configuration/static content; no hardcoded jurisdictional promises.

Reuse one server-authorized selected-output projection with thin templates for agency brief/handover, trip essentials, AI context and confirmed-information sheet. Authorization precedes protected-value reveal and response serialization. The projection carries selected immutable versions, source/as-of context, purpose and unknowns. Live recipient reads recheck grants; exported copies cannot be recalled. Do not persist another copy of the entire profile to create outputs.

New pure helpers may cover contextual comparison or formatting. Avoid bolting unrelated logic into large agency/missions/AI files. Add exports through current package boundaries. Final module names/route placement follow the current repo; do not create speculative APIs solely to match this document.

Use additive schema changes only after W0 proves existing definitions cannot represent the requirement. New metadata follows encryption, consent, audit and retention classification. Do not centralize all guessed future changes into a large migration. Existing mutation idempotency, optimistic concurrency, validation, rate limiting and transactional invalidation remain mandatory. No cron/queue/provider is introduced for a read aggregation.

## 6. Delivery: three PRs and six sessions

W0 precedes all six sessions. All current-code references in session instructions are discovered/revalidated there. Assign the implementation branch explicitly before any push under repo policy. A plan file is not authorization to publish code, execute production migrations or activate data collection.

| PR/session | Bounded scope | Primary requirements | Exit evidence |
|---|---|---|---|
| PR1/S1 | Intended-recipient invitation, neutral preview, atomic claim/reissue and authenticated owner resume; only verified gaps | U07; E01 return-path security | T02-T05/T15-T16 affected cases; unrelated/forwarded/replayed invitations cannot claim or reveal; no duplicate case |
| PR1/S2 | Version/time semantics, change impact and narrow consistency resolution foundation | U04/U05; E03 service foundation | T06/T10-T12; dated changes correct; unknown date honest; unsafe replacements unavailable; history exact |
| PR2/S3 | Personal Record, Application Memory and understandable prior/current comparison | U01/U06; E01/E03 | T01/T07/T10-T12; E01/E03 tests; authorized protected history; useful partial profile and task completion |
| PR2/S4 | Reuse, attention, resumable request journey and agency triage/guidance | U02/U03/U07; E01/E02 | T02/T05-T09/T13; E01/E02 tests; persisted resume, scoped A/B reuse, consistent actionable summary and guides |
| PR3/S5 | Shared authorized projection, selection/preview, four thin output presentations | U08/U09/U10; E01 output/E04 | T14-T16; E04 tests; selected brief, handover, trip/AI formats and confirmed-information sheet function without new providers |
| PR3/S6 | Full loop acceptance, regression/security/privacy, evidence ledger and release reconciliation | All U/E/T | All coverage mapped to exact commit; mandatory checks; actual authenticated journey evidence; no unsupported launch claims |

PR1 isolates sensitive foundations. PR2 integrates the task and agency journey. PR3 completes useful outputs and end-to-end acceptance. No fourth feature PR or new platform module is assumed. If reviewability or a necessary independent migration requires subdivision, document that delivery adjustment without adding scope. Six sessions are bounded handoffs, not elapsed-time guarantees.

Read only the relevant paths/symbols/tests within each session; expand the set only for an identified dependency. Complete each service-to-UI path rather than leaving labels that promise unimplemented protection. PR2 may demonstrate request completion before PR3 output work, but the whole loop is not complete until PR3 proves the actual selected output and retained history.

## 7. Verification and coverage ledger

Keep inherited T01-T16 unchanged in intent, listed in Appendix C. Add R01-R08 below. Security tests exercise real service/route boundaries, not merely hidden UI. Use synthetic fixtures in development and permitted staging records; do not solicit real financial evidence as a shortcut around release conditions.

| ID | New v1.2 acceptance scenario | Refinement |
|---|---|---|
| R01 | Fresh and returning traveller completes a selected task without full profile/goal/passport; supported auth returns to the correct task; invalid return URL rejected | E01 |
| R02 | Minimum input produces an honestly partial useful result; save failure/retry is visible; preview/export contains only authorized selected data | E01 |
| R03 | Agency triage equals item state after request, receipt, processing, correction, review and replacement; no false reviewed/ready label or hidden-history inference | E02 |
| R04 | Existing pack/preset creates a permitted request with applicable version; guidance states what/why/action without exposing real sample PII or inventing official rules; deferred languages stay deferred | E02 |
| R05 | Prior/current view uses exact versions and context; renewal/later salary/gross-net/alias/unknown dates classify appropriately; false old declaration is correctable without rewriting history | E03 |
| R06 | Comparison refuses inaccessible side, unauthorized modified ID and revoked grant; resolution/new changes retain material-review invalidation and frozen history | E03 |
| R07 | Sheet copy/download has only selected confirmed fields/entries; sensitive defaults minimized; unknowns/as-of visible; unsafe text/CSV handled; clipboard-denied fallback works | E04 |
| R08 | Relevant revision or permission change between preview and export forces authorized refresh/denial rather than silent different content; no raw links, unselected values or persistent browser copies | E04 |

Coverage row fields: requirement/test ID; current code and regression test; package/session; status (reused/implemented/blocked); exact test command and outcome; tested commit; remaining live evidence. Do not label a requirement done solely because a component or mocked test exists. Reuse tests and add meaningful behaviour/security regressions; avoid implementation-mirroring test proliferation.

For PR1 verify the identity/version foundation and affected negatives. For PR2 verify record/reuse/request/comparison/attention journeys. For PR3 run full T01-T16 and R01-R08 coverage with all output formats. Every PR still receives the complete current repo-required ship verification; focused checks are feedback during editing, not substitutes.

The historical CLAUDE.md required lint, typecheck, full tests, web Vitest, web build, production dependency audit, prescribed browser/security checks and smoke. Required CI names were `Lint · Build · Typecheck · Test`, `No-secret Playwright checks`, `No-secret smoke check`. W0 revalidates exact commands/configuration. Do not use an obsolete WorkOS test setup if current instructions require Neon Auth journeys; do not remove coverage because the provider changed. Preserve named CI gates unless a separately authorized change supersedes them.

Run one complete final local verification batch per finished PR and inspect its summary; rerun appropriate checks after fixes. Never skip, disable, quarantine or waive required tests to reduce tokens. Demonstrate new critical guards can fail using the repository's prescribed safe regression procedure. Report baseline failures, skipped-by-design checks and unverified live controls honestly. CI green is only claimed for the exact checked head SHA. Historical test counts are not new evidence.

## 8. Token, cost and handoff discipline

Use one coding agent and one active writer per worktree. Do not ask Codex and Claude to rediscover and edit the same scope concurrently. No autonomous subagents are introduced. Each session stays on its assigned boundary and leaves a short durable handoff. No model or effort change is required mid-session; do not claim a particular model guarantees correctness or lowest cost.

At implementation start, place this single consolidated artifact at `docs/upgrades/upgrade.v1.2.execution.md`, one compact status file and one coverage ledger. Preserve v1.1 as history; do not reread both generations every session. Status stays about 250-400 words: branch/current SHA, session, completed IDs, touched paths, exact checks/results, blockers and next action. The ledger owns full coverage and evidence; logs remain outside prompts.

At first session, read authority/invariants and assigned requirement sections; later sessions read the status, assigned sections and code delta. Search exact symbols using `rg`, then bounded ranges. Do not dump huge schema/agency/missions/AI files, append-only known-issues logs, full passing CI logs, generated snapshots or lockfiles into context. Read those only for demonstrated dependencies.

Batch independent source/test discovery and tool reads. Keep edits, migrations and dependent verification sequential. Follow current repo preflight limits. Use one CI watcher according to repo guidance rather than repeated manual polls. No full tests after every small edit; targeted feedback during work, complete mandatory batch at the PR boundary, repeats justified by a change/failure.

Retain existing dependencies and infrastructure. E01-E04 require no per-use AI charge; storage, compute, email, security operations, support and verification are still real costs. No assertion that 1,000 users fit free tiers or that extraction/share costs equal an unmeasured number. Track actual operation costs and baseline-to-after staff/user effort with existing instrumentation.

## 9. Release, operations and commercial access

Historical 12 October operating evidence recorded BETA_BLOCKED for public sensitive-data use, controlled synthetic operation, outstanding live scanner/storage, inbox/auth, MFA and full recovery/lifecycle acceptance. Personal sharing invitations were enabled under specific approval. These are historical observations to reconcile, not assertions about 15 October production. Do not reset settings or duplicate prior migrations based on old notes.

Current release obligations must be checked and closed alongside implementation. Completion of U01-U10/E01-E04 does not authorize public-data activation or establish commercial launch readiness. Enforce existing controls before processing sensitive data; do not bypass them through anonymous uploads or delete-after-extraction promises. Production migrations remain explicitly authorized per run. Do not treat a production restore as application rollback.

Core Founding Access stays complimentary. No new payment, VIP, artificial profile-completion or usage-marketing gate. Existing permissions, abuse controls and actual safety dependencies remain. No automatic agency access to a traveller's next case; no marketing right inferred from an old engagement. Traveller-facing permitted outputs remain accessible under retention policy, agency-private notes remain private, and there is no new payment-based deliverable lock.

Handover includes changed files/services/routes/migrations, selected-version/access behaviour, acceptance ledger, exact check results and commit, actual configuration changes, known limits, variable-cost effects and deployment/rollback instructions where applicable. Claim live verification only with current deployment evidence.

## 10. Measurement, compounding assets and scope exclusions

Measure metadata only through existing instrumentation: time to first useful result; task/invite completion and resume; clarification/re-upload rounds; reviewer handling effort; repeat record reuse; selected output usage; errors resolved; support fallback; variable-operation costs. Do not log values, document text, identifiers or invite tokens. Do not confuse link exposure with activation, records with users, or agency interest with revenue.

Every processed/closed case must improve at least one approved asset through the current reviewed operations boundary: rules library, evidence taxonomy, operational benchmark or distribution network. Ordinary measured workflow events can contribute to benchmarks. Do not auto-publish personal data or turn one case outcome into an authoritative immigration rule. No new analytics/data-warehouse subsystem.

Explicitly outside this v1.2: watermarked-rendition product, financial forensic/rejection scoring, anonymous sensitive diagnostic uploads, sponsorship/guest-contributor vaults, new EA delegation or multi-applicant synchronization, messaging/email/archive ingestion, WhatsApp bot/API sending, browser extension/portal autofill, tax-residency determinations, automatic stamp reconstruction, public corridor intelligence, passport-unlock rule product, corporate KYC verification, public agency rankings/Top100, marketplace, bank/embassy APIs, native apps, encrypted offline caches, new paid OCR/provider, broad design/i18n expansion and new paywalls. Existing approved AI remains available under its existing controls but is not a dependency for these tasks.

Reviewed missing-item guidance, request presets, renewal shortcuts, confirmed travel-history display and accessible acknowledgement receipts are subordinate improvements to U01-U08/E01-E04, not new programmes. Do not use this list to expand scope into their automated or institution-specific variants.

## 11. Implementation starter and session handoff

```text
Use docs/upgrades/upgrade.v1.2.execution.md as the consolidated task contract.
Preserve all U01-U10, E01-E04, T01-T16 and R01-R08 requirements. Implement
only the assigned session. First read applicable repo instructions and the
short status. If W0/current-code reconciliation is incomplete, complete it
before editing; if the repo is inaccessible, report that blocker and stop
code work. Never assume historical findings are current or reset to old main.

For S1 inspect current client/sharing invitation, auth, grant and accept UI
boundaries plus their tests. Record existing/partial/missing/blocked, then
make only the smallest remaining recipient-safe claim/resume/preview change.
Reuse identity, audit, transactions, storage, mail and scope services. Add no
guest sensitive-upload system, SMS provider or new permissions engine.

Use focused checks during edits and every current mandatory verification at
the completed PR boundary. Update the short status and evidence ledger with
the exact commit and outcomes. Do not claim green/live/launch-ready from old
results. Do not push to an undesignated branch, execute production migrations,
merge/deploy or activate sensitive-data intake without applicable authority.
Stop at the assigned session boundary; do not opportunistically implement
excluded ideas or later sessions.
```

For S2-S6 replace the S1 work boundary with the assigned row in section 6, keeping authority and evidence rules. Each brief needs requirement IDs, allowed paths/symbols from W0, invariants, relevant tests and a concrete done condition. Do not paste the entire prior conversation.

## 12. Completion and remaining dependency

Product scope is consolidated: ten upgrades plus four refinements, with no feature removals. Execution remains conditional on W0 because today's latest repository is inaccessible. Once access is restored, record the current SHA, resolve the historical delta, revise only implementation-path assumptions and append the reconciliation outcome. Any material product/privacy/provider change gets an explicit versioned owner decision.

Upgrade v1.2 is complete only when all U/E requirements and T/R acceptance scenarios map to working code and evidence; identity, selected access, temporal truth and frozen history remain correct; the full request-to-retained-record loop works; required checks pass; and current live-release limitations are accurately disclosed. Do not reduce the meaning of done to a mock, successful build, number of users or a partial PR.

## Appendix B. Inherited product requirements, consolidated verbatim in intent

The following requirements are carried forward from the locked v1.1 contract. Version references are updated to v1.2 and punctuation normalized. E01-E04 above clarify their task journey and presentation. They do not weaken the inherited security/ownership requirements.

### B02. Canonical information ownership and reuse

#### Three layers

| Layer | Content | Policy |
|---|---|---|
| Master Profile and Wallet | Traveller-provided reusable facts/documents, their versions/provenance | Traveller-controlled; agencies receive selected, purpose-limited access. |
| Case/Mission | Destination, purpose, dates, requirements, selected records, requests, correspondence and outcomes | Visible only to traveller and explicitly authorised participants. |
| Historical snapshot/declaration | Exact fact/document/rule versions approved or handed off at a stated time | Immutable representation with existing retention/access policy. Not proof of factual correctness or government submission. |

Save reusable information once; attach references separately to each case; freeze exact versions in historical outputs. Do not copy personal evidence into agency-owned silos or duplicate the same stored bytes to prepare another case. Distinct logical ownership/versions must not be collapsed solely because hashes match.

#### Master-save rules

- Owner-uploaded reusable documents are saved to the owner's wallet and explicitly attached to the current case. Case-only assets may be labelled/stored as such using existing visibility/type controls.
- Reusable facts entered by the traveller become confirmed versions through the existing permitted write path. Autosave means server persistence of valid completed input, not permission to silently accept OCR/AI or overwrite a conflicting master fact.
- When a new answer differs materially from an existing master fact, ask whether it is a new circumstance, correction or context difference. Preserve the prior version.
- Trip-specific facts stay in the case. Selecting a new destination or date must not overwrite another mission.
- Contributor-restricted documents retain their permissions/reuse choice. Do not automatically expose them as unrestricted traveller wallet items.
- Agency-private notes, internal assessments and organisation-only records remain separate from traveller exports/onward sharing, subject to applicable access obligations.
- Agency-produced traveller-facing outputs/approved packets must remain available to the traveller under the case's permitted retention policy; do not strand them merely because agency access ends.

#### Cross-agency example: mandatory behaviour

Agency A invites a traveller to a UK case. Traveller supplies personal facts and documents. Reusable data saves to their profile/wallet, with selected references in A's case and exact historical snapshots. Later Agency B creates a separate engagement. Traveller selects relevant existing records after freshness/change review. B receives a new explicit grant and its own case - not A's workspace. Old refusal/application records are shared only if the traveller deliberately includes them. A gets no automatic access to B's work.

Do not infer record access from matching names, emails, agency membership or an existing relationship. Same-person continuity uses the existing immutable identity binding, not an email-only merge.

### B03. U01  -  Personal Record

#### User behaviour

The signed-in traveller sees clear groups for personal details, passports/identity, travel/application history, employment/professional records, education, relevant finances and other existing supported categories. Reuse the canonical field registry; extend it only for an approved missing field. Family records remain distinct subjects with explicit relationships.

Documents show type, subject, version, date/expiry where known, processing/review state, use in active cases and selected access context. `Current version` describes record/version status, not authenticity or suitability for every purpose.

Provide metadata filters/search and contextual actions: View, Update/Replace, Use in case and Share. Do not add full-document semantic search/vector infrastructure. Protect sensitive metadata through the existing permission boundary.

#### Acceptance

- Owner can find a current passport or employment document using metadata and identify its previous version.
- Unselected personal wallet items do not appear to an agency.
- Processing/rejected/expired records cannot be mistaken for reviewed usable evidence.
- Empty state allows useful manual entry without a passport, trip or complete profile.

### B04. U02  -  Prepare again without starting again

Create a new draft mission from existing profile records, an approved template/pack or a previous case. Copy reusable preparation intent/references only, not previous approvals, outcome, acknowledgements, agency grants, private comments or submission status.

Show three groups: Reusable; Needs refreshing/review; Missing. Include relevant current facts and candidate documents only. Traveller previews/confirms attachment. Deterministic suggestions may identify candidates but must not treat similarity/type match as acceptance.

New agency engagement requires its own grant. A historical document may be retained in an old snapshot while its updated version is selected in the new case. Requirements use the intended current/published applicable pack version; stale/unknown rule status remains visible.

#### Acceptance

- Repeat case starts without retyping unchanged confirmed facts.
- Outdated evidence is marked for review, not silently accepted or deleted.
- New case starts in draft/intake with fresh tasks/acknowledgement and no inherited recipient access.
- User can reject a suggested record and choose another.

### B05. U03  -  Needs Attention

Aggregate existing tasks, deadlines, document expiry/freshness, incoming requests and material-change review into one authorised read projection. Each item shows why it matters, relevant case/person, due date where applicable and a direct resolution action.

Prioritise actual overdue/blocked work before general reminders. Avoid duplicated alerts for the same event. Use existing in-app/email delivery, idempotency, retry and notification preferences. Sensitive details stay inside the authenticated workspace.

Optional calendar export produces an `.ics` file for selected appointments/tasks/reminder dates, with minimal generic titles by default and explicit preview. It is a one-time export; later changes do not automatically update the user's calendar. No Google/Microsoft OAuth integration or calendar credentials in v1.2.

#### Acceptance

- A task/expiry event appears once with a working action.
- Successful completion/replacement clears or changes the appropriate attention item.
- Missing date is shown as unknown, not guessed.
- Calendar dates preserve timezone meaning and exclude passport/financial identifiers by default.

### B06. U04  -  Change impact

When a confirmed master fact or document changes, identify active missions selecting it using existing dependency links. Show affected cases, what changed, and required actions. Preserve old document records and snapshots.

Use existing material-revision and acknowledgement invalidation in the same transaction as the material mutation. A new pending/quarantined replacement is not treated as usable. Changed evidence loses applicable current reviewer approval. Re-review tasks/notifications are deduplicated and recipient-scoped.

Do not mass-update frozen packets. Do not extend a recipient's scope to new fields/categories automatically. Any current shared-case update follows the previously disclosed selected-item scope; scope expansion needs explicit consent.

#### Acceptance

- Renewal/correction shows affected selected cases.
- Material change invalidates old live acknowledgement exactly once and prevents stale final output.
- Historical snapshot remains unchanged.
- Another agency receives no details unless its own valid scope permits the changed item.

### B07. U05  -  Time-aware consistency

#### Meaning

Consistency means facts coexist truthfully within their subject, time and context - not identical values forever. Separate current profile, historical circumstances and prior declaration. Correct truth; never preserve a false answer for apparent consistency.

#### Metadata contract

Inspect existing fields before extending: subject/field/repeating record; immutable value/version; source/provenance; effective-from and effective-through where applicable; observation date or period for measurements; recorded-at; actor; change type; explanation/evidence where material; review status. Unknown dates remain unknown; the save date is not silently used as the real-world change date.

Change types: New circumstance; Historical correction; Context/representation difference. A passport renewal is a new repeating identity-document record linked to the same person/predecessor, not replacement of old passport facts in historical applications.

#### Narrow first implementation

Compare selected, confirmed or explicitly reviewable data for:

- Passport number, date of birth and names for the same person/document context.
- Travel/leave dates where the requested trip and coverage refer to the same case.
- Missing required fields/content from configured requirements.
- Prior-versus-current material declarations for selected fields, with effective dates/context before classifying.

No mandatory automated extraction dependency. Use existing approved extraction candidates where present; otherwise manual confirmed input remains functional. Preserve source strings and show source references. No broad bank transaction analysis, fraud detection, hidden person score or universal fuzzy-name equivalence.

Result types: Consistent; Legitimate change; Context difference; Needs clarification; Insufficient information. Map these to existing readiness/review vocabulary rather than adding a parallel case state machine. Show the comparison and reviewer/user action; do not silently suppress a conflict.

#### Legitimate-change examples

| Situation | Required handling |
|---|---|
| Passport renewal | New record/current document selection; old case retains old passport. Existing visas on old passport are a separate destination-specific check. |
| New employment/title/salary | Dated transition; concurrent work may be valid; prior periods remain. |
| Changed bank balance | Separate as-of observation with account/currency; variation is expected. |
| Salary versus deposit | No automatic failure without matching period/currency/gross-net/payment basis. |
| Address/family/circumstance change | Record effective date and supporting record where necessary. |
| Name spelling/transliteration | Exact sources plus confirmed alias; no silent merger or document alteration. |
| Wrong old entry | Append correction tied to mistaken version; historical declaration stays intact. Material submitted errors may need qualified advice. |
| Changed purpose/sponsor/duration | User-confirmed new intent; affected drafts/acknowledgements require review. |
| Official rule change | Requirement/source event, not applicant contradiction. |

AI/agency suggestions remain proposals. Narratives derive from confirmed facts and traveller-stated intentions; never invent ties, motives, return assurances or excuses.

#### Acceptance

- Salary change from a later date is not classified as contradiction.
- Gross/net difference remains Context difference/Needs clarification, not fraud/failure.
- Unknown date remains Insufficient information.
- Same-period incompatible identity data becomes a neutral actionable conflict.
- User explanation is recorded with author/source; it is not proof of correctness.
- No statement about approval likelihood is generated.

### B08. U06  -  Application Memory

Provide an owner-visible timeline of cases and their prepared snapshots, acknowledgements, handoffs, recorded external submissions and outcomes. Show agency, purpose, date, exact version and status. A download/approval is not submission; use existing recorded-submission semantics.

Allow selected comparison between an old declaration and current confirmed facts. Describe legitimate dated changes and unresolved corrections using U05; do not assume the old statement was true or enforce its repetition.

Traveller can export permitted historical packet/manifest. Agency B sees A's history only when explicitly selected for a new permitted share; no cross-tenant private commentary or agency metrics.

#### Acceptance

- User can retrieve what was approved for a previous case.
- Renewed records do not alter that representation.
- Prepared/approved/reported-submitted labels are distinct.
- Comparison uses exact snapshot versions and current effective context, not only today's display strings.

### B09. U07  -  Resumable agency intake

#### Two link types, no bearer-data access

Personal case invitation is bound to intended recipient/case and leads to authenticated claim. General agency intake link is a public agency entry point through which each user creates/resumes only their own work. Neither opens applicant data through URL possession.

Use the existing invitation/case capabilities if present. If no canonical mission can exist before applicant binding, store a minimal invitation/request template and create/bind the mission atomically after authenticated acceptance. Do not invent a duplicate applicant account or expose another person's existing mission merely to create a link.

#### First visit

1. Public page/link preview shows agency branding and neutral invitation text only. No applicant name/email, case details, filenames or progress.
2. Correct signed-in account continues without redundant login. Otherwise use existing Neon Auth signup/sign-in/recovery; do not assume unimplemented OTP or magic-link support.
3. Server validates invitation, recipient identity, agency/case status and expiry. Verified email may establish eligibility for a new invitation; it cannot transfer old records or administrator rights through email matching. Existing trusted identity binding controls apply.
4. Traveller sees agency, purpose, requested scope and duration, then accepts explicitly. Narrow default scope is this case's selected facts/documents, not the entire wallet.
5. Atomic claim binds the invitation to immutable authenticated identity and consumes the claim token; concurrent/replayed claims fail safely.
6. Open case checklist and persist its account association. Case appears under My Cases, so the message/link is not the only way to return.

#### Saving and visibility

Disclose: Items you add to this case are visible to authorised agency staff; your other records remain private. `Add to this case` is an explicit attachment/share action. Valid completed case answers may autosave under this scope. Personal wallet uploads remain private until selected. Show Saving, Saved at [time], or Not saved - retry accurately.

Do not offer fake private drafts. A shared current-version pointer is visible under its valid grant. If private drafting is introduced, reuse an actual staged proposal/draft mechanism and enforce server-side visibility; it is not required as a new v1.2 system.

#### Resume/replace

- Return while signed in: reopen existing saved state.
- Expired session/new device: authenticate and return without restarting the case.
- Wrong account/forwarded link: neutral unavailable/account-switch message with no personal metadata and no read/upload/replace access.
- Invitation default: seven days before initial claim, configurable. Reissue invalidates old claim token but keeps same case/progress. Accepted link can only navigate its bound owner; it cannot claim again or grant rights.
- Agency-grant expiry is separate from traveller record ownership. Renewal needs explicit consent.
- Replacement creates a new immutable version. Until it passes validation/scan and case attachment confirmation, show Processing or Needs attention, not completed replacement. Old shared version status is clear.
- Once material replacement becomes active, use U04 revision/review/acknowledgement invalidation. Historical packets stay frozen.
- Removing from case differs from underlying erasure; retain/delete according to current policies and holds. Revocation never promises recall of copies.

#### Request UX

Each checklist item identifies required content/date range, reason, due date and status: Missing; Processing; Received; Needs correction; Reviewed. Allow bounded item-specific clarification using existing task/comment mechanisms; no separate chat product. Group/deduplicate notifications and open the authenticated item directly. Agencies propose corrections; they do not silently edit confirmed master facts.

#### Security acceptance

- Forwarded URL fails in anonymous and unrelated-account browsers, including API/preview/export attempts.
- Link-preview GET cannot consume/claim invitations; no access mutation on GET.
- Token is high entropy, hashed at rest, expiring and revocable; tokens/PII absent from logs/analytics/referrers. Post-claim navigation removes token from address bar.
- Every object operation checks current identity, subject, case, recipient, grant status/expiry, role and item scope.
- Agency members cannot access other tenants or unselected wallet items.
- Private storage and existing authenticated document gateway used; underlying signed URLs are short-lived and not claimed identity-bound unless enforced.
- Reauthentication for consequential sharing/export/acknowledgement uses existing assurance controls. CSRF/session/rate-limit safeguards remain.
- Server-saved progress survives interruption; retry is idempotent; simultaneous edits detect stale revision.
- No sensitive authenticated records/files persist in service-worker cache or localStorage to make resume appear easy.

### B10. U08  -  Selected brief and handover pack

Provide purpose presets for agency enquiry and case handover. User chooses recipient and selected facts/documents, previews exactly the content/scope and then shares through existing grant mechanisms or exports.

Brief includes relevant purpose/dates/preferences, selected preparation state, missing questions/items and source/as-of dates. Handover includes permitted selected records and work status, not previous agency-private notes. A previous snapshot is included only by deliberate selection.

Do not repurpose the full account export as a minimal brief without filtering: build an authorised projection, then use existing render/CSV helpers. Stable HTML/print plus structured data/CSV is sufficient; no new PDF service or archive service required. Original file access uses existing controlled downloads; reference manifests are not public document URLs.

WhatsApp share uses a prepared generic message plus secure workspace/invitation link. Sensitive documents/identifiers are not placed in the message or social preview. No automatic sending or WhatsApp Business API integration.

#### Acceptance

- Preview and delivered/exported content match exact selected versions.
- Unselected records and private notes excluded in server output, not merely UI.
- Separate B grant created; A receives no access to B case.
- Expired/revoked grant denies future access; exported-copy limits disclosed.

### B11. U09  -  Trip essentials pack

From an existing case/trip reference, let owner select ticket, accommodation, passport/visa copies, insurance and contacts relevant to that trip. Include only supplied/approved available items; absence stays visible. No claim that the template covers every border requirement.

Render an authenticated mobile summary with links to authorised original evidence and a printer-friendly page. Financial records/refusal history excluded by default; user deliberately adds anything extra with preview. Keep documents distinct from summary and label copies appropriately.

No encrypted offline PWA, Apple/Google Wallet pass or emergency device-recovery implementation in v1.2. Printing/downloading a summary is an explicit export with its privacy limitations. Do not cache all evidence in browser storage.

#### Acceptance

- Selected essentials can be located quickly with owner/grantee scope preserved.
- Printable output contains only selected content and date/version.
- No false Boarding pass, Certified copy, Verified booking or Guaranteed entry label.
- Missing/stale items remain visible; no invented booking/contact.

### B12. U10  -  AI-context export

Choose purpose/question and selected relevant facts. Produce a previewed, dated text/Markdown context brief containing confirmed facts, relevant historical context, document inventory/freshness metadata, unknowns and the user's question.

Omit passport/ID/account numbers, exact address, contact identifiers, raw scans and unrelated financial/refusal details by default. User may intentionally include a sensitive field after preview; do not imply the AI tool's retention/training policy is controlled by VisaStack. Source provenance and fact status accompany relevant statements.

Controls: Copy text; Download text/Markdown; Change selection. No model call, persistent public link or live token required. Clearly state exported snapshot/date and that changes do not sync. Disconnection/revocation cannot erase exported content from another service.

Provide task guidance to distinguish confirmed facts, assumptions and current official requirements, cite authoritative research, avoid approval predictions and request clarification. These instructions do not guarantee model compliance or current knowledge.

#### Acceptance

- Selected context only; unknowns not invented.
- Identifiers excluded by default and protected fields properly authorised/decrypted before user-requested inclusion.
- No AI-provider account/API cost needed for export.
- No scope expansion, raw document transfer or automatic application submission.

### B13. UX and state rules across all upgrades

Home prioritises My Records, Needs Attention and Active Requests/Work. My Next Journey is supporting, at most roughly half initial desktop content; mobile prioritises actionable items. Do not force users to choose a goal, upload a passport, complete all sections or pay before managing their permitted records.

Distinguish storage, safety processing, human review, freshness, sharing and final acknowledgement. Received is not Reviewed. Current version is not Valid everywhere. Saved is not Shared unless disclosed. Approved is not Submitted. Suggested is not Confirmed.

Sensitive actions have concise consequence text, not repeated legal walls. Normal returns to a valid authorised session should not prompt unnecessary reauthentication. High-risk access changes/export/final acknowledgement retain required assurance.


## Appendix C. Inherited T01-T16 acceptance suite

| ID | Scenario |
|---|---|
| T01 | Traveller creates useful manual profile without passport/goal; finds and updates existing records. |
| T02 | Agency A intake: save partial progress, leave, resume same/new device after authentication. |
| T03 | Forwarded invite/URL, unrelated account, modified IDs and link previews disclose no applicant data and cannot claim/write. |
| T04 | Expired/revoked invite reissue preserves case; recipient/agency grants do not bypass identity binding. |
| T05 | Network failure/retry/parallel edits do not lose confirmed work, duplicate case ownership or show false Saved state. |
| T06 | Replace document: pending scan unavailable, current/history distinguished, re-review and acknowledgement invalidation correct. |
| T07 | Personal reusable intake records appear in owner wallet/profile; case-only/restricted contributor data retains scope. |
| T08 | Agency B case reuses selected current records but cannot see A workspace/private notes; A cannot see B. |
| T09 | New case does not inherit prior final approval, submission state, outcome or old grants. |
| T10 | Passport renewal, salary change, net/gross difference, alias, unknown date and historical correction produce proper contextual states. |
| T11 | True same-context conflict is visible/actionable; material unresolved issue prevents affected final readiness, not ordinary profile access. |
| T12 | Prior snapshot/acknowledged packet remains exact after subsequent updates; prepared/approved/reported-submitted distinguished. |
| T13 | Attention items and reminders deduplicate; calendar timezone/export limitations correct. |
| T14 | Brief, trip pack and AI context contain only previewed authorised content; no hidden field/raw file URL/private note leakage. |
| T15 | Grant revocation/expiry denies subsequent page/API/document/export requests; downloaded-copy limitation shown honestly. |
| T16 | Logout/shared-device tests do not expose sensitive persistent caches; session/CSRF/upload controls remain intact. |

Tests must exercise actual services/routes and representative authenticated staging journeys, not only screenshots, mocks or comments. Reuse existing tests; add focused regressions for changed behaviour. Run applicable repository checks and report failures/skips honestly. Do not assert production verification from synthetic service tests.

