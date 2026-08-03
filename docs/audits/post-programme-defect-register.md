# Post-Programme Defect Register

**Authority:** Post-Programme Defect Closure, Controlled-Pilot Verification and
Commercial-Activation Readiness Programme (engagement brief received
2026-08-03). Phase 0 deliverable — read-only forensic baseline, produced
before any code in this programme was changed.

**Baseline commit:** `f3f697506a32c7d41306b6684a27cebbc16f8ecb` — `main`,
"PR 11: Commercial activation framework (#64)", merged 2026-08-03T09:49:32Z.
Confirmed via `git fetch origin main && git rev-parse origin/main` and
independently via GitHub API. This session's working branch
(`claude/visastack-pilot-commercial-readiness-lp1h5x`) started at the same
commit (`git merge-base HEAD origin/main` == `origin/main` HEAD) — no rebase
was required before this baseline was taken.

**Scope:** all 64 merged PRs (`#1`–`#64`) confirmed closed/merged, zero open
PRs at baseline. PRs `#54`–`#64` are the 11-PR "commercial-recovery" programme
executed under
[`docs/roadmap/commercial-recovery-completion-ux-directive.md`](../roadmap/commercial-recovery-completion-ux-directive.md)
(PR 1 → PR 11 in that directive map 1:1 to `#54` → `#64`). This register
covers every unresolved, non-outdated review thread GitHub reports on
`#54`–`#64` (36 threads, confirmed via `pull_request_read` →
`get_review_comments` per PR — all `is_resolved: false`, `is_outdated: false`
at baseline), plus defects this session found independently while
establishing the baseline.

Each finding below was re-verified against **current `main`** (not against
the PR diff it was originally posted on) by reading the complete current
function/file — not merely the originally-flagged line number, which has in
several cases shifted or been touched by a later PR. Four defects were
verified directly; the remainder were verified by dedicated read-only
research passes, each independently re-reading the full current source before
returning a verdict, cross-checked against this session's own direct reading
of the capability registry, provider registry, readiness route, session/
provisioning path, and platform-roles module.

---

## 1. Baseline verification (Phase 0 §8)

| Check | Command | Result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | ✅ clean, no lockfile drift |
| Production dependency audit | `pnpm audit --prod --audit-level high` | ✅ 0 findings |
| Dev dependency audit | `pnpm audit --dev --audit-level high` | ⚠️ 6 findings (1 critical, 1 high, 4 moderate) — see §1.3 |
| Lint/format | `pnpm run lint` (biome) | ✅ clean |
| Production build | `pnpm run build` (`turbo run build`) | ✅ all packages build |
| Typecheck | `pnpm run typecheck` (`turbo run typecheck`) | ✅ clean |
| Unit/integration tests | `pnpm run test` (`turbo run test`) | ⚠️ see §1.2 — 2 pre-existing flaky timeouts, 0 genuine regressions |
| Migrations vs. fresh DB | `packages/db/src/schema.test.ts`'s `freshDb()` (PGlite + `drizzle-orm/pglite/migrator`) | ✅ all 24 migrations (`0000`–`0023`) apply cleanly to an empty database, exercised on every test run |
| Migrations vs. pre-existing schema | See §1.4 | ⚠️ not independently re-verified as a generic exercise this session — folded into the targeted Phase 2/3 regression tests for the two migrations (`0019`, `0020`) a later PR must add backfills for (findings #17, #21) |

### 1.1 Test totals (exact, reconciled)

Full suite, `pnpm turbo run test --continue` (the `--continue` flag was
required — see §1.2):

| Package | Test files | Tests |
|---|---|---|
| `@visastack/core` | 1 | 2 |
| `@visastack/i18n` | 1 | 6 |
| `@visastack/policy` | 1 | 29 |
| `@visastack/adapters` | 7 | 57 |
| `@visastack/db` | 3 | 24 passed + 1 skipped (25) |
| `@visastack/services` | 25 | 250 |
| `@visastack/web` | 11 | 103 passed + 2 flaky-failed (105) |
| **Total** | **49 files** | **471 passed + 1 skipped + 2 flaky (474)** |

The repository's own `README.md:152` currently claims "296 tests" — stale.
Corrected in the Phase 7 documentation PR.

### 1.2 Test-suite defects found (not from GitHub review threads)

**D-T1 — Two pre-existing flaky timeouts, same root cause, not yet fixed
everywhere.** A prior commit on `main` (visible in Vercel deployment metadata
for `a8debb2d5`, "Fix CI-only timeout in commercial-readiness.test.ts's first
test") already diagnosed this exact pattern: a test file's *first* dynamic
`import('./…')` transitively pulls in `./ai` → the OpenAI SDK's esbuild
transform, which is fast in isolation but can exceed Vitest's 5000ms default
`testTimeout` under full-monorepo parallel contention. That commit fixed it in
`commercial-readiness.test.ts` and `providers.test.ts` but **missed two other
files with the identical shape**:

- `apps/web/src/lib/capabilities.test.ts` → `getPlatformCapabilities > reports
  every one of the 20 registry fields` (first test in the file) — timed out
  in both the initial baseline run and the `--continue` re-run.
- `apps/web/src/app/api/health/ready/route.test.ts` → `GET /api/health/ready
  … returns 200 "ready" when DB is connected+migrated and WorkOS config is
  present` — timed out only in the `--continue` re-run (order-dependent,
  exactly as the diagnosing commit's message predicted for `providers.test.ts`
  before it was fixed).

Not a security defect; a test-infrastructure gap. **Disposition:** fix in the
PR that already touches each file — `capabilities.test.ts` in the Phase 1 PR,
`health/ready/route.test.ts` in the Phase 5 PR — by giving each file's first
test a generous explicit timeout, matching the existing fix's pattern.

**D-T2 — `turbo run test` aborts sibling packages on first failure.**
Discovered while reconciling test totals: the first baseline run (no
`--continue`) reported `ELIFECYCLE Test failed` for `@visastack/db`,
`@visastack/adapters`, and `@visastack/services` with **no test summary at
all** — not because those suites failed, but because Turbo killed their
still-running `vitest` processes the moment `@visastack/web`'s suite failed
(D-T1). This is a CI-hygiene risk: a single flaky test in one package can
mask a real regression in another package by preventing its summary from
ever printing. **Disposition:** not a defect in application code; noted here
so the Phase 6 CI PR considers `turbo run test --continue` (or per-package
`fail-fast: false`) so a flake in one package never hides a genuine
regression in another.

### 1.3 Dependency audit detail

`pnpm audit --dev --audit-level high` (soft gate in CI, `|| true`) reports:

| Severity | Package | Advisory | Notes |
|---|---|---|---|
| critical | `vitest` (`<3.2.6`, resolved via `apps/web`'s `vitest`) | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) — arbitrary file read/execute via Vitest UI server | Dev/test-only; the Vitest UI server is never started in this repo (no `--ui` flag anywhere in scripts/CI) |
| high | `vite` (`<=6.4.2`, transitive via `vitest`) | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) — `server.fs.deny` bypass on Windows | Dev/test-only; CI runs on Linux, no `vite dev`/`vite preview` server is ever exposed |
| moderate ×4 | transitive dev deps | (not shipped) | None reachable from the production bundle — confirmed clean by the hard-gated `pnpm audit --prod` |

None of these ship in the production bundle (confirmed by the separate,
passing, hard-gated `pnpm audit --prod --audit-level high`). **Disposition:**
low priority; track as a dependency-bump follow-up, not a blocking finding —
recorded in `docs/roadmap/remaining-commercial-blockers.md` (Phase 7) so it
isn't silently dropped.

### 1.4 Migrations

24 migrations (`0000`–`0023`) apply cleanly to a fresh PGlite database on
every test run via `schema.test.ts`'s `freshDb()` helper (this is the
project's existing, continuously-exercised "fresh database" migration
proof). A **generic** "apply against a representative pre-existing schema"
smoke test was not built as a standalone exercise this session; instead, the
two specific migrations this programme's findings require backfills for —
`0019_opposite_lily_hollister.sql` (finding #17: role-history preservation)
and `0020_wide_doctor_doom.sql` (finding #21: lease backfill for pre-existing
`CLAIMED` jobs) — get **targeted** pre-existing-data regression tests as part
of their respective fixes (Phase 1 and Phase 3 PRs): each test seeds rows
under the old schema/constraint shape, applies the new migration, and asserts
the pre-existing rows remain valid and recoverable. This is a more precise
proof than a generic smoke test would have been.

---

## 2. Deployed state (Vercel)

- **Project:** `visastack` (`prj_RZcDRy1odwehHuDqsiGwvVGC0epe`), team `Nazmus
  Sadat's projects` (`team_YDtSBrhGH5u4NwrHUCCddXwS`).
- **Latest production deployment:** `dpl_Gpd4ViGNaz5pSprveXCKwpWDGM5m`,
  `READY`, commit `f3f6975` (exactly `main`'s HEAD), created
  2026-08-03T09:49:37Z. Matches the intended commit exactly — no drift
  between `main` and the live deployment.
- **Deployment protection:** password protection, Vercel Authentication
  (SSO), and Trusted IPs are all **disabled** — the production URL is
  genuinely, unauthenticated-ly public.
- **Runtime errors, last 7 days (`get_runtime_errors`):** 48 error groups.
  44+ occurrences are `[AuthKit callback error] Missing required auth
  parameter` on `POST /callback` — consistent with the prior baseline's
  conclusion (bot/scanner traffic hitting the public OAuth callback with no
  `code`/`state`, not a real sign-in failure; `handleAuth`'s `onError` already
  redirects to `/` with a safe reference id rather than 500ing).
  **D-RT1 (new finding, not from a review thread):** one genuine application
  defect: `Error: STEP_UP_SIGNING_SECRET is not configured` — an **unhandled
  exception** (not a graceful degraded response) thrown from
  `/app/privacy/export` on 2026-08-01T15:31:52Z, propagating out of
  `withSession` as `[withSession] failed for acct:eac2d3368447`. `STEP_UP_SIGNING_SECRET`
  is not set on this deployment; the step-up-gated export route should fail
  with a safe, user-facing "this action requires step-up, which isn't
  configured in this environment" message, not an unhandled server exception.
  **Disposition:** register as a defect to close in the Phase 1 PR (same PR
  that touches step-up-adjacent consent/export code) — low severity (no data
  exposure; the request is correctly rejected, just with a worse failure
  mode than intended), but a real robustness gap worth closing while in the
  area.

## 3. PR #64 preview-deployment investigation

**Distinguishing the failed preview from the successful merge deployment.**
Every commit pushed to the PR-#64 head branch
(`claude/visastack-commercial-readiness-an08tb`) produced a Vercel **preview**
deployment in `ERROR` state; the merge-to-`main` deployment for the *same*
final commit (`a8debb2d5`) succeeded normally
(`dpl_Gpd4ViGNaz5pSprveXCKwpWDGM5m`, `READY`).

Direct evidence pulled for the preview build of the exact final pre-merge
commit (`dpl_2Y2TfaRgrJZdY1Fgt2RHd7t8Divy`, commit `a8debb2d5`):

- `errorCode: "BUILD_FAILED"`, `errorMessage: "Resource provisioning failed"`.
- `get_deployment_build_logs(errorsOnly: true)` → **"No error/stderr/exit
  events in this build."**
- `buildingAt` → `ready` spans **~1.7 seconds** — the build container never
  actually started; this fails before any install/build step runs.

This is not an isolated incident: the same signature (instant
`BUILD_FAILED`/`Resource provisioning failed`, zero log lines, preview-only,
**never** the corresponding production deployment for the same final commit)
recurs identically across every one of PRs `#58`–`#64` (7+ distinct preview
builds, across multiple separate days). **Conclusion: this is conclusively
not a code defect** — the build never reaches a point where VisaStack's own
code could be at fault. The most evidence-consistent explanation, given the
project sits on Vercel Hobby (which enforces a single concurrent-build slot)
and this account's team runs 6 total projects
(`visastack`/`travelrouter`/`tradeproof`/`peopleops2025`/`flowtal`/`bidesh365`)
that can compete for that same slot, is a Hobby-tier build-concurrency
ceiling — but this session did not have direct access to Vercel's
account-level concurrency/plan-limit dashboard to prove the exact mechanism
with certainty, so that specific cause is stated as the best-supported
hypothesis, not a proven fact. What **is** proven: the production/deployed
artifact users and reviewers actually see has never been affected by this —
every `main` merge deployment for `#58`–`#64` reached `READY` normally.
**Disposition:** no code change required; documented here so future preview
`ERROR` states on this repo are correctly triaged (check `get_deployment_build_logs`
before assuming a code regression) rather than re-investigated from scratch
each time.

---

## 4. Defect register

Severity follows the P0 (critical, blocks pilot) / P1 (high, must fix before
the relevant PR merges) / P2 (moderate, must fix before the relevant PR
merges) scale implied by the operating rules ("no unresolved P0, P1 or P2
finding"). All 36 GitHub-review findings below carry the severity the
reviewer originally assigned; none were downgraded without code-level proof,
and none were dismissed without either a fix or a proof of obsolescence.

**Disposition legend:** which of this session's 7 delivery PRs closes the
finding. PR names match §"Delivery structure" in the engagement brief:
**PR-A** Access/consent/authorization · **PR-B** Erasure/legal-hold/document
trust · **PR-C** Job fencing/AI budget/evaluation · **PR-D**
Mission/snapshot/UX · **PR-E** Readiness/provider validation/disclosure ·
**PR-F** Exact-SHA CI/deployed E2E · **PR-G** Documentation.

### 4.1 PR #54 findings (3)

| # | Severity | File/function | Current-main verification | Security/privacy impact | Proposed correction | Regression test | Disposition |
|---|---|---|---|---|---|---|---|
| 1 | P1 | `apps/web/src/lib/capabilities.ts` — commercial capability gating | **FIXED.** `publicSignup`/`realApplicantData`/`commercialClaims` are now gated by `isCommercial && commercialConfigurationReady()`, and `commercial-readiness.ts` requires 19 real gates (one, `realMalwareScanner`, hardcoded `false` and unattestable) before reporting ready. Verified by reading both files in full. | None remaining — closed by PR #64 itself. | — | Existing: `capabilities.test.ts` "keeps publicSignup/… disabled in commercial mode alone"; `commercial-readiness.test.ts`. | Closed already — no action. Noted here only so the register is complete. |
| 2 | **P1 (treated as P0 — invite-only pilot access is a non-negotiable objective)** | `apps/web/src/lib/session.ts` (`withSession`) + `packages/services/src/accounts.ts` (`provisionAccount`) | **STILL PRESENT.** `withSession` calls `provisionAccount(handle, { email, workosUserId, emailVerified })` unconditionally for every successfully authenticated WorkOS identity; `provisionAccount` performs zero invitation/allowlist checks. Repo-wide grep for `invit`/`allowlist`/`Invite` confirms **no** signup-gating mechanism exists anywhere — every hit is either the unrelated grant/sharing "invitation" UI copy or an eval fixture. The `publicSignup` capability flag is read only by its own definition, tests, and the readiness route's self-force-disable — nothing in the sign-in/callback/middleware/session path reads it. | **Critical** — any person who can complete a WorkOS AuthKit sign-in (a matter of WorkOS project configuration alone) is silently provisioned a full local account, directly contradicting "invite-only controlled pilot." | Add a server-authoritative pilot-access boundary: a new `pilot_invitations` table (email-keyed, audited create/revoke) plus an `ADMIN_EMAILS`-style bootstrap allowlist; check it in `withSession` *before* calling `provisionAccount` (existing accounts, i.e. any WorkOS id already bound, always pass — the check is for *new* provisioning only); deny with a safe, non-account-creating redirect otherwise. | New hostile tests: unknown/uninvited identity is denied and provisioned nothing; changed email after invitation does not block the already-bound account; replayed/reused invitation does not create a second account; revoked invitation blocks a not-yet-provisioned identity; cross-identity collision (different WorkOS id, same invited email) is refused exactly like the existing takeover guard. | **PR-A** |
| 3 | P1 | `apps/web/src/app/app/agency/[orgId]/page.tsx` + `packages/services/src/agency.ts` (`listApplicantsForOrganization`) | **PARTIALLY FIXED.** `listMissionsForOrganization` (agency.ts:231-267) now correctly filters `status='ACTIVE' AND acceptedAt IS NOT NULL AND startAt<=now AND (expiryAt IS NULL OR expiryAt>now)`. But `listApplicantsForOrganization` (agency.ts:544-557) still filters **only** by `recipientOrganizationId` — no status/acceptance/expiry predicate — so revoked/paused/expired/unaccepted grants still surface applicant names in the evidence-request applicant picker. | Applicant identity of a revoked/expired collaborator leaks into the agency UI. | Apply the same ACTIVE/accepted/unexpired predicate `listMissionsForOrganization` already uses to `listApplicantsForOrganization`. | Hostile test: an org with only a revoked/paused/expired/unaccepted grant sees zero applicants from `listApplicantsForOrganization`. | **PR-A** |

### 4.2 PR #55 findings (4)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 4 | P1 | `agency.ts` `bulkExport` grant→policy mapping | **STILL PRESENT.** The mapped grant object passed to `authorize()` omits `missionId`/`documentIds` entirely (not merely `undefined` — the keys are absent), so `evaluateGrant`'s scope check (`missionId !== undefined`) never triggers and every grant is evaluated applicant-wide. | A mission- or document-scoped grant can export the full applicant profile. | Copy `missionId`/`documentIds` into the mapped grant exactly as `loadGrantsForPolicy` (sharing.ts) already does. | Hostile test: a mission-scoped (or document-scoped) grant's bulk export must reject/narrow to that scope, never the full profile. | **PR-A** |
| 5 | P1 | `agency.ts` (mission read chain: `listMissionsForOrganization` → `listNotes`/`listAssignmentsDetailed`) | **STILL PRESENT.** Mission listing checks status/acceptance/expiry but not `actions`; `listNotes`/`listAssignmentsDetailed` take only a `missionId`, no action check at all. An applicant-wide grant containing only `PREVIEW` still yields full note bodies and assignee identities. | Notes/assignee PII exposed without the specific permission (`COMMENT`/`MANAGE`) that should gate it. | Require `orgGrantPermits(db, orgId, applicantId, <read action>, missionId)` before calling `listNotes`/`listAssignmentsDetailed`. | Hostile test: an applicant-wide grant scoped to `PREVIEW` only must not expose notes/assignments. | **PR-A** |
| 6 | P2 | `agency.ts` `requestEvidence` | **STILL PRESENT.** `orgGrantPermits(db, organizationId, applicantId, 'MANAGE')` is called with no 5th (`missionId`) argument, and `RequestEvidenceInput` has no `missionId` field to supply one — so a mission-scoped `MANAGE` grant always evaluates `scope_mismatch`. | Functional/availability defect (over-denial), not a confidentiality leak — but contradicts the function's documented applicant-wide-or-any-mission contract. | Add optional `missionId` to `RequestEvidenceInput`, thread it through to `orgGrantPermits`. | Test: an org with only a mission-scoped `MANAGE` grant can successfully request evidence for that applicant/mission. | **PR-A** |
| 7 | P2 | `agency.ts` mission-listing dedup | **STILL PRESENT.** `selectDistinct` retains `grantMissionId`; the scope filter keeps both an applicant-wide row and a mission-scoped row for the same mission; the trailing `.map` drops the distinguishing field, yielding duplicate identical rows. | UI/data-integrity defect: duplicate React keys, duplicate note/action affordances for the same mission. | Deduplicate by `missionId` after scope filtering, before dropping `grantMissionId`. | Test: an org holding both an applicant-wide and a mission-scoped grant for the same applicant sees each mission exactly once. | **PR-A** |

### 4.3 PR #56 findings (4)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 8 | P1 | `packages/adapters/src/zip-structure.ts` | **STILL PRESENT.** EOCD's central-directory-size field is never read/checked; no entry's local-file-header offset/signature is ever located or validated. The file's own test fixture comment admits the parser "only ever reads from centralDirectoryOffset onward." | A forged central directory over non-DOCX bytes is accepted as a valid DOCX, defeating the structural scanner. | Read each entry's local-header offset, verify it points in-bounds to a genuine `PK\x03\x04` header matching the central-directory entry, validate declared data fits in-file, validate EOCD directory size. | Hostile tests: forged central directory over arbitrary bytes; overlapping entries; path traversal in entry names; encrypted entries; macro-bearing entries; zip-bomb-shaped archives (extreme compression ratio/entry count) — all rejected. | **PR-B** |
| 9 | P1 | `packages/adapters/src/scanner.ts` (PDF active-content check) | **STILL PRESENT.** `containsActivePdfContent` does a plain `latin1` substring search with zero `#XX` hex-unescaping and zero object-stream awareness. | `/Open#41ction`-style escaped names, or active content inside an encoded object stream, bypass the active-content boundary entirely. | Decode PDF name `#XX` escapes before matching; detect markers inside supported encoded/object-stream structures where feasible within the bounded parser; classify as "needs attention" (not clean) when undecidable. | Hostile tests: escaped `/OpenAction`, `/JavaScript`, `/JS`, `/AA` names; markers inside a `FlateDecode`d object stream where decodable. | **PR-B** |
| 10 | P2 | `packages/services/src/intake.ts` (scanner invocation) | **STILL PRESENT.** No try/catch around `scanner.scan()`; a throw skips the `documentScanResults` insert entirely, so failed attempts are invisible to `listScanResults()`. | Cannot distinguish "never scanned" from "repeatedly failed to scan" — an operational/audit gap, not a direct data exposure. | Wrap `scanner.scan()`; persist a failure row before rethrowing. | Test: a throwing scanner still produces a durable scan-attempt row. | **PR-B** |
| 11 | P2 | `packages/services/src/documents.ts` (`accessDocument` audit) | **STILL PRESENT.** An authorized-but-not-yet-safe-to-serve request appends `DOCUMENT_ACCESS: ALLOWED` first, then a second event `DOCUMENT_ACCESS: DENIED` for the same request. | Append-only audit trail records an access that never happened; double-counts the request. | Defer the audit append until after the safety/servability check, or merge both gates into one decision before auditing once. | Test: exactly one `DOCUMENT_ACCESS` event per request, correctly `ALLOWED` or `DENIED`. | **PR-B** |

### 4.4 PR #57 findings (3)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 12 | P1 | `packages/services/src/erasure.ts` (`claimErasureJobs`, admin-attention query) | **STILL PRESENT.** Claim query matches `status='PENDING'` only; `erasureJobs` schema has no `leaseExpiresAt` column at all (unlike `processingJobs`, which PR #59 gave one); admin-attention query only surfaces `FAILED`/`BLOCKED_BY_HOLD` — a worker killed mid-`CLAIMED` or mid-`DELETED` leaves the job permanently invisible to both reclaim and admin. | Erasure can silently stall forever with no operator visibility — directly undermines "never report successful erasure until absence is verified." | Add `leaseExpiresAt`/owner-token column to `erasure_jobs`; reclaim stale `CLAIMED`/`DELETED` jobs past lease expiry; surface them in admin attention. | Worker-crash simulation: a job stuck at `CLAIMED`/`DELETED` past lease expiry is reclaimed and/or surfaced to admin. | **PR-B** |
| 13 | P1 | `packages/services/src/erasure.ts` (`finalizeVerifiedJob`) + `retention.ts` (`purgeExpiredDocuments`) | **STILL PRESENT.** One job per storage object, all sharing one `documentId`; the *first* job to verify unconditionally deletes the `documents` row (cascading all versions) with no check that sibling jobs for other objects of the same document are also verified. | A multi-version document can have its logical record (and metadata for still-undeleted objects) destroyed before every object is actually erased — breaks "finalize only after every required storage-object erasure job is verified." | Only finalize/delete the `documents` row once every sibling job for that `documentId` is `VERIFIED`. | Multi-version test: 3 objects, only 1 verifies — document row and its metadata must survive until all 3 verify. | **PR-B** |
| 14 | P1 | `packages/services/src/deletion.ts` (`executeAccountDeletion`) vs. `legal-hold.ts` (`placeLegalHold`) | **STILL PRESENT.** Deletion's hold check is a plain unlocked `SELECT`; `placeLegalHold` takes no lock either — neither `pg_advisory_xact_lock` nor `SELECT … FOR UPDATE` appears in either file (both patterns exist elsewhere in the codebase, e.g. `erasure.ts`, `organizations.ts`, `ai.ts`). | A legal hold placed in the race window is destroyed by a concurrent deletion — the exact scenario "legal hold must win" forbids. | Have both paths take the same serializing primitive on the applicant (advisory lock keyed by `applicantId`, or `SELECT … FOR UPDATE` on the applicant row). | Real concurrency regression test (two transactions racing hold-placement vs. deletion) where the test harness supports true concurrent transactions; otherwise the strongest available DB-level proof, with the limitation documented honestly. | **PR-B** |

### 4.5 PR #58 findings (4)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 15 | P1 | `packages/services/src/platform-roles.ts` (`isPlatformAdmin`/`hasAnyPlatformRole`) | **STILL PRESENT.** Exactly 2 predicates exist: "has any active role" and "is PLATFORM_OWNER." ~20 call sites (retention, legal hold, purge, org verification, pack admin) use the universal "any role" check; only role-grant/revoke itself requires `PLATFORM_OWNER`. No `canPerform(role, action)` matrix exists anywhere (confirmed by grep). | A `SUPPORT_ADMIN` can place legal holds, purge documents, verify organizations, edit retention policy — every "concern-scoped" role is functionally identical except for role management. | Build an explicit action→role permission matrix in the service layer; replace the universal `isPlatformAdmin` call at each of the ~20 sites with the specific required role(s) for that action. | Full matrix test: each of the 4 roles × each gated action, asserting exactly the intended roles succeed and all others are denied. | **PR-A** |
| 16 | P1 | `platform-roles.ts` (bootstrap grant) | **STILL PRESENT.** Bootstrap eligibility (`totalGrantCount===0`) is checked, but the granted `role` is whatever the caller supplied — a bootstrap actor can make their first grant `SUPPORT_ADMIN`, permanently disabling bootstrap with zero `PLATFORM_OWNER` ever created. | Installation can be locked out of role management entirely. | On the bootstrap path, force the inserted role to `PLATFORM_OWNER` regardless of caller input. | Test: first-ever grant request for a non-owner role is either rejected or silently upgraded to `PLATFORM_OWNER`; either way an owner always results. | **PR-A** |
| 17 | P1 | `packages/db/migrations/0019_opposite_lily_hollister.sql` + `schema.ts` (`platformRoles.accountId` FK) + `deletion.ts` | **STILL PRESENT.** FK is `ON DELETE cascade`; `executeAccountDeletion` deletes the `accounts` row directly with no special handling for `platformRoles` (unlike `missionNotes.authorAccountId`, which is explicitly nulled first). | Deleting an account (including a former `PLATFORM_OWNER`) destroys the append-only role-history record — audit/compliance gap, and can silently re-enable the `ADMIN_EMAILS` bootstrap path if it was the only grant. | New migration: change `platformRoles.accountId` FK to `ON DELETE SET NULL` (nullable column), matching the established `set null`-on-deletion pattern already used for every other actor/author reference in this schema. | Test: deleting an account that holds/held a platform-role grant leaves the grant row intact with `accountId` nulled, not deleted. | **PR-A** |
| 18 | P1 | `platform-roles.ts` (`revokePlatformRole`) | **STILL PRESENT.** The active-owner count runs on plain `db` *before* the transaction opens; the transaction's own `UPDATE` only filters `WHERE id = grantId`, with no re-check or lock. Two concurrent revocations against a 2-owner state can each independently pass the pre-check. | Concurrent revocations can strand the platform with zero active owners. | Move the owner count inside the same transaction as the revoke `UPDATE`, using `SELECT … FOR UPDATE` on active-owner rows or a fixed-key advisory lock. | Concurrency test: two simultaneous revocations against exactly 2 owners — exactly one must succeed, or both must be safely serialized so at least one owner always survives. | **PR-A** |

### 4.6 PR #59 findings (3)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 19 | P1 | `packages/services/src/intake.ts` (document-processing transitions) + `jobs.ts` | **STILL PRESENT.** Job-table lease fencing (`leaseOwner`/`leaseExpiresAt`) is correctly enforced for `completeJob`/`failJob`, but `processIntake`'s own state-transition CAS checks only `processingStatus` — the lease owner never threads into the document-version pipeline (scan-result writes, extraction-result writes, proposal writes). | A worker whose lease was reclaimed can still win the race to persist scan/extraction side effects and advance the document, corrupting state the new lease-holder is simultaneously writing. | Thread the claimed job's lease owner (or a monotonic fencing token) through every document-processing state transition and side-effect write in the pipeline. | Worker-crash/lease-reclaim simulation: a reclaimed worker's stale writes must be rejected once a new worker holds the lease. | **PR-C** |
| 20 | P1 | `packages/services/src/ai.ts` (platform-wide AI budget check) | **STILL PRESENT.** The advisory lock (`pg_advisory_xact_lock(hashtext(documentVersionId))`) is per-document by design (its own docstring says so); no second, fixed-key lock serializes the platform-wide total check across different documents. | Enough concurrent different-document requests can overshoot the platform-wide AI budget by multiple calls. | Add a second, fixed-key advisory lock around the platform-wide budget check itself. | Concurrency test: N concurrent different-document extraction requests near the platform cap never collectively exceed it. | **PR-C** |
| 21 | P1 | `packages/db/migrations/0020_wide_doctor_doom.sql` + `jobs.ts` (reclaim query) | **STILL PRESENT.** Migration adds nullable `lease_expires_at` with no backfill; reclaim query is `status='CLAIMED' AND lease_expires_at < now()`, which never matches `NULL`. | A `CLAIMED` job that existed before this migration is permanently stuck — never reclaimable. | Add `OR lease_expires_at IS NULL` to the reclaim predicate, or a follow-up migration backfilling a bounded expiry for pre-existing `CLAIMED` rows. | Pre-existing-schema regression test: seed a `CLAIMED` row with `lease_expires_at = NULL` (simulating a pre-migration row), confirm it becomes reclaimable. | **PR-C** |

### 4.7 PR #60 findings (3)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 22 | P1 | `apps/web/src/app/app/page.tsx` + `privacy/page.tsx` | **STILL PRESENT.** `CONSENT_TYPES` grant/revoke controls render only inside the `coreGranted` branch; the Privacy page shows read-only history with no live controls at all. | After core-processing revocation, a user cannot revoke marketing/sharing/AI consent without first re-granting core processing — violates independent consent lifecycle. | Render `CONSENT_TYPES` controls independent of the `coreGranted` gate. | Test: with core processing revoked, AI/sharing/marketing consent each remain independently toggleable. | **PR-A** |
| 23 | P2 | `apps/web/src/app/app/applicant/[id]/documents/page.tsx` | **STILL PRESENT.** An early return on `!coreGranted` hides the entire Document Vault (list, metadata, preview), not just upload/processing actions. | Users must re-consent to processing merely to view/export/delete data they already stored — conflicts with "existing data must remain viewable/exportable/deletable." | Gate only upload/AI-extraction actions on `coreGranted`; always render existing document metadata + preview when documents exist. | Test: with core processing revoked, existing documents remain listed/previewable; upload/AI actions are disabled. | **PR-A** |
| 24 | P2 | `.github/workflows/playwright-smoke.yml` + `apps/web/e2e/ux-public.spec.ts` | **STILL PRESENT.** Re-confirmed directly: the workflow's only Playwright invocation is `no-secret-auth.spec.ts`. `ux-public.spec.ts` (axe/responsive/keyboard/i18n/404 checks) is not referenced by any workflow, `package.json`, or Playwright config — it cannot fail a build. | False sense of coverage: accessibility/responsive/UX regressions in this spec cannot block a deploy despite the spec existing. | Add `ux-public.spec.ts` to the deploy-smoke Playwright workflow. | N/A (CI wiring, not a new test) — verified by observing the workflow actually gate on this spec's pass/fail. | **PR-F** |

### 4.8 PR #61 findings (1)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 25 | P2 | `apps/web/src/app/.../profile-editor.tsx` + `packages/services/src/profile.ts` | **STILL PRESENT.** Date-only values are parsed as UTC midnight on write but rendered via `toLocaleDateString` with no `timeZone` on read — a date entered as `2020-01-15` displays as `Jan 14` in timezones west of UTC. No shared, UTC-aware `formatDate` exists; the logic is duplicated ad hoc in 3 files. | Data-integrity/UX defect: a user's entered date silently shifts by a day depending on viewer timezone. | Render date-only fields with `timeZone: 'UTC'` explicitly (or store/compare as a plain date string), consolidated into one shared helper. | Test: a date-only value round-trips identically regardless of the rendering environment's timezone (parametrized across at least UTC-8, UTC, UTC+6). | **PR-D** |

### 4.9 PR #62 findings (3)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 26 | P1 | `packages/adapters/src/eval/run.ts` + `scoring.ts` (`aggregate`) | **STILL PRESENT.** An adapter error is converted to a score object missing `promptInjectionSucceeded`; `aggregate` defaults a missing-field case to "injection resisted: true," so an adapter that errors on the prompt-injection case still scores as resistant. | The evaluation programme can report PASS while never having genuinely executed the prompt-injection case — directly contradicts "the prompt-injection case is not actually executed" being a required failure condition. | Any adapter error on a required case (especially prompt-injection) must fail the run outright, or explicitly mark that capability unverified rather than defaulting it to a pass-shaped value. | Test: an injected adapter error on the prompt-injection case makes the overall evaluation FAIL, never PASS. | **PR-C** |
| 27 | P1 | `packages/adapters/src/eval/scoring.ts` (evidence accuracy) | **STILL PRESENT.** `if (proposal.evidenceSnippet && !documentText.includes(snippet))` — a null/empty snippet short-circuits the whole check, so a fully evidence-free proposal set scores 100% evidence accuracy. | An ungrounded model can pass the pilot-verification evidence threshold with zero real evidence — directly contradicts "any mapped proposal lacks an evidence snippet" being a required failure condition. | Count a missing/empty `evidenceSnippet` on a mapped proposal as a mismatch, not a pass. | Test: a proposal set with all-null evidence snippets fails the evidence-accuracy threshold. | **PR-C** |
| 28 | P2 | `packages/services/src/ai.ts` (`countAiExtractionAttempts`) | **STILL PRESENT.** Cache hits insert their own `aiExtractionRuns` row (`servedFromCacheRunId` set, `costUnits: 0`) and are counted by `countAiExtractionAttempts`, which runs before the cache lookup. Cost-wise cache hits are correctly free; attempt-wise they are not. | With the default limit of 3, one paid call + 2 cache hits permanently blocks a 4th identical (cache-hit-eligible) request. | Exclude rows with `servedFromCacheRunId` set from the attempt count, or check cache before applying the attempt-limit gate. | Test: N cache-hit-eligible repeats of the same request never exhaust the attempt limit; only genuine paid invocations count against it. | **PR-C** |

### 4.10 PR #63 findings (6)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 29 | P1 | `apps/web/.../snapshots/[snapshotId]/page.tsx` + historical `missions.ts` snapshot writer | **STILL PRESENT.** Confirmed via `git show` that pre-PR-#63 snapshots wrote `content.facts` as an object; PR #63 switched the writer to an array with no migration rewriting existing rows; the read path does an unguarded `.map()`. | Any snapshot created before PR #63 is unreadable (throws) today — immutable historical/application-pack data made inaccessible. | Render both the legacy object-keyed shape and the new array shape in the read path; never rewrite the immutable historical rows themselves. | Test: a snapshot fixture in the pre-#63 object shape renders correctly alongside a post-#63 array-shape fixture. | **PR-D** |
| 30 | P1 | `packages/services/src/missions.ts` (`snapshotMission` / `loadDocumentInstancesByType`) | **STILL PRESENT.** `if (!row.docType) continue;` drops any document with no classified type from the only collection `snapshotMission` uses. | A document with a current version can be permanently absent from every future snapshot — including its version id/hash, i.e. lost from the immutable evidentiary record. | Group unclassified documents under a sentinel key so they still appear in `content.documents` (just ineligible for a specific-type requirement match). | Test: an unclassified (no `docType`) document with a current version appears in a new snapshot's `content.documents`. | **PR-D** |
| 31 | P1 | `apps/web/src/app/app/agency/[orgId]/page.tsx` | **STILL PRESENT.** All mission/requirement/decision loading and the decision UI sit inside the `isOrgAdmin` branch; an assigned active `REVIEWER`/`CASE_MANAGER` gets only a static "not an administrator" message, despite `recordMissionDecision` explicitly authorizing them. | The reviewer workflow PR #63 built is unusable by its primary non-admin users. | Load missions/requirements/decisions and render the decision form for any active assigned `REVIEWER`/`CASE_MANAGER`, reserving only member-management/bulk-export for `isOrgAdmin`. | Test: an assigned active non-admin `REVIEWER` reaches and can submit the decision workflow for their assigned mission. | **PR-D** |
| 32 | P1 | `packages/services/src/agency.ts` (`listMissionDecisions`) | **STILL PRESENT.** The non-owner path checks only the assignment row's account/mission IDs — no active-membership or current-grant re-check, unlike the write path (`recordMissionDecision`), which checks both. | A deactivated/removed reviewer, or one whose org's grant was revoked, retains indefinite read access to decision history/reasons. | Add the same active-membership + current-grant check `recordMissionDecision` already performs. | Test: a former (deactivated/removed/grant-revoked) reviewer is denied `listMissionDecisions` for a mission they used to have access to. | **PR-A** (agency read-authorization repair) |
| 33 | P2 | `apps/web/src/app/app/mission/[id]/page.tsx` (evidence-selection UI state) | **STILL PRESENT.** Selection IDs are keyed only by `factId`/`documentId`, not by requirement — when the same candidate is selected for two requirements needing the same field/type, one selection's "remove" button can delete the other's selection. | UI data-integrity defect: removing evidence from one requirement can silently remove a different requirement's (intact) selection. | Key the selection map by a composite `${packRequirementId}:${factId ?? documentId}`. | Test: two requirements sharing a selected candidate — removing one's selection leaves the other's intact. | **PR-D** |
| 34 | P2 | `packages/services/src/missions.ts` (`selectEvidence`) | **STILL PRESENT.** Neither the FIELD nor DOCUMENT branch compares the candidate's field key/`docType` against `requirement.fieldKey`/`requirement.docType` — only applicant ownership is checked. | A crafted/stale selection request can attach any of the applicant's facts/documents to any requirement, corrupting readiness computation. | Validate the fact's field-definition key against `requirement.fieldKey` (FIELD branch) and the document's `docType` against `requirement.docType` (DOCUMENT branch) before accepting a selection. | Test: a selection request naming a fact/document that doesn't match the requirement's field key/doc type is rejected. | **PR-D** |

### 4.11 PR #64 findings (2)

| # | Sev | File/function | Verification | Impact | Correction | Test | Disposition |
|---|---|---|---|---|---|---|---|
| 35 | P2 | `apps/web/src/app/api/health/ready/route.ts` | **STILL PRESENT** (verified directly by this session, not delegated). `commercialReadiness: commercial` is included in **both** the verbose and non-verbose response branches (only `env`/`db`/`capabilities` are gated by `verbose`) — on a real deployment in commercial mode, the full per-gate breakdown (pentest status, backup status, security-finding attestations, etc.) is still publicly exposed. | Unauthenticated disclosure of detailed security/operational posture on a real deployment. | On a real deployment (`isRealDeployment()`), reduce the exposed `commercialReadiness` to aggregate `ready: boolean` only; require authenticated platform-admin access for the full per-gate breakdown. | Test: on a simulated real deployment, the unauthenticated readiness response contains no gate-level detail, only the aggregate boolean. | **PR-E** |
| 36 | P2 | `apps/web/src/lib/providers.ts` (`validateProviderEnv`) | **STILL PRESENT** (verified directly by this session). `validateProviderEnv()` exists and is exercised only by its own unit tests — grep confirms zero callers anywhere in `apps/web/src/app` (including the readiness route, which this session read in full). An unsupported value for a not-yet-constructed provider (e.g. `DATABASE_PROVIDER=supabase`) is silently ignored at runtime. | Configuration drift for an unbuilt provider port goes undetected — defeats the "fail loudly, never silently no-op" contract the provider registry advertises. | Call `validateProviderEnv()` from the readiness route (or an equivalent guaranteed startup path) so an unsupported value makes readiness fail loudly. | Test: setting an unsupported provider env var makes `/api/health/ready` report not-ready, even for a provider whose factory is never otherwise invoked. | **PR-E** |

---

## 5. Summary

- **36/36** GitHub review findings re-verified against current `main`.
- **1 FIXED** (finding #1), **1 PARTIALLY FIXED** (finding #3 — one of two
  functions repaired), **34 STILL PRESENT**.
- **3 additional defects** found independently during this baseline (not from
  a review thread): D-T1 (flaky test timeouts), D-T2 (Turbo abort-on-failure
  masking sibling test summaries), D-RT1 (unhandled `STEP_UP_SIGNING_SECRET`
  exception on `/app/privacy/export`).
- **0 findings dismissed without code-level proof** — every "still present"
  verdict above cites the exact current file/line and quotes the operative
  code; the one "fixed" verdict cites the specific later commit/PR that
  closed it.
- No code was changed to produce this document (Phase 0 is read-only,
  matching the governing directive's own §6 requirement).

Next: Phase 1 implementation (PR-A — access, consent and authorization
closure) branches from this exact commit (`f3f6975`).
