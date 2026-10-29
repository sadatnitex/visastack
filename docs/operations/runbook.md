# Operations Runbook

Authority: PRD §6 (Controlled Launch), Build Spec §16 (reliability & operations).
This runbook is for on-call responders. It is deliberately provider-neutral —
concrete dashboards/URLs live in the Vercel and Neon consoles, not in the repo.

## Health surfaces

- **Liveness** — `GET /api/health/live`: process is up. Never touches the DB.
- **Readiness** — `GET /api/health/ready`: reports env presence (never values),
  DB connectivity, and whether migrations are applied. In production it hides
  details and returns only `{ "status": "ready" | "degraded" }`.

A deploy is healthy when readiness returns `ready` and the latest migration is
applied. Migrations do not run during a deploy: they run only through the manual
"DB Migrate" workflow (see `docs/operations/release-and-rollback.md`), so a new
release that needs a migration shows `degraded` until someone runs it.
For a suspected incident, start at `docs/operations/incidents/README.md`.

## Common incidents

### Readiness = `degraded`
1. Check the Neon console: is the production branch reachable / not suspended?
2. Confirm the connection string env var is present (readiness reports presence).
3. Check whether a migration is waiting: compare the newest migration in the repository
   with the one applied, and look at the latest "DB Migrate" run in GitHub Actions for a
   failure. The Vercel build log will not show a migration.
4. If migrations failed, fix forward with a new reviewed migration — never edit
   an applied migration.

### Signed-in pages 500 with "Connection terminated unexpectedly"
The authenticated app reaches Neon over a WebSocket (the pooled,
transaction-capable driver — ADR-0009). If the `ws` frame masker is broken by
bundling you get `TypeError: b.mask is not a function`, the socket dies with
"Connection terminated unexpectedly", and every DB-backed page 500s on its
first query — typically right after sign-in, on `/app`.
1. Look for `[withSession] failed for <email> — …` in the Vercel function
   logs; the `[cause]` names the real failure. Next.js otherwise masks it
   behind an opaque `Digest:` number with no detail.
2. The fix lives in code and must stay: `apps/web/src/instrumentation.ts` sets
   `WS_NO_BUFFER_UTIL` / `WS_NO_UTF_8_VALIDATE` so `ws` uses its always-defined
   pure-JS masker, and `apps/web/next.config.mjs` keeps
   `@neondatabase/serverless` + `ws` in `serverExternalPackages`. If this
   regresses, confirm both are present.
3. A dropped *idle* connection alone should not crash the request — `withSession`
   attaches an `error` listener to the pool. A crash originating there means the
   listener was removed.

### Audit chain verification fails
1. The `audit_events` hash chain is append-only (DB RULEs + SHA-256 chain).
2. Run `verifyAuditChain` over the exported events. A break indicates tampering
   at the storage layer, not the app — treat as a security incident.
3. Do NOT attempt to "repair" the chain; preserve it and escalate.

### Document stuck in the pipeline
1. `document_versions.processing_status` shows the state.
2. `SCANNING` that never advances = the scanner adapter is unavailable;
   re-running `processIntake` resumes safely (idempotent, recoverable).
3. `NEEDS_ATTENTION` = an unsafe scan; the file never entered processing.

## Escalation

- Security (audit tamper, data exposure, auth bypass): page the security owner.
- Data-layer (Neon down, migration failure): page the platform owner.
- All incidents: record a timeline; the audit trail is the system of record.


## Current operating correction, 2026-10-12

Use current-platform.md and invitation-journeys.md before older provider examples above. Production uses Neon Auth, Neon Postgres, private R2 with path-style addressing, region auto and the verified jurisdiction endpoint. Neon Auth SMTP and application Resend delivery are separate. Never relink accounts or records solely by matching an email. Signed callback acceptance and provider acceptance are not proof of inbox placement. Readiness is coarse; detailed diagnostics require administrator authorisation, and ordinary errors must not log emails or credentials.

If GitHub refuses a job before startup due to payments or spending limits, record that the tests did not run. Ask the repository account owner to correct the account issue; do not increase budgets or remove required checks. After a confirmed fix, retry only the affected exact-commit runs, then verify source/main checks, deployment smokes, READY deployment and both aliases. The 2026-10-12 main/deployment jobs were retried after the owner's fix; completion remains a separate gate.

Weekly encrypted SQL backups use Actions pg_dump, with an unpooled production database binding and separate recoverable encryption key. Database-only restore evidence does not prove document, key, revocation, deletion or full lifecycle recovery. Never run a production migration or restore as an automatic application rollback. Independent staging must be proven at Auth, database, roles, storage and processing boundaries before synthetic authenticated acceptance. Preserve the controlled-pilot sensitive-data gate and current Neon branch dependency protections.

Update 2026-10-29 (S27): encrypted SQL backups now run daily at 06:00 UTC, not weekly. Retention, storage numbers and the manual pruning rule: r2-encrypted-backups.md, section "Daily SQL capture and retention".
