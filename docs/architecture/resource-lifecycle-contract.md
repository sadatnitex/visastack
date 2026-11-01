# Resource lifecycle contract

Written by lane F of the Resource Lifecycle Programme (`docs/roadmap/lifecycle/PROGRAMME.md`, sections 1 to 3), 1 Nov 2026. This is the model every lane builds on: what each kind of record can go through, where the rule lives, and what is kept forever. The code is the truth; where this page and the code differ, the code wins and this page is corrected.

## 1. The rules in one place

| Rule | Where it lives |
|---|---|
| What "current", "archived", "recently deleted" and "being removed" mean | `packages/services/src/lifecycle/foundation/` (`state.ts`, `conditions.ts`) |
| Which Manage actions a document offers | `availableDocumentActions` (`actions.ts`), pure; lanes never compute visibility themselves |
| Which reads must apply the rule | `lifecycle/foundation/read-paths.test.ts`, with one baseline per owning lane (`read-baseline/<LANE>.json`, shrink only) and permanent exceptions with reasons (`read-exempt.json`) |
| The Removal Record and what it may hold | `receipts.ts` (strict input), migration 0113's `deletion_receipts` guard |
| Verified removal of a document's files | `enqueueDocumentRemoval` (`removal.ts`) and the erasure engine (`erasure.ts`, `DOCUMENT_ROW_REASONS`) |
| A backup restore never brings a removal back | `backup-reconciliation.ts` (`DOCUMENT_ROW_REASONS`) |

Before migration 0113 runs, `lifecycleTablesPresent(db)` is false: no lifecycle table is read, every document reads Current, every lifecycle command refuses, and the Documents page shows no tabs and no Manage menu. Callers add a condition only when the tables are present:

```ts
const lifecycle = await lifecycleTablesPresent(db);
db.select().from(schema.documents).where(
  and(eq(schema.documents.applicantId, id), lifecycle ? everydayDocumentCondition() : undefined),
);
```

The four conditions are written against the unaliased `documents` and `applicants` tables of the query they join. An aliased table makes the query fail loudly, never silently.

## 2. Lifecycle per resource

| Resource | Create | View | Correct | Replace | Archive | Restore | Delete | Ends by | Kept forever | Downstream effects |
|---|---|---|---|---|---|---|---|---|---|---|
| Document (unique) | Upload | Current list; Archived list once archived | Rename, set kind and date (versioned) | Replace With a Newer Document: the old one reads Replaced and stays | Archive: hidden from default lists, offers and automatic matching; kept whole | Restore, any time | Not by the person (D1). Ask Us to Remove This File, reviewed by support | Retention purge, account deletion, or an approved removal | Removal Record; audit events; Case History shows it as removed | An archived document stays wherever it was explicitly chosen, flagged (D6). An approved removal bumps the material revision of every case selecting it (TRU-03) |
| Document (exact duplicate) | Upload | As above | As above | As above | As above | As above, and from Recently Deleted for 30 days | Delete Duplicate, no new sign-in (D7), when every version's fingerprint exists in another usable document of the same person that stays (D2) | 30 days in Recently Deleted, then verified erasure (D3) | Removal Record | Open cases using it switch to the surviving copy and their material revision moves on (D4); restoring does not switch back. Refused, with Archive offered, for a finished case's choice, an agency request answer, a contributor's handover, a live grant naming it, or a legal hold (D5) |
| Traveller record | Add Traveller | Travellers list; archived ones on their own list | Profile edits (versioned) | Not applicable | Archive Traveller (never "Myself") | Restore Traveller | Remove Empty Record only, through Recently Deleted; an empty Myself only while another Myself exists (D9) | Account deletion | Removal Record (path `EMPTY_TRAVELLER`) | Archived travellers leave default lists and offers |
| Removal request | Ask Us to Remove This File (reason from a closed list, no typed note) | The person's document; the support queue | Not applicable | Not applicable | Not applicable | Cancel while pending | Not applicable | Approved, Declined, Cancelled or Completed | The request row and the Removal Record | Approval moves the document to removal at once; staff approving pass staff step-up (D7) |
| Removal Record | Opened by the action that removes | Removal Records (owner); privacy admin | Never: only a forward status move, the approver, the verified time and new effects | Not applicable | Not applicable | Not applicable | Never by itself; it goes only with the whole traveller record (cascade) | Never | Itself; `audit_events` stays as the pseudonymous proof after a whole account goes (PRV-03) | None |
| Profile fact | Answer or approve a suggestion | Profile | A new version (P1) | Not applicable | Marked No Longer Current, never deleted | Not applicable | Never | Account deletion | Every version | Cases keep the version they captured |
| Share, membership, request, invoice | Their own flows | Their own pages | Not applicable | Not applicable | Not applicable | Not applicable | Never: revoked, cancelled or ended (P2) | Revoke, cancel, end | The row and its audit events | Access ends at once |

## 3. Document states

| State | Stored as | Offered actions (when registered by a lane) |
|---|---|---|
| Current | no `document_lifecycle` row, or one with neither time set | Archive; Replace while not replaced; Delete Duplicate or Ask Us to Remove This File; Cancel Removal Request while one is pending |
| Archived | `archived_at` set | Restore; Delete Duplicate or Ask Us to Remove This File; Cancel Removal Request |
| Recently Deleted | `deleted_at` set, `delete_path = DUPLICATE`, `purge_after` in the future | Restore (from Recently Deleted) |
| Being removed | `delete_path = REQUEST`, or `purge_after` reached | none |

A legal hold (on the whole record, on the document, or on a case selecting it) offers neither deletion nor a request, refuses `enqueueDocumentRemoval` (the receipt reads Kept (Legal Requirement)), and, if it lands while files are being erased, keeps the document row and blocks the receipt.

## 4. Removal Record

Kept: reference code (`D-` or `P-`), kind of record, catalogue document kind (never a title), upload date and uploader role, where it was used (case `C-` and request `R-` codes), who asked and who approved (account ids, never shown in lists), the dates, the status, and counted effects (`casesSwitched`, `casesFlagged`, `acknowledgementsReset`, `sharesAffected`, `aiChoicesMoved`, `aiChoicesRemoved`, `agencyRequestsAffected`, `bytesFreed`). Never: a name, a title, a number, typed text, the file or a raw fingerprint (D8). The input schemas are strict, so an unknown key is refused before anything is written.

Status moves only forward: Scheduled to Restored, Removing or Kept; Removing to Removed or Kept; Kept to Removing. People read: Scheduled (or Removed in N Days), Restored, Removing Securely, Removed, Kept (Legal Requirement). Backups: "Removed from VisaStack. Backup copies expire within 90 days and are never brought back." (D10).

## 5. Access

Every exported lifecycle function that touches a person's records takes an access gate as its last parameter (the access ratchet, `access/enforcement.test.ts`): an `AuthorizedApplicant` for that applicant, a `SystemScope` (a scheduled job) or a `StaffScope`. The Removal Records list takes the owner's own `VIEW_METADATA` proof, or a fresh `APPLICANT_DIRECTORY_VIEW` staff scope with the database and applicant named.

## 6. Registered names

- Product events: `DOCUMENT_ARCHIVED`, `DOCUMENT_RESTORED`, `DOCUMENT_REPLACED`, `DUPLICATE_REMOVED_AT_UPLOAD`, `DOCUMENT_DELETED`, `DOCUMENT_DELETE_UNDONE`, `DOCUMENT_DESTROYED`, `REMOVAL_REQUESTED`, `REMOVAL_DECIDED`, `TRAVELLER_ARCHIVED`, `TRAVELLER_RESTORED`, `TRAVELLER_REMOVED` (no label; analytics category "Archive, replace and removal").
- Audit event types (free text; metadata holds ids, codes and counts only): `DOCUMENT_ARCHIVED`, `DOCUMENT_RESTORED`, `DOCUMENT_SUPERSEDED` (exists), `DOCUMENT_DELETED`, `DOCUMENT_DELETE_UNDONE`, `DOCUMENT_REMOVAL_QUEUED` (written by `enqueueDocumentRemoval`, metadata `receiptId`, `storageObjects`), `DOCUMENT_REMOVAL_BLOCKED` (written by `enqueueDocumentRemoval` and the erasure worker, metadata `receiptId`, `cause: LEGAL_HOLD`), `DOCUMENT_REMOVAL_REQUESTED`, `DOCUMENT_REMOVAL_DECIDED`, `DOCUMENT_REMOVAL_REQUEST_CANCELLED`, `APPLICANT_ARCHIVED`, `APPLICANT_RESTORED`, `APPLICANT_DELETED`, `APPLICANT_REMOVED`, `FACT_MARKED_NOT_CURRENT`, `ORGANIZATION_APPLICATION_WITHDRAWN`. The Active and Past cases split is presentation only and records no event.
- Erasure reason: `DOCUMENT_REMOVAL` (admin label "Document Removal").
- Words people see: `docs/uiux/ccd/VOCABULARY.md`, section "Resource lifecycle".
