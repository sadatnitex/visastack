# Vercel Project Setup

`apps/web` deploys to Vercel. These settings are applied once in the Vercel
dashboard when connecting the GitHub repository; this file records the
intended configuration.

## Project settings (one-time, in the Vercel dashboard)

VisaStack is a pnpm/Turborepo monorepo with the Next.js app under
`apps/web`. Vercel detects Next.js by finding `next` in the
`package.json` **at the Root Directory** — so the Root Directory must point
at the app, not the repo root. A repo-root `vercel.json` cannot substitute
for this (Vercel reported `No Next.js version detected` when we tried).

Set these once under **Project → Settings → Build & Deployment**:

| Setting | Value |
|---------|-------|
| Framework preset | Next.js (auto-detected once Root Directory is set) |
| **Root Directory** | **`apps/web`** |
| Include files outside the root directory | **Enabled** (needed for `packages/*`) |
| Install command | *(auto)* `pnpm install` (pnpm enables frozen lockfile in CI) |
| Build command | *(auto)* `next build` |
| Node.js version | 22.x |

With Root Directory = `apps/web` and "include files outside" enabled,
Vercel installs at the workspace root, resolves `@visastack/core`, and
builds the app with full Next.js runtime support (SSR + API routes).

The **Framework Preset is pinned in code** via
[`apps/web/vercel.json`](../../apps/web/vercel.json) (`"framework":
"nextjs"`). This is necessary because the project was auto-created with an
"Other" preset before the Next.js app existed, and setting the Root
Directory alone does not re-run framework detection — without the pin,
Vercel looked for a static `public/` directory and failed. Pinning it in
`vercel.json` keeps the setting reproducible rather than relying on a
dashboard toggle.

Turbo Remote Caching may be enabled later to share the CI/Vercel build cache.

## Deployments

- **Preview:** one isolated deployment per pull request. Preview env vars
  point at non-production provider instances / branch databases. **No
  production data in preview.**
- **Production:** promoted on merge to `main`.

## Environment variables

Set the keys documented in `.env.example` under
**Project → Settings → Environment Variables**, scoped per environment
(Production / Preview / Development). Never commit real values.

## Security headers

Baseline headers ship from `apps/web/next.config.mjs`. The full CSP and
privacy caching rules (no sensitive PWA cache) are hardened in Phase 6.


## Current setup precedence, 2026-10-12

README.md and docs/operations/current-platform.md describe the current setup. Neon Auth is selected for production, with explicit legacy WorkOS paths retained only for compatibility. Set Production values independently of branch-specific Preview values. A gitBranch-scoped variable cannot target Production. Verify the immutable deployment commit and both canonical aliases instead of assuming a preview URL points at the current branch.

R2 credentials are S3 object-storage access, not Cloudflare account-management access. The S3 client retains path-style routing, region auto and the verified EU jurisdiction endpoint; region auto does not repair an incorrect account/jurisdiction endpoint. Application email uses the verified VisaStack sender and its signed Resend callback, separate from Neon SMTP. Weekly pg_dump capture runs in Actions with its own backup and encryption credentials, not in a Vercel cron function. Save secrets securely and verify scopes without printing values.

Production migrations, restores, sensitive-data activation and paid upgrades are not implicit in ordinary deployments. Current staging has a separate empty schema/Auth foundation but is not yet a verified five-role app/storage deployment. Reference-based UI source implementation, CI success and public screenshots do not close actual authenticated PDF acceptance. See docs/public-beta/DEPLOYMENT-ACTIONS.md for current release gates.
