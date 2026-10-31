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

- Started on main:
- PR / merged SHA:
- Checks seen green:
- Live / hidden until migration:
- Not verified:
- Blocked:
