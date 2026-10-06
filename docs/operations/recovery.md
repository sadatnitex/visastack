# Recovery: objectives, what is covered, and the exact restore procedure

Authority: Commercial V1 PRD OPS-02 and directive Part 9 section 12 (prepare), Part 10 section 5
(perform the drill, acceptance test A30). Incident decisions are in
[incidents/restore.md](./incidents/restore.md).

## Objectives

| Metric | Target | Status |
|---|---|---|
| **RPO** (most data we may lose) | 15 minutes for committed data | Not measured. No restore drill has been run |
| **RTO** (longest we may be down) | 4 hours for the core service | Not measured |
| Availability | 99.9% a month, an engineering target | Not measured; not a customer commitment |

The PRD sets one consistent target and says it replaces the older five-minute and one-hour figures
that used to be on this page, "until a stricter target is demonstrated". Nothing stricter has been
demonstrated, so these are the numbers. If the plan or the provider settings cannot meet them, the
drill is recorded as FAILED or BLOCKED and the targets are **not** rewritten to fit the result.

## What has to be recovered, and where it lives

| Thing | Where it lives | Recoverable today? |
|---|---|---|
| Database (facts, document records, audit trail, cases, grants, retention state) | Neon Postgres | Yes, to a point in time inside the plan's history window, into a **new** branch. The window for the current plan has not been verified |
| Document originals | Vercel Private Blob, one copy | **No.** There is no independent copy. A database restore does not restore files. A provider's own durability is not a recovery procedure. This is the largest gap |
| Derived files (previews, extracted text) | Previews are rendered on demand and not stored; extracted text is in the database | Previews: nothing to restore. Text: with the database |
| Protected-field encryption key (`KMS_LOCAL_MASTER_KEY_BASE64`) | Vercel environment only | **No copy anywhere else.** Lose the Vercel project and every protected field and stored AI key is unreadable for ever. The local key is also not a real key service |
| Configuration (environment variables) | Vercel environment | **No copy outside Vercel.** `.env.example` lists the names, not the values |
| Other secrets (signing, cron, API keys) | Vercel environment; provider consoles | Can be re-issued from the providers, so they are replaceable, not recoverable |
| Code and migrations | GitHub (`main`) | Yes |
| Sign-in identities | WorkOS, outside our database | Unaffected by a database restore. Accounts are bound to a WorkOS user id |
| Audit trail integrity | Inside the database | The chain restores with the database; verify it over the whole history (below). Signed checkpoints exist as code but are not scheduled, so there is no outside copy to compare with |
| Deletions, revoked shares, ended memberships, holds after the restore point | Not in the restored data | Reapplied by reconciliation (below) from the audit trail of the pre-incident database |

## Gaps that stop the drill passing today

These are not footnotes. Each one needs a decision and an owner before Part 10's drill can pass.

1. **Originals have no backup.** Decide a second store (with version history and protection against
   deletion), how copies are made and checked by hash, and how they are restored. Until then
   "recovered object hashes" cannot be shown for a lost file.
2. **The master key has no escrow.** Decide where an offline copy lives, who may open it, and test
   that a restore can decrypt a protected field with it. Separately, a real key service (the code
   refuses the local key in commercial mode) must replace it before commercial launch, with a
   rotation tool that has been rehearsed.
3. **No copy of the configuration.** Record the names and values in a secret store the owner controls,
   outside Vercel, and keep it current.
4. **The database history window is unverified.** Read it from the Neon console for the plan in use and
   write it here. Backups must also expire within the directive's 90 days; do not keep manual copies
   longer without a recorded reason.
5. **No scheduled audit checkpoints,** so tampering by someone with full database rights is not
   detectable from outside the database.

## Rules for any recovery environment

- Recovered production data never goes into an ordinary pull request preview, or any environment that
  is shared, public, or built from a branch other than a reviewed one.
- It is a separate environment: its own Vercel project, its own Neon branch or project, and its own
  blob store. Equivalent access controls to production (the same protections, not a convenience copy).
- **Outbound messages are off:** leave `EMAIL_PROVIDER` unset (the null sender sends nothing), leave
  `AI_ENABLED` unset, leave `CRON_SECRET` unset (the job routes refuse to run), do not set the payment
  provider.
- Few operators: only named people, and only those who need it. Sign-in is limited with
  `PILOT_ALLOWLIST_EMAILS` and a separate WorkOS environment, so real users cannot walk in.
- For a **drill** use synthetic or approved safe test data only. For a **real** restore the promoted
  database becomes production, in the production project, and the rules above apply to the
  rehearsal, not to the promotion.

## Restore drill (before launch, then every quarter)

1. **Prepare.** Name the people and the time. Write the plan's history window and the chosen recovery
   point (for example 30 minutes ago) in the record. Note the start time.
2. **Restore the database** in the Neon console to a **new** branch from that point. Never overwrite
   production. Note the moment it finishes.
3. **Create the recovery environment** per the rules above and point it at the new branch only.
4. **Restore the files** the database references from the independent copy (gap 1). Compare every
   object's content hash and size with `storage_objects`.
5. **Restore the key and configuration** from escrow (gaps 2 and 3). Do not copy them from production.
6. **Verify the database:**
   - `GET /api/health/ready` returns ready, with no migration pending.
   - The whole audit chain verifies:
     `VERIFY_DATABASE_URL=<recovery branch> pnpm --filter @visastack/adapters verify:audit-chain`.
   - Row counts for accounts, applicants, documents, grants and cases are what you expect for the
     chosen point.
7. **Verify protected data:** open a profile with a protected field and read it back with the restored
   key; open a document and check its hash matches.
8. **Verify access:** sign in as a synthetic traveller and as a synthetic agency member; confirm a
   revoked share stays refused, an ended membership stays ended, and one applicant cannot see
   another's data.
9. **Verify deletions did not come back:** run reconciliation (below) against the production database
   as the "old" branch, then check that something deleted after the restore point is still deleted.
10. **Record** the start and end of each step; the measured data-loss window (restore point to the last
    write in the pre-incident database); the measured time to a working core service; any step that
    failed or was missing; and the result (PASS, FAIL or BLOCKED). If either measure is over target the
    result is not PASS, and the remedy is a task, not a changed target.
11. **Tear down** the recovery environment and its branch, and keep the record.

## Restoring for real

1. Follow [incidents/restore.md](./incidents/restore.md) to decide, preserve evidence and choose the
   restore point. Keep the damaged database reachable and read-only.
2. Restore to a **new** branch as in the drill, then verify it (steps 6 to 8 above).
3. **Reconcile before anyone reconnects.** With the damaged database as OLD and the restored branch as
   NEW:

   ```
   RECONCILE_OLD_DATABASE_URL=<damaged, read only> RECONCILE_NEW_DATABASE_URL=<restored> \
     pnpm --filter @visastack/adapters reconcile:restored-branch \
     --restore-point=<UTC time the restore used, ISO 8601>
   ```

   It replays, from the old audit trail, every account deletion, erasure, revoked share, revoked
   consent, ended membership, placed or released legal hold, revoked platform role, organization
   suspension or termination, and case purge after the restore point. It only ever tightens: it never
   brings back access. It must finish with no errors. Design and limits:
   [backup-resurrection-reconciliation.md](./backup-resurrection-reconciliation.md).
4. Verify the audit chain over the whole restored database again, because reconciliation adds events.
5. **Promote:** point production's database variables at the restored branch and redeploy. Then
   re-enable users and the scheduled jobs. Not before.
6. Run the signal checks on `/app/admin` and the smoke checks, tell people what was lost (legally
   reviewed wording), and keep the log.

## Invariants

- Never restore production data into a preview or a synthetic test environment.
- Never edit an applied migration; fix forward.
- The audit chain must verify after any restore. A break is a security incident.
- A database restore is not a document backup, and a provider's version history is not a rehearsed
  procedure. Say which one you actually used.
