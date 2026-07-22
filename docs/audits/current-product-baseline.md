# VisaStack — current product baseline (truthful audit)

**Audit date:** 2026-07-22
**Branch:** `claude/visastack-reliability-document-intelligence`
**Base commit (`main`):** `2da875b` (docs: correct drift and capture the ws/WebSocket masking hazard, #39)
**Production deployment:** `visastack-five.vercel.app` — Vercel project `prj_RZcDRy1odwehHuDqsiGwvVGC0epe`; latest production deployment at audit time `dpl_2SJgNFvwb8Kx5zzQpD85uN6UYJEn` (commit `39031a7`, READY). The `#39` docs merge (`2da875b`) had not yet been promoted to production at audit time.

> Truth-labelling taxonomy (per the upgrade directive). Every capability is one
> of: **Domain model only · Service implemented · UI present · Infrastructure
> wired · Preview verified · Production verified · Commercial-launch verified.**
> Only the last three are "working/live". Evidence is cited for each claim.

## Authentication status

**Production verified.** WorkOS AuthKit login reaches the authenticated workspace (`/app`) on `visastack-five.vercel.app` — confirmed interactively by the account owner this session, after a chain of fixes (PRs #29–#39). Middleware (`apps/web/src/middleware.ts`, `middlewareAuth.enabled`) owns session enforcement and token refresh; `/callback` (`apps/web/src/app/callback/route.ts`, `handleAuth`) is the OAuth callback; `withSession()` reads the refreshed session read-only. The Neon WebSocket masking fix is in place and must remain (`apps/web/src/instrumentation.ts` → `WS_NO_BUFFER_UTIL`/`WS_NO_UTF_8_VALIDATE`; `serverExternalPackages`; pool `error` listener in `apps/web/src/lib/session.ts`).

**Gap:** there is no automated end-to-end authentication regression test running against the deployed app. No Playwright is configured in the repo (`apps/web` has no `playwright.config.*`, no `@playwright/test`).

## Route inventory

Pages (`apps/web/src/app`): `/` (landing), `/status`, `/app` (workspace), `/app/privacy`, `/app/privacy/export` (route), `/app/shared`, `/app/agency`, `/app/agency/[orgId]`, `/app/agency/[orgId]/export` (route), `/app/admin`, `/app/admin/packs`, `/app/admin/packs/[packId]`, `/app/applicant/[id]`, `/app/applicant/[id]/history`, `/app/applicant/[id]/missions`, `/app/applicant/[id]/sharing`, `/app/applicant/[id]/evidence`, `/app/mission/[id]`.
API routes: `/callback`, `/api/health`, `/api/health/live`, `/api/health/ready`, `/api/blob/[key]`, `/app/privacy/export`, `/app/agency/[orgId]/export`.

## Environment-variable contract

From `.env.example` and `docs/governance/service-wiring.md`:
- **Auth (required):** `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (32+ chars), `NEXT_PUBLIC_WORKOS_REDIRECT_URI` (must equal `https://<domain>/callback` and be in the WorkOS Redirects allow-list, same WorkOS environment as the client id).
- **Database (required, first present wins):** `DATABASE_URL` · `POSTGRES_URL` · `DATABASE_URL_UNPOOLED` · `POSTGRES_URL_NON_POOLING` · `POSTGRES_PRISMA_URL`.
- **Signed blob storage (required for document preview/download):** `BLOB_SIGNING_SECRET` — consumed by `/api/blob/[key]` and `NeonBlobStorage`. Not in `.env.example` (contract gap — see defects).
- **Declared but not yet wired (future phases):** `STORAGE_*` (S3/R2), `INNGEST_*`, `AI_GATEWAY_*`, `SENTRY_*`.

## Database migration inventory

10 reviewed Drizzle migrations, `0000_superb_blazing_skull.sql` … `0009_wide_emma_frost.sql`, applied at build time by the Vercel `buildCommand` (`pnpm --filter @visastack/db db:migrate && next build`) and via the manual `db-migrate.yml` workflow. `accounts` table keys identity by `email` (unique) — **no `workos_user_id` column** (identity-binding gap, see below).

## Module-by-module implementation matrix

| Capability | Highest truthful label | Evidence / notes |
|---|---|---|
| WorkOS login → workspace | **Production verified** | Confirmed on `visastack-five` this session. |
| Local identity binding to WorkOS user | **Domain model only (incorrect)** | `provisionAccount` keys by email (`packages/services/src/accounts.ts`); no immutable `workosUserId`. Email change ⇒ duplicate/oprhaned account risk. |
| Account provisioning (idempotent) | **Production verified** | `provisionAccount` idempotent by email; runs on every `/app` load. |
| Consent (separated, per-purpose) | **Service implemented + UI present** | `consent.ts`, `/app` consent controls. Not independently E2E-verified this session. |
| Applicant/family records | **Service implemented + UI present** | `applicants.ts`, `/app`, `/app/applicant/[id]`. |
| Master Profile (immutable fact versions) | **Service implemented; UI = passport subset only** | `profile.ts`; UI exposes a small identity/passport field subset, not the canonical registry. |
| Document register/version metadata | **Service implemented + UI present** | `documents.ts`, applicant page upload form. |
| Document preview | **UI present — SECURITY DEFECT (P0, fixed on this branch)** | See P0 below. |
| Document download (redacted) | **Service implemented; not wired in UI** | `downloadDocument`; no UI trigger found. |
| Upload processing pipeline | **Service implemented — states advance without doing the work** | `intake.ts`/`pipeline.test.ts`; `NORMALIZING`/`EXTRACTING` transitions do not perform normalization/OCR. Synchronous, in-request, whole-file-in-memory. |
| Malware/structural scanning | **Service implemented — reduced-control** | `packages/adapters/src/scanner.ts` is a structural scanner, explicitly not antivirus. |
| Object storage | **Infrastructure wired — reduced-control (Neon bytea)** | `NeonBlobStorage` stores bytes in Postgres. No private S3/KMS adapter. |
| AI extraction / gateway | **Port only** | `ai.ts` port; no production adapter, no model wired. |
| Missions & requirement packs | **Service implemented + UI present** | `missions.ts`, `packs.ts`, mission/admin pages. Owner-driven state machine. |
| Sharing / scoped grants | **Service implemented + UI present** | `sharing.ts`; recipient inbox exists; no full permission-filtered recipient workspace. |
| Agency console | **UI present — raw IDs / field keys** | Requires typing internal UUIDs & raw field keys. |
| Retention / legal hold | **Service implemented** | `retention.ts`, admin UI. |
| Audit chain (append-only, hash-linked) | **Service implemented** | `audit.ts`; advisory-lock serialized; verified in unit tests. |
| Readiness/liveness probes | **Production verified (now corrected)** | `/api/health/*`. Readiness previously returned HTTP 200 while degraded — corrected on this branch (503 when degraded). |

## Known defects

**P0**
- **Preview served original bytes under a "redacted" label.** `/api/blob/[key]` returned the stored original bytes for any valid token regardless of the signed `variant`; `previewDocument` minted a `redacted` variant for everyone. A third-party PREVIEW token would therefore have returned the original document. *Fixed on this branch:* the serving route now fails closed for any non-`original` variant (HTTP 501), and `accessDocument` mints an `original` preview only for the applicant owner; third parties get `redacted` (fail-closed until real renditions exist). Tests added in `documents.test.ts`.
- **Identity keyed by mutable email**, not the immutable WorkOS user id (account-takeover / duplicate-account risk on email change). *Not yet fixed — highest-priority remaining Release A item.*

**P1**
- Readiness returned 200 while degraded. *Fixed on this branch (503 + core WorkOS-config gate).*
- Full email address written to server logs (`[withSession] failed for <email>`). *Fixed on this branch — replaced with a non-reversible `acct:<hash>` reference.*
- Signed blob URLs do not re-check a revoked grant until token expiry (short TTL mitigates; not eliminated).
- `BLOB_SIGNING_SECRET` missing from `.env.example` / readiness contract. *Readiness now reports it as an optional capability on this branch; still absent from `.env.example`.*
- Upload processing is synchronous and loads whole files into memory.

**P2**
- README / landing page overclaim ("live in production today", "six capability areas are live"). *Corrected on this branch.*
- Upload UI limited to PDF/PNG/JPEG.
- Agency & shared workspaces surface raw UUIDs / field keys.

## Acceptance criteria — status (summary)

- **Passing/production-verified:** authenticated login and workspace entry; idempotent account provisioning; append-only audit chain (unit-verified); default-deny document authorization (unit-verified); honest readiness (this branch).
- **Open:** deployed E2E auth regression; WorkOS-id identity binding; real async intake; real normalization/OCR/AI; persisted extraction & proposal review; automatic filename proposal + approval; document→profile approval UI; true redacted renditions; private production object storage; real malware scanning; permission-filtered shared/agency workspaces; account export/deletion drill; backup-restore drill; pen-test; EN/BN critical paths; WCAG 2.2 AA gate; AI/document benchmarks.

## Current security exceptions (must remain visibly labelled)

- **Reduced-control storage:** `NeonBlobStorage` (bytes in Postgres) — acceptable only for synthetic/internal testing; not the sensitive-document production design.
- **Reduced-control scanning:** structural scanner is not antivirus; real-data upload must stay gated until a real malware control is active.
- **No true redacted rendition:** third-party preview is fail-closed (disabled) on this branch until renditions ship.

## Changes made on this branch (this session)

1. Governing directive saved (`docs/roadmap/reliability-document-intelligence-upgrade.md`).
2. This baseline audit.
3. **P0 preview fix** — `/api/blob/[key]` fails closed for non-`original` variants; owner-only original preview in `documents.ts`; + tests.
4. **Honest readiness** — `/api/health/ready` returns 503 when core (DB/schema/WorkOS config) is not ready; optional capabilities reported separately.
5. **PII-safe logging** — `withSession` logs `acct:<hash>` instead of the raw email.
6. README / landing / status wording corrected to "Technical Preview".

## Immediate next priorities (in order)

1. WorkOS immutable-id identity binding (staged, non-destructive migration + takeover tests) — Release A.
2. Playwright auth regression + deployed-preview smoke workflow (Milestone 0/1).
3. Real generated redacted renditions + download-time re-authorization (Milestone 2 completion) — unblocks third-party preview.
4. Release B: private async upload + production storage adapter contract + durable jobs.
