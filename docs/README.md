# VisaStack Documentation

This directory is the engineering source of truth. It is versioned with the
code so that every decision, boundary, and plan is reviewable in the same PR
that changes behavior.

## Current public-beta work

Start with [current operating guidance](operations/current-platform.md), [public-beta contract](public-beta/PRODUCT-CONTRACT.md), [deployment actions](public-beta/DEPLOYMENT-ACTIONS.md) and [release acceptance](public-beta/RELEASE-ACCEPTANCE-CHECKPOINT.md). Earlier Commercial V1 records and ADRs remain evidence and requirements, rather than current provider-setup instructions. See [the communications and documentation register](public-beta/DOCUMENTATION-COMMUNICATIONS-REGISTER.md).

## Current work (updated 26 October 2026)

Programme X (interface upgrade plus the v1.2 functional spec) is the active programme. Start with [its status](upgrades/programme/STATUS.md), then [the latest session handoff](upgrades/programme/SESSION-HANDOFF-2026-10-25-evening.md), the [programme contract](upgrades/programme/PROGRAMME.md) and [work packages](upgrades/programme/WORK-PACKAGES.md). Each package may edit only the files on its allowlist (`upgrades/programme/allowlists/`). Evidence goes in [the coverage ledger](upgrades/programme/COVERAGE-LEDGER.csv) and [the known-issues log](commercial-v1/known-issues.md).

## Map

| Area | Path | Purpose |
|------|------|---------|
| **Commercial V1 requirements and history** | [`commercial-v1/requirements-ledger.md`](commercial-v1/requirements-ledger.md) | Living, per-requirement status (DONE/IN_PROGRESS/NOT_STARTED/BLOCKED) with every implementation decision's own reasoning. Updated in the same PR as the work it describes. |
| - Known issues | [`commercial-v1/known-issues.md`](commercial-v1/known-issues.md) | Living log of every gap, defect, and deliberate deferral found during the Commercial V1 build, in narrative form. |
| - Directive | [`../roadmap/commercial-v1-implementation-directive.md`](roadmap/commercial-v1-implementation-directive.md) | The preserved 10-part implementation programme; public-beta continuation is linked above. |
| - Baseline | [`commercial-v1/baseline.md`](commercial-v1/baseline.md) | Part 1's point-in-time snapshot: governing directive/PRD receipt and hash verification, repository state at programme start. |
| - Architecture decisions | [`commercial-v1/architecture-decisions.md`](commercial-v1/architecture-decisions.md) | Commercial-V1-specific decisions, in the style of `adr/`; extends the standing ADRs rather than replacing them. |
| - Assumptions & blockers | [`commercial-v1/assumptions-and-blockers.md`](commercial-v1/assumptions-and-blockers.md) | Tracked programme-level assumptions and blockers (each marked resolved or open, never silently dropped). |
| - Threat model | [`commercial-v1/threat-model.md`](commercial-v1/threat-model.md) | Commercial-V1-scoped trust boundaries and threat analysis; companion to `asvs-l2-map.md`. |
| - ASVS L2 map | [`commercial-v1/asvs-l2-map.md`](commercial-v1/asvs-l2-map.md) | OWASP ASVS 5.0 Level 2 control map: a verification target and progress map, not a certification claim. |
| - Privacy data map | [`commercial-v1/privacy-data-map.md`](commercial-v1/privacy-data-map.md) | What personal data is held, why, and for how long (PRV-01); items needing legal counsel are marked BLOCKED, never guessed. |
| - Cost & vendor register | [`commercial-v1/cost-and-vendor-register.md`](commercial-v1/cost-and-vendor-register.md) | Every external vendor/API this programme adds or changes: pricing, region, data terms. |
| - Test evidence | [`commercial-v1/test-evidence.md`](commercial-v1/test-evidence.md) | Exact commands, commit, environment, and pass/fail status for every quality-gate run this programme has executed. |
| - Supersession map | [`commercial-v1/supersession-map.md`](commercial-v1/supersession-map.md) | Directive lineage: which prior engagement briefs/directives this programme supersedes, and what stands as completed history. |
| - Release gate | [`commercial-v1/release-gate.md`](commercial-v1/release-gate.md) | The Part 10 release-eligibility record; populated only once the programme reaches a verdict. Currently not eligible. |
| **Programme X** | [`upgrades/programme/`](upgrades/programme/) | Status (overwritten each package), work packages, allowlists, coverage ledger, route map and session handoffs. |
| - Functional spec | [`upgrades/upgrade.v1.2.execution.md`](upgrades/upgrade.v1.2.execution.md) | The v1.2 requirements (U, E, B, T and R ids) the packages implement. |
| **Current product state** | [`public-beta/CURRENT-STATE.md`](public-beta/CURRENT-STATE.md) | What is deployed, what has evidence and what acceptance is open. |
| **Legal drafts for the owner** | [`legal/`](legal/) | AI processing review and a privacy-notice AI section draft. Reviews, not legal advice; no compliance claims. |
| **Runbooks** | [`operations/runbooks/`](operations/runbooks/) | Step-by-step operating procedures (switching AI providers). |
| Decisions | [`adr/`](adr/) | Architecture Decision Records - why we chose what we chose. |
| Architecture | [`architecture/overview.md`](architecture/overview.md) | System context, layering, boundaries. |
| - Data model | [`architecture/data-model.md`](architecture/data-model.md) | Canonical entities, fact/snapshot immutability. |
| - Permissions | [`architecture/permission-model.md`](architecture/permission-model.md) | Actions, laws, enforcement sequence. |
| - Doc pipeline | [`architecture/document-pipeline.md`](architecture/document-pipeline.md) | Intake state machine + safety. |
| - AI Gateway | [`architecture/ai-gateway.md`](architecture/ai-gateway.md) | Model governance, output contract, cost. |
| Security | [`security/threat-model.md`](security/threat-model.md) | Threat model + control matrix (living). |
| - Tenant isolation | [`security/tenant-isolation-matrix.md`](security/tenant-isolation-matrix.md) | Cross-tenant boundary → enforcement → test map (living). |
| - Document trust boundary | [`security/document-trust-boundary.md`](security/document-trust-boundary.md) | Upload/scan/serve boundary → enforcement → test map (living). |
| - Erasure & retention | [`security/erasure-and-retention-boundary.md`](security/erasure-and-retention-boundary.md) | Deletion outbox, legal hold, account export boundary → enforcement → test map (living). |
| - Identity & step-up | [`security/identity-and-step-up-boundary.md`](security/identity-and-step-up-boundary.md) | Identity binding, platform-role administration, step-up/reauthentication → enforcement → test map (written for WorkOS; Neon Auth has been the only sign-in system since #237). |
| - Durable jobs & upload integrity | [`security/durable-jobs-and-upload-integrity-boundary.md`](security/durable-jobs-and-upload-integrity-boundary.md) | Job leases/uniqueness, processing idempotency, upload consistency, free-tier controls → enforcement → test map (living). |
| Roadmap | [`roadmap/phase-plan.md`](roadmap/phase-plan.md) | Delivery sequence (Build Spec §20). |
| - Acceptance | [`roadmap/acceptance-criteria.md`](roadmap/acceptance-criteria.md) | Release gates (Build Spec §19). |
| Governance | [`governance/`](governance/) | Branch protection, delivery process, Vercel. |

## Authority

The current governing product contract is
[`product/commercial-v1-prd-2026-09-16.md`](product/commercial-v1-prd-2026-09-16.md),
executed through
[`../roadmap/commercial-v1-implementation-directive.md`](roadmap/commercial-v1-implementation-directive.md).
The original product contract remains in [`product/`](product/) as
retained authority for anything the Commercial V1 PRD doesn't supersede:

1. [`product/prd-v1.1.md`](product/prd-v1.1.md) - the original executive
   product contract (3-page PRD).
2. [`product/build-spec-v1.1.md`](product/build-spec-v1.1.md) - the
   implementation authority (Build Specification).

The full authority order, per the implementation directive: explicit
current user instruction; the Commercial V1 PRD; approved implementation
decisions recorded during this programme (`commercial-v1/requirements-ledger.md`);
retained repository architecture and security invariants; the original PRD
and Build Specification as historical context beneath that. Where this
documentation and those documents disagree, the higher authority wins and
the docs here are corrected. Every feature PR links the clause(s) it
implements.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
