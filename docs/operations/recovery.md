# Recovery: RPO/RTO, Backups, and Restore Drill

Authority: PRD §6 (availability, RPO/RTO, restore drill), Build Spec §16.

## Objectives

| Metric | Target | Basis |
| --- | --- | --- |
| **RPO** (max data loss) | ≤ 5 minutes | Neon continuous WAL / point-in-time restore |
| **RTO** (max downtime) | ≤ 60 minutes | Restore to a new branch + redeploy |
| **Availability** | 99.9% monthly | Stateless app on Vercel; managed Postgres on Neon |

These are launch targets; they are only *proven* by the restore drill below and
by production monitoring, not by assertion.

## What is backed up

- **Neon Postgres** — the only canonical writable store. Continuous backup with
  point-in-time restore. This covers all facts, documents metadata, audit chain,
  packs, missions, grants, and lifecycle records.
- **Object storage (S3)** — document bytes, once the storage adapter is wired.
  Versioned bucket + lifecycle policy; the DB holds the immutable object keys.
- **Migrations** — reviewed SQL in the repo; re-applied on deploy. The schema is
  reproducible from `main`.

## Restore drill (run quarterly and before launch)

1. Pick a recovery point (e.g. 30 minutes ago).
2. In Neon, restore that point to a **new** branch (never overwrite production).
3. Point a preview deploy at the restored branch (env var only).
4. Verify: `GET /api/health/ready` = `ready`; run `verifyAuditChain` over the
   restored `audit_events` — it must validate end-to-end.
5. Spot-check row counts for accounts/applicants/documents against expectations.
6. Record the measured RTO (start of drill → readiness green) and confirm it is
   within target. File the result; if over target, open a remediation task.

## Non-goals / invariants

- Never restore production data into a preview/synthetic environment used for
  testing (Build Spec §15 — no production data in preview).
- Never edit an already-applied migration; always fix forward.
- The audit chain must verify after any restore; a break is a security incident.
