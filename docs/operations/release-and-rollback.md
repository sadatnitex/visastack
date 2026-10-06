# Releases, migrations and rollback

Directive Part 9 section 13 and acceptance test A31. This page says how code and schema reach
production, how to tell which commit is live, what is recorded, and how to roll back.

## How a release happens

1. A pull request is reviewed and its required checks must be green: "Lint · Build · Typecheck · Test",
   "No-secret Playwright checks" and "No-secret smoke check".
2. Merging to `main` makes Vercel build and promote a **production** deployment. `vercel.json` builds
   with `next build`. **The build never runs migrations.** (An older version of this page said
   migrations ran at build time; nothing in the build, the Next configuration or the start-up code
   does that. Search `migrate` in `apps/web` to confirm.)
3. Every deployment, preview or production, triggers the **Deploy Smoke** workflow, which checks the
   live address and writes a release record (below).
4. A schema change is applied separately, by a person, with the **DB Migrate (manual)** workflow.

## Migrations: controlled, one at a time, not from a preview

- Pull request previews never see the production database credential and never migrate. A preview is
  built from an unreviewed branch.
- The only path to production is `.github/workflows/db-migrate.yml`: started by hand
  (`workflow_dispatch`), the confirmation word `migrate` typed, run from `main` only, one at a time
  (`concurrency: db-migrate`, never cancelled halfway).
- **Dedicated credential.** The job prefers the secret `MIGRATION_DATABASE_URL`, the connection string
  of a database role used only for migrations. Without it the job runs with the application's own
  connection secrets and says so in its log and summary. Using the application credential is allowed
  for the pilot and is a **launch blocker**: create the role in Neon, store its string as
  `MIGRATION_DATABASE_URL`, and confirm the summary says "Dedicated migration credential: true".
- **Branch protection of the secret.** A workflow file on a branch can be edited to print a secret it
  can read, so a check inside the file is not enough. Create the GitHub environment
  `production-migrations`, restrict its deployment branches to `main`, require a reviewer, and keep the
  migration secret in that environment. The workflow already names that environment. **Not done:**
  this is a repository setting that only an administrator can make; until it is, any person with write
  access could in principle run an edited copy of the workflow.
- Readiness compares the migrations the running build ships with those recorded in the database and
  reports `degraded` when one is pending, so a deployment that is ahead of its schema is visible
  ([monitoring.md](./monitoring.md), "Migration drift").
- Never edit an applied migration; fix forward with a new one.

### Make every migration safe to roll back over

Application rollback does not undo the database. So each migration must work with **both** the new code
and the code of the previous release: add before you use (new columns nullable or defaulted, new tables
unused by old code), and remove only in a later release once nothing reads the old shape. A migration
that breaks the previous release makes a code rollback unsafe, and the release notes must say so.

## Which commit is live

| Question | Where to look |
|---|---|
| Which commit is production serving? | Vercel dashboard, Deployments, the current Production deployment shows the commit. The release record for that deployment also names it |
| Is the live database up to date with it? | `/app/admin` Operations, "Database migrations" signal; `GET /api/health/ready` is `degraded` while one is pending |
| What was recorded at deploy time? | The workflow artifact `release-record-<sha>-<deployment id>` on the Deploy Smoke run (kept 90 days), also printed in the run summary |

The release record is a JSON file with the repository, the code SHA, the ref, the environment, the
GitHub deployment id, the deployment address and state, the creation time, the newest migration in the
repository at that commit (tag, time and count), and the smoke result. It does **not** say a migration
is applied; the readiness check does. Part 10's release gate adds what only a person or a later step can:
provider configuration versions, rule-pack versions, test reports, scan timestamps, independent review
and the recovery drill ([../commercial-v1/release-gate.md](../commercial-v1/release-gate.md)).

## Rollback

Rolling back means making an earlier, already-built production deployment serve traffic again. It takes
seconds and loses no data, because it changes code only.

1. **Decide.** The production deployment is broken or unsafe and the previous one is good. If a
   migration shipped with the bad release, read "Make every migration safe to roll back over" first: if
   the previous code cannot work with the new schema, do not roll back; fix forward.
2. **Do it.** In the Vercel dashboard, open Deployments, choose the last good Production deployment
   (it shows as a rollback candidate) and use Instant Rollback. The platform also exposes this to the
   API. Note the time and both commits in the incident log.
3. **Check.** `GET /api/health/ready` returns ready, sign in, open the admin Operations page, and read the
   signals. Confirm the commit now serving is the one you chose.
4. **Fix forward.** A rollback is a pause, not a repair. Revert or fix the change in a pull request;
   the next merge deploys normally. Automatic promotion of new deployments may be paused by the rollback
   until you re-enable it in Vercel; check, because forgetting leaves production on the old commit.
5. A rollback never undoes a migration or a data change. If data was damaged, that is a restore
   ([incidents/restore.md](./incidents/restore.md)).

**Tested?** No. The procedure has not been rehearsed on this project. Rolling back production is a
user-visible action, so it needs the owner's go-ahead for a rehearsal: choose a quiet time, roll back to
the previous deployment, check readiness, then roll forward again, and record the times. Until then
treat the steps above as a documented procedure, not a proven one.

## A31 evidence

| A31 element | State |
|---|---|
| Clean install | Covered by CI (`pnpm install --frozen-lockfile`, build, test) on every pull request |
| Upgrade | Migrations are forward only and checked by the readiness comparison; a rehearsed upgrade from a restored copy is part of Part 10 |
| Preview isolation | Previews are built from unreviewed branches and are public addresses; they get no production credential by design. Verified from the Vercel environment-variable scoping on 2026-10-06 (see the supply-chain page) |
| Migrations serialized | One workflow, one at a time, never cancelled halfway |
| Deployed commit identity | Vercel shows it; the release record names it; the readiness comparison names the migration state |
| Rollback behaviour | Documented above; **not tested** |
