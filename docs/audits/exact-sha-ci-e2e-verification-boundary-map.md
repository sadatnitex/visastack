# Exact-SHA CI, deployed E2E verification, and the Vercel preview-failure pattern (PR-E2)

Written for PR-E2, closing the gap between the governing directive's own
testing standard (`docs/roadmap/commercial-recovery-completion-ux-directive.md`
§8 "Testing standard") and what CI actually did. Unlike PR-A through PR-E1,
this PR does not close numbered findings from the original GitHub review —
§8 is a standing process requirement the whole programme was meant to satisfy
for every PR, not a defect discovered in application code. Documents what was
actually wrong, what changed, and what's still open — matching the honesty
pattern of the other per-PR boundary-map docs in this directory.

## 1. Exact-SHA CI — the gap

Directive §8, "Deployment tests": *"For every PR: test exact deployed
commit... A deployment test may not check out tests from another revision."*

`actions/checkout@v4` with no explicit `ref` resolves differently depending
on the triggering event, and none of the four workflows that build/test this
repo pinned one:

| Workflow | Trigger | Default checkout without a pinned `ref` | Problem |
|---|---|---|---|
| `ci.yml` | `pull_request` | GitHub's synthetic `refs/pull/N/merge` — the PR branch merged onto whatever `main` currently is | Confirmed directly in job logs across this session (e.g. "HEAD is now at 4d2c58f Merge 9655896...5344 into 9278867...07"): CI validated a merge PREVIEW, not the PR's actual head SHA — the exact commit Vercel builds as the preview deployment and the exact commit that becomes the merge parent. If `main` moved between CI running and the PR merging, CI's green check was never run against either the exact pre-merge or post-merge tree. |
| `deploy-smoke.yml` | `deployment_status` | Ambiguous/event-dependent default resolution of `github.sha` | The smoke script (`scripts/smoke.mjs`) itself could change between commits; an ambiguous checkout means a fix to the script isn't guaranteed to test itself at the deployment's own revision. |
| `playwright-smoke.yml` | `deployment_status` | Same as above | Same reasoning — `no-secret-auth.spec.ts` should run at the exact revision of the deployment it's checking. |
| `workos-staging-e2e.yml` | `deployment_status` / `workflow_dispatch` | Same as above | Same reasoning — `authenticated-workspace.spec.ts`. |

## 2. Exact-SHA CI — the fix

Every workflow now pins `checkout`'s `ref` explicitly:

- `ci.yml`: `${{ github.event.pull_request.head.sha || github.sha }}` — the
  PR's actual head SHA on `pull_request` events; falls through to
  `github.sha` (already correct) on `push` events, where
  `github.event.pull_request` doesn't exist.
- `deploy-smoke.yml` / `playwright-smoke.yml` / `workos-staging-e2e.yml`:
  `${{ github.event.deployment.sha }}` — the exact commit the
  `deployment_status` event's own payload names as deployed.
  `workos-staging-e2e.yml` additionally falls back to `github.sha` for its
  `workflow_dispatch` trigger, where `github.event.deployment` doesn't
  exist and `github.sha` already correctly resolves to whatever ref the
  operator selected when manually dispatching.

`db-migrate.yml` (manual `workflow_dispatch` only) was left unchanged — an
operator manually selects the exact branch/tag to run against from the
Actions UI, so `github.sha` is already unambiguous by construction; there is
no "which revision" question for a human-triggered, human-selected run.

**Verification.** All four edited workflow YAML files parse
(`python3 -c "import yaml; yaml.safe_load(open(...))"`, confirmed clean for
all four). This class of change has no meaningful unit-test surface — it's
GitHub Actions expression syntax, not application code — so verification is
YAML validity plus direct reasoning about each event payload's documented
fields, not an automated test. The real proof is empirical: the next PR
through this pipeline will show `ci.yml`'s checkout step actually resolving
to the PR's head SHA rather than a `pull/N/merge` ref, visible directly in
that PR's own job logs.

## 3. Deployed E2E verification — the gap

Directive §8, "Browser E2E," names two full journeys to run against a
deployed preview:

- **Applicant journey** (22 steps): sign in → grant consent → create
  applicant → complete core profile → upload synthetic evidence → observe
  real processing → review filename → review AI/deterministic proposals →
  approve selected facts → verify history and evidence → create mission →
  map evidence → share narrow permission → verify recipient sees only
  allowed content → pause grant → verify immediate denial → resume valid
  paused grant → revoke → verify it cannot resume → export own data →
  request deletion → verify external-object deletion workflow.
- **Agency journey** (8 steps): org admin signs in → accepts organization
  grant → assigns active member → member sees assigned case only → requests
  permitted evidence → adds permitted note → attempts unauthorized case
  access and is denied → export includes exact granted subset only.

Before this PR, `apps/web/e2e/authenticated-workspace.spec.ts` had 6 tests
covering a small slice: sign-in, one create-applicant-and-persist-a-fact
flow, sign-out denial, a cross-tenant 404 probe, a unicode display-name
check, and an accessibility scan. Missing entirely: consent granting as its
own step, document upload/processing/filename-review/AI-proposal-review,
mission creation, sharing (grant creation, revoke, pause/resume), history,
export, deletion, and the entire Agency journey.

## 4. Deployed E2E verification — the fix

`authenticated-workspace.spec.ts` now has 21 tests across three
`describe` blocks:

1. **`authenticated workspace journey`** — the original 6 tests, unchanged.
2. **`applicant journey — consent, evidence, missions, sharing, privacy`**
   (7 new tests, single-identity-feasible, run `.serial` — see round 1
   below): grants and independently revokes core-processing and sharing
   consent; uploads a document with passport-shaped synthetic content and
   polls for a terminal processing status via real page reloads (never a
   fixed delay — "real processing, never faked progress," directive §7
   "PR 7"), then conditionally reviews a filename proposal if the
   deterministic classifier offered one; creates a mission; verifies
   sharing to an address with no VisaStack account fails safely with a
   clear error and creates no grant row; views fact history; exports
   account data and confirms a downloadable `.json`; and requests account
   deletion, confirms the pending grace-window state, then cancels it
   within the same test.
3. **`cross-account boundary journeys — NOT YET COVERED`** (8 new tests,
   all self-skipping): every directive §8 step that can only be
   *meaningfully* verified with a second, independent identity — including,
   after round 1, real grant creation itself (see below).

**Codex review, PR-E2, round 1 (two P1s, one P2) — all in this new spec,
none in the CI-workflow changes.**

1. **P1 — the sharing test asserted the opposite of what the app actually
   does.** The first draft's "shares narrow access and can revoke it before
   the recipient ever accepts" test shared to a fabricated
   `@example.invalid` address and asserted a grant row appeared.
   `createGrantAction` (`apps/web/src/app/app/applicant/[id]/sharing/
   actions.ts:61-66`) looks the recipient up with `getAccountByEmail` and
   returns an error — creating **no** grant row — when the address belongs
   to no real account. The test would always time out waiting for a row
   that could never exist; real grant creation needs a genuine second,
   provisioned account, not just a syntactically valid email. Fixed by:
   replacing the test with one that asserts the *correct* behavior single-
   identity testing can actually prove — that the app fails safely with a
   clear "No VisaStack account found" message and creates no grant row for
   an unowned address — and moving the real "create a grant, then revoke it
   before acceptance" scenario into the cross-account boundary block (block
   3), since it now requires a second account to get past its very first
   step.
2. **P1 — the processing-status wait could never observe a real, healthy
   upload succeeding.** Two compounding bugs: (a) the regex
   (`/ready|needs attention|failed|rejected/i`) omitted `AWAITING_REVIEW`'s
   actual UI label, "Needs review" (`packages/i18n/src/messages.ts`) — the
   correct terminal state for a normal, safe, non-auto-approved upload, so
   healthy processing was treated as a timeout; (b) `documents/page.tsx` is
   a `dynamic = 'force-dynamic'` Server Component with no client-side
   polling — the status renders once, server-side, at request time.
   Playwright's web-first assertions auto-retry against the
   *already-loaded* DOM; they never re-fetch the page on their own, so
   waiting on a locator here would just keep re-checking the same stale
   initial render forever, regardless of what changed in the database.
   Fixed with a new `waitForTerminalProcessingStatus` helper that polls via
   real `page.goto()` reloads on a bounded interval, and a `TERMINAL_
   PROCESSING_STATUS` regex that includes "needs review".
3. **P2 — shared-account tests needed serial execution.** `playwright.
   config.ts` has `fullyParallel: true`; every test in block 2 mutates the
   same single account's consent/deletion state, so a mid-test consent
   revoke in one test could race a concurrently-running test's own
   consent-gated action in another (e.g. the consent test's revoke
   overlapping the sharing test's `ensureConsent` + submit). Fixed by
   converting block 2 to `test.describe.serial(...)` — isolated
   per-applicant state (documents, missions) doesn't need this, but the
   account-level state does, and serializing the whole block is more
   robust than trying to cherry-pick which specific tests race.

**Verification (round 1).** `pnpm exec tsc --noEmit` (apps/web) — clean.
Playwright lists and runs all 21 tests correctly
(`npx playwright test --list` / `npx playwright test`), all reporting
`skipped` without credentials. This class of fix (test-authoring
correctness caught by review, not a fix to already-tested application
logic) has no separate non-vacuousness check of its own — the "proof" is
that the corrected assertions now match the actual, source-verified
application behavior (`getAccountByEmail`'s real return value; `messages.ts`'s
real label strings; `documents/page.tsx`'s real render model), each
re-confirmed by reading the relevant source directly, not re-derived from
memory.

**Why the boundary tests are skipped rather than faked.** A single account
sharing access to itself, or assigning itself as an org's only member, would
exercise the code paths without proving the thing the directive actually
asks for: that a *different* account is denied. A green check on a
self-dealing test would be worse than no test — it would imply tenant
isolation was verified when it wasn't. Each of the 8 skipped tests calls
`test.skip(true, reason)` with an explicit, printed reason
(`requires a second synthetic WorkOS-staging identity
(WORKOS_STAGING_TEST_EMAIL_2 / _PASSWORD_2), not yet provisioned`) rather
than being silently absent from the file — the gap stays visible in every
run's own output, matching this programme's established disclosure
discipline (e.g. the page-level `.tsx` coverage disclosures in PR-D2/PR-E1).

**Also explicitly out of scope**, each documented inline at its own site in
the spec file:
- **"Map evidence"** against a published requirement pack — needs either a
  pre-seeded pack fixture or platform-admin pack-authoring automation in
  whatever environment this eventually runs against; neither can be safely
  assumed to exist.
- **AI/deterministic proposal review** is best-effort/conditional, not a
  hard assertion — `AI_ENABLED` plus a real OpenAI project may or may not
  be configured wherever this runs; asserting it unconditionally would fail
  the test on a legitimate "AI isn't configured here" state, not a defect.

**Verification.** `pnpm exec tsc --noEmit` (apps/web) — clean. Playwright
itself parses and lists all 21 tests correctly
(`npx playwright test --list e2e/authenticated-workspace.spec.ts`) and,
run without credentials (this session has none), reports all 21 as
`skipped` — 13 via the existing `!hasCredentials` guard, 8 via their own
explicit `test.skip(true, reason)` regardless of credentials — confirming
the skip logic itself is correct. **This spec still cannot be run against
real WorkOS staging in this session** (no credentials available) — it
carries forward the pre-existing "implemented, not yet verified" caveat
from the file's own header, now explicitly scoped to the 13
credential-gated tests; the 7 boundary tests are unconditionally skipped
regardless of credentials until a second identity exists.

## 5. The Vercel preview-failure pattern — investigated

Every non-production (PR-preview) deployment throughout this entire
programme has ended in `state: ERROR`, while every production deployment
has reached `READY` — noted as a "known, out-of-scope pattern" without
investigation in every prior PR this session. Investigated properly here,
directly against two independent recent failed deployments
(`dpl_6oMwbX9x7aYSRy9jkCE4WFPPZ7rb`, `dpl_DRbWbfcwZRMG832TVk34oz1tPeYF`):

**Confirmed facts**, identical across both:
- `errorCode: "BUILD_FAILED"`, `errorMessage: "Resource provisioning
  failed"`.
- `buildingAt` → `ready` (i.e. terminal) in **under 1.5 seconds** — no real
  build step (install, `next build`, etc.) can complete in that window.
- **Zero build-log events** (`get_deployment_build_logs` returns "No build
  log events found") — not a compile/runtime error with output, a failure
  before any build container produced log lines at all.
- Every production deployment at the same points in time (`dpl_GavsS7tK…`,
  `dpl_9DCbKBt2…`, `dpl_A54cTKgS…`, etc.) reached `READY` normally, with
  full build logs, at the same `buildCommand`.

**Strongest lead, not yet tool-confirmable.** `apps/web/vercel.json`'s
`buildCommand` is `pnpm --filter @visastack/db db:migrate && next build` —
**every** deployment, preview or production, runs a real database
migration against a live Postgres connection *before* any Next.js build
output exists. A missing or environment-unscoped `DATABASE_URL` (or the
Neon/Vercel-Postgres integration's usual `POSTGRES_URL*` variants) for the
Preview environment specifically would make `db:migrate` fail to even
resolve a connection near-instantly — consistent with the sub-1.5s timing,
the total absence of build-log output, and production's consistent success
(implying the connection string genuinely is present and correct for
Production). This is a strong, evidence-consistent hypothesis, not a
tool-confirmed root cause: nothing available to this session can enumerate
Vercel's per-environment Environment Variables scoping
(`get_project` returns no env var listing; there is no
list-environment-variables tool in this session's toolset).

**Not this PR's to fix.** Confirming and resolving this requires Vercel
dashboard access this session doesn't have — Project Settings →
Environment Variables, checking whether the database connection
string(s) are scoped to Production only, and if so, adding the same
value(s) (a preview/dev Neon branch, ideally, not the production database
itself) scoped to Preview as well. Documented here, with the exact
evidence and the exact next diagnostic step, rather than left as an
unexamined "known pattern" for an eighth consecutive PR.

## 6. What this PR does not cover

- The Vercel preview-failure root cause is investigated and documented, not
  fixed (§5) — fixing it needs dashboard-level access outside this
  session's tool surface.
- The 8 cross-account boundary E2E tests remain skipped (§4) — need a
  second synthetic WorkOS-staging identity, not yet provisioned as a
  repository secret.
- "Map evidence" and AI-proposal review remain unverified/best-effort in
  the E2E spec (§4) — genuinely environment-dependent, not something this
  spec can respons­ibly assume.
- No change was made to the authorization-attack-suite or file-security
  test lists directive §8 also names — those are unit/integration-level
  requirements already covered by `packages/services`' and
  `packages/adapters`' own extensive test suites (338 and 88 tests
  respectively as of PR-E1), not something this PR's E2E-focused scope
  re-verifies.
