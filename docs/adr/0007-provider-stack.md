# ADR-0007: Provider stack for persistence, storage, pipeline, and AI

- **Status:** Proposed (per-provider ADRs to be Accepted at each phase)
- **Date:** 2026-07-19
- **Deciders:** VisaStack engineering

## Context

Several PRD requirements exceed Vercel's built-in primitives: durable
malware quarantine, point-in-time recovery for RPO/RTO, an AI gateway with
caching/cost/eval controls, and a recoverable multi-state document
pipeline. We need to choose best-of-breed, Vercel-compatible services and
keep each behind a swappable package seam.

## Decision (proposed)

| Concern | Choice | Package seam | Accept at |
|---------|--------|--------------|-----------|
| Relational DB (with PITR) | **Neon Postgres** (serverless, branch-per-PR) | `@visastack/db` | Phase 1 |
| ORM / migrations | **Drizzle** (type-safe, migration-first) | `@visastack/db` | Phase 1 |
| Object storage + quarantine | **Cloudflare R2 / S3** (separate quarantine & clean buckets) | `@visastack/storage` | Phase 3 |
| Malware scanning | AV scan step (e.g. ClamAV worker / scanning API) | `@visastack/pipeline` | Phase 3 |
| Durable pipeline | **Inngest** (retries, state machine, recoverable steps) | `@visastack/pipeline` | Phase 3 |
| AI gateway | **Vercel AI Gateway** fronting GPT-5.6 Terra (caching, cost caps, eval, outage handling) | `@visastack/ai-gateway` | Phase 4 |
| Secrets / KMS | Vercel env + **AWS KMS / Infisical** (envelope encryption, rotation) | `@visastack/crypto` | Phase 1+ |
| Observability | **Sentry** + OpenTelemetry + fail-closed audit log | `@visastack/observability` | Phase 6 |

Each provider is wrapped behind its package's interface. Application and
domain code never import a vendor SDK directly.

## Consequences

- **Positive:** every capability the PRD needs has a concrete, compatible
  home; providers are swappable; PR previews get isolated DB branches.
- **Trade-offs:** several external accounts and their costs/keys; each is
  a supply-chain and availability dependency to monitor.
- **Follow-ups:** promote each row to its own Accepted ADR when its phase
  begins, with the integration details and the fallback/outage plan.

## Alternatives considered

- **Supabase all-in-one** (DB + storage + auth) — fewer vendors and lower
  cost, but weaker fit for the org/verification and step-up auth model
  (see ADR-0006) and less control over the quarantine pipeline.
- **Vercel Blob only** for documents — lacks the quarantine/scan
  separation the PRD requires; rejected for document storage.
