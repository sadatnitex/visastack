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

- Started on main:
- PR / merged SHA:
- Migration number:
- Checks seen green:
- Live / hidden until migration:
- Not verified:
- Blocked:
