# Operations Runbook

Authority: PRD §6 (Controlled Launch), Build Spec §16 (reliability & operations).
This runbook is for on-call responders. It is deliberately provider-neutral —
concrete dashboards/URLs live in the Vercel and Neon consoles, not in the repo.

## Health surfaces

- **Liveness** — `GET /api/health/live`: process is up. Never touches the DB.
- **Readiness** — `GET /api/health/ready`: reports env presence (never values),
  DB connectivity, and whether migrations are applied. In production it hides
  details and returns only `{ "status": "ready" | "not_ready" }`.

A deploy is healthy when readiness returns `ready` and the latest migration is
applied (build-time migration runs on every production deploy).

## Common incidents

### Readiness = `not_ready`
1. Check the Neon console: is the production branch reachable / not suspended?
2. Confirm the connection string env var is present (readiness reports presence).
3. Check the latest Vercel deploy's build log for a migration failure.
4. If migrations failed, fix forward with a new reviewed migration — never edit
   an applied migration.

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
