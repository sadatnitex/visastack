# VisaStack — current product baseline (truthful audit)

**Audit date:** 2026-07-22
**Branch:** `claude/visastack-storage-async-intake`
**Base commit (`main`):** `87e8eeb` (Reliability upgrade Release A + P0 preview fix + smoke/Playwright/Neon regression, #40 — merged and promoted to production this session)
**Production deployment:** `visastack-five.vercel.app` — Vercel project `prj_RZcDRy1odwehHuDqsiGwvVGC0epe`. PR #40's login/identity/health fixes were verified in production before this branch started. The Storage-PR work below (Vercel Private Blob adapter, quotas, opaque keys, filename-in-Content-Disposition) is **new on this branch and not yet deployed** — no preview or production URL exists for it yet.

> Truth-labelling taxonomy (per the upgrade directive). Every capability is one
> of: **Domain model only · Service implemented · UI present · Infrastructure
> wired · Preview verified · Production verified · Commercial-launch verified.**
> Only the last three are "working/live". Evidence is cited for each claim.

## Authentication status

**Production verified.** WorkOS AuthKit login reaches the authenticated workspace (`/app`) on `visastack-five.vercel.app` — confirmed via passing deployed no-secret smoke + Playwright checks on the real production deployment after PR #40 merged, following a chain of fixes (PRs #29–#40, including the `/callback` `onError` fix PR #40 itself uncovered and fixed). Middleware (`apps/web/src/middleware.ts`, `middlewareAuth.enabled`) owns session enforcement and token refresh; `/callback` (`apps/web/src/app/callback/route.ts`, `handleAuth`) is the OAuth callback with a recoverable `onError` redirect; `withSession()` reads the refreshed session read-only. The Neon WebSocket masking fix is in place and must remain (`apps/web/src/instrumentation.ts` → `WS_NO_BUFFER_UTIL`/`WS_NO_UTF_8_VALIDATE`; `serverExternalPackages`; pool `error` listener in `apps/web/src/lib/session.ts`).

**Remaining gap:** the authenticated Playwright spec (`apps/web/e2e/authenticated-workspace.spec.ts`) is **implemented, not yet verified** — it requires `WORKOS_STAGING_TEST_EMAIL`/`WORKOS_STAGING_TEST_PASSWORD` repository secrets (documented, not set) and its hosted-UI selectors have not been exercised against real WorkOS staging. The no-secret spec and smoke script are Production verified (confirmed passing via GitHub Actions job logs on the real deployment).

## Route inventory

Pages (`apps/web/src/app`): `/` (landing), `/status`, `/app` (workspace), `/app/privacy`, `/app/privacy/export` (route), `/app/shared`, `/app/agency`, `/app/agency/[orgId]`, `/app/agency/[orgId]/export` (route), `/app/admin`, `/app/admin/packs`, `/app/admin/packs/[packId]`, `/app/applicant/[id]`, `/app/applicant/[id]/history`, `/app/applicant/[id]/missions`, `/app/applicant/[id]/sharing`, `/app/applicant/[id]/evidence`, `/app/mission/[id]`.
API routes: `/callback`, `/api/health`, `/api/health/live`, `/api/health/ready`, `/api/blob/[key]`, `/app/privacy/export`, `/app/agency/[orgId]/export`.

## Environment-variable contract

From `.env.example` and `docs/governance/service-wiring.md`:
- **Auth (required):** `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (32+ chars), `NEXT_PUBLIC_WORKOS_REDIRECT_URI` (must equal `https://<domain>/callback` and be in the WorkOS Redirects allow-list, same WorkOS environment as the client id).
- **Database (required, first present wins):** `DATABASE_URL` · `POSTGRES_URL` · `DATABASE_URL_UNPOOLED` · `POSTGRES_URL_NON_POOLING` · `POSTGRES_PRISMA_URL`.
- **Signed blob storage (required for document preview/download):** `BLOB_SIGNING_SECRET` — consumed by `/api/blob/[key]` and both storage backends. *Fixed: now in `.env.example`.*
- **Object storage backend (Release B):** `BLOB_READ_WRITE_TOKEN` — when present, `createStorage()` selects `VercelPrivateBlobStorage` (real private access); when absent, falls back to `NeonBlobStorage` (reduced-control, dev/test/legacy only).
- **Upload quotas (optional overrides):** `QUOTA_MAX_UPLOAD_MB`, `QUOTA_MAX_APPLICANT_EVIDENCE_MB`, `QUOTA_MAX_ACCOUNT_EVIDENCE_MB`, `QUOTA_PLATFORM_WARNING_MB`, `QUOTA_PLATFORM_HARD_STOP_MB` — conservative pilot defaults (10/50/100/500/700 MB) apply when unset.
- **Declared but not yet wired (future phases):** `INNGEST_*` (durable job queue — not yet implemented), `AI_*`/`OPENAI_*`, `SENTRY_*`. `STORAGE_*` (S3-compatible) is an optional future migration path, not required now that Vercel Private Blob is wired.

## Database migration inventory

11 reviewed Drizzle migrations, `0000_superb_blazing_skull.sql` … `0010_light_kulan_gath.sql`, applied at build time by the Vercel `buildCommand` (`pnpm --filter @visastack/db db:migrate && next build`) and via the manual `db-migrate.yml` workflow. `accounts.workos_user_id` (nullable, unique) landed in migration `0010` (PR #40) — `provisionAccount` now binds by immutable WorkOS id; `email` is mutable contact data. No schema changes on this branch (Storage PR touches only application code).

## Module-by-module implementation matrix

| Capability | Highest truthful label | Evidence / notes |
|---|---|---|
| WorkOS login → workspace | **Production verified** | Confirmed via deployed smoke + Playwright checks on `visastack-five` production after PR #40. |
| Local identity binding to WorkOS user | **Production verified (PR #40)** | `accounts.workos_user_id` (migration `0010`, nullable+unique); `provisionAccount` binds by immutable WorkOS id, claims a legacy account only on a verified email, and refuses a takeover. 6 tests. *Follow-up:* a later migration makes the column NOT NULL once all live users are bound. |
| Account provisioning (idempotent) | **Production verified** | `provisionAccount` idempotent by WorkOS id; runs on every `/app` load. |
| Consent (separated, per-purpose) | **Service implemented + UI present** | `consent.ts`, `/app` consent controls. Not independently E2E-verified this session. |
| Applicant/family records | **Service implemented + UI present** | `applicants.ts`, `/app`, `/app/applicant/[id]`. |
| Master Profile (immutable fact versions) | **Service implemented; UI = passport subset only** | `profile.ts`; UI exposes a small identity/passport field subset, not the canonical registry. |
| Document register/version metadata | **Service implemented + UI present** | `documents.ts`, applicant page upload form. Object keys are now opaque UUIDs (this branch) — no applicant id/email/filename in the physical storage path. |
| Document preview | **Service implemented — P0 fixed (PR #40)** | Owner-only `original` variant; third parties get `redacted` (fail-closed). `Content-Disposition` now carries the approved/original display filename via the signed token (this branch) instead of an anonymous byte stream. |
| Document download (redacted) | **Service implemented; not wired in UI** | `downloadDocument`; no UI trigger found. |
| Upload processing pipeline | **Service implemented — states advance without doing the work** | `intake.ts`/`pipeline.test.ts`; `NORMALIZING`/`EXTRACTING` transitions do not perform normalization/OCR. Still synchronous, in-request, whole-file-in-memory — durable async intake (Inngest) is deferred to a follow-up PR. |
| Malware/structural scanning | **Service implemented — reduced-control** | `packages/adapters/src/scanner.ts` is a structural scanner, explicitly not antivirus. |
| Upload quotas | **Service implemented + tested (this branch)** | `packages/services/src/quotas.ts` — per-file/per-applicant/per-account/platform-wide caps, fail-closed before any bytes are written, config-driven via env overrides with conservative pilot defaults. 10 tests (PGlite). Not yet Production verified (no live deployment of this branch). |
| Object storage | **Service implemented + tested (this branch); NOT yet Production verified** | `VercelPrivateBlobStorage` (`packages/adapters/src/vercel-blob.ts`) — genuine `access: 'private'` Vercel Blob backend, selected automatically when `BLOB_READ_WRITE_TOKEN` is set; bytes are served only through the app's own signed `/api/blob/[key]` route (never a direct Vercel presigned URL), preserving per-request `Content-Disposition` and a single audit-enforcement point. 6 unit tests against a mocked `@vercel/blob`. No live `BLOB_READ_WRITE_TOKEN` exists in this sandbox, so the adapter has not been exercised against a real Vercel Blob store — that verification must happen in a real deployment. `NeonBlobStorage` (bytes in Postgres) remains the fallback when the token is absent, still labelled reduced-control/non-commercial (master directive §10/§21E). `deleteObject` exists on the new adapter but is not yet wired into any retention/deletion workflow (documented follow-up). |
| AI extraction / gateway | **Port only** | `ai.ts` port; no production adapter, no model wired. |
| Missions & requirement packs | **Service implemented + UI present** | `missions.ts`, `packs.ts`, mission/admin pages. Owner-driven state machine. |
| Sharing / scoped grants | **Service implemented + UI present** | `sharing.ts`; recipient inbox exists; no full permission-filtered recipient workspace. |
| Agency console | **UI present — raw IDs / field keys** | Requires typing internal UUIDs & raw field keys. |
| Retention / legal hold | **Service implemented** | `retention.ts`, admin UI. |
| Audit chain (append-only, hash-linked) | **Service implemented** | `audit.ts`; advisory-lock serialized; verified in unit tests. |
| Readiness/liveness probes | **Production verified (now corrected)** | `/api/health/*`. Readiness previously returned HTTP 200 while degraded — corrected on this branch (503 when degraded). |

## Known defects

**P0 — resolved in PR #40 (merged, production-verified)**
- **Preview served original bytes under a "redacted" label.** `/api/blob/[key]` returned the stored original bytes for any valid token regardless of the signed `variant`; `previewDocument` minted a `redacted` variant for everyone. *Fixed:* the serving route fails closed for any non-`original` variant (HTTP 501), and `accessDocument` mints an `original` preview only for the applicant owner; third parties get `redacted`.
- **Identity keyed by mutable email**, not the immutable WorkOS user id. *Fixed* — `workos_user_id` binding (migration `0010` + `provisionAccount` rewrite + 6 tests); email is now mutable contact data. Follow-up still open: make the column NOT NULL after all live users are bound.

**P0 — resolved on this branch (Storage PR, not yet deployed)**
- **Object storage path leaked applicant identity.** Upload objects were keyed `${applicantId}/${uuid}` — the applicant id was directly recoverable from the storage path. *Fixed:* object keys are now bare, opaque UUIDs; the applicant/document association lives only in the domain tables.
- **`Content-Disposition` never carried the approved display filename** — served bytes as an anonymous stream. *Fixed:* the filename is now part of the signed blob-access token payload (tamper-proof) and flows through to both the classic and RFC 5987 `Content-Disposition` forms.

**P1**
- Signed blob URLs do not re-check a revoked grant until token expiry (short TTL mitigates; not eliminated).
- Upload processing is still synchronous and loads whole files into memory — durable async intake (Inngest) is deferred to a follow-up PR, per the master directive's own permission to split Release B into reviewable pieces.
- `VercelPrivateBlobStorage.deleteObject` exists but is not yet wired into any retention/deletion workflow.

**P2**
- Upload UI limited to PDF/PNG/JPEG.
- Agency & shared workspaces surface raw UUIDs / field keys.

## Acceptance criteria — status (summary)

- **Passing/production-verified:** authenticated login and workspace entry (PR #40, confirmed via deployed smoke/Playwright checks); idempotent account provisioning; WorkOS-id identity binding; append-only audit chain (unit-verified); default-deny document authorization (unit-verified); honest readiness.
- **Service implemented + tested, not yet Production verified (this branch):** Vercel Private Blob object storage; upload quotas; opaque object keys; filename-carrying `Content-Disposition`.
- **Open:** deployed authenticated-E2E regression (WorkOS staging secrets); real async intake; real normalization/OCR/AI; persisted extraction & proposal review; automatic filename proposal + approval; document→profile approval UI; true redacted renditions; real malware scanning; durable job queue; existing-byte migration off Neon-bytea; permission-filtered shared/agency workspaces; account export/deletion drill; backup-restore drill; pen-test; EN/BN critical paths; WCAG 2.2 AA gate; AI/document benchmarks.

## Current security exceptions (must remain visibly labelled)

- **Reduced-control storage fallback:** `NeonBlobStorage` (bytes in Postgres) remains the backend whenever `BLOB_READ_WRITE_TOKEN` is unset — acceptable only for synthetic/internal testing, dev, and legacy data; not the sensitive-document production design. `VercelPrivateBlobStorage` is the commercial-track backend but is not yet Production verified from this sandbox.
- **Reduced-control scanning:** structural scanner is not antivirus; real-data upload must stay gated until a real malware control is active.
- **No true redacted rendition:** third-party preview is fail-closed (disabled) until real renditions ship.
- **No durable job queue yet:** upload processing runs synchronously in-request; a stalled/failed pipeline step has no retry/backoff, only the existing fail-closed error path.

## Changes made on PR #40 (merged, production-verified)

1. Governing directives saved (`docs/roadmap/reliability-document-intelligence-upgrade.md`, `docs/roadmap/master-build-pilot-commercialization-directive.md`).
2. P0 preview fix, honest readiness (503 when degraded), PII-safe logging, WorkOS immutable-id identity binding (migration `0010`), no-secret smoke tests, Playwright foundation, Neon pooled-transaction regression, README/landing wording corrections. Full detail in PR #40's description and commit history (`87e8eeb`).

## Changes made on this branch (Storage PR, `claude/visastack-storage-async-intake`)

1. **Upload quotas** (`packages/services/src/quotas.ts`) — per-file/per-applicant/per-account/platform-wide caps, config-driven via env overrides, conservative pilot defaults (10/50/100/500/700 MB), enforced fail-closed before any bytes are written. 10 tests (PGlite).
2. **Blob-token extraction** (`packages/adapters/src/blob-token.ts`) — `signBlobToken`/`verifyBlobToken` factored out of `neon-blob.ts` so both storage backends share one signing implementation; extended to sign the display filename as part of the tamper-proof payload. 5 tests.
3. **Vercel Private Blob adapter** (`packages/adapters/src/vercel-blob.ts`) — `VercelPrivateBlobStorage` implementing `StoragePort`+`BlobStore` against `@vercel/blob`'s genuine `access: 'private'` mode; mints its own signed reference to the app's `/api/blob/[key]` route rather than a direct Vercel presigned URL, preserving per-request `Content-Disposition` and a single audit-enforcement point. 6 tests against a mocked `@vercel/blob`.
4. **Backend selection** (`apps/web/src/lib/storage.ts`) — `createStorage()` selects `VercelPrivateBlobStorage` when `BLOB_READ_WRITE_TOKEN` is present, else falls back to `NeonBlobStorage`.
5. **Filename-carrying `Content-Disposition`** — `IssueReadRefInput.filename` threaded through `documents.ts` → both adapters → the signed token → `/api/blob/[key]`'s new `contentDisposition()` helper (classic + RFC 5987 forms).
6. **Opaque object keys** — upload action now generates a bare `randomUUID()` key (no applicant id in the path) and computes/stores a SHA-256 of the uploaded bytes.
7. **`.env.example`** — added the previously-missing `BLOB_SIGNING_SECRET`, plus `BLOB_READ_WRITE_TOKEN` and quota override variables.
8. This baseline audit, updated to reflect the above truthfully.

## Immediate next priorities (in order)

1. Open the Storage PR, get it reviewed, and — pending explicit human approval — merge and deploy it so the Vercel Private Blob adapter can be Production verified against a real `BLOB_READ_WRITE_TOKEN`.
2. Real generated redacted renditions + download-time re-authorization (Milestone 2 completion) — unblocks third-party preview.
3. Durable async intake (Inngest) + existing-byte migration tool off Neon-bytea — the remaining Release B scope deferred out of the Storage PR.
4. Deployed authenticated-E2E regression once `WORKOS_STAGING_TEST_EMAIL`/`WORKOS_STAGING_TEST_PASSWORD` secrets are provisioned.
5. Release C/D per the master directive sequencing (Processing PR, then AI PR) — not started; blocked on Storage PR approval per the directive's sequencing rule.
