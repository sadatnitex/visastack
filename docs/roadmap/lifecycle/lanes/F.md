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
- PR / merged SHA: (filled in at merge)
- Migration number: 0113 (`0113_resource_lifecycle`, journal idx 111, snapshot `meta/0111_snapshot.json`); free on main ad452237; checked again right before merging
- Checks seen green: (filled in at merge)
- Tests added (each new guard broken once on purpose and seen red):
  - `packages/db/src/resource-lifecycle-migration.test.ts`: re-runnable statement by statement; deleted, path and purge time together; one pending request per document and only known values; the receipt guard refuses an edit of `subject_code`, `path` or who asked, a backward status move, a second verified time, losing or changing an effect, and a direct delete; deleting an asking account clears only that name; the whole record cascades.
  - `packages/services/src/lifecycle/foundation/foundation.test.ts`: commands refuse a read-level proof and a directory-view staff scope; a deleted duplicate cannot be removed inside its 30 days; a retention purge finishing a deleted document still completes its Removal Record; a document with no stored file is removed at once and recorded for restores; who approved cannot be replaced; presence false before and true after the migration; the four conditions; state per document, scoped to the proof; `availableDocumentActions` for every state; strict receipts and effects; forward-only advance; owner and privacy-admin lists; `enqueueDocumentRemoval` refuses under an applicant-wide, a document and a case hold; removal deletes the row only after every sibling file verifies, bumps the material revision of the selecting case and reads Removed with the space freed; a hold landing mid-erasure keeps the row and reads Kept; with the tables missing everything reads Current, commands refuse and the transaction stays usable.
  - `packages/services/src/lifecycle/foundation/read-paths.test.ts` (with `read-paths.test-support.ts`): the read-path guard over all services; fixtures prove it fails on a new unlisted read and on a baseline entry that already complies, follows aliases, joins and private helpers, ignores comments and strings, exempts an applicant read keyed on its id (not a join on it) and refuses a same-named local condition.
  - `packages/services/src/backup-reconciliation.test.ts` (new case): a restore never brings back a `DOCUMENT_REMOVAL` and the restored Removal Record reads Removed.
  - `packages/services/src/product-events.test.ts`: the new analytics category.
  - Web: `documents/page.test.tsx` (tables missing: exactly as before and `availableDocumentActions` never called; tables present: tabs only when non-empty, lists split by tab, Removal Records link only when records exist), `manage/manage-menu.test.tsx`, `manage/lifecycle-tabs.test.tsx`, `manage/wallet-row-manage.test.tsx` (the row is unchanged without a menu), `components/lifecycle/undo-status.test.tsx`, `components/lifecycle/removal-record-list.test.tsx`, `lib/vocabulary.test.ts` (no retired word on the lifecycle screens).
- Read baselines at merge (entries still to migrate, `lifecycle/foundation/read-baseline/`): A1 8 document reads and 1 applicant list; A2 51 and 15; B 3 and 2; E 0 and 1. Permanent exceptions with reasons: 13 and 6 (`read-exempt.json`).
- Live / hidden until migration: before migration 0113 runs nothing changes for anyone (no tabs, no Manage menu, every document in the one list; lifecycle commands refuse). After it runs, still nothing new is visible: the menu stays empty until a lane registers an action, and the tabs and the Removal Records link appear only when something is archived, deleted or recorded. The admin scorecard lists the 12 new measures (at zero), and the admin Privacy page can name a Document Removal job.
- Not verified: the migration on production (needs the owner's go-ahead for that run); the screens with real lifecycle data in a browser (nothing can be archived or deleted until wave 1 lanes ship actions).
- Coordinator-approved exceptions (PROGRAMME rule 2; route (b): `allowlists/F.txt` unchanged). Each is the only change in its file:
  - `apps/web/src/app/app/admin/privacy/page.tsx`: one label line, `DOCUMENT_REMOVAL: 'Document Removal',` (WP-SB7 told to keep it).
  - `apps/web/src/app/app/admin/page.tsx`: 12 `SCORECARD_LABELS` lines for the new product events (WP-SB6 told to keep them).
  - `apps/web/src/components/document-wallet-browser.tsx`: optional `manage?: ReactNode` on `WalletBrowserDocument`, drawn in the row after its select button, never in the selected details; a row without it renders as before (`manage/wallet-row-manage.test.tsx`).
  - `apps/web/src/lib/ccd/parity-documents.test.tsx`: one line in its services mock, `lifecycleTablesPresent: async () => false,` (the page before migration 0113, which is what that parity test protects; approved 1 Nov 2026). The tables-present case is covered by `documents/page.test.tsx`.
  - Exact output of `node scripts/programme/check-allowed-paths.mjs docs/roadmap/lifecycle/allowlists/F.txt --no-emdash --exclude docs/design/harbor-v2` before the last commit:

    ```
    4 changed file(s) are outside docs/roadmap/lifecycle/allowlists/F.txt:
      apps/web/src/app/app/admin/page.tsx
      apps/web/src/app/app/admin/privacy/page.tsx
      apps/web/src/components/document-wallet-browser.tsx
      apps/web/src/lib/ccd/parity-documents.test.tsx
    Stop. Ask the owner to approve an allowlist change before editing these files.
    OK: no long dashes in added lines (excluding docs/design/harbor-v2).
    ```
- Ordering note for the coordinator: the Documents page shows a Removal Records link (to `applicant/[id]/removal-records`, lane C) as soon as a receipt exists. Lane C's page must be on main before any lane ships code that writes receipts, or that link leads to a missing page.
- Blocked: none (the earlier block on the privacy page was answered by the coordinator on 31 Oct 2026).

### Signatures for wave 1

Import from `@visastack/services` (or `../lifecycle/foundation` inside services). `LifecycleAccess = AuthorizedApplicant<PermissionAction> | SystemScope<SystemJob> | StaffScope<PlatformAction>`; `Result` is `@visastack/core`'s.

- Reads (`getDocumentLifecycle(s)`): any genuine proof for that applicant, any genuine `SystemScope`, or a fresh `StaffScope`.
- Commands (`openDeletionReceipt`, `advanceDeletionReceipt`, `enqueueDocumentRemoval`): only the record owner's own `MANAGE` proof for that applicant, a `SystemScope` for one of `LIFECYCLE_SYSTEM_JOBS` (`process-erasure`, `process-notification-sweeps`, `process-deletions`), or a fresh `StaffScope` for one of `LIFECYCLE_STAFF_ACTIONS` (`RETENTION_PURGE`, the compliance administrator). A read-level proof, an agency or contributor proof, any other job, and a stale or other staff scope are refused. A lane needing another job or staff action asks the coordinator; the lists live in `lifecycle/foundation/access.ts`.
- A traveller receipt (`TRAVELLER`, `EMPTY_TRAVELLER`) is opened with `applicantId` = another traveller record of the same owner that stays (their Myself), never the record being removed: receipts go with their applicant (cascade, PROGRAMME 3.1).

```ts
lifecycleTablesPresent(db: Db): Promise<boolean>
presentDocumentCondition(): SQL
everydayDocumentCondition(): SQL
presentApplicantCondition(): SQL
everydayApplicantCondition(): SQL
// Add a condition only when lifecycleTablesPresent(db) is true. Written against the unaliased
// `documents` / `applicants` table of the query.

getDocumentLifecycle(db: Db, documentId: string, access: LifecycleAccess, options?: { now?: Date }): Promise<DocumentLifecycle | null>
getDocumentLifecycles(db: Db, documentIds: readonly string[], access: LifecycleAccess, options?: { now?: Date }): Promise<ReadonlyMap<string, DocumentLifecycle>>
// DocumentLifecycle = { state: 'CURRENT' | 'ARCHIVED' | 'RECENTLY_DELETED' | 'REMOVING', replaced: boolean,
//   archivedAt: Date | null, deletedAt: Date | null, purgeAfter: Date | null, deletePath: 'DUPLICATE' | 'REQUEST' | null }
// Tables missing: every document Current. Not covered or not found: absent / null.

DOCUMENT_ACTIONS = ['ARCHIVE','RESTORE','REPLACE','DELETE_DUPLICATE','RESTORE_DELETED','REQUEST_REMOVAL','CANCEL_REMOVAL_REQUEST'] as const
availableDocumentActions(view: DocumentActionView): DocumentAction[]
// DocumentActionView = { state, replaced, isDuplicate, duplicateBlockReason: DuplicateBlockReason | null,
//   pendingRequest, legalHold, requestsSwitchOn }
// DuplicateBlockReason = 'FINISHED_CASE' | 'AGENCY_REQUEST_ANSWER' | 'CONTRIBUTOR_HANDOVER' | 'SHARED_BY_NAME' | 'LEGAL_HOLD'

receiptEffectsSchema  // zod, strict: casesSwitched?, casesFlagged? (C- codes), acknowledgementsReset?, sharesAffected?,
                      // aiChoicesMoved?, aiChoicesRemoved?, agencyRequestsAffected? (R- codes), bytesFreed?
openDeletionReceipt(tx: Db, input: OpenDeletionReceiptInput, access: LifecycleAccess): Promise<Result<{ id: string }, ServiceError>>
// input (strict) = { applicantId, subjectKind: 'DOCUMENT' | 'TRAVELLER', subjectCode (D- or P- code matching the kind),
//   documentKind? (catalogue key), uploadedAt?, uploadedByRole?, path: 'DUPLICATE' | 'REQUEST' | 'EMPTY_TRAVELLER',
//   requestedByAccountId?, approvedByAccountId?, requestedAt?, scheduledFor?, status?: 'SCHEDULED' | 'REMOVING', effects? }
advanceDeletionReceipt(tx: Db, id: string, next: DeletionReceiptStatus, patch: { approvedByAccountId?, verifiedGoneAt?, effects? }, access: LifecycleAccess): Promise<Result<{ status: DeletionReceiptStatus }, ServiceError>>
// Forward only: SCHEDULED -> RESTORED | REMOVING | BLOCKED; REMOVING -> REMOVED | BLOCKED; BLOCKED -> REMOVING.
// Lists gain codes; a count is written once (a changed count is refused).
listDeletionReceipts(access: AuthorizedApplicant<'VIEW_METADATA'> | StaffScope<'APPLICANT_DIRECTORY_VIEW'>, options?: { db?: Db; applicantId?: string; limit?: number }): Promise<Result<readonly DeletionReceiptView[], ServiceError>>
// Owner proof (actor applicant_owner): its own record. Staff scope: name db and applicantId. Newest first, at most 200.

enqueueDocumentRemoval(tx: Db, input: { documentId: string; applicantId: string; receiptId: string }, access: LifecycleAccess): Promise<Result<EnqueueDocumentRemovalOutcome, ServiceError>>
// Needs a document_lifecycle row with deleted_at set and receipt_id = receiptId. Outcomes:
// { outcome: 'QUEUED', storageObjects } | { outcome: 'REMOVED' } (no stored file) | { outcome: 'BLOCKED' } (legal hold; receipt BLOCKED, nothing queued)
// The erasure worker deletes the row after every file verifies and sets the receipt REMOVED with verified_gone_at and bytesFreed.
```

Web (`apps/web/src/app/app/applicant/[id]/documents/manage/`): `registry.tsx` `MANAGE_ACTIONS` with anchors `// LC-A1 actions`, `// LC-B actions`, `// LC-C actions`, `// LC-D actions`; each entry `{ label, Component }`, the component receiving `{ applicantId, documentId, documentName, onClose }`. `view.ts` `documentActionView(lifecycle, facts)`: the facts lanes C and D own (`isDuplicate`, `duplicateBlockReason`, `pendingRequest`, `legalHold`, `requestsSwitchOn`) start as "no"; wiring their readers into `page.tsx` needs a coordinator decision (F owns that file). Shared pieces: `components/lifecycle/undo-status.tsx` (`UndoStatus`), `components/lifecycle/removal-record-list.tsx` (`RemovalRecordList`, `removalRecordSentence`). Deep link: `?manage=<documentId>&action=<ACTION>` opens that action when the rule allows it; `?view=archived` and `?view=deleted` open those lists.
