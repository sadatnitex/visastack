# Backup resurrection protection: reconciliation design

Authority: master directive Part 7 §15 ("Backup resurrection protection");
PRD PRV-04 ("Restoring a backup must reapply deletion tombstones and current
revocations before reconnecting users or sending jobs; recovery cannot
resurrect deleted data or old grants."). Extends `docs/operations/recovery.md`
(RPO/RTO, backup mechanism, restore drill) - read that first; this document
covers only the reconciliation step it does not.

## The problem this solves

`recovery.md` establishes that Neon Postgres's continuous point-in-time
restore is this codebase's entire backup mechanism, and that a restore
targets a **new branch**, never overwriting the live one directly. That is
exactly right for the quarterly restore *drill* (§"Restore drill" in that
document): the drill's restored branch only ever faces a preview deploy, the
real production branch keeps running untouched, and no reconciliation is
needed because nothing real ever talks to the restored data.

A **real disaster restore** is a different scenario: production itself is
corrupted, badly migrated, or otherwise unusable, and the restored branch is
promoted to become the *new* production. The restored branch reflects
whatever the database looked like at the chosen recovery point, which, by
definition, does not include anything that happened between that point and
the moment of the incident. If that gap contained a legally-requested
account deletion, a revoked grant, a released consent, a deactivated
membership, or a placed legal hold, the restored branch would silently bring
all of it back: a deleted account reappears, a cut-off collaborator regains
access, a hold-protected applicant becomes purgeable again. This is "backup
resurrection," and it is a genuine privacy and access-control failure, not
merely stale data - the directive is explicit that recovery must never
"resurrect deleted data or old grants."

## Principle: reconciliation only ever tightens, never loosens

Every reconciliation rule in this design moves the restored branch **toward
more restriction**, never away from it:

- data that was deleted stays deleted;
- access that was revoked stays revoked;
- a hold that was active stays active (even if the restore point predates
  it, since a hold placed after the restore point is protecting something
  the restore itself does not know needs protecting);
- membership/organization status moves toward inactive/suspended/closed,
  never back toward active.

The reconciliation process never invents access, never un-deletes anything
based on the restored branch's own state, and never treats "the restored
branch doesn't have this row" as license to leave it that way if the source
branch shows it should be gone for a reason (an erasure, an executed
deletion) rather than because it never existed. When source and restored
disagree, whichever state is more restrictive wins, full stop.

## Precondition: this requires the pre-incident branch to still be reachable

This design reconciles the restored branch **against the branch it is
replacing**, the live database as it stood at the moment of the incident,
however corrupted or degraded it may be for normal application traffic.
Postgres itself does not need to be healthy for this: a read-only query
against `audit_events` (append-only, hash-chained, and the one place every
reconciliation-relevant fact is already recorded with a timestamp) is a far
weaker requirement than "the application can run against it."

If the pre-incident branch is not reachable at all (the Neon project itself
was deleted, or the incident is data corruption so total that even a
read-only connection cannot be established), reconciliation as designed
here cannot run, because there is nothing to diff against. This is named
honestly rather than papered over: full backup resurrection protection is
only as strong as the survivability of *some* read path to the pre-incident
state. (Neon retains the WAL underlying point-in-time restore independently
of the branch's own query availability, so "the branch is up but degraded"
is the overwhelmingly likely incident shape this protects against; "the
whole project is gone" is a materially different, harder failure this
design does not claim to solve.)

## Scope: exactly which changes get reconciled

Every rule below is keyed off `audit_events`, filtered to
`occurredAt > <restore point>`, read from the pre-incident branch. Audit
events are the right source: they are already the durable, append-only,
timestamped record of every sensitive state change in this codebase, and
"replay tombstones/revocations" is precisely a query over exactly the event
types below, not a new logging mechanism.

| Resource | Event type(s) on the pre-incident branch | Reconciliation action on the restored branch |
| --- | --- | --- |
| Account deletion | `ACCOUNT_DELETION_EXECUTED` | Re-run `executeAccountDeletion`'s effect: the account and its owned applicants must end up deleted/cascaded on the restored branch too. |
| Document/version erasure | `ERASURE_VERIFIED` | The corresponding document version's bytes and row state must reflect erased, not merely present-but-flagged. |
| Grant revocation | `GRANT_REVOKED` | Force the grant's `status` to `REVOKED` on the restored branch, regardless of what status it currently shows there. |
| Consent revocation | `CONSENT_REVOKED` | Force that consent type to revoked for the account on the restored branch. |
| Membership deactivation | `MEMBERSHIP_DEACTIVATED` | Force `memberships.active = false` for that membership on the restored branch. |
| Legal hold placed | `LEGAL_HOLD_PLACED` | If the restored branch has no active hold for that applicant (or an inactive/released one), re-apply the hold - a hold protects data from *deletion*, so a restore losing it is exactly backwards. |
| Legal hold released | `LEGAL_HOLD_RELEASED` | Force that hold to released on the restored branch (an explicit release is itself a deliberate access decision, not something to leave stale). |
| Platform role revocation | `PLATFORM_ROLE_REVOKED` | Force that role grant to revoked on the restored branch. |
| Organization suspension/termination | `ORGANIZATION_SUSPENDED`, `ORGANIZATION_TERMINATED` | Force the organization's `status` to the more restrictive of the two branches' values (`CLOSED` beats `SUSPENDED` beats `ACTIVE`). |
| Case retention purge | `MISSION_RETENTION_PURGED` | Force the mission row into its redacted (post-purge) state on the restored branch too, matching `sweepCaseRetentionPurge`'s own redaction, not a full delete (the same four historical-fact tables it deliberately preserves stay preserved here as well). |
| Per-case sharing exception recorded (ADR 0017) | `GRANT_CASE_EXCLUDED` (including reason `carried_forward`, written when a new all-cases grant or invitation for the same recipient inherits an earlier "no") | Re-create the exception row for that grant or invitation and case on the restored branch. Replayed in chain order with the removal event below; only the last event per grant-or-invitation and case is applied, so a second run is a no-op. Nothing happens when the grant, invitation or case was made after the restore point. |
| Per-case sharing exception removed (ADR 0017) | `GRANT_CASE_EXCLUSION_REMOVED` | Delete that exception row on the restored branch: "Allow This Case" is an explicit owner decision, replayed like a legal hold release. |
| Per-case sharing answer "yes" (ADR 0017) | `GRANT_CASE_ALLOWED` | Nothing to write (a "yes" stores no row). Answers are one-shot per case, so a "yes" can never follow a "no" for the same case; later changes come only from the two events above. |
| Exception could not be written | `RECONCILIATION_CASE_EXCEPTION_FAIL_CLOSED` (written on the restored branch) | Fail closed: when an exception cannot be re-created (for example a restored branch from before migration 0090), the grant (active, paused or awaiting acceptance) or the pending invitation is REVOKED, never paused, because a pause could be undone with Resume and give the case back. The error is reported; the owner shares again on purpose if they want to. |
| AI connection turned off (S15) | `AI_CONNECTION_REVOKED` | Force the connection's `revoked_at` on the restored branch and revoke every one of its tokens, in one transaction. A second run is a no-op. A restored branch from before the AI connection tables existed has nothing to turn off. |
| AI connection access changed (S15) | `AI_CONNECTION_CHANGED` | Narrow the restored connection to what both branches allow, against the pre-incident branch's current row: the parts both allow, the narrower case choice (none, then one case, then all current cases; two different single cases leave none), full document numbers only if both have them, and the earlier end. A widening is never replayed. When that earlier end has passed, the connection's tokens are revoked too. A connection whose own stored end passes needs no replay: the restored branch keeps that end and every use checks it. |

Explicitly out of scope for this reconciliation (by design, not oversight):
anything that only ever *adds* data (a new upload, a new note, a new
mission) needs no reconciliation - the restored branch simply lacks it,
which is ordinary, expected data loss within the RPO window `recovery.md`
already targets (<= 5 minutes), not a resurrection risk. Reconciliation
exists only for changes whose whole point was to make something *less*
accessible.

## Procedure

Run this after promoting a restored branch to production, **before**
reconnecting real users or background workers (Vercel cron jobs, the
intake/erasure/notification workers) to it:

1. Confirm the pre-incident branch is still reachable read-only. If it is
   not, stop and treat this as the degraded case named above - do not
   reconnect traffic until a human has explicitly accepted the residual
   resurrection risk, and record that decision.
2. Determine the restore point (the timestamp Neon restored to).
3. Query the pre-incident branch's `audit_events` for every event type in
   the table above with `occurredAt` after the restore point, ordered
   oldest first.
4. For each event, apply the corresponding forcing rule to the restored
   branch, using the existing service-layer functions where the effect is
   more than a single-column flip (e.g. `executeAccountDeletion`'s own
   cascade), and idempotent direct updates where it is not (e.g. forcing a
   `grants.status` or `memberships.active` column) - never hand-rolled SQL
   that reimplements a cascade a service function already owns correctly.
5. Re-verify the restored branch's own audit chain (`verifyAuditChain`,
   already required by the restore drill) after reconciliation writes land,
   since reconciliation itself appends new audit events (each forced change
   is itself audited, actor recorded as the reconciliation process, method
   `SYSTEM`) and the chain must still validate end-to-end.
6. Only then reconnect application traffic and re-enable the Vercel cron
   jobs.

## Implementation status

This is the design the directive asks for. Steps 3-4 of the table above are
now fully implemented as `reconcileRestoredBranch(oldDb, newDb, restorePoint)`
(`packages/services/src/backup-reconciliation.ts`), covering every row in
the table -- all 10 event types replayed in genuine global chronological
order, with each forced change itself audited on the restored branch,
matching step 5 above. Most rows (grant revocation, consent revocation,
membership deactivation, legal hold placed/released, platform role
revocation, organization suspension/termination) are a single column flip
on an existing row or inserting one missing row entirely. The remaining
three reuse or re-derive a more complex mechanism instead of hand-rolling
a second cascade:

- **Account deletion** calls `executeAccountDeletion` directly with the
  original event's own timestamp as `now` - safe specifically because the
  function's one real precondition (a PENDING request whose grace window
  elapsed) naturally already holds: the request itself predates execution
  by the grace period (days), which dwarfs this codebase's <=5 minute RPO,
  so the PENDING row is essentially always already mirrored onto the
  restored branch by the time reconciliation runs.
- **Case-retention purge** calls `purgeMissionUnconditionally`
  (`case-retention.ts`), the unconditional purge mechanism extracted out
  of `sweepCaseRetentionPurge` for exactly this reuse, shared between the
  sweep and the reconciliation replay so the two can never drift apart.
  Reconciliation does not call the sweep itself: the sweep's own
  eligibility gate (grace days, complaint status, legal hold) re-checks
  CURRENT state, the wrong precondition here - a `MISSION_RETENTION_PURGED`
  event on the pre-incident branch is already proof the purge was
  correctly decided there.
- **Document/storage-object erasure** (`ERASURE_VERIFIED`) has exactly two
  enqueue sources -- account deletion (a single, ungated storage-object
  delete) and `retention.ts`'s `purgeExpiredDocuments` (gated behind every
  sibling storage object a document ever referenced also reaching
  VERIFIED). Rather than reconstructing that job-by-job gating state
  machine on the restored branch, reconciliation asks the one branch that
  actually knows the ground truth - the old branch, right now - whether
  the document is already gone there; if so, the identical end state
  (including bumping material revision for any mission on the restored
  branch still selecting that document as evidence) is forced onto the
  restored branch. The underlying bytes are already gone for real on both
  branches simultaneously by the time this runs - Vercel Blob's `del()` is
  external, never branched alongside Postgres - so no `erasureJobs`
  bookkeeping row is recreated on the restored branch at all; that table
  is pure operational queue state, not the privacy-relevant fact itself.

A CLI wrapper also exists: `packages/adapters/src/reconcile-restored-branch.ts`
(`pnpm --filter @visastack/adapters reconcile:restored-branch`) takes two
real branch connection strings and a restore point and calls
`reconcileRestoredBranch` directly, matching
`packages/adapters/src/backfill-protected-fields.ts`'s established
operational-script shape - a runbook command an operator can run directly,
not merely a library function requiring a one-off script.


## Current operating correction (2026-10-11)

Production uses private R2 storage; database-only encrypted archive recovery is verified, while complete document/key/lifecycle recovery remains open.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
