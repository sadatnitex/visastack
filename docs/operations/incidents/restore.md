# The database or data must be restored

Read [README.md](./README.md) first. The exact procedure is in
[../recovery.md](../recovery.md); this page is the decision to restore, and what must be true
before, during and after. Restoring is a last resort that loses data on purpose, so it is the
incident owner's decision, written in the log with the reasons.

## Decide: fix forward or restore

| Situation | Usually |
|---|---|
| A bad migration or deploy, data intact | Fix forward or roll the app back ([../release-and-rollback.md](../release-and-rollback.md)); do not restore |
| A bug wrote wrong values for a few records | Correct them through the product's actions; do not restore |
| Rows deleted or corrupted by a person or a bug, extent known and large | Restore to a new branch, compare, and copy back only what is needed, or promote |
| The database is unusable or untrustworthy (corruption, a taken-over owner credential, a failed migration that cannot be undone) | Restore and promote, with the reconciliation step |
| Stored files are missing | A database restore does not bring them back ([storage-issue.md](./storage-issue.md)) |

A restore loses everything written after the chosen point. The target is to lose at most 15 minutes
(RPO), and to be back within four hours (RTO). Both are targets that have **not yet been measured by
a drill**.

## Before you restore

1. Declare the incident (SEV1 unless the loss is already contained) and open the log.
2. Stop writes if you can: put the product in a state where no one is changing data, so the restore
   point and the loss window are well defined (for example by pausing the deploy and noting the time
   of the last good write from the audit trail).
3. **Keep the damaged database.** Create the evidence branch ([README.md](./README.md)). The
   reconciliation step compares the restored copy against it, and it is the only record of what
   happened after the restore point. If it cannot be reached, stop and read the "pre-incident branch
   must still be reachable" section of
   [../backup-resurrection-reconciliation.md](../backup-resurrection-reconciliation.md); a person must
   accept the residual risk in writing.
4. Choose the restore point: the last moment you trust, from the audit trail and the incident
   timeline. Write it in the log in UTC.
5. Confirm the point is inside the database provider's history window (check the plan's retention in
   the Neon console; this has not been verified for the current plan).

## Do it

Follow [../recovery.md](../recovery.md), section "Restoring for real", step by step. In short:
restore to a new branch, verify it, **reconcile** deletions, revocations and holds that happened after
the restore point, verify again, then promote and reconnect users and jobs, in that order. Do not
reconnect users or the scheduled jobs before reconciliation has finished without errors.

## After

- Confirm the signals on `/app/admin` are healthy and the audit chain verifies over the whole database
  (`pnpm --filter @visastack/adapters verify:audit-chain`).
- Tell affected people what was lost and how to recover it (their last edits within the window), with
  the legal reviewer's approval of the wording.
- Record the measured data-loss window and time to recover in the log. These are the first real
  numbers against the targets.
- Delete the evidence and damaged branches when the review date passes (README), unless a hold applies.
