# LC-B Replace and the renewal loop

- Wave 1. Branch: `claude/lc-b-replace`. Depends on: F merged. Allowlist: `../allowlists/B.txt`.
- Read first: `../PROGRAMME.md` sections 2, 3, 5, 6, 7.

## Objective

"Replace With a Newer Document" works end to end and is reachable from the moment a reminder says something is expiring: one upload updates every open case, the agency sees "Updated", history stays exact.

## Build

1. Add `replaceDocument(access, { oldDocumentId, newDocumentId })` in `packages/services/src/lifecycle/replace/replace.ts` on a `requireAccess` MANAGE proof, holding the replace logic. Keep `supersedeDocument` in `wallet.ts` with its current signature, delegating to the shared logic after its existing owner check, because other lanes' tests (`attention.test.ts`, `application-memory.test.ts`) call it; its existing `enforcement-baseline.json` entry stays. Every new caller uses `replaceDocument`.
2. Fix, red first: the same document as its own replacement; a loop (new document already replaced, or replaced by the old one); a replacement that is not usable (not clean or not servable); an already-replaced old document (keep the existing race-safe update).
3. Keep today's behaviour: case revision bump and task per affected case, `DOCUMENT_SUPERSEDED` audit, snapshots untouched. Add product event `DOCUMENT_REPLACED`.
4. Replace flow under `documents/manage/replace/`, registered under the B anchor: choose an existing document of the same kind or upload a new one, then a confirmation listing the affected cases by name ("2 cases will be updated and will need to be confirmed again"), then the result line.
5. `notification-sweep.ts` expiry reminders: skip archived and non-present documents and archived travellers; set the reminder's existing `deepLinkPath` to `/app/applicant/<id>/documents?manage=<documentId>&action=REPLACE` (the notifications page already renders it; it belongs to WP-SB1 and is not edited) and add a "Replace It" button with the same link to the designed email in `email-design.ts`. Migrate `wallet.ts` and `notification-sweep.ts` read sites (empty `read-baseline/B.json`).
6. Export a small pure helper `documentLifecycleLabel(lifecycle, now)` in `lifecycle/replace/` returning "Replaced on {date}", "Archived" or "Removed by the traveller on {date}" (never a title for removed ones). The case page and agency case views belong to WP-SB2 and SB5; lane Z wires the helper into them (PROGRAMME 5.3).

## Red first

The four defects in step 2; a reminder for an archived document is still sent.

## Acceptance

Same person only; agency, stranger and guessed id refused; snapshots byte-identical before and after; affected open cases flagged and revision bumped; Replace It deep link opens the Replace flow on the right document; works with tables missing. Record whether an open task blocks final submission after a replacement (PROGRAMME section 12).

## Not yours

`missions.ts` readiness (A1 makes replaced documents stop counting), delete paths (C), any other read site (A2).

## Status (lane fills in)

- Recorded by lane Z (1 Nov 2026): merged as #393, squash commit 19ec6a15 on main. Migration 0113 ran on production on the owner's word (db-migrate.yml run 41263156493, 1 Nov 2026 01:57Z; confirmed: 112 rows in the migration journal, the four lifecycle tables and the DOCUMENT_REMOVAL reason). Production is in "tables present" mode, so any "hidden until the migration" or "0113 has not run" line in this section is now out of date: those pieces are live.

- Started on main: 9d5bb99abdc23571021bebe1cfe152013209a793 (LC-F, #381).
- PR / merged SHA: #393 (https://github.com/sadatnitex/visastack/pull/393); merged as the squash commit of #393 on main (its SHA is in the PR and in the coordinator message).
- Checks seen green: on 938898c6 (branch with main at 0c6e35a4 merged in): "Lint · Build · Typecheck · Test" (all shards), "No-secret Playwright checks", "No-secret smoke check", CodeQL, dependency review. Guarded full check DONE on 09af8510 (resumed from the test step after an adapters HEIC test ran past its 60 s limit on the first pass; that file passes alone in 24 s and in the resumed run). The final head adds only this Status text and is checked by CI again before merge.
- Tests added: `lifecycle/replace/replace.test.ts` (red first: same document, loop, unusable replacement, already replaced and the two-at-once race; also other kind, expired, still checking, cannot be used, a document handed in for one case only, archived or deleted on either side, stranger, agency with a real MANAGE grant, read-level proof, guessed id, snapshots byte-identical, open cases flagged and revision bumped, finished cases untouched, audit and product event, the label helper), each run with the lifecycle tables present and missing; `notification-sweep.test.ts` (Replace link, expiry link while tables are missing, no reminder for an archived or deleted document or an archived traveller, no confirmation reminder about an archived or deleted document, an archived document that expires still makes its cases confirm again, no task reminder for a deleted traveller record); `email-design.test.ts` (Replace It button); web `replace/replace-action.test.tsx` and `replace/actions.test.ts`. Seven guards were broken once in the real code and went red, then restored.
- Live / hidden until migration: nothing is live yet. Once merged, while migration 0113 has not run: reminders keep linking to the expiry list and the Manage menu stays hidden, so people see no change. After the migration: the Manage menu offers Replace with a Newer Document, expiry reminders link to it and the email shows a Replace It button.
- Open task and final submission (PROGRAMME section 12): an open "confirm again" task does not block confirming the case again; nothing in submission reads case tasks (test: flags every case ... keeps snapshots exact).
- Notes for the coordinator: `supersedeDocument` keeps its signature and delegates to the shared logic with `legacy: true`, which skips only the usable, expired, same-kind and wallet-visible checks, because `attention.test.ts` (not in this lane) replaces with a document that has no file. It has no caller outside tests. If `attention.test.ts` gives its renewed passport a clean version, `legacy` can go. The menu and heading read "Replace with a Newer Document" (small "with"), because `title-case.test.ts` refuses "With"; `docs/uiux/ccd/VOCABULARY.md` line 122 (lane F) should match. Finished cases (closed, cancelled, submitted, D5) are left exactly as they were by a replacement.
- Not verified: browser and smoke checks, build, the full test run, CI, the Replace flow against a real upload and virus scan, the email in a real inbox, and anything on production.
- Blocked: none. Cleared on 1 Nov 2026: the coordinator approved the two exact changes to `apps/web/src/app/app/applicant/[id]/documents/manage/manage-menu.test.tsx` (lane F's file), the same form lane A1 uses: the "ships empty" test became "lists only frozen actions" (each registered key must be one of `DOCUMENT_ACTIONS`), and "renders nothing when no allowed action is registered" passes `registry={{}}`. Nothing else in that file changed. Approved exception: the path check lists only that file, exactly as below.

```
1 changed file(s) are outside docs/roadmap/lifecycle/allowlists/B.txt:
  apps/web/src/app/app/applicant/[id]/documents/manage/manage-menu.test.tsx
Stop. Ask the owner to approve an allowlist change before editing these files.
OK: no long dashes in added lines (excluding docs/design/harbor-v2).
```
