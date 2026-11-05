# Restore drill: sign-off sheet

Companion to the restore drill in [recovery.md](recovery.md). Fill one sheet per drill. The result is PASS only when every step passed and both measures are inside their targets; anything else is FAIL or BLOCKED, and the remedy is a task, never a changed target.

| Field | Entry |
|---|---|
| Date and time started | |
| People | |
| Plan history window | |
| Chosen recovery point | |
| Recovery branch name | |

## Steps

| # | Step | Started | Ended | Result (PASS, FAIL, BLOCKED) | Notes |
|---|---|---|---|---|---|
| 1 | Prepare: people, time, recovery point written down | | | | |
| 2 | Restore the database to a new branch (never production) | | | | |
| 3 | Create the recovery environment, pointed at the new branch only | | | | |
| 4 | Restore the files; every object's hash and size match the database | | | | |
| 5 | Restore the key and configuration from escrow, not from production | | | | |
| 6 | Verify the database: ready, no migration pending, audit chain verifies, row counts as expected | | | | |
| 7 | Verify protected data: a protected field reads back with the restored key; a document's hash matches | | | | |
| 8 | Verify access: revoked share still refused, ended membership still ended, one traveller cannot see another's data | | | | |
| 9 | Verify deletions did not come back (reconciliation against production) | | | | |
| 10 | Record the measured data-loss window and the time to a working core service | | | | |
| 11 | Tear down the recovery environment and branch | | | | |

## Measures

| Measure | Target | Measured | Inside target |
|---|---|---|---|
| Data-loss window (restore point to the last write before the incident) | See recovery.md objectives | | |
| Time to a working core service | See recovery.md objectives | | |

## Known gaps before this can pass (from recovery.md)

- An independent copy of the documents (step 4) is not yet proven end to end.
- The key and configuration escrow (step 5) is not yet in place: see O5 and O16 in the owner actions.
- Encrypted database capture and the database-only restore have passed; the full lifecycle has not.

## Result

| Result | PASS / FAIL / BLOCKED |
|---|---|
| Any step that failed or was missing | |
| Follow-up tasks opened | |
| Signed by | |
| Date | |
