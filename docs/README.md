# VisaStack Documentation

This directory is the engineering source of truth. It is versioned with the
code so that every decision, boundary, and plan is reviewable in the same PR
that changes behavior.

## Map

| Area | Path | Purpose |
|------|------|---------|
| Decisions | [`adr/`](adr/) | Architecture Decision Records — why we chose what we chose. |
| Architecture | [`architecture/overview.md`](architecture/overview.md) | System context, layering, boundaries. |
| — Data model | [`architecture/data-model.md`](architecture/data-model.md) | Canonical entities, fact/snapshot immutability. |
| — Permissions | [`architecture/permission-model.md`](architecture/permission-model.md) | Actions, laws, enforcement sequence. |
| — Doc pipeline | [`architecture/document-pipeline.md`](architecture/document-pipeline.md) | Intake state machine + safety. |
| — AI Gateway | [`architecture/ai-gateway.md`](architecture/ai-gateway.md) | Model governance, output contract, cost. |
| Security | [`security/threat-model.md`](security/threat-model.md) | Threat model + control matrix (living). |
| — Tenant isolation | [`security/tenant-isolation-matrix.md`](security/tenant-isolation-matrix.md) | Cross-tenant boundary → enforcement → test map (living). |
| — Document trust boundary | [`security/document-trust-boundary.md`](security/document-trust-boundary.md) | Upload/scan/serve boundary → enforcement → test map (living). |
| — Erasure & retention | [`security/erasure-and-retention-boundary.md`](security/erasure-and-retention-boundary.md) | Deletion outbox, legal hold, account export boundary → enforcement → test map (living). |
| — Identity & step-up | [`security/identity-and-step-up-boundary.md`](security/identity-and-step-up-boundary.md) | WorkOS identity binding, platform-role administration, step-up/reauthentication → enforcement → test map (living). |
| Roadmap | [`roadmap/phase-plan.md`](roadmap/phase-plan.md) | Delivery sequence (Build Spec §20). |
| — Acceptance | [`roadmap/acceptance-criteria.md`](roadmap/acceptance-criteria.md) | Release gates (Build Spec §19). |
| Governance | [`governance/`](governance/) | Branch protection, delivery process, Vercel. |

## Authority

The product contract is imported into [`product/`](product/):

1. [`product/prd-v1.1.md`](product/prd-v1.1.md) — the executive product
   contract (3-page PRD).
2. [`product/build-spec-v1.1.md`](product/build-spec-v1.1.md) — the
   implementation authority (Build Specification).

Where this documentation and those documents disagree, the PRD and Build
Specification win, and the docs here are corrected. Every feature PR links
the clause(s) it implements.
