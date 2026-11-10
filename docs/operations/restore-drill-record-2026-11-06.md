# Restore drill record, 6 November 2026 (partial, result BLOCKED)

Filled on the [sign-off sheet](restore-drill-signoff.md) format. The owner said "run the drill" in the decision pack of 6 November 2026 (item 9). Only the steps that can be done today were done; the others are blocked by gaps that [recovery.md](recovery.md) already lists, so the result cannot be PASS.

| Field | Entry |
|---|---|
| Date | 6 November 2026 |
| Who | Claude Code, on the owner's instruction |
| Recovery point | The state of production at 01:48 UTC (a branch from the current point, not an earlier time; no incident was simulated) |
| Recovery branch | `drill/2026-11-06-restore-check` (id br-plain-smoke-a4gxiypu), a new branch of the production project; production was never written |

## Steps

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Prepare | PASS | Recovery point and branch named above |
| 2 | Restore the database to a new branch | PASS | Created at 01:48:25 UTC from production's data; ready when first queried a few minutes later |
| 3 | Recovery environment | NOT DONE | No application was pointed at the branch; only the database was checked |
| 4 | Restore the files | BLOCKED | No independent copy of the documents exists yet (recovery.md, gap 1) |
| 5 | Restore the key and configuration from escrow | BLOCKED | No escrow exists yet (O5, O16) |
| 6 | Verify the database | PARTIAL | The branch and production hold the same 124 tables and 1,077 rows in total, with an identical per-table fingerprint (4d54c3b6ab81f565142ad5bc2be1a10e), including 9 accounts and 14 documents. Not run: the readiness endpoint against the branch and the audit chain check, which need an application and a database address that this session does not hold |
| 7 | Verify protected data | BLOCKED | Needs step 5 |
| 8 | Verify access | NOT DONE | Needs step 3 |
| 9 | Verify deletions did not come back | NOT DONE | The reconciliation needs a branch from an earlier point than production |
| 10 | Record measures | NOT MEASURED | No restore point earlier than now was used, so no data-loss window; no application was brought up, so no time to a working service |
| 11 | Tear down | PENDING | The branch is still there. The Neon tool asks for the owner's confirmation before deleting a branch; delete it once confirmed (the project holds 3 branches with it) |

## Result: BLOCKED

- The database restore itself works and is fast, and the copy matches production exactly.
- A full pass needs: the independent copy of the documents (step 4), the key and configuration escrow (step 5), and an application started against the branch (steps 3, 6 to 9).
- Follow-up tasks: build the independent document copy; set up escrow (owner action O5, then O16 for the key service); re-run with a restore point 30 minutes in the past and the application started.

## Update of 10 November 2026: step 11 done

- Step 11 (Tear down) is done. On the owner's word the recovery branch `drill/2026-11-06-restore-check` (id br-plain-smoke-a4gxiypu) was deleted from the Neon project. Checked first: no child branch, compute idle since 6 Nov, nothing written to it after it was made, and no Vercel domain, alias or workflow referring to it.
- The Neon project now holds two branches: `main` and the preview branch for `public-beta/r2-encrypted-recovery`, which stays while its Vercel preview domain is bound to it.
- Steps 3 to 9 are still open. The follow-up re-run needs a new branch made from a restore point about 30 minutes in the past, with the application started against it; it cannot reuse the deleted one.

