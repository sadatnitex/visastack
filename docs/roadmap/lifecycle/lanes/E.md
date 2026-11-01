# LC-E Travellers: Archive, Restore, Remove Empty Record

- Wave 1. Branch: `claude/lc-e-travellers`. Depends on: F merged. Allowlist: `../allowlists/E.txt`.
- Read first: `../PROGRAMME.md` sections 2 (D9), 3, 5, 6, 7.

## Objective

A person can tidy their list of travellers: archive and restore anyone, and remove a record created by mistake when it holds nothing, without ever losing a record that holds data.

## Build

1. `packages/services/src/lifecycle/travellers/`: `archiveTraveller`, `restoreTraveller` (Myself never archived), `travellerIsEmpty(db, applicantId)` (checks every table that references `applicants` with data, listed explicitly: facts, documents, missions, grants, sharing invitations, evidence and contributor requests, client invitations, acknowledgements, photos, AI connections, calendar feeds, profile exemptions, notifications; a fixed list with a test that fails when a new table references `applicants` and is not classified), `deleteEmptyTraveller` (Recently Deleted for 30 days, receipt path `EMPTY_TRAVELLER`; an empty Myself only while another Myself exists), `restoreDeletedTraveller`, `purgeDueTravellers` (re-check emptiness, then delete the row; receipt `REMOVED`).
2. `applicants.ts`: `listApplicants` returns everyday travellers only; add `listArchivedApplicants`. The six callers then need no change (verify each: Home, applicants page, AI app sign-in, client invitation accept, profile photos, WhatsApp inbox). Empty `read-baseline/E.json`.
3. `apps/web/src/lib/profile-photos.ts`: the account photo still resolves to the Myself record.
4. Screens: an Archived section on the applicants page with Restore; a Manage menu on the traveller's own page (`applicant/[id]/page.tsx`) with Archive Traveller or Remove Empty Record; opening an archived traveller's page by link still works and shows an "Archived" note with Restore.
5. `apps/web/src/lib/lifecycle-jobs/traveller-purge.ts` called from `api/jobs/process-deletions/route.ts`.

## Red first

The table-classification test fails when a referencing table is unclassified; a traveller with one fact cannot be removed.

## Acceptance

PROGRAMME section 8 row Travellers; another person's traveller refused; archived travellers' expiry reminders stop (B's sweep reads `everydayApplicantCondition`, coordinate through the contract only); works with tables missing.

## Not yours

Document actions (A1, B, C, D), workspace search (A2).

## Status (lane fills in)

- Started on main: 19ec6a15ec99e0ea7877454560b51bbf3ba1be46; merged main 1f2f2e9b (LC-A1) into the branch.
- PR / merged SHA: draft PR open (see the PR); not merged. Waits for lane C (Removal Records) to merge, because this lane writes `EMPTY_TRAVELLER` receipts; then merge main, recheck, CI, merge.
- Checks seen green: local guarded full check on f6c2778b ended DONE (install, audit, lint, typecheck, all package tests, web tests, build, supply chain, browser checks, smoke). CI not yet seen.
- Tests added: `lifecycle/travellers/classification.test.ts` (every foreign key and `*applicant_id` column of the migrated database is classified; red when one is removed), `lifecycle/travellers/travellers.test.ts` (archive and restore, Myself never archived, stranger refused, one fact blocks removal, Recently Deleted for 30 days with the receipt on the record that stays, two Myself records, only record, last traveller in use, unfinished erasure, archived then removed then restored, everything with the tables missing), `api/jobs/process-deletions/traveller-purge-database.test.ts` (purge after 30 days, receipt REMOVED, re-check restores a record that gained data, other job refused, tables missing, job function never throws), route, page, menu, bar, messages, form action, profile photo, workspace navigation and plan page tests. Guards proven red by breaking real code: classification, emptiness, purge re-check.
- Live / hidden until migration: migration 0113 has run on production, so once merged the actions are live: Manage menu (Archive Traveller, Remove Empty Record) on a traveller's page, Archived and Recently Deleted notes with Restore Traveller, Archived and Recently Deleted lists on All Travellers, the traveller purge in `process-deletions`. With the tables missing every action is hidden and every list is as before (tested).
- Rules added inside the lane: the last traveller in use cannot be archived or removed (keeps Home from treating the account as new); a record restored from Recently Deleted returns to everyday use even if it was archived before.
- Approved exceptions to allowlist E (coordinator, 1 Nov 2026): `apps/web/src/lib/workspace-chrome.ts`, `apps/web/src/lib/workspace-navigation.ts` (+ test): archived traveller pages keep their frame, the switcher lists only everyday travellers; `apps/web/src/app/app/account/plan/page.tsx` (+ test): storage meter counts archived and Recently Deleted travellers. Lane D also edits workspace-chrome.ts and workspace-navigation.ts: whoever merges second keeps both.
- Not verified: CI and production after merge; the reviews design:accessibility-review and design:ux-copy are not installed in this session (screens reviewed by hand against F's reviewed menu pattern and the vocabulary); the six-callers check found a seventh (plan page) and the workspace frame, both fixed; the switcher chip shows the full name rather than the first name on an archived traveller's page (workspace-shell.tsx not touched).
- Deviation from the brief: archived and Recently Deleted travellers are listed with `listApplicants(db, accountId, { view })` instead of a new `listArchivedApplicants`, because the access ratchet allows no new ungated read and `listApplicants` is the existing owner read.
- Blocked: nothing.
