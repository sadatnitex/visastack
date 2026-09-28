# VisaStack

Universal, pack-composable visa and immigration platform. Applicants and
verified agencies turn documents into structured, permission-aware profiles
through a governed, AI-assisted workflow - with an equivalent **no-AI manual
path**. Applicants own their data; agencies get exactly the access they are
granted, and every action is authorized, consent-gated, and audited.

> **Status: VisaStack Controlled Pilot - internal and synthetic-data testing
> only.** Not a commercial launch. The repository is mid-way through the
> **VisaStack Commercial V1** implementation programme
> ([`docs/roadmap/commercial-v1-implementation-directive.md`](docs/roadmap/commercial-v1-implementation-directive.md),
> 10 parts): **Parts 1-7 are complete** (authority/traceability, data model,
> evidence vault, missions/packs/sharing, billing/notifications/admin, the
> rules engine and public trust, applicant truth-check and retention/erasure).
> **Part 8 (multi-provider AI gateway, admin control, OCR, budgets) is in
> progress.** Parts 9-10 (UX/i18n/accessibility/monitoring completeness, and
> the full release gate) have not started. The governing product contract is
> [`docs/product/commercial-v1-prd-2026-09-16.md`](docs/product/commercial-v1-prd-2026-09-16.md)
> plus the Build Specification; a feature is not "complete" until it is
> verified end-to-end, not merely built. For the live, per-requirement
> status and every implementation decision's own reasoning, see
> [`docs/commercial-v1/requirements-ledger.md`](docs/commercial-v1/requirements-ledger.md)
> and
> [`docs/commercial-v1/known-issues.md`](docs/commercial-v1/known-issues.md) -
> both are updated in the same PR as the work they describe, so they never
> go stale the way a snapshot in this README would. The pre-Commercial-V1
> audits below remain as point-in-time snapshots each was written from - see
> the superseded notice at the top of each:
> [`docs/audits/final-programme-verdict.md`](docs/audits/final-programme-verdict.md),
> [`docs/audits/post-programme-defect-register.md`](docs/audits/post-programme-defect-register.md),
> [`docs/audits/current-product-baseline.md`](docs/audits/current-product-baseline.md),
> [`docs/audits/commercial-readiness-recovery-baseline.md`](docs/audits/commercial-readiness-recovery-baseline.md).
>
> **Status legend used throughout this README and the linked audits:**
> **Implemented** (built, not yet independently verified) ·
> **Pilot verified** (exercised against the real controlled-pilot
> deployment) · **Provider-unconfigured** (built, waiting on a credential/
> provider that isn't provisioned) · **Commercial blocker** (must be closed
> before commercial mode can activate) ·
> **Commercially verified** (not yet true for anything in this repository).

## What's implemented

> These describe implemented **domain/service** guarantees. "Implemented" is not
> the same as "verified end-to-end through the UI in production," and not the
> same as "wired into every live call site" - see the requirements ledger for
> the precise, current status of each item.

| Area | Capability |
| --- | --- |
| **Applicant Core** | Accounts, six separately-revocable consent purposes (core processing / AI extraction / AI OCR / sharing / marketing / issuer contact), applicant + family + guarded-minor records, and a Master Profile whose every value is an immutable, atomically-approved `FactVersion` (no silent mutation). Full account data export (JSON/CSV) and consent-gated, legal-hold-aware deletion. |
| **Document Vault** | Private storage keyed by opaque object IDs (never the filename); permission-aware access with step-up before original bytes are released. `VercelPrivateBlobStorage` is the active production backend when `BLOB_READ_WRITE_TOKEN` is configured; `NeonBlobStorage` (bytea in Postgres, reduced-control) is the local dev/test/PR-preview fallback only. Malware scanning is a real `ScannerPort`: the built-in structural scanner by default, or a real ClamAV adapter (`packages/adapters/src/clamav-scanner.ts`) when `MALWARE_SCANNER_PROVIDER=clamav` is configured - the same "implemented and wired, provider-selectable" pattern the AI Gateway uses. |
| **Document Intelligence / AI Gateway** | Deterministic passport-MRZ (TD3) parsing, embedded PDF/DOCX/TXT/MD text extraction, and rules-based document classification run first and always. A provider-agnostic `AiExtractionPort` behind an **admin-managed, DB-backed configuration console** (`/app/admin/ai-settings`) now has real adapters for **OpenAI, Anthropic, and Google Gemini** - every configuration is an immutable, versioned snapshot (DRAFT → ACTIVE → SUPERSEDED/DISABLED) with an encrypted API key, a reviewed-data-policy attestation, durable per-document/platform cost budgets, a kill switch, a synthetic connection test, and a 13-case evaluation harness run before activation. A separate `AiOcrPort` (its own consent purpose, its own privacy posture - raw image bytes, not text) has a baseline OpenAI adapter, a "Run OCR" trigger on the document page, and review-issue display (low quality / ambiguous date / unsupported script / missing text); it shares the same platform-wide budget ledger as text extraction and its own attempt cap. Anthropic/Gemini OCR adapters are the one piece of this row not yet built. The AI Gateway only ever **proposes** fields - a human approves, nothing is written silently. |
| **Missions & Packs** | Cited, versioned, checksummed requirement packs (Pack Studio); parallel mission workspaces; a rules engine driving readiness as **completeness only** (never an approval probability); reviewer state machine; immutable, checksummed snapshots. |
| **Agencies & Sharing** | Organization verification (no self-upgrade); scoped, accepted, time-limited, revocable grants; access transparency; agency case collaboration (assignments, notes, evidence requests) and bulk export. |
| **Public Trust & Content Governance** | Publish-reviewed, source-cited pack routes for unauthenticated public lookup, with staleness handling (fee amounts auto-removed once a review is overdue). |
| **Billing & Notifications** | Plans, invoices, scheduled downgrades, real outbound email (Resend, with webhook-driven delivery status), a notification sweep pipeline, and a platform admin console over all of it. |
| **Applicant Trust & Lifecycle** | Truth-check attestations, acknowledgements, case state transitions, retention policies with eligibility-based purge, legal holds that **override deletion**, and a durable erasure outbox with lease-based recovery. |
| **Reliability** | Liveness + readiness probes; English/Bangla i18n; incident runbook + RPO/RTO/restore-drill docs; a tamper-evident, hash-chained audit log on every mutation. |

## Principles (enforced, not aspirational)

- **Default-deny permissions.** The policy engine is the authoritative decision
  point; membership never implies access, and denials are audited.
- **Fail-closed, tamper-evident audit.** Every mutation and its SHA-256
  hash-chained audit event commit together; database `RULE`s make the log
  append-only.
- **No silent mutation.** Record changes are explicit, immutable, versioned, and
  atomically approved - the AI path proposes; a human approves.
- **Provider-agnostic ports.** Storage, scanning, and AI sit behind interfaces;
  infrastructure is swapped - including which AI provider is active - never
  the domain. AI credentials are encrypted at rest and rotated through a
  versioned admin console, never edited in place.
- **Remote-first.** No required local setup - GitHub for source/CI, Vercel for
  hosting, Neon for data. See [ADR-0002](docs/adr/0002-remote-first-delivery.md).

## Repository layout

```
visastack/
├── apps/
│   └── web/              # Next.js App Router app (UI + API routes) on Vercel
├── packages/
│   ├── core/             # Universal Core - framework-agnostic domain vocab, Result, brands
│   ├── db/                # Drizzle schema + migrations, audit hashing, Neon client
│   ├── policy/            # Default-deny authorization engine
│   ├── services/          # Application services (the write side; transactional, audited)
│   ├── adapters/          # Concrete infra: blob storage, ClamAV/structural scanning,
│   │                       #   multi-provider AI extraction + OCR, evaluation harness, email, payments
│   └── i18n/               # English/Bangla message catalog + typed translator
├── docs/
│   ├── adr/                # Architecture Decision Records (point-in-time; never edited retroactively)
│   ├── architecture/       # Data model, permission model, pipeline, AI gateway
│   ├── commercial-v1/      # Living trackers: requirements ledger + known issues (Commercial V1)
│   ├── governance/         # Delivery, branch protection, Vercel/service wiring
│   ├── operations/         # Incident runbook, RPO/RTO & restore drill
│   ├── product/            # PRD (3-page + Commercial V1) + Build Spec
│   ├── roadmap/            # Commercial V1 implementation directive + original phased plan
│   ├── security/           # Threat model + boundary/enforcement/test maps
│   └── audits/              # Point-in-time audit snapshots (each superseded-flagged)
└── .github/                 # CI (lint · build · typecheck · test), CodeQL, governance
```

## Architecture in one paragraph

The **Universal Core** holds framework-agnostic domain primitives. The **db**
package is the only canonical writable store (Neon Postgres) via Drizzle, with a
tamper-evident audit chain. The **policy** engine renders explicit allow/deny
decisions. The **services** layer is the transactional write side: every
operation is policy-authorized, consent-gated where required, and audited
atomically - it accepts a transaction-capable `Db` handle and never constructs a
client (see [ADR-0009](docs/adr/0009-service-layer-transactional-driver.md)).
The **adapters** package supplies concrete infrastructure behind the service
ports: blob storage (Vercel/Neon), malware scanning (structural/ClamAV), and
the multi-provider AI Gateway (OpenAI/Anthropic/Gemini extraction, OpenAI OCR)
- each swappable without a domain change
([ADR-0011](docs/adr/0011-neon-bytea-storage-and-structural-scanner.md)). The
**web** app renders the UI, hosts API routes (health probes, signed blob
serving, background job sweeps), and includes the platform admin console
(AI provider configuration, organizations, packs, complaints).

## Ports & adapters (how to make it stronger)

Everything external is injected behind an interface, so upgrades are edge-only:

| Port | Pilot default | Local dev/test/PR-preview fallback | Real swap-in, already in-repo |
| --- | --- | --- | --- |
| `StoragePort` / `BlobStore` | `VercelPrivateBlobStorage` (real private access, signed `/api/blob/[key]` serving) - active when `BLOB_READ_WRITE_TOKEN` is set | `NeonBlobStorage` (bytea in Postgres) - reduced-control; a real deployment without the token fails closed instead of using this | An S3-compatible provider, for customer-managed keys/region requirements |
| `ScannerPort` / `MalwareScannerPort` | `BasicSafetyScanner` (magic-byte allow-list + size limits) - **structural validation only, not antivirus** | same | `ClamAvScanner` - a real malware-scanning engine, selected via `MALWARE_SCANNER_PROVIDER=clamav` |
| `AiExtractionPort` | Admin-selected, DB-configured `OpenAiExtractionAdapter` / `AnthropicExtractionAdapter` / `GeminiExtractionAdapter` - versioned, encrypted, budget- and kill-switch-governed | *(manual path - no AI required; the app is fully usable without it)* | Another model provider, behind the same port |
| `AiOcrPort` | `OpenAiOcrAdapter` - wired to a manual "Run OCR" trigger on the document page, sharing text extraction's budget ledger | *(manual path - no OCR required)* | Anthropic/Gemini OCR adapters (tracked in `known-issues.md`) |

The built-in scanner is an **accepted, documented reduced control** when
ClamAV isn't configured - it is not antivirus; it is paired with the human-
approval gate. See ADR-0011.

## Deployment modes and the capability registry

VisaStack runs from one codebase in three modes - `development`,
`controlled_pilot`, `commercial` - never a separate codebase per mode. The
current deployment is `controlled_pilot`. A server-authoritative capability
registry (`packages/core/src/deployment-mode.ts`,
`apps/web/src/lib/capabilities.ts`) reports the real, current state
(`available` / `degraded` / `disabled` / `unconfigured`) of every
user-facing capability - the client never decides this. `GET
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
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob private storage | production document storage (falls back to Neon-bytea when unset, non-production only) |
| `BLOB_SIGNING_SECRET` | HMAC secret for signed blob URLs | document serving via the Neon-bytea fallback |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` / `WORKOS_COOKIE_PASSWORD` | WorkOS AuthKit | the login flow |
| `MALWARE_SCANNER_PROVIDER` (+ `CLAMAV_SOCKET_PATH` or `CLAMAV_HOST`/`CLAMAV_PORT`) | Selects `builtin` (default) or `clamav` | real malware scanning |
| `AI_ENABLED`, `OPENAI_API_KEY` (+ `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` once those adapters are selected) | Env-based AI Gateway fallback | only the initial bootstrap before any admin-console AI provider configuration exists - once one is `ACTIVE`, the DB-backed, encrypted config in `/app/admin/ai-settings` is authoritative and these are ignored |

Migrations run automatically at build time on Vercel (`pnpm --filter
@visastack/db db:migrate && next build`).

## Quickstart

```bash
pnpm install
pnpm run check          # lint + typecheck + test - 1,570+ tests, in-memory PGlite, no DB needed
pnpm run build          # build the workspace
```

Requires Node 22 (`.nvmrc`) and pnpm 10+. Tests run migrations against an
in-memory Postgres (PGlite), so correctness - FK/enum/unique constraints, the
append-only audit rules, and every service invariant - is proven in CI with zero
external dependencies. CI (`.github/workflows/ci.yml`) runs lint, build,
typecheck, and the full test suite as one required check; a 60-minute ceiling
tracks the suite's own growth (see the in-file history comment).

## Web app

- `/` - product landing (Apple-HIG design system: system font stack, light/dark,
  accessible, responsive), with a global controlled-pilot banner stating the
  current deployment mode on every page.
- `/app` - the authenticated workspace (applicants, missions, documents,
  sharing, privacy/consent, notifications); `/app/admin/*` is the platform
  admin console (AI provider configuration, organizations, packs, complaints).
- `/status` - live system status, polling the real health probes.
- `/api/health/live`, `/api/health/ready` - liveness / readiness; readiness
  always reports the current deployment mode and full capability registry.
- `/api/blob/[key]` - signed, expiring blob serving (returns `503` until
  storage is configured).
- `/api/jobs/*` - background sweep endpoints (notifications, downgrades,
  retention, erasure, exports, intake) for the platform's scheduler to call.

## Documentation

- **Commercial V1 (current programme):**
  [Implementation directive](docs/roadmap/commercial-v1-implementation-directive.md) ·
  [Requirements ledger](docs/commercial-v1/requirements-ledger.md) ·
  [Known issues](docs/commercial-v1/known-issues.md) ·
  [Commercial V1 PRD](docs/product/commercial-v1-prd-2026-09-16.md)
- [Architecture overview](docs/architecture/overview.md) ·
  [Data model](docs/architecture/data-model.md) ·
  [Permission model](docs/architecture/permission-model.md) ·
  [AI Gateway](docs/architecture/ai-gateway.md)
- [Original phased delivery plan](docs/roadmap/phase-plan.md) ·
  [Acceptance criteria](docs/roadmap/acceptance-criteria.md)
- [Operations runbook](docs/operations/runbook.md) ·
  [Recovery: RPO/RTO & restore drill](docs/operations/recovery.md)
- [Threat model](docs/security/threat-model.md)
- [Architecture Decision Records](docs/adr/) ·
  [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License

Proprietary and confidential. All rights reserved.
