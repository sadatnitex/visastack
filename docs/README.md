# VisaStack Documentation

This directory is the engineering source of truth. It is versioned with the
code so that every decision, boundary, and plan is reviewable in the same PR
that changes behavior.

## Map

| Area | Path | Purpose |
|------|------|---------|
| **Commercial V1 (current programme)** | [`commercial-v1/requirements-ledger.md`](commercial-v1/requirements-ledger.md) | Living, per-requirement status (DONE/IN_PROGRESS/NOT_STARTED/BLOCKED) with every implementation decision's own reasoning. Updated in the same PR as the work it describes. |
| - Known issues | [`commercial-v1/known-issues.md`](commercial-v1/known-issues.md) | Living log of every gap, defect, and deliberate deferral found during the Commercial V1 build, in narrative form. |
| - Directive | [`../roadmap/commercial-v1-implementation-directive.md`](../roadmap/commercial-v1-implementation-directive.md) | The 10-part implementation programme this repository is currently executing. |
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
| - Identity & step-up | [`security/identity-and-step-up-boundary.md`](security/identity-and-step-up-boundary.md) | WorkOS identity binding, platform-role administration, step-up/reauthentication → enforcement → test map (living). |
| - Durable jobs & upload integrity | [`security/durable-jobs-and-upload-integrity-boundary.md`](security/durable-jobs-and-upload-integrity-boundary.md) | Job leases/uniqueness, processing idempotency, upload consistency, free-tier controls → enforcement → test map (living). |
| Roadmap | [`roadmap/phase-plan.md`](roadmap/phase-plan.md) | Delivery sequence (Build Spec §20). |
| - Acceptance | [`roadmap/acceptance-criteria.md`](roadmap/acceptance-criteria.md) | Release gates (Build Spec §19). |
| Governance | [`governance/`](governance/) | Branch protection, delivery process, Vercel. |

## Authority

The current governing product contract is
[`product/commercial-v1-prd-2026-09-16.md`](product/commercial-v1-prd-2026-09-16.md),
executed through
[`../roadmap/commercial-v1-implementation-directive.md`](../roadmap/commercial-v1-implementation-directive.md).
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
