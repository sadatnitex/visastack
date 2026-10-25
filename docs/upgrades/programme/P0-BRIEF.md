# WP-P0 brief: WorkOS retirement

Status: written 25 Oct 2026. Approval: proceeding under the owner's autonomous-work mandate of 24 Oct 2026 ("implement the whole thing by yourself ... merge and deploy upon checking everything"), recorded here and reported in the PR. D10 approved 24 Oct 2026.

## Why it is safe to do now

- Production and previews select Neon Auth (`IDENTITY_PROVIDER=neon_auth`); production health reports authentication available. The WorkOS code runs only when that setting is absent or different, so no live sign-in path changes.
- Every WorkOS site already sits beside a working Neon Auth branch chosen by `selectedIdentityProvider()`. Retirement keeps the Neon branch and deletes the WorkOS one.

## Inventory on main (`git grep -i workos`, runtime code only)

| File | What WorkOS does there | Change |
| --- | --- | --- |
| `apps/web/package.json` | `@workos-inc/authkit-nextjs` dependency | remove; regenerate the lockfile with pnpm |
| `apps/web/src/middleware.ts` | `authkitMiddleware` when not Neon | Neon middleware only |
| `apps/web/src/lib/identity-provider.ts` | `WorkosIdentityPort` (`withAuth`) | remove the class; keep `NeonIdentityPort` |
| `apps/web/src/lib/providers.ts` | picks WorkOS or Neon port | Neon port only |
| `apps/web/src/lib/session.ts` | `withAuth` branch | Neon branch only |
| `apps/web/src/lib/session-age.ts`, `step-up.ts` | `checkRecentAuth`, `getSignInUrl` | Neon recency (`neon-recency.ts`) only |
| `apps/web/src/lib/sign-out.ts` | `signOut` | Neon sign-out only |
| `apps/web/src/app/callback/route.ts` | `handleAuth` (WorkOS OAuth callback) | route returns to sign-in (no WorkOS callback exists any more) |
| `apps/web/src/app/api/session-reauth/route.ts` | `getSignInUrl` | Neon re-authentication URL only |
| `apps/web/src/lib/identity-selection.ts` | default provider is WorkOS when unset | provider selection removed; Neon Auth is unconditional. A leftover `IDENTITY_PROVIDER` other than `neon_auth` is refused by `createIdentityPort` and reported by readiness; missing Neon settings make protected pages fail closed and the public beta stays shut |
| `apps/web/src/lib/env.ts`, `readiness.ts`, `commercial-readiness.ts`, `capabilities.ts` | `WORKOS_*` presence checks, `isWorkosConfigured`, `WORKOS_PRODUCTION` attestation | Neon Auth configuration only; health payload keeps its shape |
| `apps/web/src/lib/csp.ts` | WorkOS form-action origins and redirect origin | removed |
| `apps/web/src/app/app/admin/page.tsx` | lists missing `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | Neon settings only |
| `apps/web/src/lib/authkit-paths.ts` and its test | WorkOS path list | removed (unused after the middleware change); the CSP middleware test now uses the Neon path rule |
| `apps/web/preview/render.preview.tsx` | mocks the WorkOS package | mock removed |
| comments in `packages/services/src/ports.ts` and two mission files | name WorkOS | reworded |

## Kept exactly (stored data and names bound to it)

- Columns `workos_user_id` in `packages/db/src/schema.ts` (accounts and the second table) and every migration. No migration, no rename, no data change.
- Service fields named `workosUserId` in `packages/services` (they map to that column). Renaming is a separate, data-aware change if ever wanted.

## Tests

- 33 test files mention WorkOS. Neon Auth tests stay and must pass. Tests that only exercise the removed WorkOS branch are removed together with that code; each is listed in the PR with the Neon test that covers the same journey. No test is removed to make the build pass.
- New: identity selection fails closed when Neon Auth is not configured; the middleware never loads WorkOS.

## Proof required before merge

- Unit and package tests, lint, typecheck, build, `pnpm audit --prod --audit-level high` exit 0.
- CI "No-secret Playwright checks" and "No-secret smoke check" run against the preview, which uses staging Neon Auth: sign-up feedback, same-site sign-in redirect, protected routes denied, password recovery.
- Not provable from the container: email confirmation and recovery mail delivery end to end, and step-up on a real account. Reported as not verified.

## Owner follow-up after merge

- Vercel: the `WORKOS_*` and `NEXT_PUBLIC_WORKOS_REDIRECT_URI` variables become unused and can be deleted from the project settings.
- WorkOS dashboard: the application can be archived once the owner is satisfied.

## Rollback

Revert the PR. Stored data is untouched, so a revert restores the previous behaviour completely.
