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

- Started on main:
- PR / merged SHA:
- Checks seen green:
- Live / hidden until migration:
- Not verified:
- Blocked:
