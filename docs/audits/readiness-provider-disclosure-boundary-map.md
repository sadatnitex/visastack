# Readiness / provider-validation / public-disclosure boundary map (PR-E1)

Written for PR-E1, closing findings #35 and #36 in
[`post-programme-defect-register.md`](./post-programme-defect-register.md) —
the "Readiness/provider validation/disclosure" disposition category.
Documents what `/api/health/ready` actually discloses today, to whom, and
what this PR closed — matching the honesty pattern of the other per-PR
boundary-map docs in this directory.

## 1. Who can reach `/api/health/ready`, and how

The route itself (`apps/web/src/app/api/health/ready/route.ts`) has no
authentication check of its own — it is, deliberately, a load-balancer/
platform health probe. Two real paths reach it:

- **Unauthenticated, directly.** Any caller (load balancer, uptime monitor,
  or a plain `curl`) can hit the route with no session.
- **Unauthenticated, via the public `/status` page**
  (`apps/web/src/app/status/page.tsx`) — a `'use client'` page with **no**
  `withSession` gate, not nested under `/app/`. It polls `/api/health/ready`
  client-side every 15s and renders every key/value pair from the response
  body one level deep (`toRows()`). Whatever the route returns in its body,
  a member of the public can see rendered on this page. This is the exact
  reachability path that made finding #35 a real, not theoretical,
  disclosure.

`verbose` (the route's own internal flag) is `!isRealDeployment()` —
`isRealDeployment()` (`apps/web/src/lib/deployment-mode.ts`) is true for
`controlled_pilot` **and** `commercial`, false only for `development`. One
non-obvious consequence, load-bearing for both findings below: an explicit
`DEPLOYMENT_MODE=commercial` override makes `getDeploymentMode()` return
`'commercial'` regardless of `VERCEL_ENV`, so commercial mode is *always* a
"real deployment" as far as this split is concerned — there is no
"commercial mode, but verbose" state to design around.

## 2. Finding #35 — the public response leaked the full commercial-readiness gate breakdown

`evaluateCommercialReadiness()` (`apps/web/src/lib/commercial-readiness.ts`)
returns `{ ready: boolean, gates: ReadinessGate[] }` — 19 named gates,
including operational/security-posture facts that are not presence
booleans: whether an external penetration test happened, whether a backup
restore was verified, whether a named incident owner exists, whether the
tenant-isolation suite ran. Before this PR, **both** the verbose and
non-verbose response branches spread the full `commercial` object in as
`commercialReadiness: commercial` — the `verbose` gate that correctly
withholds `env`/`db` detail on a real deployment did nothing for this field.
Reachable, unauthenticated, on production, via `/status` (§1).

**Fix:** the non-verbose branch now includes only
`{ commercialReadiness: { ready: commercial.ready } }` — the verbose branch
is unchanged (full `commercial`, including `gates`). Per §1's
`DEPLOYMENT_MODE`-override note, `commercial` is only ever computed when
`deploymentMode === 'commercial'`, which is always non-verbose — so in
practice the full-gates verbose branch is unreachable via this route today,
by construction, not by a second check. Nothing else about the route's
existing `env`/`db` withholding pattern changed.

**The full per-gate breakdown still needs a home** for an operator to act on
a 503 — it moved to the authenticated, platform-admin-gated `/app/admin`
page (`apps/web/src/app/app/admin/page.tsx`, new "Commercial readiness"
card), which independently calls `evaluateCommercialReadiness` with
`databaseReady: true`. That input is sound, not assumed: by the time that
call runs, several other real queries against the same `db` handle have
already succeeded in the same request's `Promise.all` — DB connectivity is
already proven, not merely hoped, for this specific call site.

**Test coverage.** `route.test.ts`: "exposes only the aggregate ready
boolean on a real deployment, never the per-gate breakdown" — sets
`DEPLOYMENT_MODE=commercial` (+ `VERCEL_ENV=production`, for an explicit,
unambiguous reader signal even though §1 means it's redundant), asserts
`commercialReadiness` deep-equals `{ ready: false }` and that neither
`realMalwareScanner` nor `externalPenetrationTest` appear anywhere in the
serialized body (a string-level check, not just the parsed object — guards
against the detail being smuggled into some other field by a future
refactor). Verified non-vacuous: temporarily reverting the non-verbose
branch to the old `commercialReadiness: commercial` made exactly this test
fail (the full 19-gate array reappeared), confirmed, then restored. The
pre-existing test this replaced ("names the specific unmet gates so an
operator can act on the 503") asserted the OLD, insecure behavior; per-gate
content itself (e.g. that `realMalwareScanner` can never be attested past)
is already covered independently at the pure-function level by
`commercial-readiness.test.ts`.

**Not covered:** no `.tsx`-level unit test exists for the admin page's new
card (this codebase's established, pre-existing constraint — Vitest covers
route/lib-level tests; JSX/component behavior is Playwright's job; no
page-adjacent test exists anywhere in the codebase, most recently
reconfirmed investigating PR-D1/PR-D2's own page-level findings). Verified
instead by direct code review of the full authorization path
(`withSession` → `isPlatformAdmin` gate, unchanged, already covered by the
page's pre-existing admin-gating tests-by-review) and by the fact that
`evaluateCommercialReadiness` itself — the only new logic the card calls —
is already thoroughly tested.

## 3. Finding #36 — `validateProviderEnv()` had zero callers

`validateProviderEnv()` (`apps/web/src/lib/providers.ts`) validates every
`*_PROVIDER` env var against `KNOWN_PROVIDERS`, throwing on a set-but-
unsupported value (e.g. a typo, or a provider planned but not yet built).
Every individual `create*Port()` factory in that file already calls the
underlying `checkKnownProvider` for its own var — but nothing called
`validateProviderEnv()` itself, the one function meant to validate every
var up front, independent of whether that var's port is ever constructed
on a given request. `DATABASE_PROVIDER` and `JOB_PROVIDER` in particular
have no `create*` factory at all (§ doc comment in `providers.ts` — the
database is Drizzle-over-Neon directly, the job queue is
`packages/services/src/jobs.ts`'s functions), so those two could never be
validated by any existing call path.

**Fix:** `/api/health/ready` now calls `validateProviderEnv()` once per
request, folding the result into `coreReady` alongside DB connectivity and
WorkOS config — the "one guaranteed startup/readiness path" the finding's
proposed correction names. A caught validation error becomes
`providers: { valid: false, error: <message> }`; the message only ever
names a `*_PROVIDER` key and the provider-name values this deployment
supports (never a secret), but is still verbose-gated like every other
diagnostic field here — only its effect on `coreReady`/`status`/the HTTP
code is always public.

**Test coverage.** `route.test.ts`, two new tests: (1) an unsupported
`MALWARE_SCANNER_PROVIDER` makes the route report 503/`degraded` even
though DB and WorkOS are both otherwise ready; (2) the verbose body names
the offending var (`/MALWARE_SCANNER_PROVIDER/`), while the same
misconfiguration on a real deployment (`VERCEL_ENV=production`) still
degrades `status` but omits `providers` entirely from the body. Verified
non-vacuous: temporarily dropping `&& providers.valid` from `coreReady`
made exactly these two tests fail (200/`ready` instead of 503/`degraded`),
confirmed, then restored; no other test in the file was affected either
time.

**Test-infrastructure note.** Wiring `providers.ts` into `route.ts`
transitively pulls in `./identity-provider` → `@workos-inc/authkit-nextjs`,
whose `next/cache` import doesn't resolve outside a real Next.js runtime —
the exact issue `providers.test.ts` already documents and works around.
`route.test.ts` now carries the same
`vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth: vi.fn() }))`
for the same reason.

**Codex review, PR-E1, round 1 (P1): blank optional `*_PROVIDER` values
broke the standard local-dev setup.** `checkKnownProvider` treated any
value other than `undefined` as "configured," including `''`. Every
optional `*_PROVIDER` line in `.env.example` is declared present but blank
(`IDENTITY_PROVIDER=`, etc. — confirmed directly), so the standard
`cp .env.example .env.local` workflow sets each one to `''`, not
`undefined`, in `process.env`. Before `validateProviderEnv()` gained a real
caller this distinction was inert — nothing called it, so it never actually
rejected anything at runtime; wiring it into the readiness route (this PR's
own fix, above) made it live, and every freshly-copied local environment
would have reported readiness `degraded` on the very first optional
provider var, even with DB and WorkOS both genuinely configured. Fixed by
treating a blank string the same as unset in `checkKnownProvider` itself —
the one function every `create*Port()` factory and `validateProviderEnv()`
already funnel through, so the fix applies uniformly rather than needing a
per-caller patch. New tests: `providers.test.ts` (`validateProviderEnv`
doesn't throw when every var is set to `''`) and `route.test.ts` (the
route reports `ready`/200 with `providers: { valid: true }` under the same
condition). Verified non-vacuous: temporarily narrowing the guard back to
`value === undefined` made exactly these two new tests fail (`IDENTITY_PROVIDER`
rejected as unsupported; the route degraded to 503), confirmed, then
restored — no other test in either file was affected either time.

## 4. What this PR does not cover

- **`DATABASE_PROVIDER`/`JOB_PROVIDER` still construct nothing** —
  `validateProviderEnv()` only proves the *value* is one this deployment
  recognizes; there is still no `create*` factory for either (see §3),
  because there is no second implementation to select between yet. That is
  unchanged, pre-existing, and out of scope here.
- **The admin-only "Commercial readiness" card is read-only** — it does not
  add any way to satisfy an attestation gate from the UI (those remain
  env-var-only by design, per `commercial-readiness.ts`'s own "no escape
  hatch" doc comment).
- **`/status` itself is unchanged** — it still renders whatever
  `/api/health/ready` returns, unauthenticated, one level deep. That is the
  correct design (a public liveness/readiness surface); this PR's fix is
  entirely in *what the route returns*, not in restricting who can view
  `/status`.
