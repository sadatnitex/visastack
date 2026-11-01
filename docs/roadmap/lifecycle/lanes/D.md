# LC-D Removal requests reviewed by support

- Wave 1. Branch: `claude/lc-d-removal-requests`. Depends on: F merged. Allowlist: `../allowlists/D.txt`.
- Read first: `../PROGRAMME.md` sections 2 (D1, D3, D7, D8), 3, 5, 6, 7, 10 (gate G-D).

## Objective

Any document, including a unique one, can be fully removed after a short support review, with the person kept informed, the affected agency told without the name, and a permanent record. Built and switched off until the owner completes gate G-D.

## Build

1. Switch `DOCUMENT_REMOVAL_REQUESTS=off|on` in `apps/web/src/lib/env.ts` (default off), passed into `availableDocumentActions` as `requestsSwitchOn`.
2. `packages/services/src/lifecycle/removal-requests/`: `requestRemoval(access, { documentId, reason })` (owner only, one pending per document), `cancelRemovalRequest(access, id)`, `listRemovalQueue(staffAccess)` (with an impact preview built from the same counts as the receipt effects), `decideRemovalRequest(staffAccess, { id, decision, stepUpSatisfied })`. Approve, in one transaction: refuse under a legal hold (decision `LEGAL_HOLD`), remove the document from open-case selections with `incrementMaterialRevision` and a task "A document was removed by request; choose another", leave finished cases' snapshots alone, open the receipt, set `document_lifecycle` with `REQUEST`, call `enqueueDocumentRemoval`. Decline needs a decision code.
3. Agency notice: one notification to members of each agency with an open shared case that used the document: "A document in case C-... was removed by the traveller." Never the title.
4. Person sees a pending request on the document itself (D's own action component shows "Removal Requested" with Cancel Request); a notification when decided and when removed; the approved removal appears in History automatically through the receipt and F's `RemovalRecordList` (no edit to the History page, which C owns).
5. Admin queue on its own route `app/admin/removals/` with one entry in `apps/web/src/lib/navigation.ts` shown only with privacy access (the privacy page belongs to WP-SB7 and is not edited, PROGRAMME 5.3); staff step-up on decide; waiting time shown; 25 rows then Show More (Scroll Budget targets).
6. `apps/web/src/lib/lifecycle-jobs/removal-alerts.ts` called from `api/jobs/process-notification-sweeps/route.ts`: alert staff when a request waits more than 3 working days.
7. Manage menu actions under `documents/manage/request/` (Ask Us to Remove This File, Cancel Request), registered under the D anchor.

## Red first

Approve without step-up refused; approve under a legal hold refused; an agency member cannot request or decide.

## Acceptance

PROGRAMME section 8 rows Requests and Records; no free text stored anywhere; with the switch off nothing is visible; works with tables missing.

## Not yours

Self-service duplicate delete and purge (C), Replace (B), central docs (Z).

## Status (lane fills in)

- Started on main: 19ec6a15 (LC-B merged, #393).
- Access plan (accepted by the coordinator for building; the owner confirms the reviewing role at gate G-D): the staff queue is read with privacy access (`APPLICANT_DIRECTORY_VIEW`, the compliance administrator); deciding needs a fresh `RETENTION_PURGE` scope (the compliance administrator, the only `LIFECYCLE_STAFF_ACTIONS` value) plus a fresh sign-in check for both approve and decline. No new role or staff action. The page refuses by address exactly who the sidebar hides: switch off gives not found, no privacy access gives the restricted notice.
- Approved path exceptions (coordinator, 1 Nov 2026), the only files outside `allowlists/D.txt`: `documents/page.tsx` (read and pass D's facts), `lib/a11y-forms.test.tsx` (scan entry for the decide form), `lib/workspace-chrome.ts` and `lib/workspace-navigation.ts` with their two tests (sidebar link). `documents/manage/view.ts` is unchanged (its facts parameter already carries D's facts).
- PR / merged SHA:
- Checks seen green:
- Live / hidden until migration / behind switch:
- Not verified:
- Blocked: none. Two allowlist needs were raised and approved by the coordinator on 1 Nov 2026: (1) one import and one scan entry for the staff decide form in `apps/web/src/lib/a11y-forms.test.tsx`; (2) the visible Removal Requests sidebar link through `lib/workspace-chrome.ts` (flag `removals` = privacy access and the switch on) and `lib/workspace-navigation.ts` (one tools entry), with their tests. The `navigation.ts` entry was dropped as instructed (`platformTabs` has no live caller).
