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

- Started on main: 19ec6a15ec99e0ea7877454560b51bbf3ba1be46 (1 Nov 2026).
- PR / merged SHA: #396, squash 9c8b664ee2c0aac06e600271e110e89e3f40b3f1 (head a333049c, 1 Nov 2026).
- Checks seen green: on head a333049c: Lint · Build · Typecheck · Test, No-secret Playwright checks, No-secret smoke check, CodeQL. After merge on 9c8b664e: Vercel production deployment, Deploy Smoke, Playwright Deploy Smoke, Live signed-in check, CI on main; GET /api/health/ready returns ready.
- Tests added:
  - `packages/services/src/lifecycle/recently-deleted/recently-deleted.test.ts`: tables missing (nothing offered, deleted or purged); the D2 rule (usable copy, no fingerprint, other person); red first: a survivor in Recently Deleted refuses, a finished case blocks, a hold placed during the 30 days stops the purge (each proven able to fail by breaking the real code once); the other D5 blocks; open cases and AI app choices switch, one material revision bump, no switch back on Undo; purge only after 30 days through verified erasure; owner only; reading queued again on restore (A2 follow-up); Tidy Up counts.
  - Web: `manage/delete/delete-action.test.tsx`, `(home)/tidy-up.test.tsx`, `lib/lifecycle-jobs/purge.test.ts`, upload route, upload client and uploader tests for Remove This New Copy.
- Live / hidden until migration: migration 0113 has run on production, so Delete Duplicate, Restore, Remove This New Copy, Removal Records and Tidy Up are live after merge. With the tables missing every piece reads "not a duplicate", refuses commands and purges nothing (tested).
- Not verified: the finished-case packet download after a deletion (PROGRAMME section 12) is not run in a browser; a safe copy (redaction) for the surviving copy is not prepared automatically when an AI app choice moves to it (the AI gate then serves nothing for that choice until one is prepared); intake's own deterministic extraction skipped while deleted is not re-run on restore (only the AI reading is re-queued).
- Path check: coordinator-approved exceptions (1 Nov): `documents/page.tsx` (reads and passes `isDuplicate` and `duplicateBlockReason` only; `view.ts` needed no change), and `api/documents/upload/route.ts`, `lib/document-upload-client.ts` plus their tests (one optional `removableCopyId`). Output: "5 changed file(s) are outside docs/roadmap/lifecycle/allowlists/C.txt: apps/web/src/app/api/documents/upload/route.test.ts, apps/web/src/app/api/documents/upload/route.ts, apps/web/src/app/app/applicant/[id]/documents/page.tsx, apps/web/src/lib/document-upload-client.test.ts, apps/web/src/lib/document-upload-client.ts" and "OK: no long dashes in added lines". Every other file is inside the allowlist.
- Blocked: none (the upload-path files were approved by the coordinator on 1 Nov).
