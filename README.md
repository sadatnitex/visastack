# VisaStack

Universal, pack-composable visa and immigration platform. Applicants and
verified agencies turn documents into structured, permission-aware profiles
through a governed, AI-assisted workflow — with an equivalent **no-AI manual
path**. Applicants own their data; agencies get exactly the access they are
granted, and every action is authorized, consent-gated, and audited.

> **Status: VisaStack Controlled Pilot — internal and synthetic-data testing
> only.** Not a commercial launch. WorkOS login and the authenticated
> workspace are verified on Vercel + Neon; document classification, automatic
> naming, and an OpenAI-backed extraction adapter are implemented and wired
> (off by default — see the capability registry below). Real malware
> scanning, step-up authentication, and generated redacted renditions are
> **not** complete, and agency collaboration and bulk export are currently
> gated off pending an authorization hardening pass — see the deployment-mode
> and capability-registry section below. Stronger backends (a real scanner,
> step-up auth) drop in behind stable ports with no domain change. For the
> honest, capability-by-capability breakdown with evidence, see
> [`docs/audits/current-product-baseline.md`](docs/audits/current-product-baseline.md)
> and
> [`docs/audits/commercial-readiness-recovery-baseline.md`](docs/audits/commercial-readiness-recovery-baseline.md).
> The product contract is the 3-page PRD plus the Build Specification; a
> feature is not "complete" until it is verified end-to-end, not merely
> built.
>
> **Status legend used throughout this README and the linked audits:**
> **Implemented** (built, not yet independently verified) ·
> **Pilot verified** (exercised against the real controlled-pilot
> deployment) · **Provider-unconfigured** (built, waiting on a credential/
> provider that isn't provisioned) · **Commercial blocker** (must be closed
> before commercial mode can activate — see §22 of the governing directive) ·
> **Commercially verified** (not yet true for anything in this repository).

## What's implemented

> These describe implemented **domain/service** guarantees. "Implemented" is not
> the same as "verified end-to-end through the UI in production" — see the
> baseline audit for the precise label on each capability.

| Area | Capability |
| --- | --- |
| **Applicant Core** | Accounts, separated consent (core / AI / sharing / marketing), applicant + family + guarded-minor records, and a Master Profile whose every value is an immutable, atomically-approved `FactVersion` (no silent mutation). Account export + deletion. |
| **Document Vault** | Private storage keyed by opaque object IDs (never the filename); permission-aware access with step-up before original bytes are released. `VercelPrivateBlobStorage` is the active production backend when `BLOB_READ_WRITE_TOKEN` is configured (it is, on the current deployment); `NeonBlobStorage` (bytea in Postgres, reduced-control) is the local dev/test/PR-preview fallback only — production now fails closed rather than silently degrading to it. *Preview is owner-only clean-original until real redacted renditions ship; third-party preview is fail-closed.* |
| **Document Intelligence** | Deterministic passport-MRZ (TD3) parsing, embedded PDF/DOCX/TXT/MD text extraction, and rules-based document classification are implemented and wired into the upload pipeline. An `AiExtractionPort` adapter for the OpenAI Responses API is implemented and wired, gated behind `AI_ENABLED`/`OPENAI_API_KEY` (off on the current deployment — a deliberate "shipped but off" state, not a stub). Real OCR/image-text extraction is not yet implemented. When enabled, the AI Gateway only **proposes** fields — a human approves, nothing is written silently. |
| **Missions & Packs** | Cited, versioned, checksummed requirement packs (Pack Studio); parallel mission workspaces; readiness as **completeness only** (never an approval probability); reviewer state machine; immutable, checksummed snapshots. |
| **Agencies & Sharing** | Organization verification (no self-upgrade); scoped, accepted, time-limited, revocable grants; access transparency. *Agency case collaboration (assignments, notes, evidence requests, membership changes) and bulk export are currently gated `disabled` in the capability registry pending an authorization hardening pass — see [`docs/audits/commercial-readiness-recovery-baseline.md`](docs/audits/commercial-readiness-recovery-baseline.md)§7/§12. Direct individual-to-individual sharing is unaffected.* |
| **Retention & legal hold** | Retention policies with eligibility-based purge; legal holds that **override deletion**. |
| **Reliability** | Liveness + readiness probes; English/Bangla i18n; incident runbook + RPO/RTO/restore-drill docs. |

## Principles (enforced, not aspirational)

- **Default-deny permissions.** The policy engine is the authoritative decision
  point; membership never implies access, and denials are audited.
- **Fail-closed, tamper-evident audit.** Every mutation and its SHA-256
  hash-chained audit event commit together; database `RULE`s make the log
  append-only.
- **No silent mutation.** Record changes are explicit, immutable, versioned, and
  atomically approved — the AI path proposes; a human approves.
- **Provider-agnostic ports.** Storage, scanning, and AI sit behind interfaces;
  infrastructure is swapped, never the domain.
- **Remote-first.** No required local setup — GitHub for source/CI, Vercel for
  hosting, Neon for data. See [ADR-0002](docs/adr/0002-remote-first-delivery.md).

## Repository layout

```
visastack/
├── apps/
│   └── web/              # Next.js App Router app (UI + API routes) on Vercel
├── packages/
│   ├── core/             # Universal Core — framework-agnostic domain vocab, Result, brands
│   ├── db/               # Drizzle schema + migrations, audit hashing, Neon client
│   ├── policy/           # Default-deny authorization engine
│   ├── services/         # Application services (the write side; transactional, audited)
│   ├── adapters/         # Concrete infra adapters: Neon-bytea storage, structural scanner
│   └── i18n/             # English/Bangla message catalog + typed translator
├── docs/
│   ├── adr/              # Architecture Decision Records (0001–0011)
│   ├── architecture/     # Data model, permission model, pipeline, AI gateway
│   ├── governance/       # Delivery, branch protection, Vercel/service wiring
│   ├── operations/       # Incident runbook, RPO/RTO & restore drill
│   ├── roadmap/          # Phased delivery plan + acceptance criteria
│   ├── security/         # Threat model
│   └── product/          # PRD v1.1 + Build Spec v1.1
└── .github/              # CI (lint · build · typecheck · test + prod audit), governance
```

## Architecture in one paragraph

The **Universal Core** holds framework-agnostic domain primitives. The **db**
package is the only canonical writable store (Neon Postgres) via Drizzle, with a
tamper-evident audit chain. The **policy** engine renders explicit allow/deny
decisions. The **services** layer is the transactional write side: every
operation is policy-authorized, consent-gated where required, and audited
atomically — it accepts a transaction-capable `Db` handle and never constructs a
client (see [ADR-0009](docs/adr/0009-service-layer-transactional-driver.md)).
The **adapters** package supplies concrete infrastructure behind the service
ports; today `NeonBlobStorage` (bytes in Postgres) and `BasicSafetyScanner`
(structural validation) — swappable for S3+KMS / ClamAV
([ADR-0011](docs/adr/0011-neon-bytea-storage-and-structural-scanner.md)). The
**web** app renders the UI and hosts API routes (health probes, signed blob
serving).

## Ports & adapters (how to make it stronger)

Everything external is injected behind an interface, so upgrades are edge-only:

| Port | Pilot default | Local dev/test/PR-preview fallback | Future/enterprise swap-in |
| --- | --- | --- | --- |
| `StoragePort` / `BlobStore` | `VercelPrivateBlobStorage` (real private access, signed `/api/blob/[key]` serving) — active when `BLOB_READ_WRITE_TOKEN` is set | `NeonBlobStorage` (bytea in Postgres) — reduced-control; a real deployment without the token fails closed instead of using this | An S3-compatible provider, for customer-managed keys/region requirements — not required by default |
| `ScannerPort` | `BasicSafetyScanner` (magic-byte allow-list + size limits) — **structural validation only, not antivirus** | same | ClamAV or another real malware scanner (commercial-mode requirement) |
| `AiExtractionPort` | `OpenAiExtractionAdapter` (OpenAI Responses API) — implemented, gated behind `AI_ENABLED`/`OPENAI_API_KEY` | *(manual path — no AI required; the app is fully usable without it)* | Another model provider, behind the same port |

The built-in scanner is an **accepted, documented reduced control** — it is not
antivirus; it is paired with the human-approval gate. See ADR-0011.

## Deployment modes and the capability registry

VisaStack runs from one codebase in three modes — `development`,
`controlled_pilot`, `commercial` — never a separate codebase per mode. The
current deployment is `controlled_pilot`. A server-authoritative capability
registry (`packages/core/src/deployment-mode.ts`,
`apps/web/src/lib/capabilities.ts`) reports the real, current state
(`available` / `degraded` / `disabled` / `unconfigured`) of every
user-facing capability — the client never decides this. `GET
/api/health/ready` always includes the current `deploymentMode` and the full
registry, so it's independently checkable, not merely a written claim. Full
rationale and the exact controlled-pilot values:
[`docs/audits/commercial-readiness-recovery-baseline.md`](docs/audits/commercial-readiness-recovery-baseline.md)§12
· governing directive:
[`docs/roadmap/commercial-recovery-completion-ux-directive.md`](docs/roadmap/commercial-recovery-completion-ux-directive.md).

## Environment variables

Set these in Vercel (Production + Preview). The app reports *presence*, never
values, on `/api/health/ready`.

| Variable | Purpose | Required for |
| --- | --- | --- |
| `DATABASE_URL` (or `POSTGRES_URL`, …) | Neon connection string | database + migrations |
| `BLOB_SIGNING_SECRET` | HMAC secret for signed blob URLs | document serving via Neon-bytea |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` / `WORKOS_COOKIE_PASSWORD` | WorkOS AuthKit | the login flow (when wired) |

Migrations run automatically at build time on Vercel (`pnpm --filter
@visastack/db db:migrate && next build`).

## Quickstart

```bash
pnpm install
pnpm run check          # lint + typecheck + test (296 tests, in-memory PGlite — no DB needed)
pnpm run build          # build the workspace
```

Requires Node 22 (`.nvmrc`) and pnpm 10+. Tests run migrations against an
in-memory Postgres (PGlite), so correctness — FK/enum/unique constraints, the
append-only audit rules, and every service invariant — is proven in CI with zero
external dependencies.

## Web app

- `/` — product landing (Apple-HIG design system: system font stack, light/dark,
  accessible, responsive), with a global controlled-pilot banner stating the
  current deployment mode on every page.
- `/status` — live system status, polling the real health probes.
- `/api/health/live`, `/api/health/ready` — liveness / readiness; readiness
  always reports the current deployment mode and full capability registry.
- `/api/blob/[key]` — signed, expiring blob serving (returns `503` until
  `BLOB_SIGNING_SECRET` is set).

## Documentation

- [Architecture overview](docs/architecture/overview.md) ·
  [Data model](docs/architecture/data-model.md) ·
  [Permission model](docs/architecture/permission-model.md)
- [Phased delivery plan](docs/roadmap/phase-plan.md) ·
  [Acceptance criteria](docs/roadmap/acceptance-criteria.md)
- [Operations runbook](docs/operations/runbook.md) ·
  [Recovery: RPO/RTO & restore drill](docs/operations/recovery.md)
- [Threat model](docs/security/threat-model.md)
- [Architecture Decision Records](docs/adr/) ·
  [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License

Proprietary and confidential. All rights reserved.
