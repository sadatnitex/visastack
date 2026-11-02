# UMPE execution status (lead board)

Newest first. One line per change of state. The requirement-level truth is `docs/umpe/ledgers/REQUIREMENT_LEDGER.csv`; decisions are in `docs/adr/0026-umpe-interface-freeze.md`.

## Current base
- `origin/main` `d17d717c` (#409), CI and CodeQL green. Locked sources verified (3 of 3 PASS).
- Baseline before any UMPE change: 8 high-risk service test files, 212 tests, all green, 92 s wall time (`packs`, `pack-matching`, `rule-conditions`, `client-invitations`, `invitations`, `uploads`, `intake`, `outcomes`).

## Lanes and leases

| Lane | Unit | State | Exclusive leases | Next dependency |
|---|---|---|---|---|
| Lead | P0 baseline, golden tests, ADR 0026, ledger | Merged #410 (`ae4e2c97`) | `packs.test.ts` area (new file only), docs | none |
| A | P2 batch and folder import | Reviewed, on the designated branch (PR 2) | `documents/page.tsx` mount point, one `globals.css` block `WP-UMPE-P2` | none; P3 needs a schema slot |
| E | P10 source monitoring dry run | Reviewed, fixed; local worktree branch `worktree-agent-a185523e2dba67bf6` (`86c76dea`), lands as PR 3 | schema slot 0115, `vercel.json`, `render-cron.yml`, `lib/jobs.ts`, services `index.ts` | owner word "migrate 0115" after merge |
| B | P1 necessity, alternatives, route applicability | Waiting for schema slot after 0115 | `packs.ts`, `missions.ts`, `rule-conditions.ts`, `pack-matching.ts` | Lane E merged |
| C | P6 agency collection request | Designed (ADR 0026 D4) | none yet | P1 merged |
| D | P8/P9 guest proof and upload | Designed (ADR 0026 D5) | none yet | owner decision on guest proof |
| F, G | P12 outcomes, P13 navigation | Not started | none | P4, P9 |

## Owner-dependent items
1. Pushing more than the one designated branch (`umpe/*` per lane) needs the owner's permission; until then lanes land as sequential PRs.
2. Each production migration needs the owner's "migrate NNNN" word for that number.
3. Guest recipient proof (email one-time code without an account) and guest retention period.
4. Who may verify and publish official sources (legal responsibility).
5. Real-data activation remains switched off (controlled pilot).

## Log
- 2026-11-02: #410 merged (`ae4e2c97`). Lane A integrated on the designated branch (PR 2): code review 10 fixed plus 1 follow-up, security review clean. Lane E fixed all 10 review findings (pinned DNS lookup, daily job that starts on Dhaka Saturday and finishes leftovers, oldest-first 40 per call, one candidate per change, manual check limits); awaits PR 3 and its security review.
- 2026-11-02: P0 review (`/code-review high`, 10 findings): 9 fixed (format 1 sort tie-break, UTF-16 wording for format 2, necessity vs provenance names, ratchet extension required for request and guest tables, lane persistence rule, locked-source check in CI, known-issues chunk, golden test no longer pins a storage detail, readiness state mapping pinned instead of duplicated rule tests); 1 not applicable (SESSION-START is updated in the same PR by the repo's own rule).
- 2026-11-02: P0 complete locally: golden manifest test (11 tests) proven to fail when a manifest key is added; ledger filled from code (17 implemented, 29 partial, 18 missing, 1 content, 2 owner-blocked, 1 tested, 19 not yet audited); ADR 0026 written; Lanes A and E started in separate worktrees.
