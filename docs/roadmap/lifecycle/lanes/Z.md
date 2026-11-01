# LC-Z Integration, acceptance and documentation

- Wave 2. Branch: `claude/lc-z-integration`. Depends on: every wave 0 and wave 1 lane merged. Allowlist: `../allowlists/Z.txt`.
- Read first: all of `../PROGRAMME.md`, then every lane file's Status section.

## Objective

Prove the whole programme works together, close the gaps between lanes, and leave one accurate, non-redundant picture in the central documents.

## Build

1. Cross-lane journeys as service-level and component tests, following PROGRAMME section 8 row by row: upload a duplicate then Remove This New Copy; delete a duplicate used in an open case then Undo then delete again then purge; archive a document an open case selected; replace from a reminder; request removal of a unique file, approve with step-up, verify destruction, read the record; a hold placed during the 30 days; archive and restore a traveller; remove an empty traveller; backup restore reconciliation.
2. Wire B's `documentLifecycleLabel` into the case page evidence list and the agency case views, after WP-SB2 and WP-SB5 have merged, editing only the evidence label lines (PROGRAMME 5.3). Apply the lifecycle rule to any function A2 left Blocked because WP-SB owned it, once that SB package has merged.
3. Fix only integration defects found here; anything larger goes back to its lane owner as a Blocked note.
4. Admin scorecard: add the section 9 measures from the registered events.
5. Central docs: `requirements-ledger.md` rows EVI-03, EVI-04, PRV-03, TRU-03 (and any row a lane touched); the next `known-issues.md` chunk; `CURRENT-STATE.md`; `SESSION-START.md` section 7; `DEFERRED-COMMERCIAL-HARDENING.md` entries for the out-of-scope items; `STATUS.md` final state.
6. Draft privacy-notice lines for gate G-D, for the owner to approve.
7. Owner report: table (Area | What changed | What you will see | Who notices), then Checked live, Not live yet, Not yet checked, Needs you.

## Acceptance

Every row of PROGRAMME section 8 has a passing test and a link in the report; full check DONE; CI green; deploy verified.

## Status (lane fills in)

- Started on main: 457fb5e7 (LC-E, #400).
- PR / merged SHA: the draft pull request for `claude/lc-z-integration`; the squash SHA is recorded in the coordinator report (it cannot be inside the merged PR).
- Checks seen green: local guarded full check DONE on 10f599b2 except lint (one inline style, fixed in the next commit, ratchet passes); install, audit, typecheck, all service tests, web tests, build, supply chain, 299 browser checks and smoke exit 0. `WP-SB4.spec.ts` documents on a phone: 2,025 px, 2.40 screens, enforced. CI is checked on the final head before merge.
- Tests added, by PROGRAMME section 8 row: Access `lifecycle/integration/acceptance-access.test.ts`; Archive `acceptance-archive.test.ts`; Replace `acceptance-replace.test.ts`; Duplicates `acceptance-duplicates.test.ts`; Destruction `acceptance-destruction.test.ts`; Requests `acceptance-requests.test.ts`; Records `acceptance-records.test.ts`; Travellers `acceptance-travellers.test.ts`; Before migration `acceptance-before-migration.test.ts`; Profile, cases, agency: lanes G1, G2, G3 tests. Also: `lifecycle/measures/measures.test.ts`; `mission/[id]/evidence-lifecycle.test.ts`, `evidence-selection-lifecycle.test.tsx`, `page.test.tsx` (labels); `agency/[orgId]/console-data-triage.test.ts`, `case-triage-summary.test.tsx`; `admin/page.test.tsx` (measures); `document-wallet-browser.test.tsx` (phone paging); plus the integration-fix tests in `ai.test.ts`, `application-memory.test.ts`, `invitations.test.ts`, `backup-reconciliation.test.ts`, `foundation.test.ts` and the documents, profile, expiry, record and traveller page tests.
- Live after merge: everything above; nothing waits for a migration (0113 is on production) or a switch.
- Not verified: the finished-case packet download after a removal in a real browser; a full storage-plus-database restore drill for removed documents (H32); `design:accessibility-review` and `design:ux-copy` were not available in this session.
- Blocked: a Founding Access subscription is not ended when an agency withdraws its application or is terminated. That is billing, so lane Z did not change it; the coordinator was messaged on 1 Nov 2026 to ask the owner whether withdrawing or terminating should end or pause it, and with or without a refund.
