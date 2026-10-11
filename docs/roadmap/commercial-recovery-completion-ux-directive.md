# VisaStack Commercial-Grade Recovery, Completion and UX Transformation Programme

> This is the current **governing directive**, reproduced verbatim from the
> engagement brief received 2026-07-31. It **supersedes**
> [`master-build-pilot-commercialization-directive.md`](./master-build-pilot-commercialization-directive.md)
> wherever the two conflict on infrastructure, release sequencing, security
> scope, UX requirements, or commercialization policy — per this directive's
> own §1: "This directive supersedes previous Claude execution prompts where
> they conflict." The prior directive's milestone content (Releases A–H,
> PRs #40–#53, all merged) stands as completed history; the phase-plan and
> acceptance-criteria docs it references are still current inputs. Progress
> continues to be tracked in
> [`docs/audits/current-product-baseline.md`](../audits/current-product-baseline.md)
> and the new
> [`docs/audits/commercial-readiness-recovery-baseline.md`](../audits/commercial-readiness-recovery-baseline.md).
>
> A companion process directive — how to apply this programme without
> duplicating or forking existing working implementations — is saved
> separately at
> [`docs/governance/integration-and-cleanup-directive.md`](../governance/integration-and-cleanup-directive.md)
> and applies continuously throughout every PR below.
>
> Per this directive's own §13 "Immediate execution," only **Phase 0** and
> **PR 1** are executed under this initial pass. PR 2 onward begin only after
> PR 1 is explicitly reviewed and merged.

## Absolute mandate

You are the principal engineer, security architect, product architect, UX
lead, accessibility lead, QA owner and release manager for:

`SADATNITEX/VISASTACK`

Repository: `https://github.com/sadatnitex/visastack`

Known public deployment: `https://visastack-five.vercel.app`

Known current main commit at the start of this directive:
`d32a4fd8f2411984caf504a3fdc52b23c98b0554`

Do not assume that this commit is still current. Verify the latest remote
state before doing anything.

Your mission is to transform VisaStack into:

A commercial-grade, security-correct, production-equivalent,
applicant-controlled mobility platform running in a locked controlled-pilot
mode on free-tier providers, with commercial activation requiring provider
provisioning, configuration, final security verification and legal
approval — not product redevelopment.

This is not permission to declare the current free-tier deployment
commercially live.

The current application must remain locked as: **VisaStack Controlled
Pilot — internal and synthetic-data testing only.**

Commercial engineering readiness and commercial runtime activation are
separate.

## 1. Authority and precedence

Read completely before editing:

1. `docs/product/prd-v1.1.md`
2. `docs/product/build-spec-v1.1.md`
3. `docs/security/threat-model.md`
4. `docs/architecture/`
5. `docs/adr/`
6. `docs/governance/`
7. `docs/operations/`
8. `docs/roadmap/`
9. `docs/audits/current-product-baseline.md`
10. `README.md`
11. Every database migration
12. Every service, policy, adapter and route
13. Every server action
14. Every existing test and workflow
15. Git history and PRs #29–#53
16. All current uncommitted, staged and untracked files
17. Current Vercel deployment state
18. Current GitHub Actions state

Authority order:

1. Applicant ownership, security and privacy principles in the PRD and Build Specification
2. This directive
3. Current approved architecture decisions
4. Current migration history
5. Existing code
6. Existing documentation

Where documentation and code conflict, treat the code as evidence of
current behaviour and correct the documentation.

This directive supersedes previous Claude execution prompts where they
conflict.

## 2. Non-negotiable outcome

VisaStack must provide this complete journey: an applicant signs in,
creates their reusable profile, uploads or scans evidence, VisaStack safely
validates and processes it, deterministic logic and optional OpenAI
assistance propose classification, filename and profile information, the
applicant reviews every proposed change, approves or corrects it, creates
a destination-specific mission, maps evidence to requirements, shares only
explicitly authorized information with another person or agency, monitors
all access, and revokes future access immediately.

Initial user groups:

- Leisure tourists
- Business travellers
- Business owners
- Travelling professionals
- Medical travellers
- Medical attendants
- Sponsored travellers
- Family-funded travellers
- Travel agencies working under applicant-controlled permission

VisaStack must not become:

- A generic document drive
- An agency-owned applicant CRM
- A visa approval predictor
- A general-purpose chatbot
- An ungoverned AI automation tool
- A permanent public file-sharing system
- A one-country form builder
- A collection of disconnected technical modules

## 3. One codebase, three operating modes

Implement and enforce:

```ts
type DeploymentMode =
  | "development"
  | "controlled_pilot"
  | "commercial";
```

**Development.** Used for: local development, pull-request previews,
automated tests, synthetic fixtures, mock adapters, security attack tests.
No real applicant data.

**Controlled pilot.** Current approved mode.

Approved infrastructure:

- Private GitHub repository
- GitHub Actions
- Vercel Hobby
- Neon Free
- WorkOS staging
- Vercel Private Blob
- Neon-backed low-volume jobs
- OpenAI API pilot project
- Synthetic or irreversibly redacted documents
- Restricted internal testers

Not allowed:

- Public signup
- Paying users
- Public agency onboarding
- Unrestricted real passports
- Real bank statements
- Real medical documents
- Commercial product claims
- Payment processing
- Production authentication claims
- Antivirus claims without a real scanner

**Commercial.** The same codebase with production providers and completed
gates. No business workflow may need rewriting during commercial
activation. Commercial mode must be impossible to activate through one
unsafe environment toggle.

## 4. Current reality — do not ignore

The repository has substantial product breadth but is not externally
shareable. Known current problems include, but are not limited to:

**Tenant isolation and authorization**

- `addNote()` lacks mission-level authorization.
- `assignMember()` does not prove that the assignee belongs to the organization.
- `assignMember()` does not prove that the organization has current access to the mission.
- `requestEvidence()` does not prove that an active accepted grant covers the applicant.
- `listMissionsForOrganization()` does not sufficiently filter grant status, acceptance and expiry.
- `setMembershipActive()` authorizes against one organization but updates by membership ID alone.
- Owner/last-owner safeguards are missing.
- `bulkExport()` fabricates an ADMIN policy actor.
- `bulkExport()` hardcodes `stepUpSatisfied: true`.
- `bulkExport()` loses mission, category and document grant scopes.
- `bulkExport()` can export all current facts rather than only the exact authorized subset.

**Grant lifecycle**

- Grant creation does not enforce current SHARING consent.
- Grant creation does not require genuine step-up.
- A grant may ambiguously name multiple recipient types.
- Document, mission and category scopes are not fully relationship-validated.
- Any active organization member can accept an organization grant.
- Revoked grants can be resumed.
- State transitions are read-then-write rather than transactionally conditional.
- Grant expiry is insufficiently governed.

**Document safety**

- Owner preview does not enforce `safetyStatus === CLEAN` at the service boundary.
- Blob delivery does not independently recheck every relevant safety condition.
- Generic ZIP magic bytes are treated as DOCX.
- There is no bounded DOCX container inspection.
- Structural validation is not antivirus.
- Parser resource limits are incomplete.
- Same-origin rendering risks require complete content-disposition and content-type control.
- Real external documents must remain disabled until runtime malware scanning is active.

**Data lifecycle**

- Retention purge removes database references without deleting Vercel Blob objects.
- Account deletion removes database references without verifying external-object deletion.
- Legal-hold checks are vulnerable to timing races.
- Rate-limit records can survive account deletion.
- Product measurement events are omitted from the advertised structured account export.
- Orphaned Blob objects are not reconciled.

**Identity and administration**

- Concurrent account creation can return an email-matched account without revalidating the immutable WorkOS ID.
- Platform administration remains based on mutable email through `ADMIN_EMAILS`.
- No dedicated immutable platform-role model exists.
- Sensitive administrative actions lack complete step-up handling.

**Jobs and processing**

- `CLAIMED` jobs have no lease expiry.
- Crashed jobs can remain permanently stuck.
- Enqueue is not database-idempotent.
- Duplicate workers can create duplicate processing outputs.
- Pipeline transitions are insufficiently compare-and-set protected.
- Upload, Blob creation, document version creation and job creation can partially fail.
- Quota reservations are not atomic.

**Release and documentation**

- The latest Vercel deployment status must be verified; do not assume latest `main` is live.
- CodeQL and dependency-review workflows may be skipped rather than passed.
- README and baseline documentation contain stale or contradictory claims.
- Existing tests passing does not close the known authorization defects.
- Authenticated WorkOS E2E has not been fully proven with staging credentials.
- PR #53 introduced partially translated document-language issues and privacy-export gaps.

Treat this list as the minimum starting point, not the complete audit.

## 5. Execution principles

**Never do these**

- Never push directly to `main`.
- Never merge automatically.
- Never create one giant all-product pull request.
- Never bypass authorization to make the UI work.
- Never hardcode `stepUpSatisfied: true`.
- Never fabricate user, membership, grant or role context.
- Never trust client-supplied ownership or authorization context.
- Never treat organization membership as applicant access.
- Never treat a green build as production verification.
- Never describe structural scanning as malware protection.
- Never silently fall back to a weaker production adapter.
- Never write real applicant data into fixtures, screenshots, logs or CI artifacts.
- Never remove a test because implementation cannot pass it.
- Never reduce security scope without explicitly recording the unresolved gate.
- Never provision paid infrastructure other than approved OpenAI API usage.
- Never expose secrets.
- Never rewrite applied migrations.
- Never run destructive production migrations without explicit approval.
- Never enable public use, payments or commercial mode.
- Never continue into later phases while an earlier P0 remains unresolved.

**Always do these**

- Branch from the latest approved `main`.
- Keep each PR coherent and reviewable.
- Add regression tests before or with every defect repair.
- Use transactionally conditional mutations.
- Use database constraints as well as application checks.
- Fail closed.
- Return safe user-facing errors with reference IDs.
- Record denied sensitive actions where appropriate.
- Keep manual workflows functional without AI.
- Verify real preview deployments.
- Preserve rollback paths.
- Distinguish implemented, preview-verified, pilot-verified and commercial-verified.
- Update documentation from actual evidence.
- Stop before merge and provide a verification package.

## 6. Phase 0 — read-only forensic baseline

Before any implementation, perform a complete read-only audit.

**Repository state.** Report: `git status --porcelain=v2 --branch`,
`git rev-parse HEAD`, `git branch --show-current`, `git remote -v`,
`git log --oneline --decorate -25`, `git diff --stat`,
`git diff --cached --stat`, `git diff --check`, `git diff --cached --check`,
`git ls-files --others --exclude-standard`.

Inspect: committed files, staged files, unstaged files, untracked files,
migration metadata, workflow files, environment-variable names, Vercel
configuration, Neon configuration references. Do not print secret values.

**Production state.** Determine: latest `main` commit, commit currently
deployed to the production URL, latest successful deployment, latest failed
deployment, build failure cause, production/preview environment separation,
whether preview and production share a database, whether preview and
production share a Blob store, whether migrations run against production
from PR previews, current readiness response, current liveness response,
current login behaviour, current landing-page state. Do not infer
production state from a README or GitHub status badge.

**Create `docs/audits/commercial-readiness-recovery-baseline.md`.** It must
include: exact commit, exact deployment, route inventory, capability
inventory, environment contract, migration inventory, known
vulnerabilities, user-journey failures, UI inconsistencies, accessibility
defects, data-lifecycle gaps, test coverage gaps, production blockers,
pilot blockers, commercial blockers, evidence path for every conclusion.

Use the labels: Domain model only · Service implemented · UI connected ·
Preview verified · Controlled-pilot verified · Production-provider
verified · Commercially verified.

Do not mark something complete merely because it exists.

## 7. Required multi-PR programme

Execute this programme sequentially. Do not combine all phases into one
pull request.

### PR 1 — Emergency production truth and recovery

Objectives:

- Identify why the latest deployment failed.
- Restore a deployable controlled-pilot build.
- Verify that the deployed commit equals the intended commit.
- Correct README and status claims.
- Add an unmistakable controlled-pilot banner.
- Disable unsafe external capabilities through server-side gates.
- Add a central deployment-mode and capability registry.
- Make unsafe agency, export, public sharing and unrestricted upload
  capabilities unavailable until repaired.

The capability registry must be server-authoritative:

```ts
type CapabilityState =
  | "available"
  | "degraded"
  | "disabled"
  | "unconfigured";
```

Include at least:

```ts
interface PlatformCapabilities {
  authentication: CapabilityState;
  manualProfile: CapabilityState;
  documentUpload: CapabilityState;
  deterministicExtraction: CapabilityState;
  aiExtraction: CapabilityState;
  structuralValidation: CapabilityState;
  malwareScanning: CapabilityState;
  ownerPreview: CapabilityState;
  thirdPartyPreview: CapabilityState;
  originalDownload: CapabilityState;
  redactedDownload: CapabilityState;
  sharing: CapabilityState;
  agencyCollaboration: CapabilityState;
  bulkExport: CapabilityState;
  missionWorkspace: CapabilityState;
  packGeneration: CapabilityState;
  publicSignup: CapabilityState;
  payments: CapabilityState;
  realApplicantData: CapabilityState;
  commercialClaims: CapabilityState;
}
```

Controlled-pilot mode must visibly state: **Internal controlled pilot. Use
synthetic or irreversibly redacted information only.**

No unsafe feature may merely disappear silently. Explain why it is
unavailable without exposing internal security detail.

### PR 2 — Tenant isolation and grant security

Repair every authorization defect before feature development.

**Agency assignment.** `assignMember()` must prove: actor has the required
organization role; actor's membership is active; assignee is an active
member of the same organization; organization has an active, accepted,
unexpired grant covering the mission; mission belongs to the applicant
identified by the grant; assignment is unique and idempotent; cross-organization
assignment is impossible.

**Mission notes.** `addNote()` must prove: actor is the applicant owner; or
actor is an authorized individual recipient; or actor is an active assigned
organization member with an active grant permitting comment on that
mission. Enforce: body length limits, sanitized rendering, no HTML
execution, append-only semantics, audit.

**Evidence requests.** `requestEvidence()` must prove: actor belongs to the
requesting organization; actor has a permitted role; organization has an
active, accepted, unexpired grant for the applicant; grant permits the
requested action; mission/category scope is preserved; field/document
request belongs to the permitted scope; rate limit passes; message is
safely bounded; the applicant can see who requested it and under what
permission.

**Membership mutation.** `setMembershipActive()` must: scope update by
both `membershipId` and `organizationId`; verify the target membership
belongs to the organization; prevent an ADMIN changing an OWNER unless
policy explicitly permits it; prevent deactivation of the last active
OWNER; prevent unauthorized reactivation; use transactionally conditional
updates; audit denied and allowed high-impact actions.

**Bulk export.** Rebuild bulk export from first principles. It must:
require actual WorkOS step-up; use the actor's real membership role;
reauthorize each applicant immediately before export; preserve recipient,
purpose, mission, category, document and field scopes; export only
explicitly authorized fields; exclude restricted fields unless individually
granted; exclude evidence bytes unless exact evidence permission exists;
exclude inactive, paused, revoked, expired or unaccepted grants; produce an
auditable manifest; have bounded result size; avoid loading an unbounded
export into memory; produce no data when scope is ambiguous; never use a
fabricated ADMIN actor.

**Grant creation.** Require: current SHARING consent; genuine step-up for
sensitive grants; exactly one recipient type; valid recipient existence;
valid applicant ownership; mission belongs to applicant; documents belong
to applicant; categories are canonical and permitted; expiry is in the
future and within a configured maximum; actions are canonical; no
impossible action/scope combinations.

**Grant acceptance.** For account grants: only the exact recipient account
may accept. For organization grants: only active OWNER or ADMIN may accept
on behalf of the organization; acceptance must identify the accepting
account; other organization members receive no access until their own role
and assignment requirements pass.

**Grant state machine.** Enforce transactionally:

```text
PENDING_ACCEPTANCE → ACTIVE
PENDING_ACCEPTANCE → REVOKED
ACTIVE → PAUSED
ACTIVE → REVOKED
PAUSED → ACTIVE
PAUSED → REVOKED
REVOKED → terminal
EXPIRED → terminal
```

No illegal transition may be possible through service calls, server
actions or direct concurrent requests.

**Required hostile tests.** Create two owners, two applicants, two
organizations, multiple roles and intentionally mixed identifiers. Prove:
Org A cannot access Org B; Org A admin cannot mutate Org B membership;
agency member cannot act without grant; assignment does not create access;
expired grant denies access; revoked grant cannot resume; paused grant
denies access; mission-scoped grant cannot access another mission;
category-scoped grant cannot export another category; document-scoped
grant cannot access another document; individual recipient cannot
impersonate organization member; raw UUID guessing fails; concurrent
transition attacks fail.

No external sharing or agency capability may be re-enabled until this
entire suite passes.

### PR 3 — Document trust boundary

**Safety-state enforcement.** At both service and serving boundaries:
require the correct document version; require `safetyStatus === CLEAN` for
owner preview; require approved/generated rendition for third-party
preview; refuse quarantined, scanning, rejected, failed or unknown states;
reauthorize access on every request; use `Cache-Control: private,
no-store`; set `X-Content-Type-Options: nosniff`; use safe
`Content-Security-Policy`; prevent inline execution of uploaded HTML, SVG,
Markdown or active PDF content; never expose the underlying private Blob
URL.

**DOCX validation.** Do not classify a generic ZIP signature as DOCX.
Implement bounded DOCX inspection: parse central directory safely; enforce
maximum archive size; enforce maximum uncompressed size; enforce maximum
compression ratio; enforce maximum entry count; reject encrypted entries;
reject path traversal; require `[Content_Types].xml`; require
`word/document.xml`; reject XLSX, PPTX and generic ZIP; reject
macro-enabled formats in controlled pilot; apply parser timeout; apply
memory limit; mark uncertainty as `NEEDS_ATTENTION`.

**Text and Markdown.** Validate the full bounded file. Store and display
as text, never trusted HTML. Escape output. Never serve it as `text/html`.
Download as attachment unless a safe text viewer renders escaped content.
Apply length limits.

**Pilot scanner.** The current scanner must be labelled: structural
validation only — not antivirus. Implement a `MalwareScannerPort`.
Provide: test adapter; local/CI ClamAV adapter where feasible; production
adapter contract; contract tests; persisted scan result; scanner version;
scan timestamp; retry behaviour; fail-closed commercial readiness. Do not
provision a paid runtime scanner. Real applicant uploads remain disabled
until a production malware scanner is configured and verified.

**Parser controls.** Apply limits for: bytes, pages, pixels, dimensions,
text length, archive entries, compression ratio, parse time, memory,
recursion, password protection, embedded active content.

> **Amendment (ADR-0012, 2026-08-04):** for PDF specifically, "embedded
> active content" detection is no longer implemented as a hand-rolled
> parser. A first attempt (PR #68) accumulated 20 distinct correctness
> findings across 8 review rounds without converging on a sound
> implementation and was abandoned. PDF content is now never parsed at
> all — every PDF fails closed to `NEEDS_ATTENTION`/`QUARANTINED`
> unconditionally, regardless of content, until a real malware-scanner
> adapter (free to depend on a mature, vetted PDF-parsing library) is
> built. See ADR-0012 for the full rationale, and for the approved (but
> not yet implemented) synthetic demo-fixture registry architecture,
> deferred to the UX/external-shareability and deployed-E2E phases —
> fixtures never enter the ordinary document safety model and are never
> represented as scanned or malware-free through it. Every other control
> in this list (bytes, pages, pixels, archive entries, compression ratio,
> etc.) is unaffected by this amendment and still applies where relevant
> (e.g. DOCX's own bounded ZIP inspection above).

### PR 4 — External erasure, privacy and retention integrity

Implement a durable external-object deletion system.

**Deletion outbox.** Use states such as: `PENDING`, `CLAIMED`, `DELETED`,
`VERIFIED`, `FAILED`, `BLOCKED_BY_HOLD`. Flow: recheck legal hold within
the transaction; mark logical data pending deletion; create deletion job
with object key and expected hash; delete from Vercel Private Blob; verify
object absence; tombstone or remove storage reference; finalize
document/account deletion; append audit evidence; retry bounded failures;
surface permanent failures in Admin. Do not report "deleted" before
external deletion is verified.

**Account deletion.** Include or appropriately anonymize: product events,
rate-limit buckets, grants, memberships, assignments, notes, evidence
requests, AI runs, cost records, Blob objects, generated renditions, pack
objects, audit references according to legal/audit policy.

**Account export.** Include every account-linked personal or behavioural
record promised by the product, including product measurement events. Do
not include: secrets, internal cryptographic material, other users' data,
unrelated organization data.

**Orphan reconciliation.** Create an admin-safe reconciliation job that
detects: Blob without database reference; database reference without Blob;
deleted record with surviving object; duplicate object reference;
size/hash mismatch. Support dry run before mutation.

### PR 5 — Identity, platform administration and step-up

**WorkOS identity race.** Repair `createAccount()` unique-collision
handling. On collision: lookup by immutable WorkOS ID first; return only
when the stored WorkOS ID matches; an email match may only be claimed
through the verified legacy-binding flow; conflicting IDs must fail closed;
record safe audit event; add concurrency tests.

**WorkOS ID migration.** After confirming all legitimate accounts are
bound: add a report/dry run; resolve legitimate unbound accounts safely;
make `workos_user_id` non-null through a new migration; do not modify
migration `0010`.

**Platform administration.** Replace `ADMIN_EMAILS` as the final
authority. Create an immutable platform-role model based on: internal
account ID, WorkOS user ID, explicit role, assignment actor, assignment
time, revocation, reason, audit. Roles should be minimal, such as:
`PLATFORM_OWNER`, `SECURITY_ADMIN`, `COMPLIANCE_ADMIN`, `SUPPORT_ADMIN`. Do
not create a universal super-admin unless strictly necessary.

**Step-up.** Implement genuine WorkOS-compatible step-up or
reauthentication for: original download, profile export, bulk export,
granting highly sensitive access, platform-role changes, legal-hold
changes, retention execution, organization verification, account deletion
confirmation. Never represent step-up as a Boolean supplied by the
browser. Use a server-generated, short-lived, action-bound assurance
record.

### PR 6 — Durable jobs, idempotency and upload integrity

**Job leases.** Add: `leaseOwner`, `leaseExpiresAt`, `heartbeatAt`,
`idempotencyKey`, processing version, safe error code. A stale `CLAIMED`
job must become reclaimable. Use compare-and-set updates.

**Job uniqueness.** Enforce database uniqueness for the intended
processing unit: `documentVersionId + jobType + processingVersion`.

**Processing idempotency.** Prevent duplicate: processing runs, extraction
runs, classifications, filename proposals, AI runs, field proposals,
generated renditions. Use uniqueness based on: `documentVersionId + task
version + parser version + prompt version + schema version + model
configuration`.

**Upload consistency.** Implement: server-created upload intent; quota
reservation; opaque object key; private upload; server-side size and hash
verification; logical document creation; version creation; job enqueue;
reservation finalization. On failure: release reservation; delete partial
Blob; mark intent failed; surface recoverable error; never leave invisible
orphan state. Reject oversize uploads before loading their entire contents
into application memory.

**Free-tier controls.** Configuration-driven pilot defaults: 10 MB maximum
upload; 10 pages automated processing; 50 MB per applicant; 100 MB per
account; platform warning threshold; platform hard stop; AI monthly hard
stop; AI per-document hard stop. Do not assume free tiers are unlimited.

### PR 7 — UX/UI foundation and information architecture

Do not apply random cosmetic changes. Create a documented product design
system: `docs/ux/visastack-product-experience.md`.

**Experience principles.** VisaStack must feel: trustworthy, calm,
precise, private, modern, human, competent, easy for non-technical
travellers, efficient for agency professionals. It must not feel: like a
developer dashboard, like a generic admin template, like a crypto product,
like an experimental AI demo, overloaded with cards, full of internal IDs,
overwhelming on first use, artificially colourful, dependent on technical
jargon.

**Global navigation.** Applicant navigation: Home, Applicants, Shared with
me, Privacy, Account. Applicant workspace navigation: Overview, Profile,
Documents, Missions, Sharing, History. Agency navigation: Case inbox,
Assigned cases, Evidence requests, Reviews, Organization, Access. Platform
administration: Readiness, Security, Organizations, Retention, Deletion,
Processing failures, Usage, Audit. Never expose a raw UUID as the primary
label.

**Dashboard.** The applicant dashboard should answer: What needs my
attention? Which applicant am I working on? What is incomplete? What was
recently changed? Who currently has access? What is the next useful
action? Use: one primary action, clear status summary, recent activity,
attention queue, evidence/profile completeness, active missions, access
summary. Do not show engineering health data to applicants.

**Applicant overview.** Show: identity summary, profile completeness by
meaningful section, document health, active missions, outstanding
requests, current sharing, recent changes, next recommended action.

**Master Profile.** Requirements: progressive disclosure, searchable
fields, section navigation, repeating-record cards, clear current value,
evidence indicator, last confirmed date, conflict indicator,
sensitive-field explanation, history access, save state, unsaved-change
protection, mobile usability. Do not display 58 fields as one
uninterrupted form. Use target-group packs as optional guided sections.

**Document experience.** Upload flow: Choose document → Validate →
Process → Review → Approve. Show real status: Uploading, In quarantine,
Structural validation, Processing, Needs review, Ready, Failed. Never use
fake progress. Document cards should show: approved display name, original
filename as secondary metadata, document type, subject, relevant date,
safety state, processing state, evidence use, current mission use, actions
currently permitted.

**Document review.** Use a clear two-pane desktop layout: left, safe
document preview; right, classification, filename and field proposals. On
mobile, stack these in a logical review sequence. Each proposal should
show: existing value, proposed value, evidence source, page/location,
confidence, conflict, sensitivity, approve/edit/reject controls. Do not
use confidence as a false guarantee.

**Missions.** The mission workspace should answer: What application is
this? What is required? What is complete? What is missing? What is
inconsistent? Who must act? What evidence supports each item? What
changed? What can be exported? Structure: mission summary, readiness
explanation, requirements, evidence, tasks, requests, collaborators,
review, pack and snapshots. Readiness must never resemble approval
probability.

**Sharing.** Before creating a grant, show a human-readable summary: who
receives access, what they can see, what they can do, why, which mission,
which documents/categories, expiry, whether downloading is allowed,
whether the recipient must accept. After grant creation, show:
pending/active/paused/revoked/expired, accepted by, last access, current
scope, revoke and pause controls, clear statement that already downloaded
copies cannot be remotely erased.

**Shared recipient workspace.** Only show data within current permission.
Include: applicant label, purpose, scope summary, expiry, permitted facts,
permitted renditions, mission, requests/comments, current actions. Do not
reveal hidden section names or counts that expose unauthorized
information.

**Agency Desk.** Design for high-volume desktop work without sacrificing
mobile access. Use: search, filters, assigned-to-me, needs applicant,
needs review, expiring, recently changed, access-expiring, permission
summary. Case row: applicant, destination, purpose, mission, stage,
missing evidence, assigned staff, last activity, access status. Never
require raw applicant, mission, organization or field IDs.

**Errors and recovery.** Every failure must state: what failed, whether
data was saved, what the user should do, whether retry is safe, reference
ID. Provide: retry, return, save for later, contact/support route where
relevant. No raw stack traces or database errors.

**Visual system.** Use the existing design foundation, but systematize it.
Requirements: strong typographic hierarchy, restrained neutral surfaces,
one controlled accent system, clear success/warning/danger semantics,
consistent spacing, consistent radius and elevation, clear input states,
visible keyboard focus, adequate touch targets, no low-contrast decorative
text, no generic AI gradients, no excessive animation, respect reduced
motion, dark mode only when every component is verified, print/export-safe
mission and pack layouts.

**Accessibility.** Target WCAG 2.2 AA. Verify: keyboard navigation, focus
order, focus visibility, screen-reader labels, form errors, heading
structure, landmarks, live regions for processing states, contrast, touch
targets, reduced motion, dialog focus trapping, tables and list semantics,
language attributes. Do not mark the whole page `lang="bn"` when most
content is English. Apply language tags to actual translated regions until
the full page is translated.

**English and Bangla.** Complete critical paths, not isolated labels.
Critical bilingual paths: sign-in guidance, consent, applicant creation,
profile navigation, upload, processing, review, mission readiness,
sharing, evidence requests, errors, privacy/export/deletion. Do not use
machine-like Bangla or transliteration. Keep the information hierarchy
equivalent across languages.

**UX verification.** Add browser-level tests for: mobile, tablet, desktop,
keyboard-only use, screen-reader-relevant semantics, English, Bangla,
empty states, error states, loading states, permission-denied states, long
names, unicode names, large repeating-record sets, narrow screens. Use
synthetic data only.

### PR 8 — Applicant core and document-to-profile completion

Complete: universal profile, professional pack, business pack, medical
traveller pack, medical attendant pack, sponsor/funding records, travel
and visa history, refusal history, family/dependant relationships,
repeating addresses, employment, education and passports.

Every fact must support: current value, immutable history, effective
date, evidence, last confirmation, sensitivity, status, conflict, reason
for change, mission use.

**Atomic proposal approval.** These must commit together: approved
document name, selected profile fact versions, current pointers, evidence
links, proposal decisions, correction feedback, confirmation, audit event.
Failure must roll back everything.

### PR 9 — OpenAI API quality and safety

OpenAI API is the only approved paid runtime dependency. Use a dedicated
pilot project.

**Provider.** Implement behind `AiExtractionPort`. Use: Responses API,
`gpt-5.6-terra`, initial reasoning effort `low`, strict structured output,
`store: false`, server-side key only, stable prompt versions, stable
schema versions, minimum necessary input, deterministic processing first,
manual fallback always.

Do not: add a general chatbot, add autonomous agents, add web search, let
AI mutate current facts, let AI grant access, let AI mark evidence
authentic, let AI predict visa approval, let AI submit applications, send
unrelated applicant data, log sensitive prompts or outputs.

**Approved tasks.** Document classification; filename component proposal;
canonical field proposal; conflict explanation; grounded draft assistance
for later mission outputs.

**Cost controls.** Enforce in the application: monthly hard limit,
per-document limit, attempt limit, page limit, cache, duplicate
prevention, usage ledger, admin warning, capability shutoff at budget.
Cache key: `content hash + task version + parser version + prompt version
+ schema version + model + reasoning configuration`.

**Evaluation.** Create a synthetic/redacted evaluation set covering:
passports, statements, employment records, business documents,
invitations, bookings, medical-travel records, low-quality scans,
conflicting documents, multilingual evidence, Bangla names, unsupported
documents, prompt-injection content inside documents. Measure:
classification accuracy, filename exactness, field precision, field
recall, unsupported-field rate, hallucination rate, evidence-location
accuracy, correction rate, cost per document, latency. No AI capability
may be considered pilot-verified until its benchmark threshold is
documented and passed.

### PR 10 — Missions, collaboration and application packs

Only after tenant-isolation repairs pass.

Complete: requirement composition, published requirement version,
requirement-to-evidence mapping, exact selected evidence, exact
FactVersion references, exact DocumentVersion references, tasks, evidence
requests, comments, decisions, conflicts, grounded letters, translation
provenance, pack preview, manifest, checksums, versioned download,
immutable snapshot.

Mission snapshot must freeze: FactVersion IDs, DocumentVersion IDs,
Evidence-link IDs, object hashes, approved display names, requirement
version, readiness result, reviewer decisions, generated-output versions.
Repeating facts must never overwrite each other in snapshots.

Readiness must ignore: unsafe documents, expired documents, unapproved
classifications, unselected evidence, conflicted facts, missing
confirmations, revoked evidence access.

### PR 11 — Commercial activation framework

Create: `docs/operations/pilot-to-commercial-activation.md`.

Implement provider registries: `IdentityPort`, `StoragePort`,
`MalwareScannerPort`, `DocumentConverterPort`, `AiExtractionPort`,
`JobQueuePort`, `EmailPort`, `ObservabilityPort`, `PaymentPort`.

Pilot providers: WorkOS staging, Vercel Private Blob, Neon Free, Neon job
queue, OpenAI pilot project, internal alert dashboard, no payment
provider.

Commercial provider activation must use configuration, not business-logic
edits. Example:

```env
DEPLOYMENT_MODE=commercial
IDENTITY_PROVIDER=workos
STORAGE_PROVIDER=vercel_blob
DATABASE_PROVIDER=neon
AI_PROVIDER=openai
MALWARE_SCANNER_PROVIDER=<configured-provider>
JOB_PROVIDER=<configured-provider>
OBSERVABILITY_PROVIDER=<configured-provider>
```

Do not require S3/KMS by default. Keep an S3-compatible adapter possible
for enterprise requirements.

**Commercial readiness guard.** Commercial mode must fail readiness when
any required gate is false: commercial-compatible hosting, WorkOS
production, production database, private production storage, real malware
scanner, safe conversion, step-up, external-object deletion verification,
tenant-isolation suite, permission matrix, production OpenAI project where
AI is enabled, privacy/consent configuration, retention/deletion workflow,
backup restore verification, authenticated production E2E, incident owner,
terms and privacy notice, no Critical/High findings, external penetration
test. Return HTTP 503 and keep public capabilities disabled. No normal
administrator may override this guard.

## 8. Testing standard

**Static and dependency checks.** Run:

```bash
pnpm install --frozen-lockfile
pnpm biome check .
pnpm turbo run typecheck --force
pnpm turbo run test --force
pnpm turbo run build --force
pnpm audit --prod --audit-level high
```

Do not run automatic fix commands without reviewing changes.

**Unit tests.** Cover: policy decisions, grant state machine, identity
binding, admin roles, step-up assurance, filename safety, classification,
readiness, job leasing, idempotency, cost controls, capability registry,
commercial guard.

**Database tests.** Cover: migrations, unique constraints, cross-tenant
mutation attempts, concurrent grant transitions, last-owner protection,
atomic approval, deletion outbox, legal-hold race, fact uniqueness,
mission snapshot immutability, job reclaim, duplicate processing, upload
reservation.

**File-security tests.** Cover: MIME spoofing, HTML/SVG disguised as text,
executable renamed as PDF, generic ZIP declared DOCX, XLSX declared DOCX,
PPTX declared DOCX, macro document, encrypted ZIP, path traversal,
decompression bomb, excessive entry count, oversized image, excessive
pixels, excessive PDF pages, active PDF, password-protected PDF, corrupt
PDF, parser timeout, parser memory exhaustion, duplicate upload.

**Authorization attack suite.** Test every role against every
resource/action combination. Include: Owner A against Owner B, Org A
against Org B, Admin against owner-only action, Member against admin
action, Recipient against organization action, Assignment without grant,
Grant without assignment, Revoked/paused/expired grants, Mission mismatch,
Category mismatch, Document mismatch, Purpose mismatch, Step-up missing,
Raw ID substitution, Concurrent state changes.

**Browser E2E.** Run against deployed preview.

Applicant journey: sign in; grant consent; create applicant; complete core
profile; upload supported synthetic evidence; observe real processing;
review filename; review AI/deterministic proposals; approve selected
facts; verify history and evidence; create mission; map evidence; share
narrow permission; verify recipient sees only allowed content; pause
grant; verify immediate denial; resume valid paused grant; revoke; verify
it cannot resume; export own data; request deletion; verify
external-object deletion workflow.

Agency journey: organization admin signs in; accepts organization grant;
assigns active member; member sees assigned case only; requests permitted
evidence; adds permitted note; attempts unauthorized case access and is
denied; export includes exact granted subset only.

**Deployment tests.** For every PR: test exact deployed commit; verify
liveness; verify readiness; verify anonymous redirect; verify callback;
verify authenticated workspace where staging secrets exist; verify
database transaction; verify Blob round trip; verify commercial guard;
verify pilot banner; verify unsafe capabilities disabled. A deployment
test may not check out tests from another revision.

## 9. Performance and free-tier discipline

Design for the current pilot without making the commercial system
disposable. Requirements: paginate lists; bound queries; add necessary
indexes; avoid N+1 queries; stream large exports; avoid whole-file memory
loading; avoid unbounded JSON; avoid unbounded audit metadata; avoid
unbounded OCR text; avoid duplicate AI calls; cache deterministic results;
record free-tier usage; hard-stop safely before capacity exhaustion;
surface usage warnings to platform administrators. Do not prematurely
introduce paid queues, search engines, analytics or observability
products.

## 10. Documentation deliverables

Maintain:

1. `docs/audits/commercial-readiness-recovery-baseline.md`
2. `docs/security/tenant-isolation-matrix.md`
3. `docs/security/document-trust-boundary.md`
4. `docs/ux/visastack-product-experience.md`
5. `docs/operations/pilot-to-commercial-activation.md`
6. `docs/operations/deletion-and-erasure-runbook.md`
7. `docs/operations/backup-and-restore-runbook.md`
8. `docs/operations/incident-response.md`
9. `docs/roadmap/commercial-readiness-gates.md`
10. Truthful `README.md`

README must distinguish: Implemented, Pilot verified, Provider-unconfigured,
Commercial blocker, Commercially verified.

Remove outdated references to: Neon-bytea as the active production storage
when Vercel Blob is active; AI being unwired when it is implemented;
S3/KMS as mandatory; WorkOS login being unwired; stale test totals;
unverified security guarantees.

## 11. PR and release contract

For every PR: branch from latest approved `main`; do not mix unrelated
scopes; add tests; run all checks; create preview deployment; verify exact
deployed commit; record migrations; record environment changes; record
cost impact; record security impact; record UX impact; record
accessibility impact; include screenshots with synthetic data; include
rollback; include unresolved issues; do not merge; stop for explicit
approval.

PR report must state: branch, base commit, head commit, PR link, preview
URL, files changed, migrations, tests passed, tests failed, tests skipped,
manual verification, pilot-ready capabilities, disabled capabilities,
commercial-compatible capabilities, commercial blockers, known risks,
rollback procedure.

Do not proceed to the next PR until the current PR has been approved and
merged.

## 12. Definition of done

A capability is done only when it is: correctly modelled, correctly
authorized, consent-gated, persisted, audited, concurrency-safe, idempotent
where required, connected to the user interface, accessible, bilingual
where part of a critical path, tested at appropriate levels, deployed to
preview, verified through the actual user journey, observable, recoverable,
reversible, truthfully documented, compatible with provider replacement.

The following do not independently mean done: interface exists, schema
exists, service exists, unit tests pass, CI is green, Vercel build
succeeds, screenshot looks correct, documentation says complete, a mocked
test passes, a happy-path manual check succeeds.

## 13. Immediate execution

Begin now with Phase 0 and PR 1 only.

1. Fetch the latest remote state.
2. Inspect committed, staged, unstaged and untracked files.
3. Identify the exact production deployment SHA.
4. Diagnose the latest Vercel failure.
5. Run the full current verification suite.
6. Create `docs/audits/commercial-readiness-recovery-baseline.md`.
7. Create a branch similar to: `claude/visastack-commercial-recovery-01`.
8. Implement: deployment-mode system; capability registry; controlled-pilot
   banner; fail-closed capability gates; temporary disabling of unsafe
   agency/export/external-sharing paths; production deployment repair;
   truthful readiness; truthful README/status; exact-commit smoke tests.
9. Create the PR.
10. Deploy preview.
11. Verify the preview.
12. Do not merge.
13. Do not begin PR 2.
14. Return the complete verification package.

Do not ask broad planning questions. Ask only when one of these is
genuinely required: a secret must be added; a paid service would be
activated; production data would be mutated; a destructive migration would
run; a legal/product decision cannot safely be inferred. Otherwise, make
the safest commercially correct decision, document it and continue.

The objective is not maximum code output. The objective is: a secure,
coherent, beautiful, commercially engineered VisaStack whose controlled
pilot is honest, whose user experience is immediately understandable,
whose applicant data boundaries are provably enforced, and whose future
commercial activation requires infrastructure configuration and final
verification rather than rebuilding the product. Only Phase 0 and PR 1 are
completed first; the PR and preview evidence are returned for review
before any further phase begins. This staged sequence is what prevents a
large, attractive but insecure build from being merged into main.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance. Production uses private R2 storage; database-only encrypted archive recovery is verified, while complete document/key/lifecycle recovery remains open.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
