# VISAStack COMMERCIAL V1
# CLAUDE CODE IMPLEMENTATION DIRECTIVE
## 10 sequential prompts — paste ONE PART AT A TIME, in order

---

# PART 1 OF 10
# AUTHORITY LOCK, REPOSITORY BASELINE, PR #77 RECONCILIATION, REQUIREMENTS LEDGER

You are beginning implementation of VisaStack Commercial V1.

This is Part 1 of 10.

Do not implement later-stage product features in this part. Your job here is to make the implementation programme deterministic, establish the exact repository truth, reconcile existing unfinished work, and create the traceability system that every subsequent part must obey.

## 1. Governing authority

The authoritative product specification is:

`docs/product/commercial-v1-prd-2026-09-16.md`

Expected SHA-256:

`5eeb15438799d89db9122ff050f15d96139f8e94d373e3b5ba9ea406a1c21575`

Before doing anything else:

1. Confirm that file exists.
2. Calculate its SHA-256.
3. If the hash does not match exactly, STOP and report the mismatch. Do not reconstruct or paraphrase the PRD from memory.
4. Read the entire PRD, not selected excerpts.
5. Read all repository-level contributor/governance instructions relevant to implementation.
6. Treat the following authority hierarchy exactly:

   a. explicit current user instruction;
   b. Commercial V1 PRD above;
   c. approved implementation decisions recorded during this programme;
   d. retained repository architecture and security invariants;
   e. older PRDs/docs only as historical context.

Older repository documents may not override this Commercial V1 PRD.

Do not silently reinterpret a requirement. Any proposed deviation must name:
- affected requirement IDs;
- reason;
- security/privacy effect;
- migration effect;
- cost/operational effect;
- replacement acceptance evidence.

Unless such a deviation is explicitly approved, implement the PRD as written.

## 2. Expected repository baseline

Expected repository:

`sadatnitex/visastack`

Expected default branch:

`main`

Expected audited main commit:

`2cb47e0ac91e8ce323956aff607bae9cd343e5a0`

Expected PR #77:
- state: open;
- draft: true;
- base: main;
- base SHA: `2cb47e0ac91e8ce323956aff607bae9cd343e5a0`;
- expected head at the beginning of this programme: `fb535c7a4a66143774738640d1c93a891864b0dc`;
- expected changed files:
  - `.github/workflows/workos-staging-e2e.yml`
  - `docs/roadmap/remaining-commercial-blockers.md`

First fetch all remote references and inspect actual current state.

If `main` has moved:
- do NOT reset it;
- do NOT force it back;
- compare the audited SHA with current `origin/main`;
- write a precise divergence report;
- inspect every intervening commit;
- incorporate legitimate newer changes;
- identify any conflict with this Commercial V1 PRD;
- continue only if the newer state can be safely reconciled without changing product scope.

If PR #77 has changed, merged or closed:
- inspect its actual state;
- do not duplicate its work;
- reconcile based on actual repository evidence.

## 3. Branch strategy

Never implement directly on `main`.

If the working tree is clean, create or switch to:

`claude/commercial-v1`

If the branch already exists:
- inspect it first;
- do not destroy user changes;
- determine whether it is the existing Commercial V1 implementation branch;
- continue only after reconciling its commits against `origin/main`.

Never use:
- `git reset --hard` against unknown user work;
- forced pushes;
- history rewriting;
- deletion of applied migrations;
- destructive cleanup merely to simplify implementation.

Do not merge anything to `main`.
Do not deploy production.
Do not mark PR #77 merged.
Do not expose secrets.

## 4. Reconcile PR #77 before duplicating anything

Inspect PR #77 completely.

Its useful changes should be incorporated into this implementation branch if they remain valid:
- WorkOS staging second-identity CI environment wiring;
- protection preventing real test credentials from being exposed to arbitrary preview-branch test code;
- corrected blocker documentation.

Do not blindly merge the PR.

Determine whether to:
- cherry-pick its commits;
- recreate only its still-valid changes;
- or leave them already incorporated if repository state has moved.

Preserve the security property that credentialed WorkOS E2E must never execute unreviewed PR-branch code with real secrets.

The eight skipped cross-account tests are NOT complete merely because second-identity variables exist. They must eventually contain real journey implementations and execute against two independent synthetic identities. That work belongs to later parts.

Record what you did with PR #77 in the implementation ledger.

## 5. Baseline repository inspection

Read, at minimum:

- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- root `package.json`
- `pnpm-workspace.yaml`
- `.env.example`
- `apps/web/package.json`
- `packages/db/src/schema.ts`
- existing migrations
- `packages/services`
- `packages/policy`
- `packages/adapters`
- `apps/web/src/lib/commercial-readiness.ts`
- `apps/web/src/lib/step-up.ts`
- `apps/web/src/lib/ai.ts`
- `apps/web/e2e/authenticated-workspace.spec.ts`
- current relevant GitHub workflows
- `docs/governance/integration-and-cleanup-directive.md`
- `docs/roadmap/remaining-commercial-blockers.md`
- recovery/privacy/security docs
- current historical product PRD
- all code specifically referenced by Section 23 of the Commercial V1 PRD.

Inspect actual implementation. Do not trust documentation over code.

## 6. Create the Commercial V1 implementation control directory

Create:

`docs/commercial-v1/`

At minimum create:

- `baseline.md`
- `requirements-ledger.md`
- `architecture-decisions.md`
- `assumptions-and-blockers.md`
- `cost-and-vendor-register.md`
- `test-evidence.md`
- `release-gate.md`
- `known-issues.md`
- `supersession-map.md`

These are engineering control artifacts, not marketing documents.

### requirements-ledger.md must contain one row for EVERY P0 requirement

Include:
- Requirement ID
- PRD section
- requirement summary
- P0/P1
- existing implementation path
- classification: REUSE / REPAIR / EXTEND / REPLACE / KEEP DISABLED / NEW
- planned implementation path
- schema/migration impact
- acceptance tests
- customer journeys
- evidence location
- status: NOT_STARTED / IN_PROGRESS / BLOCKED / IMPLEMENTED_UNVERIFIED / VERIFIED
- owner
- blocker/notes

Every one of these families must be represented:

IAM-01..04  
PRO-01..02  
EVI-01..06  
CAS-01..08  
SHR-01..04  
NTF-01..04  
RUL-01..06  
TRU-01..04  
AI-01..10  
COM-01..04  
ADM-01  
ARC-01..04  
SEC-01..07  
PRV-01..04  
UX-01..03  
OPS-01..04

Also map:
- J01..J15
- A01..A35

A requirement may never be marked VERIFIED without evidence.

## 7. Explicit non-goals

Commercial V1 must NOT expand into P1 work.

Do not build:
- public agency rankings/reviews;
- native mobile apps;
- WhatsApp/SMS;
- automated subscription/payment gateway;
- custom agency domains;
- advanced redaction editor;
- arbitrary file conversion;
- official-form filling;
- broad generated letters/translations;
- corporate/university portals;
- travel booking;
- vector database;
- open-ended immigration chatbot;
- autonomous submission;
- multi-region active-active infrastructure;
- issuer-confirmation UI.

Preserve existing extension points/data where present, but keep P1 outside the launch surface.

## 8. Architecture invariants

These are non-negotiable unless explicit evidence proves they are impossible:

- Extend the existing modular monolith.
- Keep Next.js App Router.
- Keep TypeScript.
- Keep pnpm/Turborepo.
- Keep Drizzle/Postgres.
- Keep WorkOS unless a concrete capability/cost failure is documented.
- Keep canonical services and policy engine.
- Keep `Mission` as the underlying Case entity; DO NOT create a competing `Case` table.
- Keep immutable fact/document versions.
- Add migrations; never rewrite already-applied migrations.
- Keep one database of record.
- Keep durable jobs/outbox.
- Add at most the worker infrastructure actually required by the PRD.
- Do not add Kafka.
- Do not add Kubernetes.
- Do not add a vector database.
- Do not split the application into microservices.
- Do not create a parallel auth stack.
- Do not create a second AI pathway instead of extending the existing AI port.
- Do not make security controls UI-only.

## 9. Baseline verification

Use the repository's supported Node/pnpm versions.

Run from a clean dependency state where practical:

- `pnpm install --frozen-lockfile`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run build`
- `pnpm audit --prod`

Also run existing static/security/secret/license scans that are actually configured and locally executable.

Do not call a skipped scan a pass.

Record separately:
- executed
- passed
- failed
- skipped
- blocked

Capture exact commands, commit SHA and environment.

Do not fix unrelated defects opportunistically unless:
1. they block Commercial V1;
2. they create a security risk;
3. or they are directly adjacent and the smallest safe correction.

Record all such fixes.

## 10. Current capability inventory

For every P0 domain, determine exactly what exists now.

Produce a table classifying relevant services/files as:

- REUSE
- REPAIR
- EXTEND
- REPLACE
- KEEP DISABLED
- NEW

Especially verify the PRD's audited claims around:
- scanner hardcoded readiness;
- NullEmailPort;
- AI OpenAI-only wiring;
- approximate blended AI cost calculation;
- snapshot over-collection;
- missing applicant acknowledgement;
- note visibility/org ownership;
- task due dates;
- profile plaintext sensitive values;
- rule applicability/freshness;
- commercial controls;
- cross-account E2E gaps;
- recovery assumptions.

If the code now differs, update the ledger based on code, not historical text.

## 11. External dependency discipline

For all external vendors/APIs later in the programme:
- use official current documentation at implementation time;
- record URL and review date in the relevant ADR;
- never assume model IDs or API behavior from memory;
- never put credentials in source, prompts, logs or test reports;
- use synthetic test accounts/data only.

## 12. Stop conditions for Part 1

Part 1 is complete only if:

- exact PRD hash confirmed;
- repository state pinned;
- PR #77 reconciled;
- dedicated branch established;
- current tests/build audited;
- requirement ledger covers all P0 IDs, J01–J15 and A01–A35;
- no product requirement has been silently dropped;
- current architecture is classified;
- blockers are explicit;
- no later-phase implementation has been prematurely invented.

Commit the Part 1 control artifacts on the implementation branch with a focused commit.

Then STOP.

Your final response for this part must use this exact structure:

PART 1 CHECKPOINT: PASS | BLOCKED

BASELINE
- branch
- main SHA
- implementation SHA
- PR #77 disposition
- PRD hash

VERIFICATION
- lint
- typecheck
- tests
- build
- dependency audit
- scans

CAPABILITY INVENTORY
- count REUSE
- count REPAIR
- count EXTEND
- count REPLACE
- count KEEP DISABLED
- count NEW

CRITICAL BLOCKERS
- only genuine blockers

DECISIONS REQUIRED
- only decisions that materially affect security, scope, access or cost

FILES CHANGED
- exact paths

NEXT
- state whether Part 2 may proceed

Do not begin Part 2.

---

# PART 2 OF 10
# DATA MODEL, MIGRATIONS, AUTHORIZATION, MFA, ENCRYPTION, AUDIT AND PRIVILEGE FOUNDATION

Continue the SAME VisaStack Commercial V1 implementation programme and SAME implementation branch.

This is Part 2 of 10.

Before editing:
1. Read the authoritative PRD again.
2. Read `docs/commercial-v1/requirements-ledger.md`.
3. Confirm Part 1 status was PASS or identify specifically resolved blockers.
4. Rebase/merge `origin/main` only if necessary and safely; never overwrite work.
5. Do not implement unrelated later features.

Primary requirements for this part:

IAM-01  
IAM-02  
ARC-01  
ARC-02  
ARC-03  
ARC-04  
SEC-01  
SEC-03  
SEC-04  
SEC-06  
SEC-07

Also create schema foundations required by later P0 work where additive migrations are more safely designed together, but do NOT implement their full UI prematurely.

## 1. Threat model first

Before changing code, create/update:

`docs/commercial-v1/threat-model.md`

Cover at minimum:
- account takeover;
- weak/recovered authentication;
- staff MFA bypass;
- agency overreach;
- IDOR/BOLA;
- cross-tenant list/count/search leakage;
- stale grants;
- removed memberships;
- malicious support operator;
- platform-admin overreach;
- secret theft;
- plaintext database/backups;
- AI exfiltration;
- malicious documents;
- unsafe export;
- audit tampering;
- destructive restore;
- replay/race/idempotency defects.

Map trust boundaries and privileged components.

Do not claim certification.

Create/update:

`docs/commercial-v1/asvs-l2-map.md`

Map applicable OWASP ASVS 5.0 Level 2 controls to:
- implementation;
- test;
- evidence;
- N/A justification where genuinely not applicable.

## 2. Schema design

Inspect the existing schema thoroughly.

Add only additive migrations.

Do NOT rewrite historical migrations.

Design the schema additions necessary for Commercial V1, including where not already present:

- explicit staff/platform role state where needed;
- organisation approval state;
- support-access grants;
- invitation purpose/type/recipient/expiry/consumption;
- subject relationship/authority support required by IAM-04;
- mission/case material revision;
- route/destination/purpose/deadline additions;
- task assignee/due/time-zone/priority/history;
- note author organisation + visibility;
- acknowledgement;
- submission report;
- case outcome;
- complaint;
- private feedback;
- notification outbox/schedule/delivery/preferences;
- assessment/result history;
- protected-field metadata/key version where necessary;
- AI provider/task configuration versioning foundations;
- AI budget reservations/accounting foundations;
- plan/entitlement/subscription/manual billing foundations;
- retention/legal hold/deletion support where absent.

Do not duplicate an existing canonical entity merely because its naming differs from the PRD.

Use `Mission` as Case.

## 3. Relational integrity

Implement database-level constraints wherever practical.

Protect:
- same-subject relationships;
- same-case references;
- immutable version ownership;
- organisation ownership;
- exactly-one-resource targets;
- note organisation/visibility integrity;
- acknowledgement→snapshot relationship;
- submission→packet relationship;
- tenant-scoped uniqueness;
- idempotency keys;
- status enums/checks.

Where a constraint cannot safely exist at DB level:
- enforce it inside a locked transaction;
- write a test proving corruption is rejected.

UUID possession is never authorization.

## 4. Transaction/concurrency framework

Review existing transaction patterns.

For sensitive mutations ensure domain write +:
- material revision increment where applicable;
- audit event;
- outbox event where applicable;
- idempotency record/reservation where applicable

commit consistently.

Implement typed stale-write conflict behavior.

Do not hold DB transactions open across:
- AI provider calls;
- email provider calls;
- scanner calls;
- object-storage network calls where avoidable.

Use reserve → external work → reconcile.

Establish/reuse idempotency for:
- invitation consumption;
- upload finalization;
- acknowledgement;
- export generation;
- paid AI jobs;
- deletion.

## 5. Authentication and staff MFA enforcement

Retain WorkOS.

Inspect actual authentication APIs and current configured capabilities using current official WorkOS docs where needed.

Server-side enforce:
- verified identity;
- MFA for every agency staff context;
- MFA for reviewer;
- MFA for support;
- MFA for platform admin;
- users with traveller + staff roles must satisfy staff rules when entering staff context.

Traveller MFA:
- supported and encouraged;
- not required by V1 unless existing policy already safely does so.

Do not equate “recent login” with MFA.

Implement/verify server-owned authentication assurance.

Session targets:
- staff idle max 30 minutes;
- staff absolute max 12 hours;
- traveller session max 7 days;
- sensitive actions always require fresh step-up.

Step-up window:
- within 5 minutes for:
  - new grants;
  - original/bulk export;
  - credential changes;
  - privileged actions;
  - applicant acknowledgement where required by TRU later.

Membership removal, suspension and account suspension must deny the NEXT authorized request.

Test direct service/API calls, not only UI.

## 6. Organisation onboarding security foundation

Organisation state must support:
- submitted;
- platform review;
- approved;
- suspended/closed as appropriate.

Approval must NOT be described as government accreditation.

Fixed V1 roles only.

Protect the last active owner.

An organisation membership alone must never grant unrestricted traveller wallet access.

## 7. Protected-field architecture

Implement authenticated application-level encryption for high-risk values required by SEC-03.

Do NOT write custom cryptography.

Use a maintained cryptographic library and envelope-key abstraction.

Required properties:
- random nonces;
- authenticated encryption;
- versioned key IDs;
- AAD binds tenant/subject/record/field/version;
- key usage separated from routine DB access;
- backups do not contain sufficient key material to decrypt protected data;
- key rotation supported;
- recovery tested later.

Protect or avoid persistence of sensitive values in:
- current facts;
- historical fact versions;
- AI proposals;
- OCR text;
- snippets;
- corrections;
- snapshots;
- exports/temp artifacts;
- caches;
- derived records.

Do not leave plaintext duplicates after migration.

Do not use unsalted passport/NID/tax/bank identifier hashes as searchable substitutes.

If exact-match lookup is genuinely needed, design a keyed index with documented purpose.

## 8. Encryption migration

Inventory current plaintext high-risk fields.

Create:
- resumable backfill;
- dry-run mode;
- counts before/after;
- per-batch transaction behavior;
- retry safety;
- reconciliation report;
- rollback procedure that does NOT reintroduce insecure production behavior.

Unknown data stays unknown.

Unsafe/uncertain legacy records remain restricted.

Test:
- clean install;
- upgrade from a realistic synthetic copy of current schema.

Never use real applicant data.

## 9. Authorization default-deny

Review every existing service entry point in relevant domains.

Establish or strengthen canonical policy checks so authorization covers:
- detail;
- list;
- search;
- counts;
- jobs;
- cached results;
- notification targeting;
- binary access;
- export;
- audit views.

Client-supplied IDs are lookup inputs only.

Do not add authorization in UI while leaving service calls open.

Ensure runtime DB role is least privilege.

Migration/admin credential must be separate from application runtime credential.

Do not claim RLS unless it is actually implemented and connection-pool tested.

## 10. Support access

Implement support grants with:
- actor;
- subject/resource scope;
- reason;
- approver;
- start;
- expiry;
- maximum 60 minutes;
- revocation;
- audit trail.

Normal platform admins must see operational metadata only.

Reading traveller document/fact contents requires an explicit valid support grant plus step-up.

No silent impersonation.

No “founder bypass.”

## 11. Tamper-evident audit

Reuse existing audit/hash-chain implementation where sound.

Required events include the PRD SEC-04 categories.

Audit events must avoid sensitive before/after plaintext.

Sensitive mutation or download authorization must fail if required audit recording cannot commit.

Distinguish:
- download authorization issued;
- actual transfer completion where observable.

Add/check periodic signed checkpoint/anchor capability outside the mutable primary chain abstraction.

Do not claim this makes a fully privileged DB operator cryptographically incapable of tampering unless that property is actually demonstrated.

## 12. Supply-chain hardening

Inspect:
- production dependencies;
- dev dependencies;
- CI dependencies/actions;
- secrets exposure paths.

Run:
- dependency audit;
- repository secret scan;
- static analysis configured for this repo;
- licence checks if available.

A skipped workflow is not evidence.

Do not upgrade major versions casually.

Patch only to currently supported versions proven compatible by tests.

Never allow production secrets into PR-preview code execution.

Preserve/further strengthen PR #77's credentialed E2E restriction.

## 13. Required tests in this part

Implement and execute the underlying portions of:

A01 Identity and MFA  
A02 Revocation  
A03 Tenant boundaries  
A25 Encryption  
A26 Audit  
A27 Privilege  
A31 migration/upgrade aspects where applicable

Use fixtures containing data that COULD leak.

At minimum:
- two unrelated agencies;
- two staff accounts;
- multiple unrelated subjects;
- removed membership;
- suspended user;
- revoked authority;
- protected identifiers;
- support grant expiry.

A test that returns no rows from an empty database is invalid.

## 14. No fake production integrations

If an external KMS/key-service account is not available:
- implement the production interface correctly;
- use an explicitly test-only/local adapter for unit/integration;
- mark live key-service verification BLOCKED;
- never let the test adapter activate in commercial/production mode.

Same rule for identity assurance requiring external configuration.

## 15. Quality gates

Run:
- affected tests during implementation;
- full `pnpm run lint`;
- full `pnpm run typecheck`;
- full `pnpm run test`;
- full `pnpm run build`;
- dependency/security checks.

Update the requirement ledger with evidence paths.

Commit this vertical foundation as reviewable commits.

## 16. Stop

Do not begin document scanning or later customer workflows.

Respond:

PART 2 CHECKPOINT: PASS | BLOCKED

IMPLEMENTED
- requirements
- migrations
- services
- policies

MIGRATION EVIDENCE
- clean install
- upgrade test
- backfill counts
- plaintext duplicate reconciliation

SECURITY EVIDENCE
- MFA
- revocation
- tenant boundaries
- encryption
- audit
- support privilege

TESTS
- executed/passed/failed/skipped

EXTERNAL VERIFICATION STILL BLOCKED
- exact items only

FILES/COMMITS
- paths and SHAs

NEXT
- whether Part 3 may proceed

Then STOP.

---

# PART 3 OF 10
# SECURE EVIDENCE VAULT, UPLOAD PIPELINE, MALWARE SCANNING, SAFE PREVIEW, DOWNLOAD AND WORKER

Continue the same Commercial V1 branch.

This is Part 3 of 10.

Primary requirements:

EVI-01  
EVI-02  
EVI-03  
EVI-04  
EVI-05  
EVI-06  
SEC-05  
relevant COM-02 storage reservation  
relevant ARC-01/02/03  
OPS worker foundations

Required acceptance evidence:

A06  
A07  
A08  
relevant A25  
relevant J01/J03/J05/J06 foundations

## 1. Preserve the existing document architecture

Inspect the existing:
- storage port;
- document entities;
- document-version entities;
- processing jobs;
- hashes;
- versioned naming;
- current parsers;
- upload reservation logic;
- safe conversion/preview path;
- commercial scanner gate.

Reuse canonical pieces.

Do not create a second document system.

## 2. New-upload file surface

For NEW uploads, allow only:
- PDF;
- JPEG;
- PNG.

Existing historical formats/records must remain readable under their original authorization rules.

Initial configurable limits:
- 20 MiB/original;
- 50 PDF pages;
- 40 megapixels/image;
- 10 files/user batch;
- AI default max 25 pages later.

These limits must be server-authoritative.

Client validation is convenience only.

Password/encrypted PDF:
- reject;
- clear recoverable message;
- never request/store password.

Corrupt/unsupported:
- reject safely;
- preserve user ability to retry.

## 3. Secure upload lifecycle

Implement/reuse this state machine:

1. reserve quota;
2. create one-purpose upload authorization;
3. upload to quarantine using opaque object key;
4. server verifies actual:
   - byte length;
   - extension;
   - MIME;
   - magic bytes;
   - ownership;
   - exact object version;
   - cryptographic hash;
5. real malware scan;
6. bounded parsing;
7. isolated safe rendition/preview;
8. revalidate exact object version/hash;
9. release approved original under policy;
10. move processing states independently.

Nothing quarantined may be:
- previewed;
- downloaded;
- exported;
- sent to AI;
- used as evidence.

Scanner timeout/unavailable/unrecognized:
- remain quarantined.

Delete abandoned objects/reservations after 24 hours.

## 4. Real malware engine

The PRD explicitly forbids pretending structural parsing is antivirus.

Implement a real production scanner adapter.

Preferred lowest-complexity choices:
- isolated ClamAV worker; OR
- approved private scanning service.

Choose based on actual existing hosting and cost register, not personal preference.

Record:
- engine;
- signature version/freshness;
- scan timestamp;
- result;
- object hash/version.

Initial max signature age:
24 hours.

If signatures are too old:
- deny release;
- show operational degraded status.

Never submit documents to a public malware-analysis website.

Replace the existing hardcoded scanner readiness false ONLY after real capability/health evidence exists.

Do not delete the gate.

## 5. Worker architecture

Use/reuse one isolated worker deployment for:
- scan;
- rendering;
- bounded parsing;
- later OCR/AI;
- exports;
- deletion.

Do not do unbounded processing inside a web request.

Worker requirements:
- durable jobs;
- leases;
- lease recovery;
- at-least-once safe processing;
- identifiers in payloads, not raw file data or secrets;
- encrypted temporary storage;
- resource limits;
- bounded CPU/memory/time;
- minimum necessary egress;
- cleanup of temp files;
- exact object-version fetching.

Job retries must not duplicate side effects.

## 6. Safe preview

Do not iframe/inline arbitrary original PDFs as the default preview.

Generate a safe rendered representation with active content removed.

Track independent states:
- upload;
- malware scan;
- safe rendering;
- extraction;
- human review.

AI failure must not make a clean document unusable manually.

A clean scan means:
“configured scanner found no known threat at scan time.”

Never label it authentic or verified solely from scan.

## 7. Document metadata/versioning

Ensure each document/version can preserve:

- category/type;
- display filename;
- original filename;
- subject;
- issuer;
- issue date;
- expiry date;
- statement period;
- uploader/source;
- byte length;
- page count;
- content hash;
- exact object/storage version;
- scan evidence;
- processing evidence;
- supersession relationship.

Review states:

- PENDING
- ACCEPTED
- REPLACEMENT_REQUIRED
- IRRELEVANT
- DISPUTED

Use actual repository conventions if enum naming differs, but preserve semantics.

Replacement:
- creates immutable new version;
- retains prior version/decision;
- notifies affected open cases later;
- never mutates an acknowledged historical packet.

Duplicate detection:
- only within authorized subject/scope;
- never reveal a cross-customer match.

## 8. Wallet behavior

Prepare wallet service behavior for:
- current;
- expiring;
- expired;
- superseded.

Show where a version is used and current authorized access relationships.

Reuse must require explicit version selection.

Agency must never browse unrelated/unselected wallet evidence.

Passport renewal:
- preserves old passport;
- adds new version/record;
- later flags affected cases;
- does not rewrite history.

## 9. Assurance semantics

Support explicit independent assertions:

- applicant declared;
- document supplied;
- named machine checks completed;
- agency reviewed;
- issuer confirmed, ONLY when actual evidence exists.

No UI/service may map scanning or AI extraction to document authenticity.

No E2/E3 inflation.

Issuer confirmation remains optional/P1 operational UI.

## 10. Secure binary delivery

Before every preview/original delivery re-evaluate:
- actor;
- active account;
- membership;
- assignment where applicable;
- grant;
- subject;
- exact version;
- requested action;
- purpose;
- time validity;
- step-up requirement.

Implement either:
- authenticated streaming endpoint; OR
- application-bound one-time/short token.

Maximum token lifetime:
60 seconds.

Redemption must recheck access.

Never expose reusable upstream storage bearer URLs.

Headers:
- no-store;
- nosniff;
- safe content disposition;
- appropriate security headers.

Preview and original-download permissions are distinct.

Revoking a grant before redemption must make an already issued token fail.

## 11. Upload quota concurrency

Storage reservation must be atomic.

Prove two simultaneous uploads cannot both spend the same remaining quota.

On abandonment/failure:
- reservation is reconciled/released.

Do not treat a browser-reported file size as authoritative.

## 12. Required adversarial tests

Implement A06:
- MIME spoof;
- extension mismatch;
- EICAR or approved safe malware fixture;
- corrupt PDF;
- password PDF;
- oversized PDF;
- too many pages;
- pixel bomb;
- scanner outage;
- stale signatures.

Implement A07:
- hash served == hash scanned;
- storage version exact;
- object replacement between scan/use fails;
- orphan cleanup;
- concurrent quota.

Implement A08:
- quarantine inaccessible;
- safe preview available only after release;
- wrong user/agency denied;
- original download requires correct right;
- no public reusable URL;
- revoked grant kills token;
- no caching.

Tests must exercise real Postgres/object-storage adapter in an isolated synthetic environment where credentials exist.

If live scanner/storage integration credentials are unavailable:
- unit/integration tests may use explicit test adapters;
- commercial gate remains BLOCKED;
- never fake a live pass.

## 13. Operational evidence

Add monitoring signals for:
- queue age;
- job failures;
- scanner availability;
- signature age;
- render failures;
- object-storage errors;
- abandoned uploads.

Do not expose internal diagnostics on public health endpoint.

## 14. Verification

Run all relevant tests plus full:
- lint;
- typecheck;
- test;
- build;
- dependency scan.

Update:
- requirements ledger;
- threat model;
- architecture decisions;
- cost/vendor register;
- test evidence;
- release gate.

Commit.

## 15. Stop

Reply:

PART 3 CHECKPOINT: PASS | BLOCKED

PIPELINE
- upload
- quarantine
- scanner
- preview
- release
- download

ADVERSARIAL TESTS
- A06 result
- A07 result
- A08 result

COMMERCIAL BLOCKERS
- scanner
- storage
- worker
- keys
- only genuine external blockers

PERFORMANCE OBSERVATIONS

FILES/COMMITS

NEXT
- whether Part 4 may proceed

Then STOP.

---

# PART 4 OF 10
# TRAVELLER PROFILE, AGENCY ONBOARDING, INVITATIONS, CASES, REQUESTS, TASKS, NOTES, CONTRIBUTOR AND SHARING

Continue the same branch.

This is Part 4 of 10.

Primary requirements:

IAM-03  
IAM-04  
PRO-01  
PRO-02  
CAS-01  
CAS-02  
CAS-03  
CAS-04  
CAS-05  
CAS-06  
CAS-08  
SHR-01  
SHR-02  
SHR-03  
SHR-04

Acceptance focus:

A03  
A04  
A05  
A09  
A10  
A11

Journey foundations:

J01  
J02  
J03  
J04  
J06  
J10  
J11

Do not implement rule-engine completeness, applicant acknowledgement, AI administration or payments in this part.

## 1. Canonical model

Use:
- one identity;
- one canonical traveller profile/Applicant subject;
- Mission as Case.

Do NOT create a new parallel Case table.

A person may:
- own a private traveller profile;
- separately be an agency staff member.

Agency membership never opens the person's private wallet.

Context must be explicit.

## 2. Traveller profile

Implement/complete profile sections required by PRO-01:

- identity/contact;
- nationality/residence;
- current/historical passports;
- addresses;
- family basics;
- education;
- employment;
- self-employment;
- sponsor context;
- basic financial declarations;
- travel history;
- visa history;
- refusal history.

All remain optional until a case/rule needs them.

Never request bank-login credentials.

Names:
- Unicode preserved;
- original spelling preserved;
- alternate/transliterated version only when user confirms.

Dates:
- date-only for DOB/issue/expiry.

Currency:
- decimal + ISO currency.

Events:
- UTC instant plus relevant local context where required.

## 3. Fact/version behavior

Reuse:
- FieldDefinition;
- Fact;
- FactVersion;
- EvidenceLink.

Portable profile changes proposed by:
- agency;
- AI later

remain proposals until confirmed by traveller or explicitly authorized delegate.

Evidence reviewer acceptance is separate from portable fact confirmation.

Each approved fact retains:
- author;
- source;
- method;
- version;
- observation/effective date;
- confirmation state.

Conflict:
- creates review issue/task;
- never silently resolves by “latest wins.”

Revert:
- creates new version;
- never mutates history.

Repeating data:
- multiple employers;
- passports;
- bank records;
- travel records

must not overwrite one another.

High-risk values use Part 2 protected-field mechanism.

## 4. Agency onboarding

Implement the P0 organisation onboarding UI/service:

Agency submits:
- organisation name;
- business contact;
- basic organisation evidence.

Platform reviews and approves.

Approval wording:
“approved for VisaStack platform onboarding”
or equivalent factual wording.

Never:
- government accredited;
- embassy approved;
- trusted by government;
unless independently true and specifically evidenced.

Owner must satisfy staff MFA.

Fixed roles only.

Protect last owner.

## 5. Team invitations

Implement secure member invitations:

- cryptographically random token;
- token stored hashed;
- recipient-bound;
- role-bound;
- organisation-bound;
- expiration;
- one-time consumption;
- replay safe;
- race safe.

Acceptance confirms intended authenticated account.

Removed member loses access on next request.

## 6. Agency invites traveller

Implement IAM-03 exactly.

Agency may create ONLY a minimal pending client invitation with:
- display/name;
- contact destination;
- requested route;
- agency case owner.

Agency may not:
- create applicant-owned account by claiming person's email;
- claim existing traveller wallet;
- expose whether email already has VisaStack account;
- preload sensitive evidence without authority.

On acceptance:
1. recipient authenticates;
2. selects existing/new profile;
3. sees requesting agency;
4. sees purpose;
5. sees requested scope;
6. explicitly grants access;
7. case becomes properly linked.

Default expiry:
7 days.

Allow revoke/reissue.

No account enumeration.

## 7. Subject/guardian relationship

Preserve existing family/guardian model where possible.

Requirements:
- explicit represented subject;
- explicit authority;
- separate subject IDs;
- relationship type;
- actor recorded on action.

Never infer adult guardianship from:
- surname;
- email;
- household.

Family trip:
- linked independent cases;
- optional shared itinerary reference;
- permissions remain per subject.

Later applicant acknowledgement by guardian must record both:
- acting user;
- represented applicant.

## 8. Case creation

Customer-facing term:
Case.

Underlying entity:
Mission.

Required fields:
- traveller/subject;
- destination;
- jurisdiction/consular context;
- service category;
- trip purpose;
- travel dates;
- agency owner where applicable;
- assigned manager;
- target deadline;
- explicit traveller grant.

Independent traveller cases and agency-managed cases use same services.

Unsupported route:
- allowed in MANUAL mode;
- clearly displays limitation;
- no official readiness claim.

## 9. Case workspace

Build/complete one operational workspace showing:
- next required actions;
- evidence requests;
- overdue tasks;
- approaching dates;
- review issues;
- readiness placeholder/current result;
- acknowledgement status placeholder/current result.

Search only authorized cases/clients by:
- name;
- case reference;
- stage;
- destination;
- assignee.

Do not build global passport-number search.

Protected identifiers must not appear in search snippets.

Counts and search results obey same authorization as detail page.

## 10. Evidence requests

Each request:
- case;
- requirement if applicable;
- info/document type;
- explanation;
- due date;
- requester;
- recipient/responsible party.

States:
- OPEN
- RECEIVED
- UNDER_REVIEW
- ACCEPTED
- NEEDS_REPLACEMENT
- CANCELLED

Upload can move to RECEIVED only after safe processing.

Upload NEVER equals ACCEPTED.

Malware/failed/unrelated evidence cannot close request.

Replacement retains prior decision/reason.

Allow explicit wallet reuse.

Agency custom request must be labelled as agency request, not official rule.

## 11. Tasks and appointments

Extend canonical task model with:
- assignee;
- due instant OR date;
- explicit timezone;
- priority;
- state;
- completion history.

States:
- OPEN
- IN_PROGRESS
- DONE
- CANCELLED

Overdue is derived.

Appointment:
- local date/time;
- timezone;
- place/channel;
- add-to-calendar file/download.

No calendar SaaS integration required.

Reassignment/deadline changes:
- audit;
- later reschedule notifications.

Removed member may not remain sole owner of active case.
Create reassignment queue.

## 12. Notes

Every new note requires explicit:

- AGENCY_INTERNAL
or
- TRAVELLER_SHARED

AGENCY_INTERNAL must include author organisation ID.

Rules:
- traveller cannot read internal;
- Agency B cannot read Agency A internal;
- AI cannot receive internal unless actor/scope/task explicitly permits;
- search does not leak;
- export does not leak;
- notification does not leak.

Legacy unclassified notes:
- default restricted;
- do not expose until ownership/visibility resolved.

No bulk “publish all old notes.”

## 13. Review

Implement:
- accepted evidence;
- replacement requested;
- contradiction;
- proposed correction.

Optional organisation setting:
reviewer must differ from preparer.

If enabled:
server enforces it.

If disabled:
do not claim independent review.

Independent traveller may self-review:
label it self-reviewed.

Agency reviewer cannot perform applicant acknowledgement.

## 14. Contributor request

Implement CAS-08.

Contributor:
- authenticated;
- narrow named request only;
- seven-day invitation;
- single-use;
- email verification;
- sees purpose/recipients/retention;
- uploads named evidence;
- cannot browse whole case/profile.

Default:
contributed file is case-scoped.

Do not copy to traveller reusable wallet without contributor permission.

If final applicant packet will expose it:
tell contributor clearly.

## 15. Grant lifecycle

Implement SHR-01..03 exactly.

Grant contains:
- named recipient account/approved org;
- subject;
- case/purpose;
- exact fact/document versions or explicit categories;
- actions;
- start;
- expiry.

Default:
30 days.

Maximum initial:
90 days.

Lifecycle:
- PENDING_ACCEPTANCE
- ACTIVE
- PAUSED
- REVOKED
- EXPIRED

Recipient acceptance required.

Renewal explicit.

Paused can resume only within original validity.

Revoked/expired cannot silently reactivate.

Categories do not automatically absorb future documents by default.

Scope expansion requires new displayed confirmation.

Member removal/org suspension/account suspension denies next request.

Revocation:
- stops future platform access;
- cannot erase previously downloaded copies.

No passport/financial evidence in ordinary email attachments.

No anonymous sensitive-document sharing links in V1.

## 16. Consent

Keep separate:
- optional AI consent;
- sharing;
- marketing;
- issuer contact.

Record:
- actor;
- subject;
- purpose/notice version;
- scope;
- timestamp;
- withdrawal.

Do not treat every lawful basis as universal “consent.”

No external AI processing yet—just prepare canonical consent records for Part 8.

Provider change later must not silently expand consent.

## 17. Mandatory tests

A03:
- cross-tenant enumeration/read/write/export/job denied.

A04:
- purpose;
- case;
- action;
- expiry;
- exact document-version boundary;
- future evidence not automatically included.

A05:
- wrong email;
- expired invitation;
- replay;
- concurrent acceptance;
- no account discovery.

A09:
- immutable fact history;
- repeating facts;
- conflicting values;
- authority;
- rollback as new version;
- atomic failure.

A10:
seed actual private notes then prove no access via:
- traveller UI/API;
- Agency B;
- export;
- AI-context builder if currently reachable;
- search;
- logs.

A11:
- upload != acceptance;
- due date;
- reassignment;
- replacement;
- cancellation.

## 18. UX

Complete actual UI journeys for this scope.

No service-only acceptance.

Critical screens require:
- loading;
- empty;
- error;
- forbidden;
- pending;
- retry;
- success.

No optimistic false success.

## 19. Verification and stop

Run focused + full tests/build.

Update ledger/evidence.

Commit.

Respond:

PART 4 CHECKPOINT: PASS | BLOCKED

JOURNEYS NOW FUNCTIONAL
- J01/J02/J03/J04/J06/J10/J11 status

BOUNDARY TESTS
- A03/A04/A05/A09/A10/A11

KNOWN GAPS
- only legitimate later-part dependencies

FILES/COMMITS

NEXT
- whether Part 5 may proceed

Then STOP.

---

# PART 5 OF 10
# EXPIRY, NOTIFICATIONS, REAL EMAIL, COMMERCIAL PLANS, BILLING, BRANDING AND ADMIN OPERATIONS

Continue the same Commercial V1 branch.

This is Part 5 of 10.

Primary requirements:

NTF-01  
NTF-02  
NTF-03  
NTF-04  
COM-01  
COM-02  
COM-03  
COM-04  
ADM-01

Also finish operational aspects of:
CAS-04
J05
J12

Acceptance focus:

A17  
A18  
A28

## 1. Expiry centre

Track separately:
- intrinsic expiry;
- case-specific freshness/staleness;
- verification expiry where relevant.

Examples:
- passport expiry = intrinsic;
- bank statement too old for route = requirement-specific staleness.

Never mutate the document's intrinsic validity to represent a route rule.

Track rule version behind case staleness.

Default expiry reminder thresholds:
- 90 days;
- 60;
- 30;
- 7;
- expiry date.

Make configurable by document type.

Unknown expiry remains unknown.

Do not fabricate dates.

## 2. Notification event model

Implement in-app + email for:

- invitations;
- evidence requests;
- replacement requests;
- task deadlines;
- appointments;
- material case status/readiness changes;
- final review;
- later acknowledgement invalidation;
- rule-pack impact;
- security/account changes;
- expiry.

Recipients must be authorized at SEND TIME, not merely at event creation.

Agency notifications:
- current assigned members or configured owners only.

Email content:
- neutral;
- minimal;
- authenticated deep link.

Never include:
- passport number;
- financial details;
- medical details;
- refusal narrative.

## 3. Transactional outbox

Domain change and outbox entry commit together.

Delivery workers use idempotency key including:
- event;
- recipient;
- channel;
- threshold where applicable.

Delivery states:
- QUEUED
- SENT/provider accepted
- DELIVERED only if provider confirms
- BOUNCED
- FAILED
- READ if legitimately observable

Do not label provider acceptance as delivered/read.

Retries:
- transient only;
- maximum 5;
- spread over 24 hours with backoff.

Permanent bounce:
- stop retries;
- show in-app;
- operationally visible.

Webhook:
- signature verification;
- replay/event-ID protection;
- idempotent.

Admin retry:
- permitted;
- does not expose sensitive message content.

## 4. Timing

Subject timezone drives date notifications.

Default onboarding timezone:
Asia/Dhaka.

Editable.

Use local-date thresholds.

DST must not duplicate.

Tasks:
- 7 days before;
- 1 day before;
- overdue;
- bounded weekly overdue follow-up.

Cancellation/replacement/revocation invalidates obsolete notices.

Scheduler recovery:
- send only still-relevant notifications;
- do not flood every historically missed threshold.

Targets:
- event enqueue <=60 seconds;
- email handoff <=5 minutes;
- date checks at least hourly.

Instrument them.

## 5. Real email adapter

The existing NullEmailPort may remain available only for local/test where explicit.

Commercial/production mode must refuse to start or refuse email-dependent readiness if NullEmailPort is active.

Implement a real transactional email provider adapter.

Choose the lowest-complexity appropriate provider based on:
- verified current API/docs;
- pricing;
- region;
- data terms;
- webhook support;
- domain authentication;
- retry model.

Record selection in cost/vendor register and ADR.

Remove sensitive recipient/subject content from ordinary application logging.

Use synthetic addresses for integration tests.

A18 requires actual synthetic delivery + signed webhook behavior.

If domain/provider credentials are absent:
- implementation may be complete;
- live A18 remains BLOCKED;
- commercial gate remains false.

Never fabricate delivery success.

## 6. Plans

Implement data-driven entitlements, not hardcoded UI branches.

Templates:
- Traveller Free;
- Agency Starter;
- Agency Pro.

Numerical allowances/prices are product-owner configuration, not invented market truth.

Entitlements include:
- active seats;
- cases created/billing period;
- concurrent open cases;
- retained storage;
- AI allowance.

Show meter definition.

Security/export/privacy/customer-control cannot be paywalled.

After subscription lapse:
- preserve necessary historical read;
- retention;
- privacy requests;
- own-data export.

Never make a plan change alter data authorization.

## 7. Quota enforcement

Enforce atomically at service/job layer:
- invitations where plan constrained;
- case creation;
- seats;
- storage;
- AI later.

Concurrency tests required.

Downgrade:
- effective dates;
- warning/grace;
- blocks NEW capacity use after grace;
- deletes nothing.

Billing suspension:
- blocks new paid work;
- preserves secure authorized history/export.

Commercial override:
- platform admin;
- reason;
- expiry;
- audit;
- cannot bypass security/consent/release gates.

## 8. Manual billing

Implement:

States:
- TRIAL
- ACTIVE
- GRACE
- SUSPENDED
- CLOSED

Store:
- plan;
- price;
- currency;
- period;
- invoice ref;
- invoiced amount;
- due date;
- collected amount;
- collected date;
- payment/reference;
- state/history.

Never equate:
- proposal;
- commitment;
- invoice

with collected cash.

No payment gateway.
No card handling.
No tax engine.
No full CRM.

## 9. Agency branding

Allow:
- approved logo;
- agency name;
- one accessible accent color.

Always retain “Powered by VisaStack.”

No:
- HTML;
- arbitrary CSS;
- scripts;
- remote injected content.

Logo uses secure image pipeline.

Agency A branding can never appear in Agency B context.

Independent traveller wallet stays VisaStack-branded.

## 10. Admin workspace

Complete operational admin for:
- organisation approval;
- account suspension;
- role assignment;
- rule-pack admin placeholder/entry point;
- AI admin placeholder/entry point;
- plans;
- quotas;
- billing;
- notification failures;
- job failures;
- deletion requests;
- retention holds;
- release evidence.

Default admin views show metadata.

Content access requires Part 2 support grant + step-up.

Admin role must be server-owned.

No profile self-upgrade.

Audit view must not index plaintext sensitive values.

## 11. Owner operations UI

Agency owner should be able to:
- see usage;
- invite/remove staff;
- assign/reassign cases;
- inspect limits;
- manage branding;
- view billing state.

No developer intervention for normal operations.

## 12. Required tests

A17:
- timezone;
- thresholds;
- dedupe;
- outage catch-up;
- revoked authority stops delivery;
- stale scheduled messages cancelled;
- bounce surfaced.

A18:
- real synthetic email;
- signed webhook;
- replay harmless;
- NullEmailPort impossible in commercial mode.

A28:
- simultaneous quota;
- downgrade;
- suspended billing;
- manual cash state;
- branding isolation.

J05:
- expiring evidence notice;
- replacement;
- affected-case review;
- reminder reconfiguration.

J12:
- owner dashboard;
- reassignment;
- limits;
- branding;
- billing;
- downgrade preserves evidence/export.

## 13. Verification

Run:
- focused integration;
- real provider synthetic test if credentialed;
- full lint/typecheck/test/build;
- relevant security checks.

Update ledger/gates/cost register.

Commit.

Respond:

PART 5 CHECKPOINT: PASS | BLOCKED

NOTIFICATION SYSTEM
EMAIL
EXPIRY
PLANS/QUOTAS
BILLING
BRANDING
ADMIN
A17/A18/A28
J05/J12

EXTERNAL BLOCKERS

FILES/COMMITS

NEXT
- whether Part 6 may proceed

STOP.

---

# PART 6 OF 10
# RULES ENGINE, READINESS, CONTENT GOVERNANCE AND PUBLIC TRUST LITE

Continue the same branch.

This is Part 6 of 10.

Primary requirements:

RUL-01  
RUL-02  
RUL-03  
RUL-04  
RUL-05  
RUL-06  
relevant CAS-01/CAS-07 foundations

Acceptance focus:

A12  
A13  
A34

Journeys:

J07  
J13

CRITICAL: you may implement the engine and content workflow, but you may NOT invent official immigration rules, official fees, legal requirements, source freshness or embassy endorsements.

## 1. Preserve existing pack architecture

Inspect existing:
- Pack;
- PackVersion;
- Requirement;
- source citations;
- publication/checksum;
- completeness checks;
- evaluation code.

Extend canonical implementation.

Do not build a parallel rule engine.

## 2. Coverage model

Software remains country-agnostic.

Commercial V1 launch target:
two reviewed maintained packs.

PRD starting assumptions:
1. Bangladesh-resident Bangladeshi applicants — UK Standard Visitor;
2. France-anchored Schengen short stay.

The product owner may substitute before content freeze.

Do not hardcode engine logic specifically for these routes.

Unsupported destinations:
- MANUAL_ONLY;
- still usable;
- visibly not officially assessed.

## 3. Rule schema

Each immutable version must support:

- jurisdiction;
- nationality applicability;
- residence applicability;
- route;
- purpose;
- official source URL;
- source title;
- publisher;
- bounded official extract/reference;
- separate VisaStack interpretation;
- source type;
- observed date;
- reviewed date;
- effective date;
- next review date;
- author/owner;
- reviewer;
- condition;
- expected evidence;
- severity;
- freshness;
- change reason.

Statuses:
- DRAFT
- REVIEWED
- PUBLISHED
- SUPERSEDED
- WITHDRAWN

Published manifests:
- immutable;
- checksummed.

Authoritative public pack:
author and reviewer must be distinct.

Agency custom checklist:
must remain visibly separate.

## 4. Typed rule AST

Implement or extend typed declarative rule AST.

Allowlist only required operators such as:
- existence;
- equality;
- membership;
- date comparison;
- duration;
- numeric bounds;
- safe boolean composition.

NO:
- eval;
- arbitrary JS;
- remote scripts;
- arbitrary URL fetch during evaluation.

Missing facts:
UNKNOWN.

Never convert missing into false/satisfied.

Conflicting published sources:
explicit review/conflict state.

Do not silently choose newest page.

Cross-field checks should support:
- selected passport/name conflicts;
- date ordering;
- coverage date consistency;
- multiple current conflicting facts.

Transliteration variation:
review issue;
not fraud conclusion.

## 5. Requirement result model

Each requirement returns one:

- SATISFIED
- ATTENTION
- CRITICAL_GAP
- UNVERIFIED
- CONFLICTING
- EXPIRING_STALE
- NOT_APPLICABLE

Include:
- reasons;
- exact evidence versions;
- exact rule version;
- source freshness;
- next action.

Overall:
- MANUAL_ONLY
- NEEDS_ACTION
- NEEDS_REVIEW
- READY_FOR_APPLICANT_REVIEW

Do not average scores.

One blocking requirement remains visible.

Do not convert optional issuer confirmation into readiness blocker unless official reviewed rule requires it.

No visa approval probability.

## 6. Source maintenance

Rule admin workflow must support:

- scheduled review queue;
- next-review date;
- weekly launch-source review workflow;
- change detection entered by human;
- source inaccessible state;
- withdrawn source;
- diff between versions;
- active-case impact list;
- explicit adoption/reviewer decision.

Initial next-review:
<=30 days unless documented reason.

Stale mandatory source:
cannot appear confidently current + satisfied without qualified review.

Historical:
- assessment keeps original rule versions;
- submitted packet keeps versions used.

No automatic crawler required.

## 7. Content sourcing protocol

If you have web access:
- use ONLY authoritative official government/consular/service-provider sources appropriate to the rule;
- record exact URL;
- publisher;
- retrieval date;
- effective date if stated;
- quoted/extracted material within lawful/reasonable bounds;
- interpretation separately.

Cross-check where official sources conflict.

If you do NOT have reliable official-source access:
- do not fabricate content;
- leave pack DRAFT/incomplete;
- mark content launch gate BLOCKED.

Do not publish from:
- blogs;
- agency websites;
- model memory;
- generic search snippets

as authoritative official rules.

## 8. Golden tests

Each launch pack needs at least 20 approved golden cases.

Include:
- typical complete case;
- missing evidence;
- expired evidence;
- stale evidence;
- unknown fact;
- contradictory fact;
- date boundaries;
- changed source;
- withdrawn source;
- NOT_APPLICABLE branch;
- manual-review cases.

Golden expectations must come from reviewed requirement interpretation, not be generated by copying the current code output.

If qualified content reviewer approval is unavailable:
test cases can exist as draft engineering fixtures but content gate remains BLOCKED.

## 9. Public Trust Lite

Implement only P0 trust surface.

May show:
- maintained route description;
- official source;
- official fee + currency only when verified/current;
- effective/review date;
- authorized official application channel;
- separate agency service fee;
- scam-warning checklist;
- official reporting links.

If fee stale/unverified:
remove amount and show official source link/status.

Do NOT:
- accuse a named party of fraud without evidence/process;
- scrape arbitrary external sites;
- build domain reputation;
- imply embassy endorsement;
- force Travel Router lead capture;
- prefer founder's agency;
- publish agency rankings.

## 10. Case readiness experience

J07 actual UI must allow agency/traveller to:
- see requirement list;
- see evidence mapping;
- see missing/unknown/stale;
- resolve contradiction;
- understand next action;
- see source + freshness;
- distinguish official rule from agency custom request.

Unknown/stale mandatory rule cannot show false green.

Manual-only route must remain usable.

## 11. A12/A13/A34

A12:
test:
- boundary dates;
- unknowns;
- conflict;
- source stale;
- withdrawn;
- version change;
- expected states.

A13:
unsupported route:
- case works;
- no false assessment;
- MANUAL_ONLY obvious in UI/export.

A34:
public trust:
- source visible;
- freshness visible;
- agency fee separated;
- stale amount removed;
- no unsupported endorsement.

## 12. Security

Treat source/rule text as untrusted content.

Sanitize output.

Rule evaluation cannot execute source-provided instructions.

No arbitrary URL fetch from rule expression.

Authorization protects unpublished/internal packs.

Publication is audited and requires reviewer.

## 13. Verification

Run:
- rules tests;
- golden suite;
- UI;
- lint/typecheck/test/build.

Update ledger and content-governance docs.

Commit.

Reply:

PART 6 CHECKPOINT: PASS | BLOCKED

ENGINE
CONTENT PACKS
- pack 1 status
- pack 2 status
- reviewer status

A12
A13
A34
J07
J13

CONTENT BLOCKERS
- distinguish engineering-complete vs qualified-review-required

FILES/COMMITS

NEXT
- whether Part 7 may proceed

STOP.

---

# PART 7 OF 10
# APPLICANT TRUTH CHECK, ATOMIC ACKNOWLEDGEMENT, CASE STATE, OUTCOME, EXPORT, RETENTION, ERASURE AND EXIT

Continue the same branch.

This is Part 7 of 10.

Primary requirements:

TRU-01  
TRU-02  
TRU-03  
TRU-04  
CAS-07  
PRV-01  
PRV-02  
PRV-03  
PRV-04

Acceptance focus:

A14  
A15  
A16  
A29

Journeys:

J08  
J09  
J14

## 1. Repair snapshot scope first

Inspect current MissionSnapshot behavior.

The PRD audit found it may gather all loaded applicant facts/documents rather than exactly selected case disclosure.

Fix this structurally.

Final disclosure snapshot includes ONLY:

- selected FactVersion IDs;
- selected DocumentVersion IDs + hashes;
- route/rule versions applicable to this case;
- reviewer decisions;
- approved included outputs;
- unresolved disclosed limitations.

Exclude:
- unrelated wallet facts;
- unrelated documents;
- Agency-internal notes;
- hidden fees/material;
- unrelated cases;
- unselected historical evidence.

A14 must prove minimization with seeded unrelated data.

## 2. Human-readable prepared file

Provide:
- applicant review UI;
- manifest;
- exact intended evidence bundle;
- selected facts;
- rule/source context;
- known limitations.

Label correctly:

“Applicant-acknowledged prepared file”

or approved equivalent.

Do not label:
- embassy submitted;
- officially verified;
- approved;
- legally signed

unless separately true.

## 3. Acknowledgement entity

Implement immutable acknowledgement record containing:

- subject;
- acknowledging actor;
- actor authority/representation;
- snapshot ID;
- snapshot checksum;
- case material revision;
- acknowledgement-text version;
- timestamp;
- auth/assurance context.

Require step-up.

Actions:
- acknowledge;
- reject;
- request correction + reason.

A reviewer cannot acknowledge for applicant merely because they manage the case.

A guardian/delegate records both:
- actor;
- represented applicant.

Do not describe this as a regulated digital signature unless legally implemented.

## 4. Material revision concurrency

Maintain monotonically increasing case material revision.

Material changes increment revision in SAME transaction as mutation and acknowledgement invalidation.

Material includes:
- selected fact value/version;
- selected document version/removal;
- included output text;
- itinerary;
- destination;
- purpose;
- applicable requirement/rule version;
- review resolution affecting disclosed file.

Nonmaterial:
- internal note;
- assignee;
- harmless sorting.

Snapshot creation must:
- read consistent material revision;
- capture exact selected inputs.

Acknowledgement must:
- lock/check same revision;
- check snapshot hash;
- fail if stale;
- be idempotent;
- not race a concurrent edit.

Final packet issuance must recheck:
- current acknowledgement validity;
- selected evidence validity;
- expiry;
- grant;
- scan state;
- authorization.

## 5. Replacement/expiry invalidation

If selected passport/evidence:
- expires;
- is superseded;
- is materially replaced;

mark case dirty and invalidate submission-ready use.

Historical acknowledged snapshot remains immutable/downloadable where current access allows, labelled historical.

Old submitted packet remains immutable.

Correction after submission:
new linked amendment/review cycle.

Never rewrite history.

## 6. Canonical case states

Implement/map:

DRAFT  
INTAKE  
IN_REVIEW  
AWAITING_APPLICANT  
SUBMISSION_READY  
SUBMITTED  
CLOSED  
CANCELLED

Additive migration from legacy:
- IN_PROGRESS
- READY_FOR_REVIEW
- UNDER_REVIEW
- READY_TO_EXPORT
- LOCKED

Do not convert legacy LOCKED into acknowledged/submitted.

Preserve raw legacy state in migration history.

Legacy locked:
restricted/labelled;
requires real acknowledgement for future submission-ready claim.

## 7. External submission report

Export/download does NOT mean submitted.

Create attributable submission report:
- actor;
- date/time;
- channel;
- packet reference;
- immutable packet ID;
- external report/source description.

Only then case can become SUBMITTED.

VisaStack itself must not imply it observed an embassy action unless it actually did.

## 8. Outcome

Allow:
- APPROVED
- REFUSED
- WITHDRAWN
- CANCELLED
- OTHER

Store:
- decision date;
- optional restricted decision evidence;
- exact original wording where supplied;
- separate agency interpretation.

Do not blend agency interpretation into official wording.

No approval probability.

## 9. Complaint/feedback

Case complaint:
- description;
- owner;
- status;
- history;
- resolution.

Private post-case feedback:
- tied to actual case;
- restricted authorized quality users.

No public review/ranking in V1.

Do not expose sensitive refusal/medical narrative in analytics.

## 10. Privacy data map

Create/update operational data map covering:
- operating legal entity;
- controller/processor roles to be legally confirmed;
- jurisdiction;
- lawful-basis decision placeholders;
- children/guardian;
- transfers;
- subprocessors.

List:
- host;
- DB;
- objects;
- identity;
- key service;
- scanner;
- OCR/AI;
- email;
- monitoring;
- backups.

For each:
- data class;
- purpose;
- region;
- retention;
- deletion;
- exit.

Do not claim GDPR/Bangladesh compliance without qualified legal review.

Mark legal decisions requiring counsel as BLOCKED, not “done.”

## 11. Retention

Implement configurable class-specific retention.

PRD proposed defaults—not immutable legal facts:

- abandoned invite metadata: 30d;
- incomplete upload: 24h;
- transient OCR/export: <=24h where possible;
- AI cache: <=30d later;
- ordinary app logs: 30d;
- restricted security/audit metadata: 12m subject to approved justification;
- closed case: initial proposed 12m with 30d notice;
- wallet original: until deletion/inactive-account policy.

Do not use one universal retention period.

## 12. Erasure workflow

Implement durable deletion job.

Flow:
1. authenticate/verify requester;
2. identify scope;
3. show affected data;
4. show retained exceptions;
5. offer export;
6. revoke/cancel optional processing;
7. purge live data/derived copies;
8. record minimal deletion evidence.

Cover:
- object versions;
- thumbnails;
- OCR;
- AI cache/proposals later;
- generated packs;
- snapshots where deletion policy permits;
- provider-side files later;
- temp artifacts.

Target live purge:
<=30 days after valid approved request.

Backup expiry target:
<=90 days unless approved narrower/other policy.

Do not claim completed until actual jobs/providers reconcile.

## 13. Legal holds

Hold needs:
- authority/basis;
- exact scope;
- owner;
- start;
- review/expiry.

Cannot become indefinite convenience.

Agency cannot block traveller deletion merely by calling case active.

When retained:
explain:
- what;
- why;
- who can access;
- next review.

## 14. Export/portability

Traveller export:
- readable JSON/CSV metadata;
- permitted originals;
- selected case snapshots;
- consent/share history;
- manifest.

Exclude:
- other people's restricted data;
- agency-private notes.

Agency export:
only its records + content it remains authorized to export.

Large export:
async durable job;
encrypted transient storage;
max 24h artifact;
safe ZIP paths/names;
no traversal/duplicates/executables;
current access rechecked at download.

Agency termination:
removes agency access;
traveller retains wallet.

## 15. Backup resurrection protection

Create deletion tombstone/revocation reconciliation design.

After restore:
before reconnecting users or workers:
- replay deletion tombstones;
- replay current revocations;
- reconcile memberships;
- reconcile holds.

Recovery cannot resurrect deleted access/data into live service.

Actual full restore drill comes later.

## 16. Tests

A14:
exact disclosure; unrelated data seeded and excluded.

A15:
- authority;
- step-up;
- snapshot checksum;
- material revision;
- simultaneous edit vs acknowledge;
- duplicate/idempotent request.

A16:
- material change invalidates;
- expiry blocks;
- internal note doesn't invalidate;
- submitted historical packet unchanged.

A29:
- traveller export scope;
- agency export scope;
- derivatives deleted;
- hold behavior;
- tombstone after synthetic restore/replay.

J08:
actual UI exact-file review/acknowledgement.

J09:
submission report/outcome/feedback.

J14:
export/revocation/deletion/exception report.

## 17. Verification

Full quality checks.

Update ledger/release gates/runbooks.

Commit.

Reply:

PART 7 CHECKPOINT: PASS | BLOCKED

TRUTH CHECK
CASE STATE
SUBMISSION/OUTCOME
EXPORT
ERASURE
RETENTION
LEGAL/PRIVACY REVIEW BLOCKERS

A14/A15/A16/A29
J08/J09/J14

FILES/COMMITS

NEXT
- whether Part 8 may proceed

STOP.

---

# PART 8 OF 10
# MULTI-PROVIDER AI GATEWAY, ADMIN CONTROL, OCR, BUDGETS, PRIVACY, EVALUATION AND ROLLBACK

Continue the same branch.

This is Part 8 of 10.

Primary requirements:

AI-01 through AI-10.

Acceptance focus:

A19  
A20  
A21  
A22  
A23  
A24

Journey:
J15

AI is REQUIRED as delivered Commercial V1 capability but OPTIONAL in every traveller journey.

Manual core must remain functional with AI disabled.

## 1. No second AI architecture

Inspect the existing:
- `AiExtractionPort`;
- OpenAI adapter;
- AI jobs;
- proposal model;
- AI runtime config;
- existing cost/usage code.

EXTEND the canonical port.

Do not create a separate parallel AI system.

Remove/replace the fixed-provider assumptions safely.

## 2. Required P0 AI tasks

Support only:

1. extraction of draft fields from clean supported evidence;
2. document type suggestion;
3. safe filename/name suggestion;
4. possible inconsistency flag;
5. explanation of an ALREADY-DETERMINED deterministic readiness gap.

No:
- open-ended immigration chatbot;
- autonomous case decisions;
- legal approval prediction;
- tool execution;
- browser actions;
- email/messages;
- issuer contact;
- payments;
- document submission;
- direct consequential DB writes by model.

## 3. Provider adapters

Ship production adapters for:

- OpenAI API
- Google Gemini API
- Anthropic Claude API

Use latest official provider documentation at implementation time.

Record:
- docs URL;
- date checked;
- SDK/API version;
- structured-output mechanism;
- supported file/vision behavior;
- retention/data-control assumptions;
- known limitations.

Do not hardcode “latest model”.

Admin must be able to type/select an account-accessible model ID.

Provider/model is eligible only if capability validation passes for target task.

A provider with incompatible protocol requires an adapter release—not an arbitrary URL swap.

## 4. Normalized gateway contract

Request should include:

- task ID/type;
- task schema version;
- configuration version;
- subject/case scope;
- minimal authorized content;
- allowed output fields;
- locale;
- input hash;
- job ID/idempotency;
- maximum output;
- deadline.

Result:
- typed proposals;
- exact source references;
- provider;
- model;
- provider request ID where available;
- usage units;
- timing;
- refusal/error classification;
- config version;
- prompt version;
- schema version.

Locally validate output with strict schema and field allowlist.

Provider “structured output” is not sufficient without local validation.

Explicitly handle:
- refusal;
- truncation;
- missing usage;
- schema failure;
- unsupported parameter;
- auth failure;
- rate limit;
- timeout.

## 5. Admin configuration

Build platform-admin AI Settings.

Require MFA/step-up.

Admin can:
- choose provider;
- enter/update write-only API key;
- choose/type model ID;
- select tasks;
- set limits;
- set reviewed data policy;
- save DRAFT;
- run synthetic connection test;
- run task evaluation;
- activate;
- rollback;
- emergency-disable.

Prior active version remains until replacement passes.

Activation:
atomic task-config version switch.

New jobs:
new version within 60s.

Already-dispatched:
retain pinned provenance.

Kill switch:
rechecked immediately before outbound call, including queued jobs.

Rollback:
last eligible known-good only.

Cannot resurrect:
- revoked key;
- unapproved data policy.

Agency admin:
cannot change platform provider/key.

## 6. Secrets

API keys:
- secret-store reference or KMS-backed encrypted secret;
- decryption only server AI gateway;
- write-only admin update;
- masked fingerprint;
- rotation;
- revocation;
- verification metadata.

Never return/log/export:
key value.

Reauth for changes.

## 7. Endpoints / SSRF

Built-in adapters:
official provider host locked.

Optional custom compatible endpoint may exist only if truly needed and vetted.

Reject:
- non-HTTPS;
- credentials/query token in URL;
- localhost;
- loopback;
- link-local;
- cloud metadata;
- private/reserved IP;
- unsafe port;
- redirects;
- DNS rebinding;
- unsafe IPv6.

Resolve/revalidate DNS/IP at connection time.

Apply egress restrictions.

Never implement generic “server fetch arbitrary URL to test it.”

Provider key must never be sent to the wrong host.

## 8. Evidence grounding

Every proposed field includes:

- target field/record;
- proposed value;
- current value;
- source DocumentVersion;
- page or source span;
- snippet;
- heuristic confidence;
- review state.

For extracted text:
deterministically verify snippet exists in extracted source.

Image-derived:
page/region.

Unsupported:
uncertain/unmapped/reject.

Do not display self-reported confidence as calibrated truth.

High-risk identifiers/conflicts:
individual review mandatory.

Actions:
- approve;
- edit + approve;
- reject;
- link evidence;
- choose/create repeating record.

Approval must atomically:
- create canonical fact version;
- create evidence link;
- audit.

No silent auto-commit regardless of confidence.

AI cannot increase issuer assurance.

## 9. OCR/scanned evidence

Use Part 3 clean/safe document state as prerequisite.

For image/scanned PDF:
use:
- approved OCR component; OR
- configured evaluated vision model.

Bound:
- pages;
- resolution;
- size.

Show:
- low quality;
- ambiguous date;
- unsupported script;
- missing text

as review issues.

Manual entry always available.

Do not market universal OCR or multilingual accuracy.

## 10. Data boundary

Before external call verify:

- actor authority;
- subject;
- grant if relevant;
- optional AI consent;
- data classification;
- provider data-policy eligibility;
- task scope.

Send ONLY selected content necessary.

Never send:
- whole wallet;
- unrelated case;
- other tenant;
- hidden private notes;
- open-ended chat history.

No shared applicant cache.

Treat document text as hostile/untrusted.

Prompt injection inside document cannot:
- reveal secrets;
- modify system rule;
- call URLs;
- expand data scope;
- execute tools.

## 11. Spend/accounting

Replace approximate blended token→USD behavior.

Track separately:
- input units;
- output;
- cached;
- other billed units;
- price version;
- currency;
- estimated reservation;
- actual/reconciled.

Pricing must be provider/model-specific and versioned.

If price/usage missing:
- cost UNKNOWN;
- pause further paid dispatch for affected config until bounded accounting restored.

Before dispatch atomically reserve conservative worst-case cost against:
- platform monthly cap;
- organisation cap;
- per-job cap;
- retries;
- configured fallback.

Concurrent calls may not race available budget.

Reconcile actual usage later.

Uncertain timeout outcome:
keep reservation until reconciled.

Defaults:
- 2 total attempts/job;
- 60s request timeout;
- 25 pages;
- 5 concurrent model calls platform-wide.

Budget unset:
NOT unlimited.
It means cannot enable paid dispatch.

Proposed extraction cap:
$0.50/job is only initial configurable guardrail, not a cost forecast.

Warn at 80%.
Pause at ceiling.

## 12. Cache

Cache key must bind:

- subject/authorization scope;
- provider;
- model;
- prompt version;
- schema version;
- input hash;
- consent-policy version;
- task config version.

Recheck access before cache use.

Superseded/corrected doc invalidates relevant key.

No cross-tenant cache.

## 13. Failure/fallback

Recoverable:
- timeout;
- rate limit;
- circuit breaker.

Manual workflow survives.

Do not retry:
- auth failure;
- invalid input;
- consent denial.

Cross-provider fallback:
OFF by default.

If enabled:
- provider already passed same privacy/task/budget gates;
- visible in UI;
- cannot be used to “shop for a desired answer” after a refusal.

## 14. Evaluation

Each provider must pass real synthetic adapter tests before V1 is fully accepted.

Evaluation set:
>=50 representative documents/pages per task set, covering:
- Bangladesh-relevant names;
- dates;
- English;
- Bangla;
- clean;
- poor scan;
- conflict;
- hostile embedded instructions.

Minimum bounded-set launch targets:

critical identity/date fields:
>=95% precision on clean supported samples.

Coverage:
>=80% of labelled extractable critical fields.

Document type:
>=95% accuracy.

Also measure:
- abstention;
- source grounding;
- per-field error;
- sample count.

Never call these population-wide accuracy claims.

If paid account absent for any provider:
adapter may be code-complete;
but A19 remains BLOCKED for that provider.

All three real adapters must eventually be live-tested for Commercial V1 acceptance.
Only one needs to be active for real traffic.

## 15. Required tests

A19:
all three real APIs return validated proposals;
admin activation/rollback no deploy.

A20:
evaluation + grounding + abstention + human confirmation.

A21:
- no AI consent;
- withdrawn consent;
- wrong subject;
- wrong tenant;
- restricted provider policy;
- cache collision;
- prompt injection.

A22:
- localhost;
- metadata;
- private;
- IPv6;
- DNS rebinding;
- redirect;
- wrong host;
- key browser exposure.

A23:
- timeout;
- refusal;
- invalid schema;
- rate limit;
- kill switch;
- price missing;
- manual path.

A24:
concurrent budget reservation.

J15:
admin:
- config OpenAI;
- test;
- activate;
- Gemini;
- Claude;
- rollback;
- invalid model fails;
- unsafe host fails;
- no consent blocks actual dispatch.

## 16. Verification

Do not use customer documents.

Run full quality gates.

Record external API test request IDs without sensitive content.

Update:
- provider registry;
- evaluation report;
- cost register;
- ledger;
- privacy data map;
- release gate.

Commit.

Reply:

PART 8 CHECKPOINT: PASS | BLOCKED

PROVIDERS
OpenAI:
Gemini:
Anthropic:

ADMIN CONFIG
SECRETS
BUDGET
OCR
PRIVACY
EVALUATION

A19-A24
J15

BLOCKERS
- real credentials/data-policy review only

FILES/COMMITS

NEXT
- whether Part 9 may proceed

STOP.

---

# PART 9 OF 10
# COMPLETE UX, BANGLA/ENGLISH, ACCESSIBILITY, BROWSER SECURITY, MONITORING, PERFORMANCE, ANALYTICS AND RECOVERY PREPARATION

Continue same branch.

This is Part 9 of 10.

Primary requirements:

UX-01  
UX-02  
UX-03  
OPS-01  
OPS-03  
OPS-04  
SEC-02  
remaining SEC-07  
recovery preparation for OPS-02

Acceptance focus:

A31  
A32  
A33

Do not do a cosmetic rewrite.

The PRD explicitly says use existing design system and reusable components.

## 1. Information architecture

Ensure actual navigation:

Traveller:
- Overview
- Profile
- Documents
- Cases
- Sharing
- Alerts
- Privacy

Agency:
- Dashboard
- Clients
- Cases
- Team
- Usage/Billing
- Settings

Platform:
- Organisations
- Rules
- AI
- Operations
- Privacy
- Audit

Hide internal implementation vocabulary from ordinary travellers:
- provider schema;
- job lease;
- internal DB entity names.

## 2. Critical-state completeness

Every critical screen:
- loading;
- empty;
- error;
- forbidden;
- pending;
- retry;
- success.

No false optimistic success.

Autosave:
shows persisted confirmation only after real success.

Sensitive screen:
show:
- active subject/case;
- selected version;
- ownership/access context.

Avoid vague green “verified” language.

Use exact assurance labels defined earlier.

## 3. Mobile/weak network

Critical journeys must work on narrow phone viewport.

Test:
- interrupted upload;
- slow request;
- job still processing;
- retry;
- duplicate click;
- page reload.

Do not require same file to be re-uploaded merely because status page was ambiguous.

Use resilient progress state.

## 4. English/Bangla

Provide English and Bangla for critical flows:

- account/consent;
- invitations;
- upload;
- requests;
- sharing;
- readiness warnings;
- acknowledgement;
- alerts;
- privacy actions.

Do not machine-transliterate legal names automatically.

Preserve original Unicode.

Translation files must be reviewed for:
- meaning;
- security;
- privacy;
- consent wording.

Do not translate product/legal meaning loosely merely to fill keys.

If professional legal/privacy translation review is required:
mark it explicitly before public launch.

## 5. Accessibility

Target WCAG 2.2 AA for critical journeys.

Cover:
- semantic structure;
- keyboard;
- focus order;
- focus restoration after modal/error;
- labels;
- form-error association;
- contrast;
- screen-reader status;
- loading/progress;
- modal/dialog behavior;
- visible focus;
- touch target;
- language attributes.

Automated:
axe or existing equivalent.

Manual:
- keyboard;
- at least one screen-reader pass on critical journeys.

Do not report AA compliance solely from automated scanner.

## 6. Browser/application security

Implement/verify:

- HTTPS assumption/enforcement at deployment edge;
- Secure/HttpOnly/SameSite cookies as appropriate;
- CSRF/origin controls for mutations;
- redirect allowlist;
- CSP;
- HSTS where appropriate;
- frame restrictions;
- Referrer-Policy;
- permissions policy where useful;
- no-store for protected pages/bytes;
- nosniff;
- no PII in query strings;
- sanitize filenames;
- sanitize notes;
- sanitize AI output;
- sanitize pack content;
- no untrusted HTML;
- no sensitive localStorage;
- no sensitive service-worker cache;
- no third-party session replay over protected pages.

Rate-limit:
- login/recovery;
- invitation;
- upload;
- sharing;
- export;
- AI.

Use actor + appropriate network/org dimensions.

## 7. Observability

Instrument without PII leakage.

Metrics/alerts:
- core availability;
- request latency;
- error rate;
- DB errors;
- connection pressure;
- job queue age;
- job failures;
- scanner availability/signature age;
- notification backlog;
- email failure/bounce;
- denied access anomalies;
- audit failures;
- object-storage failures;
- AI spend;
- AI circuit breaker;
- deletion job failure.

Public health:
coarse.

Admin readiness:
detailed.

Never expose:
- secret presence;
- sensitive provider detail;
- identifiers.

## 8. Service objectives

Measure, do not merely document:

Initial targets:
- 99.9% monthly authenticated-core availability engineering target;
- p95 ordinary API <800 ms excluding transfer/AI;
- meaningful UI feedback <2 s;
- p95 safe processing clean 10-page reference PDF <90 s at launch envelope.

AI outage:
manual core survives.

Scanner outage:
new document RELEASE stops.

Do not call targets customer SLA unless contractually adopted.

## 9. Capacity/load

Create representative synthetic dataset:

- 20 agencies;
- 200 professional users;
- 5,000 traveller profiles;
- 1,000 open cases;
- realistic documents metadata;
- rules;
- notifications;
- grants.

Load:
- 50 concurrent interactive sessions;
- 5 concurrent document jobs.

Measure:
- p50/p95/p99 where useful;
- errors;
- queue age;
- DB connections;
- memory;
- worker pressure;
- rough unit cost.

Pagination must operate against representative volume.

No tiny empty DB benchmark.

If current architecture cannot meet target:
optimize evidence-based bottleneck.
Do not prematurely add distributed infrastructure.

## 10. Analytics

Implement pseudonymous access-controlled product events for:

- case creation/stage;
- intake-to-ready;
- requested/received/reworked evidence;
- overdue tasks;
- gaps;
- acknowledgement/invalidation;
- source review;
- AI acceptance/correction;
- outcome;
- complaint resolution;
- activation;
- agency repeat usage;
- plan usage;
- cash collection.

Exclude:
- passport;
- file contents;
- detailed refusal text;
- medical narrative;
- unrestricted free text.

Do not repurpose aggregate data for external model training.

## 11. Incident readiness

Create/update runbooks:
- incident response;
- access compromise;
- secret compromise;
- malware/scanner outage;
- storage issue;
- AI provider issue;
- notification/email issue;
- data exposure;
- restore.

Name placeholders/actual:
- primary incident owner;
- backup owner.

If not actually appointed:
launch gate BLOCKED.

Include:
- contain;
- revoke;
- preserve evidence;
- assess;
- legally reviewed notification/escalation;
- recover;
- postmortem.

Do not promise unsupported 24/7 response.

Run/document synthetic tabletop if possible.

## 12. Recovery preparation

Prepare exact full restore runbook for Part 10.

Target:
RPO <=15 min
RTO <=4h

Must cover:
- DB;
- originals;
- derivatives as needed;
- keys;
- configuration;
- audit integrity;
- deletion tombstones;
- revocation;
- current auth/access.

Recovered production data:
never ordinary PR preview.

Recovery env:
isolated;
equivalent access controls;
outbound messages disabled;
limited operators.

Do not call PITR alone sufficient.

## 13. Deployment/migration safety

Fix any remaining deployment issue where preview builds could run production migrations.

Migration:
- controlled deployment job;
- dedicated migration credential;
- serialized;
- not normal PR preview;
- not production DB URL exposed to arbitrary branch.

Release should record:
- code SHA;
- deployment/build ID;
- migration version.

Rollback procedure documented and tested where practical.

## 14. A31/A32/A33

A31:
- clean install;
- upgrade;
- preview isolation;
- migrations serialized;
- deployed commit identity;
- rollback behavior.

A32:
- mobile;
- low bandwidth;
- EN/BN;
- keyboard;
- screen reader.

A33:
representative load envelope and bounded cost/no starvation.

## 15. Supply-chain finalization

Ensure CI scans ACTUALLY run on protected/trusted code.

Report skipped independently.

No production credential in:
- PR preview;
- test fixture;
- browser bundle;
- prompts.

## 16. Verification

Run full:
- lint;
- typecheck;
- tests;
- build;
- dependency/secret/static/licence scans;
- accessibility;
- load suite.

Update all evidence.

Commit.

Reply:

PART 9 CHECKPOINT: PASS | BLOCKED

UX
I18N
ACCESSIBILITY
BROWSER SECURITY
MONITORING
PERFORMANCE
LOAD
ANALYTICS
INCIDENT
RECOVERY PREP

A31/A32/A33

UNRESOLVED LAUNCH BLOCKERS

FILES/COMMITS

NEXT
- whether final Part 10 may proceed

STOP.

---

# PART 10 OF 10
# FULL END-TO-END VERIFICATION, CROSS-ACCOUNT E2E, RECOVERY DRILL, RELEASE GATES, SECURITY ACCEPTANCE AND HANDOVER

Continue the same Commercial V1 branch.

This is Part 10 of 10.

This is NOT primarily a feature-building phase.

Its purpose is to prove or disprove Commercial V1 readiness.

The governing rule is:

NO EVIDENCE = NOT COMPLETE.

Never turn a missing credential, skipped test, absent external review or unverified operational assumption into a green checkbox.

## 1. Re-read authority

Before final verification:
- re-read full Commercial V1 PRD;
- re-read requirements ledger;
- re-read threat model;
- re-read architecture decisions;
- re-read blockers;
- re-read release gate.

Fetch current `origin/main`.

Record divergence.

Do not silently absorb unrelated changes.

## 2. Close the eight skipped cross-account E2E tests

Inspect:
`apps/web/e2e/authenticated-workspace.spec.ts`

The eight cross-account tests previously contained unconditional `test.skip(true, reason)` placeholders.

Implement REAL test bodies.

Use two independent synthetic WorkOS staging identities.

Preserve CI rule:
real identity secrets execute only trusted code/production deployment or explicitly reviewed manual dispatch—not arbitrary PR preview code.

Required fixtures:
- Agency A;
- Agency B;
- staff for A/B as needed;
- multiple unrelated travellers;
- grants;
- revoked grants;
- removed memberships;
- private notes;
- real synthetic document versions.

Do not use a single identity to fake isolation.

If second-identity secrets/allowlist configuration are absent:
tests remain BLOCKED;
do not mark passed.

## 3. Execute J01 through J15 through the actual UI

Demonstrate all:

J01 Independent traveller  
J02 Agency onboarding  
J03 Agency invites traveller  
J04 Repeat case  
J05 Expiry replacement  
J06 Sharing  
J07 Agency preparation/readiness  
J08 Applicant Truth  
J09 Outcome/feedback  
J10 Change agency  
J11 Family/sponsor contributor  
J12 Owner operations  
J13 Public trust  
J14 Export/exit  
J15 AI admin provider change

For each record:
- environment;
- deployed SHA;
- identities;
- synthetic fixture ID;
- steps;
- result;
- screenshot/report/artifact reference where useful;
- failure-path result.

Do not substitute service tests for UI journey proof.

## 4. Execute A01 through A35

Every A-test must have:

- implementation;
- automated test where feasible;
- actual execution;
- result;
- evidence reference;
- code SHA;
- environment.

Maintain separate states:
- PASS
- FAIL
- BLOCKED
- NOT_EXECUTED

Do not use “N/A” unless PRD genuinely permits it and justification is recorded.

Required matrix:

A01 Identity/MFA  
A02 Revocation  
A03 Tenant boundaries  
A04 Grant precision  
A05 Invitation  
A06 Upload threats  
A07 Upload integrity  
A08 Safe delivery  
A09 Profile history  
A10 Private notes  
A11 Requests/tasks  
A12 Rule regression  
A13 Manual route  
A14 Snapshot minimization  
A15 Acknowledgement  
A16 Post-approval change  
A17 Alerts  
A18 Email provider  
A19 AI providers  
A20 AI quality  
A21 AI privacy  
A22 AI endpoints  
A23 AI resilience  
A24 AI concurrency  
A25 Encryption  
A26 Audit  
A27 Privilege  
A28 Commerce  
A29 Privacy  
A30 Recovery  
A31 Deployment  
A32 UX/language/accessibility  
A33 Capacity  
A34 Public trust  
A35 Independent review

## 5. Full restore drill — A30

Perform an ACTUAL restore in isolated recovery infrastructure using synthetic/non-customer data or approved safe test data.

Restore:
- DB;
- original/required object data;
- encryption keys/config capability;
- audit chain/checkpoint;
- deletion tombstones;
- revocations.

Disable outbound delivery.

Verify:
- chosen recovery point;
- start/end;
- measured RPO;
- measured RTO;
- object hashes;
- protected-field decryption;
- audit integrity;
- permission checks;
- deleted data not resurrected;
- revoked grant not resurrected;
- failed/missing steps.

Target:
RPO <=15m
RTO <=4h.

If provider tier/config cannot meet target:
A30 FAIL/BLOCKED.
Do not rewrite target after test merely to pass.

## 6. Security scans

Run against release candidate:

- dependency audit;
- secret scan;
- static analysis;
- licence scan;
- applicable CodeQL or equivalent where configured;
- all authorization suites;
- SSRF tests;
- upload/malware tests;
- encryption tests;
- audit integrity;
- browser security/CSP;
- rate limit checks.

Report:
executed/passed/failed/skipped.

Workflow green is not enough.
Inspect job-level outcome.

## 7. Independent security review — A35

The PRD requires scoped independent security review/penetration test and retest.

Claude Code cannot honestly self-certify independent review.

If a genuinely independent reviewer/report exists:
- ingest findings;
- classify;
- fix Critical/High;
- retest;
- link evidence.

If not:
A35 = BLOCKED.

Commercial admission remains blocked.

Do NOT describe internal Claude/Codex review as independent penetration testing.

## 8. Rules/content sign-off

Verify:
- at least two complete launch packs;
- official sources current;
- reviewer distinct where required;
- golden cases >=20 each;
- review dates valid;
- stale content handled;
- public trust cards consistent.

If qualified content review absent:
release BLOCKED.

Do not lower the bar.

## 9. Provider/privacy sign-off

Verify:
- AI provider business accounts/data policies;
- configured endpoint;
- retention terms;
- approved data classes;
- email provider;
- scanner;
- storage;
- identity;
- key service;
- monitoring;
- backups.

Confirm current official terms/docs rather than relying on stale memory.

If required privacy/legal decisions lack qualified approval:
label them explicitly.

Do not state compliance certification that does not exist.

## 10. Commercial operational sign-off

Verify:
- plan allowances explicitly configured;
- price/currency explicitly configured by product owner;
- billing process;
- support contact;
- primary/backup incident owner;
- rules owner/reviewer;
- privacy owner;
- infrastructure ownership;
- domain/cloud/identity/data/secrets/billing accounts belong to VisaStack/owner entity as intended.

Do not invent approvals.

## 11. Full release-candidate test run

At the exact release-candidate SHA run:

- install/frozen lockfile;
- lint;
- typecheck;
- unit/integration;
- build;
- Playwright public;
- authenticated single-account;
- authenticated cross-account;
- rule golden suites;
- AI provider live synthetic;
- email live synthetic;
- scanner live fixture;
- export/privacy suite;
- load;
- accessibility;
- security scans.

Then deploy release candidate to appropriate isolated staging/production-like environment.

Confirm deployed SHA EXACTLY matches tested SHA.

Run production-like smoke.

Never reuse a passing report from different SHA/environment.

## 12. Release gate record

Complete `docs/commercial-v1/release-gate.md` with:

- code SHA;
- branch;
- build ID;
- deployment ID;
- environment;
- schema version;
- migrations;
- provider config versions;
- rule-pack versions;
- test reports;
- scan timestamps;
- E2E results;
- recovery drill;
- external/independent review;
- incident owners;
- content sign-off;
- privacy/provider sign-off;
- approvers;
- revalidation conditions.

Every operational attestation:
- evidence link;
- approver;
- date;
- revalidation trigger.

No convenience flags.

No hardcoded “true”.

## 13. Runtime degradation vs release eligibility

Preserve distinction:

Optional AI transient outage:
- AI disabled/degraded;
- manual core continues.

Core scanner outage:
- new evidence release blocked.

Core auth/storage/security failure:
- affected operation blocked.

A runtime degraded mode must not retroactively mean the product had incomplete launch controls.

## 14. Final documentation

Update:

- README;
- architecture;
- ADRs;
- environment inventory;
- migrations;
- rollback;
- operator guide;
- admin guide;
- provider registry;
- rule handbook;
- incident runbook;
- recovery runbook;
- erasure runbook;
- support-access runbook;
- known issues;
- supersession map;
- release process.

Remove contradictory stale claims or explicitly mark historical docs superseded.

Do not delete useful historical evidence.

## 15. Handover inventory

Produce complete ownership/handover record covering:

- source code;
- migrations;
- schema;
- CI;
- tests;
- prompts;
- AI evaluations;
- rules;
- evidence taxonomy;
- infrastructure;
- environments;
- storage;
- identity;
- KMS/key service;
- scanner;
- email;
- monitoring;
- provider accounts;
- domains;
- billing;
- export path;
- backup/recovery;
- support process;
- incident contacts.

No critical system should remain dependent on an individual contractor's personal account.

## 16. Definition of done

Commercial V1 is complete only if:

A real external traveller and an approved agency can safely perform:

collect  
→ review  
→ resolve gaps  
→ applicant reviews exact prepared file  
→ acknowledge exact version  
→ export/use file  
→ report external outcome  
→ close case

without a developer,

AND:

- security controls operate;
- tenant isolation proven;
- scanning is real;
- sensitive data protected;
- email real;
- required AI adapters tested;
- rules current;
- exports/deletion work;
- recovery demonstrated;
- system monitored;
- owners/runbooks exist;
- no unresolved Critical/High security defects;
- independent review requirement satisfied.

Anything less must be labelled honestly.

Possible final verdicts:

1. `COMMERCIAL V1 RELEASE ELIGIBLE`
   Only if every mandatory P0 gate is passed.

2. `CODE COMPLETE — COMMERCIAL LAUNCH BLOCKED`
   Use when software implementation is substantially complete but external review, credentials, content/legal/privacy, recovery or operational evidence is missing.

3. `IMPLEMENTATION INCOMPLETE`
   Use when mandatory product/security functionality or tests still fail.

Never use:
“basically ready,”
“99% complete,”
“production grade”
without gate evidence.

## 17. Do not merge/deploy production without authorization

At the end:

DO NOT:
- merge to main;
- merge/close PR #77;
- deploy real production;
- enable real customer documents;
- flip commercial admission;
- activate billing;
unless explicitly instructed by the user after reviewing the final report.

You may prepare a release-candidate PR if repository policy/user authorization already permits creating one, but do not merge it.

## 18. Final response format

Return exactly this top-level structure:

VISAStack COMMERCIAL V1 — FINAL IMPLEMENTATION VERDICT

VERDICT
- one of the three permitted verdicts

RELEASE CANDIDATE
- branch
- SHA
- deployed verification SHA/environment

P0 REQUIREMENTS
- total
- verified
- blocked
- failed
- not executed

CUSTOMER JOURNEYS
- J01–J15 one line each

ACCEPTANCE TESTS
- A01–A35 one line each

SECURITY
- Critical
- High
- Medium
- Low
- independent review status

INTEGRATIONS
- WorkOS
- storage
- KMS
- scanner
- email
- OpenAI
- Gemini
- Anthropic
- monitoring

RULE PACKS
- pack 1
- pack 2
- golden tests
- content reviewer

RECOVERY
- measured RPO
- measured RTO
- drill evidence

PRIVACY/LEGAL
- completed operational controls
- external approvals still required

PERFORMANCE
- measured results vs targets

EXTERNAL BLOCKERS
- owner
- exact action needed

KNOWN ISSUES

HANDOVER

COMMITS / PR

NEXT THREE ACTIONS
- only the three highest-leverage remaining actions

Then STOP.

Do not silently continue to merge or launch.