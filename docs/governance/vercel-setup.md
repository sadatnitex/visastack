# Vercel Project Setup

`apps/web` deploys to Vercel. These settings are applied once in the Vercel
dashboard when connecting the GitHub repository; this file records the
intended configuration.

## Project settings

The monorepo build is driven by the repo-root [`vercel.json`](../../vercel.json),
so the Vercel **Root Directory stays at the repository root** (the default).
That file pins the framework, install, build, and output paths:

| Setting | Source | Value |
|---------|--------|-------|
| Framework preset | `vercel.json` | `nextjs` |
| Root directory | Vercel project | repository root (default) |
| Install command | `vercel.json` | `pnpm install --frozen-lockfile` |
| Build command | `vercel.json` | `pnpm turbo run build --filter=@visastack/web` |
| Output directory | `vercel.json` | `apps/web/.next` |
| Node.js version | Vercel project | 22.x |

> If you prefer the dashboard approach instead of `vercel.json`, set Root
> Directory to `apps/web` with "Include files outside root directory"
> enabled — but do not use both at once, since a non-root Root Directory
> hides the repo-root `vercel.json`.

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
