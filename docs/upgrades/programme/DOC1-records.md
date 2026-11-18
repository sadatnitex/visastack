# DOC1 records: documentation sync, 18 Nov 2026

Owner request (18 Nov 2026, to the Guardian): "u must the documentation with everything we have done so far". Class B, docs only. Branch `claude/doc1-docs-sync-2026-11-18`.

## What changed

| File | Change |
|---|---|
| `docs/SESSION-START.md` | Date; section 2 rows for the Wallet records, public-site records and the conductor skill; section 6 owner decisions of 16 to 18 Nov; section 7 rewritten to the 18 Nov state (the 1 Nov text kept below it, marked superseded) |
| `docs/public-beta/CURRENT-STATE.md` | New section "Update, 2026-11-18": per unit PR, merge sha and what people see; not live; not verified |
| `docs/upgrades/programme/STATUS.md` | Rewritten for the Wallet and public-site units (the 1 Nov view stays in git history) |
| `docs/upgrades/programme/SESSION-HANDOFF-2026-11-18.md` | New: roles, lanes, decisions, follow-ups, pitfalls |

Every PR number and sha comes from `git log 28c053c..origin/main` (#627 to #651); unit content from each unit's records file.

## Stale docs not edited (follow-up)

`docs/uiux/ccd/PARITY-LEDGER.md`, `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M, `docs/operations/current-platform.md` (not re-checked).

## Known-issues chunk (to append)

## 18 Nov 2026: DOC1 documentation sync

- Behaviour: none. Status pages now cover the Wallet upgrade (WAL1 to WAL10, U6 to U8, FIX9), the public-site rebuild (PUB3, PUB4, PUBFIX, HOT1, MOT1 #651, R1 to R5), the conductor operating model and the owner decisions of 16 to 18 Nov. SESSION-START section 7 is replaced by the 18 Nov state; the 1 Nov text is kept and marked superseded.
- Proof: em dash count 0; tests that read these docs run; every PR number and merge sha read from git history on main 769e43ea.
- Not verified: live behaviour of any unit (this change only records it); current-platform.md was not re-read.
- Follow-ups: PARITY-LEDGER and the Small Commercial handoff section M rows for the new units.
