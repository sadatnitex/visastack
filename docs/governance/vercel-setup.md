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
builds the app with full Next.js runtime support (SSR + API routes). No
`vercel.json` is required.

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
