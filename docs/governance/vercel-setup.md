# Vercel Project Setup

`apps/web` deploys to Vercel. These settings are applied once in the Vercel
dashboard when connecting the GitHub repository; this file records the
intended configuration.

## Project settings

| Setting | Value |
|---------|-------|
| Framework preset | Next.js |
| Root directory | `apps/web` |
| Include files outside root dir | **Enabled** (monorepo needs `packages/*`) |
| Build command | *(auto)* `next build` — or `turbo run build --filter=@visastack/web` |
| Install command | `pnpm install --frozen-lockfile` |
| Node.js version | 22.x |

Vercel auto-detects the pnpm workspace and Turborepo. Turbo Remote Caching
may be enabled later to share the CI/Vercel build cache.

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
