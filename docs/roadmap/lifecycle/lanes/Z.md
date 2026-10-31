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

- Started on main:
- PR / merged SHA:
- Checks seen green:
- Not verified:
- Blocked:
