# LC-F Foundation

- Wave 0. Branch: `claude/lc-f-foundation`. Depends on: nothing. Allowlist: `../allowlists/F.txt`.
- Read first: `../PROGRAMME.md` sections 2, 3, 5, 6, 7 (the contract is section 3; build it exactly).

## Objective

Lay the single shared base every wave 1 lane builds on: the migration, the lifecycle rule and its guard, the receipts, the removal path through the erasure engine, the registered names, and the empty-safe screen pieces. After this lane nothing new is visible to people except that the Documents page has a Manage menu with no entries yet and tabs that stay hidden.

## Build

1. Check the next free migration number on fresh main (0112 at plan time). Add the four tables and the enum value of section 3.1 to `packages/db/src/schema.ts` in one new section, generate the migration with drizzle-kit under the name `<number>_resource_lifecycle` (the allowlist expects that name), make it re-runnable (IF NOT EXISTS and DO-block guards as the repo's recent migrations do), and add the receipts trigger.
2. `packages/services/src/lifecycle/foundation/`: presence check, the four conditions, `getDocumentLifecycle(s)`, `DOCUMENT_ACTIONS`, `availableDocumentActions`, `receiptEffectsSchema`, `openDeletionReceipt`, `advanceDeletionReceipt`, `listDeletionReceipts`, `enqueueDocumentRemoval` (section 3.2). Each command takes a `requireAccess` proof; nothing is added to `enforcement-baseline.json`.
3. Generalise `erasure.ts` finalisation to `DOCUMENT_ROW_REASONS = ['RETENTION_PURGE','DOCUMENT_REMOVAL']` and advance the receipt on verification or hold. Extend `backup-reconciliation.ts` the same way.
4. The guard test, one baseline file per owning lane under `lifecycle/foundation/read-baseline/` (`A1.json` for `missions.ts`, `B.json` for `wallet.ts` and `notification-sweep.ts`, `E.json` for `applicants.ts`, `A2.json` for every other current read site) and `read-exempt.json` (permanent, with reasons).
5. Register every product event, document every audit event type, add every vocabulary word (section 3.5).
6. Anchors in `services/src/index.ts` and `documents/manage/registry.tsx` (section 5.2), plus F's own exports.
7. Screen pieces of section 3.4 and the Documents page wiring. The Manage menu shows nothing until a lane registers an action; tabs other than Current show only when non-empty.
8. `docs/architecture/resource-lifecycle-contract.md`: the lifecycle model per resource (create, view, correct, replace, archive, restore, delete, ends by, kept forever, downstream effects), written from PROGRAMME sections 1 to 3.

## Red first

- Guard test fails on a new unlisted read and on a baseline entry that already complies.
- Receipt trigger refuses an edit of `subject_code` and a backward status move.
- `enqueueDocumentRemoval` refuses under a document, case and applicant-wide legal hold.
- Finalising a `DOCUMENT_REMOVAL` job bumps the material revision of every case selecting the document, deletes the row only after all sibling storage objects verify, and sets the receipt `REMOVED`.
- With the tables missing, the Documents page renders exactly as before and `availableDocumentActions` is never called.

## Acceptance

All of the above, plus the definition of done in PROGRAMME section 7. Report the migration number in this file and in the PR title.

## Not yours

Any read-site migration (A1, A2, B, E do those), any action component, any job route, central status docs.

## Status (lane fills in)

- Started on main: ad4522378b84d3d51011f5caef0fd9eb595acca6
- PR / merged SHA: none yet (work in progress pushed to `claude/lc-f-foundation`, no PR)
- Migration number: 0113 (`0113_resource_lifecycle`, journal idx 111), free on main ad452237; recheck before merge
- Checks seen green: none yet (local only: migration test and schema drift test pass; the receipt guard was broken once and its tests went red)
- Live / hidden until migration: nothing shipped yet
- Not verified: services foundation tests, guard test, screen pieces (not written yet)
- Blocked:
  - 31 Oct 2026. Adding the frozen erasure reason `DOCUMENT_REMOVAL` (section 3.1) breaks the typecheck of `apps/web/src/app/app/admin/privacy/page.tsx`: its `ERASURE_REASON_LABELS` map is `satisfies Record<ErasureJobReason, string>`, so every reason must have a label. That file is outside `allowlists/F.txt` and inside `app/admin/privacy/**`, which PROGRAMME 5.3 gives to WP-SB7. The fix is one line in that map, `DOCUMENT_REMOVAL: 'Document Removal',`, and it must land in the same pull request as the enum value (added earlier, the `satisfies` check refuses an unknown key; added later, main does not compile). Proposed answer: add that one file to `allowlists/F.txt` for this single line, with WP-SB7 told that it will merge main and keep the line. No other file names the reason type exhaustively (checked with a repository search).
  - Not blocking, for the coordinator to confirm: the access ratchet (`access/enforcement.test.ts`) requires every exported function that touches a person's records to take an access gate as a direct parameter, and the brief forbids baseline entries. So the section 3.2 functions keep their names and leading parameters and take one more, last: `getDocumentLifecycle(db, documentId, access)`, `getDocumentLifecycles(db, documentIds, access)`, `openDeletionReceipt(tx, input, access)`, `advanceDeletionReceipt(tx, id, next, patch, access)`, `enqueueDocumentRemoval(tx, input, access)`, where `access` is an `AuthorizedApplicant`, a `SystemScope` or a `StaffScope`; `listDeletionReceipts(access, { db, applicantId })` takes the owner's proof or a fresh `APPLICANT_DIRECTORY_VIEW` staff scope. The four conditions read nothing and take no parameter; callers add them only when `lifecycleTablesPresent(db)` is true.
