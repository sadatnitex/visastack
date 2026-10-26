# VisaStack

Universal, pack-composable visa and immigration platform. Applicants and
verified agencies turn documents into structured, permission-aware profiles
through a governed, AI-assisted workflow - with an equivalent **no-AI manual
path**. Applicants own their data; agencies get exactly the access they are
granted, and every action is authorized, consent-gated, and audited.

> **Current status (2026-10-26): public beta, free to use at your own risk, running as a controlled pilot with made-up records only. Real applicant data stays switched off.**
> Sign-in is Neon Auth only (WorkOS was retired in #237). Data lives in Neon Postgres (90 migrations applied), files in private Cloudflare R2, application mail goes through Resend and sign-in mail through Neon Auth SMTP. Production deploys from `main` only; pull requests get no preview.
> Start with [current operating guidance](docs/operations/current-platform.md), [the current product state](docs/public-beta/CURRENT-STATE.md), [the product contract](docs/public-beta/PRODUCT-CONTRACT.md) and, for work in progress, [Programme X status](docs/upgrades/programme/STATUS.md) and [the latest session handoff](docs/upgrades/programme/SESSION-HANDOFF-2026-10-25-evening.md). Older dated snapshots below are history, not a current launch verdict.

## Current deployed state

Read [the current product and release state](docs/public-beta/CURRENT-STATE.md) first. It separates what is deployed, what has evidence and what acceptance is still open.

| Area | Current state (26 Oct 2026) | Still open |
| --- | --- | --- |
| Product | Public beta (free, at your own risk) in controlled pilot mode; made-up records only; real applicant data and commercial claims disabled | Public sensitive-data release acceptance and the owner's approval |
| Identity and mail | Neon Auth is the only sign-in system; separate Resend application mail with signed delivery callbacks | Full sign-up, reset and confirmation journeys, physical inbox receipt, staff two-step sign-in acceptance |
| Traveller workspace | Task-first first run; four tabs (Home, Record, Cases, Sharing) with the Record hub; Application Memory and the then-and-now view; profile photos; visa photo sizes from one passport photo | Needs Attention and the reordered Home (WP-V4, being built, not yet live); Prepare Again; request screens |
| Documents and AI | Private R2 storage; AI suggestions saved only after a person approves; AI document kind and name on request; What Your Documents Show; per-provider data terms with a training guard built and switched off | Real malware scanner (readiness reports it unconfigured); real redaction (parked) |
| Agencies and sharing | Agency triage groups, Do Next list and copy-ready follow-up message; "Download Safe Copies" permission (visa photo sizes now, redacted documents later) | Full owner, worker and client lifecycle journeys |
| Platform administration | Document protection switches; AI provider settings with draft, activate, roll back, emergency stop and fallback; provider data terms | Staff two-step sign-in acceptance; measured provider cost and capacity |
| Recovery | Encrypted weekly database backup and an isolated database-only restore | Document, key and lifecycle recovery; key rotation and escrow; the original recovery objectives |
| Release | Each merge is checked on its exact commit before merge and again against production after deployment | The final release-candidate review (Programme X WP-V6) and the owner's release decision |

Existing policies, consent, quarantine, audit and legal holds remain in place. Account confirmation does not transfer records or privileges. Invitation creation does not grant access. A provider delivery status does not prove inbox placement. Registration availability is separate from permission to use real applicant data. Payments and real redaction are parked by the owner. Bangla translation remains deferred.

## What's implemented

> These describe implemented **domain/service** guarantees. "Implemented" is not
> the same as "verified end-to-end through the UI in production," and not the
> same as "wired into every live call site" - see the requirements ledger for
> the precise, current status of each item.

| Area | Capability |
| --- | --- |
| **Applicant Core** | Accounts, six separately-revocable consent purposes (core processing / AI extraction / AI OCR / sharing / marketing / issuer contact), applicant + family + guarded-minor records, and a Master Profile whose every value is an immutable, atomically-approved `FactVersion` (no silent mutation). Full account data export (JSON/CSV) and consent-gated, legal-hold-aware deletion. |
| **Document Vault** | Private R2 storage keyed by opaque object IDs, with permission-aware original access and existing step-up checks. Vercel/Neon adapters remain compatible alternatives. Structural checks validate file types but are not antivirus; the existing ClamAV and github_clamav paths require their actual scanner/processing acceptance. |
| **Document Intelligence / AI Gateway** | Deterministic passport-MRZ (TD3) parsing, embedded PDF/DOCX/TXT/MD text extraction, and rules-based document classification run first and always. A provider-agnostic `AiExtractionPort` behind an **admin-managed, DB-backed configuration console** (`/app/admin/ai-settings`) now has real adapters for **OpenAI, Anthropic, and Google Gemini** - every configuration is an immutable, versioned snapshot (DRAFT → ACTIVE → SUPERSEDED/DISABLED) with an encrypted API key, a reviewed-data-policy attestation, durable per-document/platform cost budgets, a kill switch, a synthetic connection test, and a 13-case evaluation harness run before activation. A separate `AiOcrPort` (its own consent purpose, its own privacy posture - raw image bytes, not text) has a baseline OpenAI adapter, a "Run OCR" trigger on the document page, and review-issue display (low quality / ambiguous date / unsupported script / missing text); it shares the same platform-wide budget ledger as text extraction and its own attempt cap. Anthropic/Gemini OCR adapters are the one piece of this row not yet built. The AI Gateway only ever **proposes** fields - a human approves, nothing is written silently. |
| **Missions & Packs** | Cited, versioned, checksummed requirement packs (Pack Studio); parallel mission workspaces; a rules engine driving readiness as **completeness only** (never an approval probability); reviewer state machine; immutable, checksummed snapshots. |
| **Agencies & Sharing** | Organization verification (no self-upgrade); scoped, accepted, time-limited, revocable grants; access transparency; agency case collaboration (assignments, notes, evidence requests) and bulk export. |
| **Public Trust & Content Governance** | Publish-reviewed, source-cited pack routes for unauthenticated public lookup, with staleness handling (fee amounts auto-removed once a review is overdue). |
| **Billing & Notifications** | Plans, invoices, scheduled downgrades, a real Resend outbound adapter with signed delivery reconciliation (configuration and actual inbox acceptance are separate), a notification sweep pipeline, and a platform admin console over all of it. |
| **Applicant Trust & Lifecycle** | Truth-check attestations, acknowledgements, case state transitions, retention policies with eligibility-based purge, legal holds that **override deletion**, and a durable erasure outbox with lease-based recovery. |
| **Reliability** | Liveness + readiness probes; existing i18n infrastructure with Bangla translation deferred; incident runbook + RPO/RTO/restore-drill docs; a tamper-evident, hash-chained audit log on every mutation. |
| **Programme X experience (Oct 2026)** | Harbor landing, colour layer and brand; task-first first run; four-tab workspace (Home, Record, Cases, Sharing), with My Profile, Documents, Dates & Expiry and History inside the Record hub; case journey view and changed-case alert; grant review brief; Application Memory and then-and-now comparison; Title Case and one family of form fields across the interface; redesigned account menu. Status: [STATUS.md](docs/upgrades/programme/STATUS.md). |
| **Photos** | One profile photo per person (re-encoded on the server with hidden file details removed, included in the data export, erased on removal) and visa photo sizes cut on request from one shared passport photo for each published country rule, with source and checked date and no acceptance claim. |
| **AI provider governance** | Per-configuration provider data terms (free or paid, training, retention, region, terms address, date checked), one shared rule for warnings and blocking, and the "Only Use AI Providers That Do Not Train on Inputs" setting, built and off by owner decision. Review: [AI processing review](docs/legal/ai-processing-review-2026-10-25.md); runbook: [switching AI providers](docs/operations/runbooks/switch-ai-provider.md). |
| **Central access gate** | `packages/services/src/access/`: new applicant reads take a proof from `requireAccess`; about 313 older service functions are still to move behind it, and a ratchet test stops new ungated reads being added. |

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
│   └── i18n/               # English/Bangla message catalog + typed translator (Bangla deferred)
├── docs/
│   ├── adr/                # Architecture Decision Records (point-in-time; never edited retroactively)
│   ├── architecture/       # Data model, permission model, pipeline, AI gateway
│   ├── commercial-v1/      # Living trackers: requirements ledger + known issues (Commercial V1)
│   ├── governance/         # Delivery, branch protection, Vercel/service wiring
│   ├── operations/         # Incident runbook, RPO/RTO & restore drill
│   ├── product/            # PRD (3-page + Commercial V1) + Build Spec
│   ├── roadmap/            # Commercial V1 implementation directive + original phased plan
│   ├── security/           # Threat model + boundary/enforcement/test maps
│   ├── public-beta/        # Current product state, product contract, release acceptance
│   ├── upgrades/           # Programme X: status, work packages, allowlists, coverage ledger, handoffs
│   ├── uiux/               # Interface reference mapping and fidelity checkpoints
│   ├── legal/              # Reviews and drafts for the owner (not legal advice, no compliance claims)
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
ports: blob storage (R2/Vercel/Neon), malware scanning (structural/ClamAV), and
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
| `StoragePort` / `BlobStore` | Current production: private R2 through the S3-compatible adapter | Alternate private Vercel and reduced-control Neon adapters according to explicit compatible provider selection; do not silently substitute them for production R2 | Retain private access and the object-key contract on upgrades |
| `ScannerPort` / `MalwareScannerPort` | Configured scanner path; actual malware and lifecycle acceptance remains required | `BasicSafetyScanner` is structural validation only, not antivirus | Existing `clamav` and `github_clamav` paths behind the same boundary |
| `AiExtractionPort` | Admin-selected, DB-configured `OpenAiExtractionAdapter` / `AnthropicExtractionAdapter` / `GeminiExtractionAdapter` - versioned, encrypted, budget- and kill-switch-governed | *(manual path - no AI required; the app is fully usable without it)* | Another model provider, behind the same port |
| `AiOcrPort` | `OpenAiOcrAdapter` - wired to a manual "Run OCR" trigger on the document page, sharing text extraction's budget ledger | *(manual path - no OCR required)* | Anthropic/Gemini OCR adapters (tracked in `known-issues.md`) |

The built-in structural checker is a reduced control for synthetic pilot files, not antivirus. It does not certify PDF safety or authorise sensitive-document intake. Preserve quarantine, the configured actual scanning path and human approval. ADR-0011 is historical design context; current acceptance requirements still apply.

## Deployment modes and the capability registry

VisaStack runs from one codebase in three modes - `development`,
`controlled_pilot`, `commercial` - never a separate codebase per mode. The
current deployment is `controlled_pilot`. A server-authoritative capability
registry (`packages/core/src/deployment-mode.ts`,
`apps/web/src/lib/capabilities.ts`) reports the real, current state
(`available` / `degraded` / `disabled` / `unconfigured`) of every
user-facing capability - the client never decides this. `GET
/api/health/ready` exposes coarse readiness and platform states on deployed builds. Detailed configuration and operational diagnostics require the protected administrator dashboard. Full
rationale and the exact controlled-pilot values:
[`docs/audits/commercial-readiness-recovery-baseline.md`](docs/audits/commercial-readiness-recovery-baseline.md)§12
· governing directive:
[`docs/roadmap/commercial-recovery-completion-ux-directive.md`](docs/roadmap/commercial-recovery-completion-ux-directive.md).

## Environment variables

Set values separately for Production and the intended Preview scope. Public readiness never exposes secret values or detailed provider configuration. Use the protected administrator dashboard and current operating guide for diagnosis.

| Variable | Purpose | Required for |
| --- | --- | --- |
| `DATABASE_URL` (or `POSTGRES_URL`, …) | Neon connection string | database + migrations |
| `STORAGE_PROVIDER=r2`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION` | Configured private R2 document storage | current production storage; region defaults to auto and EU jurisdiction uses the EU account endpoint |
| `BLOB_READ_WRITE_TOKEN` | Alternate Vercel private storage adapter | only an explicitly selected compatible deployment |
| `BLOB_SIGNING_SECRET` | HMAC secret for signed blob URLs | document serving via the Neon-bytea fallback |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (32 or more characters), optional `IDENTITY_PROVIDER=neon_auth` | Neon Auth sign-in, the only sign-in system since #237 | every deployment; `IDENTITY_PROVIDER` may be blank or `neon_auth`, and any other value is refused and reported by readiness |
| `PUBLIC_BETA_OPEN=true` | Opens public sign-up | only when Neon Auth is fully configured; without it sign-up is invite-only |
| `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_WEBHOOK_SECRET` | Application email and signed delivery reconciliation | separate from Neon Auth SMTP |
| `PROTECTED_FIELDS_PGCRYPTO=required` and existing application key settings | Native protected-field encryption writes | key recovery/rotation acceptance is still required |
| `MALWARE_SCANNER_PROVIDER` (+ `CLAMAV_SOCKET_PATH` or `CLAMAV_HOST`/`CLAMAV_PORT`) | Selects the configured structural or actual scanner path, including `clamav` and `github_clamav` | real malware scanning |
| `AI_ENABLED`, `OPENAI_API_KEY` (+ `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` once those adapters are selected) | Env-based AI Gateway fallback | only the initial bootstrap before any admin-console AI provider configuration exists - once one is `ACTIVE`, the DB-backed, encrypted config in `/app/admin/ai-settings` is authoritative and these are ignored |

Weekly SQL capture runs in GitHub Actions with `pg_dump`, not inside a Vercel function. It uses `BACKUP_DATABASE_URL` for the unpooled `visastackdev` database, R2 credentials, `BACKUP_ENCRYPTION_KEY_BASE64` as an Actions secret and `BACKUP_ENCRYPTION_KEY_ID` as an Actions variable. Backup keys are separate from application keys. Vercel uses `CRON_SECRET` for protected jobs and `KMS_LOCAL_MASTER_KEY_BASE64` for the current pilot envelope provider, including encrypted invitation links. Never put secret values in documentation or chat.

The current application build is `next build`. Production migrations require specific authorization and the reviewed migration workflow; a deployment does not authorize or run them automatically. See [current operating guidance](docs/operations/current-platform.md).

## Quickstart

```bash
pnpm install --frozen-lockfile
pnpm run check          # lint + typecheck + test with isolated synthetic fixtures
pnpm run build          # build the workspace
```

Requires Node 22 (`.nvmrc`) and pnpm 10+. Tests run migrations against an
in-memory Postgres (PGlite), so service tests exercise FK/enum/unique constraints, append-only audit rules and permission invariants without a live provider. This does not prove real authentication, email, malware scanning, file storage, recovery or user journeys. Pull requests must pass three required checks on their exact head
commit: "Lint · Build · Typecheck · Test" (a summary of parallel jobs: lint and
audit, build and typecheck, three service test shards, web and other packages),
"No-secret Playwright checks" and "No-secret smoke check" (both against the PR
build on the CI machine, `.github/workflows/pr-browser-checks.yml`). After a
merge the browser and smoke checks run again against production, plus a live
signed-in check. Production migrations run only through the manual
`db-migrate.yml` workflow with the owner's approval for that specific run.

## Web app

- `/` - public Harbor landing. The beta notice is hidden for signed-in users.
- `/invitation` - public account handoff for team and client invitations (bound to the invited email address); signed-in pages review and explicitly accept.
- `/app` - the signed-in workspace: Home, then each traveller at `/app/applicant/[id]` with four tabs (Home, Record, Cases, Sharing), where Record holds My Profile, Documents, Dates & Expiry and History, plus Notifications and Countries; agency workspaces at `/app/agency/[orgId]`; `/app/admin/*` is the platform admin console (AI provider settings and data terms, document protection, organizations, packs, complaints).
- `/status` - What Works Today, from the same capability decisions the product uses.
- `/api/health/live`, `/api/health/ready` - liveness and readiness; readiness reports coarse platform states only.
- `/api/blob/[key]` - signed, expiring blob serving (returns `503` until storage is configured).
- `/api/jobs/*` - background sweep endpoints (notifications, downgrades, retention, erasure, exports, intake) for the scheduler.

## Documentation

- **Work in progress (Programme X):**
  [Status](docs/upgrades/programme/STATUS.md) ·
  [Latest session handoff](docs/upgrades/programme/SESSION-HANDOFF-2026-10-25-evening.md) ·
  [Programme contract](docs/upgrades/programme/PROGRAMME.md) ·
  [Work packages](docs/upgrades/programme/WORK-PACKAGES.md) ·
  [Coverage ledger](docs/upgrades/programme/COVERAGE-LEDGER.csv) ·
  [Functional spec v1.2](docs/upgrades/upgrade.v1.2.execution.md)
- **Running the platform:**
  [Current operating guidance](docs/operations/current-platform.md) ·
  [Current product state](docs/public-beta/CURRENT-STATE.md) ·
  [Switching AI providers](docs/operations/runbooks/switch-ai-provider.md)
- **For the owner to review:**
  [AI processing review](docs/legal/ai-processing-review-2026-10-25.md) ·
  [Privacy notice AI section draft](docs/legal/privacy-notice-ai-section-draft.md)
- **Commercial V1 (programme record and evidence log):**
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


### Earlier checkpoint: document, sharing and reference continuation (2026-10-12, history)

The source candidate adds personal invitations before registration, free private passport-image/scanned-PDF reading, owner-requested rereading and reference layout/navigation corrections. Full account names come from the signed-in Neon identity; mobile shows a compact first name with a chevron and the full name inside the menu. Management entry points are in that account menu. Existing permissions, consent, record versions and real-data gates remain intact.

Read [the current CF-04 through CF-09 acceptance checkpoint](docs/uiux/CF-04-09-ACCEPTANCE-2026-10-12.md). It distinguishes actual authenticated evidence from source checks, documents the failed first diagnostic run and explains migration/activation requirements. It does not certify complete beta acceptance.

Latest CF evidence: the final actual Neon route/device run passed 52 checks without skips; personal sharing passed its recipient-bound acceptance and access-transition journey, and separate pre-account checks verified clipboard copying and signup handoff. See the [CF acceptance checkpoint](docs/uiux/CF-04-09-ACCEPTANCE-2026-10-12.md) for deployment gates and remaining email, lifecycle, scanner/storage, MFA and recovery limitations.

For the scanner/storage acceptance run, use the existing private document workflow's `verify-synthetic` mode on reviewed main code. It exercises actual private storage copies, fresh ClamAV and PDF extraction using harmless synthetic controls, then cleans up those controls without touching production account/document records. See [current operations](docs/operations/current-platform.md) for required Actions settings and the remaining acceptance boundary.
