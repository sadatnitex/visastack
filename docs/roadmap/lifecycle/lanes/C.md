# LC-C Duplicates, Recently Deleted and Removal Records

- Wave 1. Branch: `claude/lc-c-duplicates`. Depends on: F merged. Allowlist: `../allowlists/C.txt`.
- Read first: `../PROGRAMME.md` sections 2 (D2 to D5, D8, D10), 3, 5, 6, 7.

## Objective

Duplicates can be removed by the person, safely: right after upload or later, with 30 days to change their mind, then verified destruction and a readable record. A calm "Tidy Up" card on Home points to what can be tidied.

## Build

1. `packages/services/src/lifecycle/duplicates/`: `duplicateStatus(db, documentId)` returning `{ isDuplicate, survivorDocumentId, blockReason }` per D2 and D5 (block reasons: `FINISHED_CASE`, `AGENCY_REQUEST_ANSWER`, `CONTRIBUTOR_HANDOVER`, `SHARED_ON_ITS_OWN`, `LEGAL_HOLD`, `NO_FINGERPRINT`). Do not modify `findDuplicateVersions`; write the stricter query here.
2. `packages/services/src/lifecycle/recently-deleted/`: `deleteDuplicate(access, documentId)` (one transaction: re-check duplicate status under the document row lock; switch open-case selections and AI connection document choices to the survivor; `incrementMaterialRevision` once per switched case; write `document_lifecycle` with `DUPLICATE` and `purge_after` 30 days; open a receipt `SCHEDULED` with effects; audit and product event), `undoDelete` and `restoreDeleted` (receipt `RESTORED`; no switch back), and `purgeDueDocuments(db, now)` (for each due row, under hold check, `enqueueDocumentRemoval`).
3. `apps/web/src/lib/lifecycle-jobs/purge.ts` called from `api/jobs/process-erasure/route.ts` before the erasure worker runs.
4. Upload result: when the upload matched an identical document, offer "Remove This New Copy" (calls `deleteDuplicate` on the new document; `DUPLICATE_REMOVED_AT_UPLOAD`). Files: `applicant/[id]/actions.ts`, `document-uploader.tsx`.
5. Manage menu actions under `documents/manage/delete/` (Delete Duplicate with the case-switch confirmation when an open case uses it; Restore from Recently Deleted showing "Removed in N Days"), registered under the C anchor.
6. Removal Records on their own page, `applicant/[id]/removal-records/page.tsx`, through `RemovalRecordList` (10 rows, then Show More, per the Scroll Budget targets); the backup sentence of D10 on the page. The History page belongs to WP-SB1 and is not edited (PROGRAMME 5.3); F's Documents page links here when records exist.
7. Tidy Up card on Home (`(home)/page.tsx`): only when there is something to tidy (duplicates, expired, replaced), one action, Glance depth.

## Red first

Deleting a duplicate whose survivor is itself in Recently Deleted is refused; a finished case selection blocks; purge never runs under a legal hold placed during the window.

## Acceptance

PROGRAMME section 8 rows Duplicates, Destruction and Records; storage figure drops only after verification; other documents and travellers untouched; works with tables missing. Record the finished-case packet download result (PROGRAMME section 12).

## Not yours

Support requests (D), any other read site (A2), Replace (B), travellers (E).

## Status (lane fills in)

- Started on main:
- PR / merged SHA:
- Checks seen green:
- Live / hidden until migration:
- Not verified:
- Blocked:
