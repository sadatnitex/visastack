# Phased Delivery Plan

Each phase ends at a **gate**: it does not merge to `main` until its
acceptance criteria pass. A feature is complete only when it satisfies the
3-page PRD, the Build Specification, and its acceptance tests.

## Phase 0 — Foundation ✅ (in progress)

Requirement-independent scaffolding. No product rules invented.

- Monorepo (Turborepo + pnpm), strict TypeScript, `packages/core`.
- `apps/web` (Next.js) with health endpoint and security headers.
- CI (lint → build → typecheck → test), CodeQL, dependency review.
- Governance: CODEOWNERS, PR template, SECURITY, CONTRIBUTING.
- Documentation spine: ADRs, architecture overview, this roadmap.

**Gate:** green CI on the foundation PR; Vercel project connected;
branch protection enabled.

## Phase 1 — Identity, tenancy & permissions skeleton

- `@visastack/auth` (WorkOS): passkeys, MFA, step-up, session revocation.
- `@visastack/db` (Neon + Drizzle): tenancy schema, migrations, PITR.
- Agency/organization model; verification; blocked self-upgrade; strict
  no organization-wide data visibility.
- `@visastack/permissions`: deny-by-default, fail-closed, audited denials.

**Gate:** tenant isolation tests; permission matrix tests; no-prod-data
policy enforced in preview envs.

## Phase 2 — Universal Core, Packs, Pack Studio & snapshots

- Pack schema, versioning, citations, admin approval before publish.
- Pack Studio authoring backend.
- Mission Workspaces with immutable application/pack snapshots.

**Gate:** snapshot immutability tests; governance/approval flow tests.

## Phase 3 — Document pipeline

- `@visastack/storage`: quarantine + clean buckets.
- Malware scan step; `@visastack/pipeline` (Inngest) state machine.
- Complete states with recoverable failures.

**Gate:** every failure path recovers; no clean-bucket write before a
passing scan.

## Phase 4 — AI Gateway, extraction & field proposals

- `@visastack/ai-gateway`: privacy, cost caps, caching, eval, outage
  handling, escalation (GPT-5.6 Terra).
- Extraction into structured profile.
- Field proposals: versioned, deduplicated, **atomically approved** — the
  no-silent-mutation gate.

**Gate:** no-silent-mutation gate passes; eval thresholds met; degraded-AI
path verified.

## Phase 5 — Downloads, exports & data lifecycle

- Permission-aware download interface (preview/original/redacted/pack/
  export rights).
- Consent separation, no-AI manual path, export, deletion, retention,
  legal hold.

**Gate:** permission-aware download tests; deletion/retention/legal-hold
correctness.

## Phase 6 — Reliability, i18n/a11y & release hardening

- Availability, RPO/RTO, restore drill, incident response, graceful
  degradation.
- English/Bangla, WCAG 2.2 AA (axe in CI), low-bandwidth/mobile.
- Full CSP, no sensitive PWA cache, benchmark thresholds.
- External penetration test — the release gate.

**Gate:** restore drill passes; a11y and performance thresholds met;
external pentest cleared; production baseline documented.
