# ADR-0007: Provider stack for persistence, storage, pipeline, and AI

- **Status:** Accepted — mandated by the Build Specification §15 and PRD §16.
- **Date:** 2026-07-19
- **Deciders:** VisaStack engineering
- **Spec link:** Build Spec §15 (Production architecture baseline), PRD §16.

## Context

Several requirements exceed Vercel's built-in primitives: durable malware
quarantine, point-in-time recovery for RPO/RTO, a server-only AI gateway
with cost/eval controls, and a recoverable multi-state document pipeline.
The Build Specification is prescriptive about the production baseline, so
these are not open choices — they are the contract. Each provider is still
wrapped behind a package seam so it can be tested and, if ever necessary,
replaced without touching domain rules (the spec itself requires "storage
and AI adapters prevent vendor lock-in", §16).

## Decision (spec-mandated)

| Concern | Choice (per spec) | Package seam | Phase |
|---------|-------------------|--------------|-------|
| Canonical writable store | **Neon PostgreSQL** — the *only* canonical writable data store; protected production branch; synthetic-only preview branches | `@visastack/db` | 1 (Foundation) |
| ORM / migrations | **Drizzle ORM** — reviewed, reversible migrations | `@visastack/db` | 1 |
| Identity | **WorkOS AuthKit** — users, organizations, passkeys, MFA (see ADR-0006). VisaStack's policy engine stays authoritative for applicant resources | `@visastack/auth` | 1 |
| Authorization | **VisaStack policy engine** — server-authoritative, default-deny, fail-closed audit | `@visastack/policy` | 1 |
| Object storage | **Private AWS S3** — separate quarantine & clean buckets, Block Public Access, KMS, object versioning + lifecycle, one-time presigned upload / short-lived signed download | `@visastack/storage` | 1–3 |
| Encryption / secrets | **AWS KMS** envelope encryption by sensitivity class; secrets in a managed vault, rotated | `@visastack/crypto` | 1+ |
| Durable job pipeline | **AWS SQS + isolated Lambda/container workers** — scan, conversion, OCR, deterministic parse, AI extraction, pack generation; idempotency keys, bounded retries, dead-letter queue | `@visastack/pipeline` | 3 |
| AI gateway | **Server-only, provider-neutral AI Gateway over the OpenAI Responses API** with Structured Outputs; standard model **GPT-5.6 Terra**; model/task/prompt registry, cost ledger, evaluation suite | `@visastack/ai-gateway` | 3 |
| Observability | **Sentry (or equivalent)** + structured logs without document contents; separate append-only audit sink | `@visastack/observability` | 1+ |

Application and domain code never import a vendor SDK directly; each seam
exposes a VisaStack interface.

## Consequences

- **Positive:** the implementation matches the authoritative baseline
  exactly; nothing is guessed; the isolated-worker model keeps risky file
  processing off the interactive request path.
- **Trade-offs:** AWS (S3 + SQS + Lambda + KMS) is operated alongside
  Vercel and Neon — more surface than an all-Vercel stack, but required for
  the quarantine/clean separation, envelope encryption, and durable jobs
  the spec mandates.
- **Follow-ups:** each seam gets its integration + outage/fallback plan
  documented when its phase begins.

## Supersedes

This replaces the earlier *proposed* version of ADR-0007, which had
suggested Cloudflare R2 and Inngest. Those contradicted Build Spec §15
(AWS S3; AWS SQS + Lambda/container workers) and are dropped. The spec is
the authority.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
