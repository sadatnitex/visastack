# Service Wiring (Neon, WorkOS) — required manual steps

> Historical setup and incident guidance. Provider, domain, migration and email-linking instructions below are superseded where they conflict with the latest approved decisions. Start with [current operating guidance](../operations/current-platform.md). Historical evidence and original acceptance targets are retained.

The app reads these at runtime from the Vercel environment. Connecting Neon
and WorkOS at the account level does **not** by itself place their variables
into this project's runtime — they must be present on the `visastack` Vercel
project for **Production, Preview, and Development**. Verify anytime with the
readiness probe: `GET /api/health/ready` (details shown outside production).

## 1. Neon (database)

Add the connection string to the Vercel project (all environments). The app
accepts any of these names (first present wins):

`DATABASE_URL` · `POSTGRES_URL` · `DATABASE_URL_UNPOOLED` ·
`POSTGRES_URL_NON_POOLING` · `POSTGRES_PRISMA_URL`

- Prefer the **pooled** connection string for the serverless app runtime.
- Vercel → Project → Settings → Environment Variables (or the Neon
  integration's "Connect Project" with all environments checked).

## 2. WorkOS (identity — used by the auth slice)

Add from the WorkOS dashboard (API Keys + Redirects), all environments:

`WORKOS_API_KEY` · `WORKOS_CLIENT_ID` · `WORKOS_COOKIE_PASSWORD`
(a 32+ char random string) · `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
(the AuthKit callback route is `/callback`, e.g.
`https://<prod-domain>/callback`, and the preview equivalent).

Register the exact redirect URI(s) in the WorkOS **Redirects** allow-list too —
this is a separate list from the env var, and a URI missing from it fails sign-in
with "This is not a valid redirect URI". Make sure the `WORKOS_API_KEY` /
`WORKOS_CLIENT_ID` belong to the **same WorkOS environment** whose AuthKit
domain serves the sign-in (Staging vs Production); a cross-environment mix
authenticates but then fails the code exchange.

## 3. Apply the database schema (remote, no local machine)

Reviewed migrations run **automatically on every deploy**: the Vercel build
command is `pnpm --filter @visastack/db db:migrate && next build`, so a deploy
fails closed if migration fails (the build stops before `next build`). This
uses the connection string from the Vercel project env (§1), so no extra
secret is needed for the normal path.

A manual fallback exists for applying migrations out of band (e.g. before a
deploy, or against a branch database) — the **DB Migrate (manual)** GitHub
Action (`.github/workflows/db-migrate.yml`):

1. Add a repository secret `DATABASE_URL` (the Neon connection string):
   GitHub → Settings → Secrets and variables → Actions → New secret.
2. Run the workflow: Actions tab → "DB Migrate (manual)" → Run workflow →
   type `migrate` to confirm. (Claude can also trigger it once the secret
   exists.)

Either way, `GET /api/health/ready` should then report `db.schemaApplied: true`.

## Verifying

- Preview URL: `…-git-<branch>-…vercel.app/api/health/ready` → full breakdown.
- Production: `/api/health/ready` → `{ "status": "ready" }` when fully wired.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
