# Service Wiring (Neon, WorkOS) — required manual steps

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
(e.g. `https://<prod-domain>/auth/callback`, and the preview equivalent).

Register the redirect URI(s) in the WorkOS dashboard too.

## 3. Apply the database schema (remote, no local machine)

Migrations are applied by the **DB Migrate (manual)** GitHub Action:

1. Add a repository secret `DATABASE_URL` (the Neon connection string):
   GitHub → Settings → Secrets and variables → Actions → New secret.
2. Run the workflow: Actions tab → "DB Migrate (manual)" → Run workflow →
   type `migrate` to confirm. (Claude can also trigger it once the secret
   exists.)

After this, `GET /api/health/ready` should report `db.schemaApplied: true`.

## Verifying

- Preview URL: `…-git-<branch>-…vercel.app/api/health/ready` → full breakdown.
- Production: `/api/health/ready` → `{ "status": "ready" }` when fully wired.
