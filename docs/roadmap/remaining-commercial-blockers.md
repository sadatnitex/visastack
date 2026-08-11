# Remaining commercial blockers

Referenced from `docs/audits/post-programme-defect-register.md` §1.3 and §5.2
(both promised this file and, until PR-F1, it didn't exist — closed as part
of PR-F1's own documentation-cleanup scope). This is the single place every
still-open item from the whole post-programme defect-closure engagement is
recorded, so none of them get silently dropped once the register itself
reports zero open findings. **A defect being fixed is not the same claim as
commercial-launch readiness** — this file is the honest difference between
the two.

Authority for the commercial-mode gate list itself:
`apps/web/src/lib/commercial-readiness.ts` (`buildGates`) — read that file
directly for the live, authoritative 19-gate list; this document explains
*why* each still-open one is open and what closes it, it does not restate
the gate mechanics.

## 1. Commercial-readiness gates not yet satisfiable by configuration alone

`DEPLOYMENT_MODE=commercial` returns HTTP 503 on `/api/health/ready` and
keeps `publicSignup`/`realApplicantData`/`commercialClaims` disabled in the
capability registry until every gate below is true. None of this programme's
work — PR-A through PR-F1 — claimed any of these; they were never in scope
for a defect-closure engagement operating on Vercel Hobby / WorkOS staging
under the master directive's "not approved now" infra list (§5).

| Gate | Kind | What closes it |
|---|---|---|
| `realMalwareScanner` | Hardcoded `false` | Build and wire a real malware-scanning adapter (e.g. ClamAV) behind `MalwareScannerPort` — a genuine future PR, not a config change. `BasicSafetyScanner` (the pilot default) is structural/magic-byte validation only, by design (ADR-0011). |
| `workosProduction` | Live + attestation | Provision a real WorkOS *production* project (staging is what the pilot uses today) and set `COMMERCIAL_READINESS_ATTEST_WORKOS_PRODUCTION=true`. |
| `productionDatabase` | Live | Already satisfied whenever the DB is reachable and migrated — no outstanding work, just needs to be true on whatever deployment activates commercial mode. |
| `privateProductionStorage` | Live | Already satisfied by `BLOB_READ_WRITE_TOKEN` being set — true today on the pilot deployment. |
| `stepUp` | Live | Already satisfied by `STEP_UP_SIGNING_SECRET` being set. |
| `productionOpenAiProject` | Live | Only applies when `AI_ENABLED=true` (currently off). A separate production OpenAI project + `OPENAI_PROJECT_ID` would be needed before enabling AI commercially. |
| `externalObjectDeletionVerification`, `tenantIsolationSuite`, `permissionMatrix`, `privacyConsentConfiguration`, `backupRestoreVerification`, `authenticatedProductionE2e`, `incidentOwner`, `termsAndPrivacyNotice`, `noCriticalHighFindings`, `externalPenetrationTest` | Attestation-only | Each requires a human to actually perform and verify the named activity (an external pen-test happens; a named person owns incidents; a restore drill is actually rehearsed; `tenant-isolation.test.ts`/the permission matrix are run against production data shapes, not just PGlite) and then set the matching `COMMERCIAL_READINESS_ATTEST_*=true` var. No server-side check can verify these itself, by design — that is the entire reason they're attestation-gated rather than live-checked. **None are attested on the current deployment**, so commercial mode stays `ready: false` regardless of every code-level fix in this register. |

The design is deliberate: an operator cannot accidentally flip commercial
mode on by setting env vars alone for the attestation-gated majority of this
list. Getting to `ready: true` is an operational program, not a pull request.

## 2. Vercel preview-deployment build failures (root cause hypothesized, not fixed)

Documented in full, with reproducible evidence, in
[`docs/audits/exact-sha-ci-e2e-verification-boundary-map.md`](../audits/exact-sha-ci-e2e-verification-boundary-map.md)
§5 (PR-E2) and independently in
[`post-programme-defect-register.md`](../audits/post-programme-defect-register.md)
§3 (Phase 0, PR #64 investigation) — the same signature recurring across
PRs #58–#64 and again during this programme: every **preview** deployment
for a PR branch fails (`errorCode: BUILD_FAILED`, `"Resource provisioning
failed"`, terminal in under 1.5–1.7 seconds, zero build-log lines), while
the **production** deployment for the exact same final commit, once merged,
always succeeds normally with full build logs.

Strongest lead: `apps/web/vercel.json`'s `buildCommand` runs a real database
migration (`pnpm --filter @visastack/db db:migrate`) before `next build` on
every deployment, preview or production. A missing or unscoped `DATABASE_URL`
for the Preview environment specifically — as opposed to Production, where
it's clearly set — would fail near-instantly with no build output, which is
consistent with every observed fact. This has not been tool-confirmable from
any session so far: none of them have had Vercel dashboard / environment-
variable-listing access.

**What closes it:** in the Vercel dashboard, Project Settings → Environment
Variables, confirm `DATABASE_URL` (and any sibling connection-string vars —
`POSTGRES_URL`, etc.) is scoped to the **Preview** environment, not just
Production. If it's already scoped correctly, the next diagnostic step is
requesting `get_deployment_build_logs` with a Vercel API token that has
account-level (not just deployment-level) access, to see whether the
provisioning failure is a Hobby-tier build-concurrency ceiling instead (this
account's team runs 6 total projects that can compete for Hobby's single
concurrent-build slot — the alternative hypothesis §3 of the Phase 0
baseline names, also not tool-confirmable so far).

**Why this hasn't blocked the programme:** every PR in this engagement was
verified against the **production** deployment post-merge (which has never
once failed for this reason), not the preview. The preview failure means PR
reviewers don't get a live preview URL to click through during review —
real, but a review-convenience gap, not a correctness or security gap in
anything this register tracks.

## 3. Deployed E2E coverage gaps (implemented, not yet run against real WorkOS staging)

`apps/web/e2e/authenticated-workspace.spec.ts` (55 tests across 3 describe
blocks, built out across PR-A through PR-E2) requires
`WORKOS_STAGING_TEST_EMAIL`/`WORKOS_STAGING_TEST_PASSWORD` repository
secrets to run at all. **No session in this entire engagement has had these
secrets available**, so the spec's correctness rests on direct code review
plus `npx playwright test --list`/a full `--project=chromium` run confirming
every test reports `skipped` (not `failed`) without credentials — never on
an actual pass against live WorkOS staging. This is the same "implemented,
not yet verified" gap `docs/audits/current-product-baseline.md` disclosed
for the authenticated Playwright spec back at the very start of this
product's audit history, and it remains true today for the same reason.

A further 8 tests inside that same file are **unconditionally** self-skipped
(via `test.skip(true, reason)`, independent of the credential guard above)
because they need a *second*, independent synthetic identity to prove a
cross-account/cross-tenant boundary meaningfully — a self-dealing
single-identity test would exercise the code path without proving isolation,
which this programme's own discipline treats as worse than no test at all
(see the register's own "honest disclosure" principle, applied consistently
from PR-A onward). Provisioning `WORKOS_STAGING_TEST_EMAIL_2`/
`WORKOS_STAGING_TEST_PASSWORD_2` as repository secrets closes this — no code
change is needed, the tests are already written and waiting.

## 4. Dependency-audit residue (dev-only, non-blocking, deliberately deferred)

PR-F1 closed every **production**-path finding `pnpm audit --prod` reported
(a HIGH-severity `nanoid` finding via `next>postcss>nanoid`, a MODERATE
`postcss` finding, and three MODERATE `undici` findings via
`@vercel/blob`) with three one-line `pnpm.overrides` version-floor bumps —
`pnpm audit --prod` now reports **no known vulnerabilities**.

`pnpm audit --dev` still reports 6 findings (1 critical, 1 high, 4
moderate), all rooted in `vitest@2.1.9`/`vite@6.4.x`/`esbuild` — none of
which ship in the production bundle (confirmed by the clean `--prod` audit
above; the Vitest UI server these advisories concern is never started
anywhere in this repo's scripts or CI). Closing them requires bumping
`vitest` from `^2.1.8` to a `3.x` release across every package — a **major**
version bump with real potential for test-config/API breakage across all 55
test files in this monorepo, deliberately out of scope for a
documentation-and-cleanup PR. Tracked here as a concrete, named follow-up
rather than left as an unlabeled "known issue" — pin the target version,
bump in one dedicated PR, and re-run the full suite before merging it.

## 5. What is genuinely, fully closed (for contrast)

So this file reads as a complete picture, not just a list of gaps: every
numbered finding in `docs/audits/post-programme-defect-register.md` — all
36 original GitHub review findings, all 4 baseline-discovered defects, and
all 18 findings Codex raised against this programme's own new code — is
closed as of PR-F1 (§5.2 of that register). Full monorepo lint, typecheck,
55 test files across 7 packages, and production build all pass clean. None
of the four items above were ever findings in that register; they are
scope this defect-closure engagement was never asked to close, recorded
here so the distinction between "defects fixed" and "ready to launch" stays
explicit.
