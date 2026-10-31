# Resource Lifecycle Programme (LC)

Owner-approved plan, 31 Oct 2026. Written against main `2d71a89c`. Every "exists today" statement was read in that code; nothing in this folder has been built yet. Re-check the head SHA before acting: this plan is the contract, the code is the truth.

**Goal:** a person can always fix, tidy, replace, hide or remove what they put into VisaStack. Every action is reversible where it can be and proven where it cannot, and the true history of what happened is never lost.

## 0. Files in this folder

| File | Who reads it |
|---|---|
| `PROGRAMME.md` (this file) | Everyone. Lane sessions read sections 2, 3, 5, 6 and 7 only. |
| `KICKOFF.md` | The owner and the coordinator session: how to start every lane. |
| `STATUS.md` | One row per lane. During the run each lane's own file is the live record; lane Z writes the final state here. |
| `lanes/<LANE>.md` | One brief per lane. A lane session reads only its own. |
| `allowlists/<LANE>.txt` | One file allowlist per lane, enforced by `scripts/programme/check-allowed-paths.mjs`. |

## 1. Principles

| # | Principle | In practice |
|---|---|---|
| P1 | Version what proves truth | Profile values, cases, snapshots and acknowledgements are never rewritten. Correction adds a version. |
| P2 | Revoke or cancel relationships | Shares, memberships, requests, invoices end; they are never deleted. |
| P3 | Archive what is unwanted but unique | Hidden from everyday views, kept whole, restorable at any time. |
| P4 | Delete only what is redundant; support reviews the rest | Exact duplicates are self-service. Unique files go through "Ask Us to Remove This File". |
| P5 | Undo, not confirm | Reversible actions run at once with Undo. A confirmation with an impact list appears only for what cannot be undone or changes a case. |
| P6 | Every removal leaves a record with no content | Who, what kind, where used, when, what changed. Never names, numbers, text, the file or a raw fingerprint. |
| P7 | One rule, one place | One lifecycle condition decides what is current. A guard test forces every read path to use it or to be a listed exception. |
| P8 | Nothing breaks before the migration runs | New state lives in new tables, read only after a presence check (the `redactionMasksTablePresent` pattern). |

## 2. Owner decisions in force (do not re-ask)

| # | Decision |
|---|---|
| D1 | Unique documents can be archived, never self-deleted. Full removal of a unique file is "Ask Us to Remove This File", reviewed by support (L4/lane D). |
| D2 | Exact duplicates can be self-deleted: every version's fingerprint must exist in another of the same person's documents that stays, is usable (clean, servable) and is not itself being deleted or removed. |
| D3 | A deleted duplicate goes to Recently Deleted for 30 days (restorable), then is destroyed through the existing verified erasure engine. A support-approved removal is destroyed right after approval. |
| D4 | Deleting a duplicate that an open case uses switches that case (and any AI app choice) to the surviving identical copy at delete time and bumps the case material revision (TRU-03). Restoring later does not switch back. |
| D5 | Deleting a duplicate is refused, with a plain reason and Archive offered, when: a finished (closed, cancelled, submitted) case selected it; it answered an agency evidence request; a contributor handed it over; a live grant names it in `document_ids`; or a legal hold covers it. |
| D6 | An archived item that was explicitly chosen (case selection, share, AI app choice) stays where it was chosen, flagged. Archive changes only what is offered by default. |
| D7 | No re-sign-in for deleting a duplicate. Staff approving a removal request must pass staff step-up. |
| D8 | The deletion record keeps: reference code, kind, upload date and uploader role, where it was used (reference codes), who requested and approved, dates, effects. It never keeps a name, title, number, text, file or raw hash. |
| D9 | Travellers: archive and restore any; permanently remove only an empty record (through Recently Deleted). "Myself" is never archived; an empty Myself can be removed only while another Myself record exists. |
| D10 | Backups: tell people "Removed from VisaStack. Backup copies expire within 90 days and are never brought back." The restore reconciliation must re-apply the new removal reason. |
| D11 | Parallel execution: the owner authorises separate sessions per lane for this programme (see `KICKOFF.md`). Each session still obeys every other CLAUDE.md rule. |

## 3. Frozen contract (lane F builds exactly this; every other lane builds on it)

Names below are binding. A lane that believes a name is wrong stops and writes it under "Blocked" in its lane file; it never renames on its own.

### 3.1 Database (one additive migration, the next free number on fresh main; 0112 at plan time, because 0111 is `traveller_plan_rules`)

Text columns with CHECK constraints (the `profile_field_exemptions` pattern), not new Postgres enums, except the one erasure reason value.

**`document_lifecycle`** (one row per document that has ever been archived or deleted)
- `document_id` uuid PK, FK `documents.id` ON DELETE CASCADE
- `applicant_id` uuid NOT NULL, FK `applicants.id` ON DELETE CASCADE (tenant anchor, indexed)
- `archived_at` timestamptz NULL, `archived_by_account_id` uuid NULL FK accounts SET NULL
- `deleted_at` timestamptz NULL, `deleted_by_account_id` uuid NULL FK accounts SET NULL
- `delete_path` text NULL CHECK in (`DUPLICATE`, `REQUEST`)
- `purge_after` timestamptz NULL (deleted_at + 30 days for `DUPLICATE`; deleted_at for `REQUEST`)
- `receipt_id` uuid NULL FK `deletion_receipts.id` SET NULL
- `updated_at` timestamptz NOT NULL default now()
- CHECK: `deleted_at IS NULL` = `delete_path IS NULL` = `purge_after IS NULL`
- Index on (`purge_after`) where `deleted_at IS NOT NULL`

**`applicant_lifecycle`**
- `applicant_id` uuid PK FK applicants CASCADE
- `archived_at`, `archived_by_account_id`, `deleted_at`, `deleted_by_account_id`, `purge_after`, `receipt_id`, `updated_at` (same meanings)

**`document_removal_requests`**
- `id` uuid PK; `applicant_id` uuid NOT NULL FK CASCADE; `document_id` uuid NULL FK documents SET NULL; `document_code` text NOT NULL (the D- code, kept after the document is gone)
- `reason` text NOT NULL CHECK in (`WRONG_PERSON`, `UPLOADED_BY_MISTAKE`, `NO_LONGER_NEEDED`, `PRIVACY_CONCERN`, `OTHER`)
- `status` text NOT NULL CHECK in (`PENDING`, `APPROVED`, `DECLINED`, `CANCELLED`, `COMPLETED`)
- `requested_by_account_id` uuid NULL FK SET NULL; `requested_at` timestamptz NOT NULL
- `decided_by_account_id` uuid NULL FK SET NULL; `decided_at` timestamptz NULL
- `decision_code` text NULL CHECK in (`APPROVED`, `LEGAL_HOLD`, `FINISHED_CASE_RECORD`, `AGENCY_REQUEST_ANSWER`, `RETENTION_REQUIRED`, `OTHER`)
- `completed_at` timestamptz NULL; `receipt_id` uuid NULL FK SET NULL
- Partial unique index: one `PENDING` request per `document_id`
- No free-text column anywhere (a typed note can hold personal data).

**`deletion_receipts`**
- `id` uuid PK; `applicant_id` uuid NOT NULL FK CASCADE (whole-account deletion removes receipts; `audit_events` stays as the pseudonymous proof, PRV-03)
- `subject_kind` text CHECK in (`DOCUMENT`, `TRAVELLER`); `subject_code` text NOT NULL (D- or P- code)
- `document_kind` text NULL (catalogue doc type key, never a title)
- `uploaded_at` timestamptz NULL; `uploaded_by_role` text NULL CHECK in (`OWNER`, `AGENCY_MEMBER`, `CONTRIBUTOR`, `SYSTEM`)
- `path` text CHECK in (`DUPLICATE`, `REQUEST`, `EMPTY_TRAVELLER`)
- `requested_by_account_id`, `approved_by_account_id` uuid NULL FK SET NULL
- `requested_at` timestamptz NOT NULL; `scheduled_for` timestamptz NULL; `verified_gone_at` timestamptz NULL
- `status` text CHECK in (`SCHEDULED`, `RESTORED`, `REMOVING`, `REMOVED`, `BLOCKED`)
- `effects` jsonb NOT NULL (validated by the zod schema in 3.2), `created_at`
- A trigger refuses UPDATE of any column except `status`, `approved_by_account_id`, `verified_gone_at`, `effects` (effects may only gain keys), and refuses DELETE except by cascade. Status moves only forward: SCHEDULED to RESTORED, REMOVING or BLOCKED; REMOVING to REMOVED or BLOCKED; BLOCKED to REMOVING.

**Enum value:** `ALTER TYPE erasure_job_reason ADD VALUE IF NOT EXISTS 'DOCUMENT_REMOVAL'` (not used inside the migration's own transaction).

### 3.2 Services (`packages/services/src/lifecycle/foundation/`)

| Export | Contract |
|---|---|
| `lifecycleTablesPresent(db)` | true only when all four tables exist; cached per process like `redactionMasksTablePresent`. Every lifecycle read and command checks it; when false, behaviour is exactly today's and lifecycle actions are hidden. |
| `presentDocumentCondition()` | SQL condition on `schema.documents`: not in Recently Deleted, not being removed (no `document_lifecycle.deleted_at`). Use for anything that must never show a deleted document. |
| `everydayDocumentCondition()` | `presentDocumentCondition()` AND not archived. Use for default lists, offers and automatic matching. |
| `presentApplicantCondition()`, `everydayApplicantCondition()` | The same for `schema.applicants`. |
| `getDocumentLifecycle(db, documentId)` | `{ state: 'CURRENT' \| 'ARCHIVED' \| 'RECENTLY_DELETED' \| 'REMOVING', replaced: boolean, archivedAt, deletedAt, purgeAfter, deletePath }` |
| `getDocumentLifecycles(db, documentIds)` | Map form of the above, one query. |
| `DOCUMENT_ACTIONS` | `['ARCHIVE','RESTORE','REPLACE','DELETE_DUPLICATE','RESTORE_DELETED','REQUEST_REMOVAL','CANCEL_REMOVAL_REQUEST']` |
| `availableDocumentActions(view)` | Pure. Input: lifecycle state, replaced, isDuplicate, duplicateBlockReason, pendingRequest, legalHold, requestsSwitchOn. Output: ordered list of allowed actions. Lanes never compute visibility themselves. |
| `receiptEffectsSchema` (zod) | `{ casesSwitched?: string[] (C- codes), casesFlagged?: string[], acknowledgementsReset?: number, sharesAffected?: number, aiChoicesMoved?: number, aiChoicesRemoved?: number, agencyRequestsAffected?: string[] (R- codes), bytesFreed?: number }`. Strict: unknown keys refused. |
| `openDeletionReceipt(tx, input)` | Inserts a receipt; validates effects; never accepts a title or name field. |
| `advanceDeletionReceipt(tx, id, next, patch)` | Moves status forward only; merges effects. |
| `listDeletionReceipts(access)` | Owner (and admin with privacy access) read; returns codes and kinds only. |
| `enqueueDocumentRemoval(tx, { documentId, applicantId, receiptId })` | Locks the document row, queues one `DOCUMENT_REMOVAL` erasure job per distinct storage object (Safe Copies follow through the existing `removeSafeCopyMasks` path), sets the receipt to `REMOVING`. Refuses when a legal hold covers the document. |
| `erasure.ts` finalisation | `DOCUMENT_REMOVAL` takes the same document-row path as `RETENTION_PURGE` (hold recheck, row lock, all-siblings-verified, `incrementMaterialRevision` for selecting cases, then delete row and storage objects) and then sets the receipt `REMOVED` with `verified_gone_at`, or `BLOCKED` when a hold appears. Implemented by generalising the four `job.reason === 'RETENTION_PURGE'` checks to a `DOCUMENT_ROW_REASONS` set. |
| `backup-reconciliation.ts` | Treats `DOCUMENT_REMOVAL` like `RETENTION_PURGE` on restore (never resurrects). |

### 3.3 Guard test (`lifecycle/foundation/read-paths.test.ts`)

- Parses `packages/services/src/**/*.ts` (not tests) per exported function, reusing the parsing approach of `access/enforcement.test.ts`.
- Every function that reads `schema.documents` (from or join) must reference `presentDocumentCondition` or `everydayDocumentCondition`, or appear in a baseline file `read-baseline/<LANE>.json` (to be migrated by that lane; one file per owning lane so no two lanes edit the same list) or in `read-exempt.json` (permanent, each with a reason, for example erasure, deletion, retention, legal hold, backup reconciliation, authorisation in `require-access.ts`, Case History).
- The same for `schema.applicants`, where only list reads count (a read with an equality on `applicants.id` is exempt by rule).
- Baselines can only shrink: a new unlisted read fails, and a listed entry that now complies fails until removed. Each lane edits only its own baseline file.

### 3.4 Interface pieces (lane F)

| Piece | Path | Contract |
|---|---|---|
| Manage menu | `apps/web/src/app/app/applicant/[id]/documents/manage/manage-menu.tsx` | Menu button pattern (WAI-ARIA), 44 px targets, keyboard, focus returns to the trigger. Renders only the actions `availableDocumentActions` returns, each through the registry. |
| Action registry | `.../documents/manage/registry.tsx` | Maps each `DOCUMENT_ACTIONS` value to a component. F ships one anchor block per lane (see 5.2); an action with no component yet is simply not listed. |
| Lifecycle tabs | `.../documents/manage/lifecycle-tabs.tsx` | Current, Archived, Recently Deleted. A tab other than Current shows only when its list is non-empty. |
| Undo status | `apps/web/src/components/lifecycle/undo-status.tsx` | `<output>` polite status, Undo button for 10 seconds, focus-safe. |
| Removal record list | `apps/web/src/components/lifecycle/removal-record-list.tsx` | Renders receipts: "Removed on 3 Nov: Passport D-7K2Q9M. Used in 2 cases." Status words: Scheduled, Restored, Removing Securely, Removed, Kept (legal requirement). |
| Documents page wiring | `.../documents/page.tsx` | Adds tabs, the menu per document at Browse depth, a "Removal Records" link shown only when records exist, and a deep link `?manage=<documentId>&action=<ACTION>` that opens that action (used by reminders). No other page change, and never the detail panel (WP-SB4, 5.3). |

### 3.5 Names registered by F (lanes never edit these lists)

- Product events (`product-events.ts` closed list and its test): `DOCUMENT_ARCHIVED`, `DOCUMENT_RESTORED`, `DOCUMENT_REPLACED`, `DUPLICATE_REMOVED_AT_UPLOAD`, `DOCUMENT_DELETED`, `DOCUMENT_DELETE_UNDONE`, `DOCUMENT_DESTROYED`, `REMOVAL_REQUESTED`, `REMOVAL_DECIDED`, `TRAVELLER_ARCHIVED`, `TRAVELLER_RESTORED`, `TRAVELLER_REMOVED`.
- Audit event types (free text, documented in the contract doc): `DOCUMENT_ARCHIVED`, `DOCUMENT_RESTORED`, `DOCUMENT_SUPERSEDED` (exists), `DOCUMENT_DELETED`, `DOCUMENT_DELETE_UNDONE`, `DOCUMENT_REMOVAL_QUEUED`, `DOCUMENT_REMOVAL_BLOCKED`, `DOCUMENT_REMOVAL_REQUESTED`, `DOCUMENT_REMOVAL_DECIDED`, `DOCUMENT_REMOVAL_REQUEST_CANCELLED`, `APPLICANT_ARCHIVED`, `APPLICANT_RESTORED`, `APPLICANT_DELETED`, `APPLICANT_REMOVED`, `FACT_MARKED_NOT_CURRENT`, `ORGANIZATION_APPLICATION_WITHDRAWN`. (The Active and Past cases split is presentation only and records no event.) Metadata holds ids, codes and counts only.
- Vocabulary (`docs/uiux/ccd/VOCABULARY.md`, all lanes' words): Manage, Archive, Restore, Archived, Replace With a Newer Document, Replaced, Delete Duplicate, Remove This New Copy, Recently Deleted, Removed in N Days, Ask Us to Remove This File, Removal Requested, Removal Record, Removing Securely, Removed, Kept (Legal Requirement), Tidy Up, No Longer Current, Ended, Active Cases, Past Cases, Withdraw Application, Archive Traveller, Restore Traveller, Remove Empty Record. Retire on screen: erase, erasure, purge, tombstone, supersede, soft delete, cascade, fact version.

## 4. Lanes, waves and timing

| Wave | Lanes (parallel inside a wave) | Starts when |
|---|---|---|
| 0 | **F** Foundation; **G1** Profile "No Longer Current"; **G2** Active and Past cases; **G3** Withdraw agency application | Owner says go |
| 1 | **A1** Archive; **A2** Read paths; **B** Replace and renewal; **C** Duplicates, Recently Deleted, records; **D** Removal requests; **E** Travellers | F is merged to main (the production migration is not needed to start building) |
| 2 | **Z** Integration, acceptance and documentation | All wave 1 lanes merged |

G1, G2 and G3 use no new tables and touch no file another lane owns, so they run beside F.

Critical path: F, then the longest wave 1 lane (A2 or C), then Z. Estimate, not a promise: F 4 to 6 hours; wave 1 lanes 4 to 8 hours each in parallel; Z 3 to 5 hours. About 2 working days of wall-clock time, plus CI and deploy waits and the owner's migration word.

Features go live per lane on merge, but every lifecycle action stays hidden until the migration has run (P8). Lane D also stays behind its switch until the owner completes gate G-D (section 10).

## 5. File ownership

### 5.1 Single owner per file

| Area | Owner |
|---|---|
| `packages/db/**` (schema, migration, meta) | F only. No other lane adds a migration. |
| `packages/services/src/lifecycle/foundation/**`, `erasure.ts`, `backup-reconciliation.ts`, `product-events.ts` | F |
| `packages/services/src/lifecycle/<lane>/**` | That lane (archive A1, replace B, duplicates C, removal-requests D, travellers E, profile G1, agency G3) |
| `missions.ts` (document readiness matching only; never `listMissionSnapshots` or `listTasks`, WP-SB2) | A1 |
| `wallet.ts`, `notification-sweep.ts`, `email-design.ts` | B |
| `applicants.ts`, `apps/web/src/lib/profile-photos.ts` | E |
| `profile.ts` (except `listFactHistory` and `listApplicantProfile`, WP-SB1), `profile-sections.ts`, `missions.ts` field-requirement readiness only | G1 |
| `organizations.ts` | G3 |
| Every other service file that reads documents or applicants (listed in A2's allowlist), except the functions WP-SB owns (5.3) | A2 |
| `apps/web/src/app/app/applicant/[id]/documents/page.tsx`, `documents/manage/*.tsx` (top level), `components/lifecycle/**` | F |
| `.../documents/manage/<lane>/**` | That lane |
| `.../applicant/[id]/actions.ts`, `document-uploader.tsx`, `applicant/[id]/removal-records/**` (new), `(home)/page.tsx`, `api/jobs/process-erasure/route.ts` | C |
| (no screen files beyond its own `documents/manage/replace/**`; see 5.3) | B |
| `apps/web/src/app/app/admin/removals/**` (new), `apps/web/src/lib/navigation.ts` (one entry), `api/jobs/process-notification-sweeps/route.ts`, `apps/web/src/lib/env.ts` | D |
| `apps/web/src/app/app/applicants/**`, `applicant/[id]/page.tsx`, `api/jobs/process-deletions/route.ts` | E |
| `applicant/[id]/profile-editor.tsx`, `section-actions.ts`, `applicant/[id]/profile/**` | G1 |
| `applicant/[id]/missions/page.tsx` | G2 |
| `apps/web/src/app/app/agency/page.tsx`, `agency/actions.ts` | G3 |
| `docs/architecture/resource-lifecycle-contract.md`, `docs/uiux/ccd/VOCABULARY.md` | F |
| Central status docs (`known-issues.md`, `requirements-ledger.md`, `CURRENT-STATE.md`, `SESSION-START.md`, `DEFERRED-COMMERCIAL-HARDENING.md`) | Z only |
| `docs/roadmap/lifecycle/lanes/<LANE>.md` | That lane (its own status, evidence and blocked notes) |
| `docs/roadmap/lifecycle/STATUS.md` | Z |

New background work never adds a cron entry (no edits to `apps/web/vercel.json` or `.github/workflows/render-cron.yml`): each lane calls its own new function from the one job route it owns (C: purge in `process-erasure`; D: request alerts in `process-notification-sweeps`; E: traveller purge in `process-deletions`), with the function itself in `apps/web/src/lib/lifecycle-jobs/<lane>.ts`.

### 5.2 Shared anchor files (the only files two lanes edit)

F writes one anchor comment per lane in each, separated by a blank line, for example `// LC-A1 exports` then a blank line then `// LC-B exports`. A lane inserts only directly below its own anchor. Git merges insertions under different anchors cleanly.

| File | Anchors for |
|---|---|
| `packages/services/src/index.ts` | A1, B, C, D, E (export blocks). Wave 0 lanes G1 and G3 run before the anchors exist, so they add their exports next to the existing related export block (profile, organizations), never at the end of the file. |
| `.../documents/manage/registry.tsx` | A1, B, C, D (action entries) |
| `apps/web/src/app/globals.css` | Each lane appends its own `/* WP-LC-<LANE> ... */` block at the end; merge with `scripts/agent/merge-css.py` |

If a conflict still appears: take main's file, re-insert only your own lines under your anchor, rerun the checks.

### 5.3 Boundary with the Scroll Budget programme (WP-SB, `docs/upgrades/programme/SCROLL-BUDGET-PLAN.md`, merged 31 Oct as #368)

WP-SB runs its own parallel sessions at the same time. Its section 4 gives every file to exactly one SB package. This programme never edits a file or function WP-SB owns. Where both need the same place, the work moves as below.

| Place WP-SB owns | Owner there | What this programme does instead |
|---|---|---|
| `applicant/[id]/history/**` | SB1 | Removal Records get their own route, `applicant/[id]/removal-records/**` (lane C), linked from the Documents page tabs (lane F, link shown only when records exist) |
| `app/notifications/**` | SB1 | "Replace It" travels in the notification's existing `deepLinkPath`, set by `notification-sweep.ts` (lane B); the page already renders it |
| `app/mission/[id]/**`, `agency/[orgId]/cases/**` | SB2, SB5 | Lifecycle labels on case evidence ("Replaced on", "Archived", "Removed by the traveller on") are wired by lane Z after SB2 and SB5 have merged, editing only the evidence label lines |
| `app/admin/privacy/**` | SB7 | The removal queue is its own route, `app/admin/removals/**` (lane D), with one entry in `apps/web/src/lib/navigation.ts` under the privacy access |
| `applicant/[id]/documents/**` detail panel | SB4 | Lane F edits `documents/page.tsx` only to add the tabs, the records link, the deep-link handler and the menu per row, and never moves the detail panel. Whichever lands second merges main and keeps the other's structure. |
| `profile.ts` `listFactHistory`, `listApplicantProfile` | SB1 | G1 does not edit these two functions; "No Longer Current" is rendered in `profile-editor.tsx` from the status the read already returns |
| `missions.ts` `listMissionSnapshots`, `listTasks` | SB2 | A1 and G1 never edit them |
| `application-memory.ts` `getApplicationMemory` | SB1 | A2 does not edit `application-memory.ts`; Case History stays a permanent exception in `read-exempt.json` (it must show removed documents as "removed") |
| `agency.ts` `listNotesForOwner`, `listEvidenceRequestsForApplicant`, `listNotes`, `listVisibleMissionsForMember`, client invitation and request lists; `sharing.ts` `listAccessForApplicantDetailed`; `organizations.ts` `listAllOrganizations`; `legal-hold.ts` `listLegalHolds` | SB2, SB3, SB5, SB7 | Never edited here. If one of them reads documents and needs the lifecycle rule, A2 leaves its baseline entry and writes it under Blocked; Z handles it after that SB package merges |

Rules carried over from WP-SB: new lists in this programme meet its targets (section 1 there: 10 rows for travellers and 25 for staff, then Show More; logs in a fixed panel with a server limit), using its SB0 components once SB0 is on main. The shared files `packages/services/src/index.ts` and `globals.css` follow both programmes' append rules.

## 6. Parallel safety protocol (every lane, every session)

1. **Start:** `git fetch origin`; branch from fresh `origin/main` onto your designated branch; record the main SHA in your lane file.
2. **Scope:** before every commit run `node scripts/programme/check-allowed-paths.mjs docs/roadmap/lifecycle/allowlists/<LANE>.txt --no-emdash --exclude docs/design/harbor-v2`. It must pass. Needing a file outside it means stop and write the need under "Blocked" in your lane file; the coordinator decides.
3. **No migrations** except F. A lane needing schema stops (Blocked).
4. **Contract:** use section 3 names exactly. Never re-implement a lifecycle rule; call the foundation.
5. **Before merging:** merge fresh `origin/main` into your branch (never rebase or force), rerun the guarded full check from the right step, then CI on the exact head.
6. **Merge train:** merge when your three required checks are green on the current head and the PR is clean. If main moved after your CI started, merge main again and wait for CI again. One merge at a time; after each merge the merging lane verifies the deploy checks (`scripts/agent/wait-deploy.sh`) before announcing in its lane file.
7. **Never:** push to another lane's branch; run a production migration; edit central status docs; disable or skip a test; put a name, title, number or text into audit metadata, receipts or logs.
8. **Hand-back:** your lane file ends with: merged PR link and SHA, checks seen green, tests added, what is live, what is hidden until the migration, what is not verified.

## 7. Definition of done (every lane)

- Tests written first where the brief says "red first"; each new guard proven able to fail by breaking real code once (back up with cp, never git checkout on edited files).
- `scripts/agent/full-check.sh` summary ends DONE (lint, typecheck, all tests, build, audit, browser and smoke checks).
- Reviews: `/code-review` at **max** for F, A1, A2, B, C, D, E (documents, deletion, sharing, permissions); **high** for G1, G2, G3. `/security-review` for F, A2, B, C, D, E. `design:accessibility-review` and `design:ux-copy` for every lane with a screen change. Fix everything a review confirms.
- Works with the lifecycle tables missing (a test runs against a database without the migration) and with them present.
- No long dash added; allowlist check passes; draft PR with the template headings; CI green on the exact head; squash merge; deploy verified.

## 8. Cross-lane acceptance matrix (Z runs it end to end)

| Area | Must be proven | Lanes |
|---|---|---|
| Access | Owner allowed; stranger, agency A on agency B, recipient with and without grant, revoked and expired grant, inactive agency, contributor and AI tool refused; guessed and malformed ids get the same not-found | all |
| Archive | Hidden from wallet, search, AI default context and tools, reminders, automatic readiness; explicit choices kept and flagged; Restore; retention clock unmoved | A1, A2, B |
| Replace | Same person only; no self or loop; replacement usable; case flagged and revision bumped; snapshots byte-identical; replaced document no longer counts automatically | B, A1 |
| Duplicates | Only when every version has a surviving identical usable copy; all five D5 refusals; case and AI choice switch plus revision bump; Undo; Restore inside 30 days; destroyed after; nothing else touched | C |
| Destruction | Never "Removed" before verification; hold placed during the window blocks it (receipt Kept); Safe Copies, readings, AI choices gone; storage figure drops; backup restore does not resurrect | F, C, D |
| Requests | Cancel while pending; approve needs staff step-up; decline needs a code; open case loses the selection and gets a task; finished case keeps its snapshot and Case History says removed; agency told without the name | D |
| Records | No name, title, number, text or raw hash stored; content columns immutable; visible to the person and admin | F, C, D, E |
| Travellers | Empty-only removal; Myself rules; archived hidden from the six list places; profile photo still resolves | E |
| Before migration | Every page and action works with the tables missing; lifecycle actions hidden | all |
| Profile, cases, agency | No Longer Current keeps history and leaves snapshots unchanged; Active and Past split; withdraw only while pending | G1, G2, G3 |

## 9. Measures (events registered by F; Z adds them to the admin scorecard)

Starting targets, to confirm after 30 days of pilot data: expiry reminder to replacement within 14 days at least 40%; duplicates kept under 3 per 100 uploads; restores under 10 per 100 deletions and archives; removal requests decided in a median of 3 working days or less and never over 30 days (PRV-03); zero deleted items visible anywhere (guard test).

## 10. Owner gates

| Gate | When | Owner action |
|---|---|---|
| G-GO | Start | Paste the coordinator prompt from `KICKOFF.md` (it carries the parallel-sessions authorisation). |
| G-MIG | After F merges | Say "migrate 0112" (or the number F reports) for the one production run of `db-migrate.yml`. |
| G-D | Before removal requests go live | Name the staff role that reviews requests; approve the privacy notice lines on Recently Deleted, removal requests and backup expiry; then say "switch on removal requests". |
| G-Z | After Z | Read Z's plain report; accept or send back. |

## 11. Risks and handling

| Risk | Handling |
|---|---|
| A read path forgets the rule | Guard test (3.3) fails the build |
| Pages break between merge and migration | Separate tables plus presence checks, tested both ways |
| Another track takes the migration number | F checks the next free number right before generating and again right before merging; regenerates if taken |
| Two lanes edit the same file | Single-owner map plus anchors; allowlist check before every commit |
| A lane drifts from the contract | Names frozen in section 3; deviations go to Blocked, never silently |
| Production load from many merges | Live checks are light since 30 Oct (12 tagged tests, 8 smoke requests); merge one at a time |
| Support overload | Below 20 requests a month manual review is fine (H13); queue shows waiting time and alerts after 3 working days |

## 12. Not verified at plan time (each is the first test of its lane)

- `supersedeDocument` accepts the same document as its own replacement, can form a loop, does not check the replacement is usable, and a replaced document still counts in readiness (`loadDocumentInstancesByType` ignores `supersededByDocumentId`). Read in code; lanes A1 and B prove them red first.
- `EvidenceSelectionPanel` renders only for requirements with more than one candidate (read in code).
- Whether an open case task blocks final submission after a replacement (B).
- A finished case's packet download after a document's bytes are gone (C, D).
- The next free migration number at F's start.

## 13. Out of scope

A generic delete or CRUD layer; deleting cases, shares, memberships, invoices, payments, acknowledgements, audit or verification records; traveller merge; storing an identical file only once across documents; per-case "don't use this document here"; voluntary agency closure (written up in `DEFERRED-COMMERCIAL-HARDENING.md` by Z); the AI Connections screen (done in S15, #315); Bangla.
