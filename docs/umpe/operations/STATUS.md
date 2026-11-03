# UMPE execution status (lead board)

Newest first. One line per change of state. The requirement-level truth is `docs/umpe/ledgers/REQUIREMENT_LEDGER.csv`; decisions are in `docs/adr/0026-umpe-interface-freeze.md`.

## Current base
- `origin/main` `d17d717c` (#409), CI and CodeQL green. Locked sources verified (3 of 3 PASS).
- Baseline before any UMPE change: 8 high-risk service test files, 212 tests, all green, 92 s wall time (`packs`, `pack-matching`, `rule-conditions`, `client-invitations`, `invitations`, `uploads`, `intake`, `outcomes`).

## Lanes and leases

| Lane | Unit | State | Exclusive leases | Next dependency |
|---|---|---|---|---|
| Lead | P0 baseline, golden tests, ADR 0026, ledger | Merged #410 (`ae4e2c97`) | `packs.test.ts` area (new file only), docs | none |
| A | P2 batch and folder import | Merged #411 (`1c425309`), live checks green | `documents/page.tsx` mount point, one `globals.css` block `WP-UMPE-P2` | none; P3 needs a schema slot |
| E | P10 source monitoring dry run | PR 3 on `umpe/p10-source-monitor` (owner allowed `umpe/*` branches on 2 Nov) | schema slot 0115, `vercel.json`, `render-cron.yml`, `lib/jobs.ts`, services `index.ts` | owner word "migrate 0115" after merge |
| B | P1 necessity, alternatives, route applicability | Waiting for schema slot after 0115 | `packs.ts`, `missions.ts`, `rule-conditions.ts`, `pack-matching.ts` | Lane E merged |
| C | P6 agency collection request | Designed (ADR 0026 D4) | none yet | P1 merged |
| D | P8/P9 guest proof and upload | Designed (ADR 0026 D5) | none yet | owner decision on guest proof |
| F, G | P12 outcomes, P13 navigation | Not started | none | P4, P9 |

## Owner-dependent items
1. Done 2 Nov: the owner allowed `umpe/*` branches, so lanes can ship in parallel.
2. Each production migration needs the owner's "migrate NNNN" word for that number.
3. Guest recipient proof (email one-time code without an account) and guest retention period.
4. Who may verify and publish official sources (legal responsibility).
5. Real-data activation remains switched off (controlled pilot).

## Log
- 2026-11-03: UX4 (sidebar fits a laptop) on its own PR, not merged: one-row brand, tasks as icon buttons inside their rows, a hairline before the utilities, trimming by window height. Content 818 px to 556 px at a 600 px window. Next: the agency answers queue (service read, brief and security review), then the guest per-item Add File. See `handoffs/UX4.md`.
- 2026-11-03: UX1 and UX2 merged (#424, `b4577ef`): guest desk, group trip, Home. UX3 (agency Document Requests list: status filters, customer first, labelled cells) on a new PR, not merged. The agency answers queue is not built (needs a service read). See `handoffs/UX3.md`.
- 2026-11-03: UX2 (group trip page and Home polish) on PR 424, not merged. One Next Step, stage tracker, Allowed or Not Allowed in words, icons and date tiles; card links not underlined. Trip phone 2.64 to 3.00 screens (inside the budget). Review high: 8 of 10 fixed. Agency request desk not yet built. See `handoffs/UX2.md`.
- 2026-11-03: UX1 (guest desk interface) on PR 424, not merged. Progress strip, line states, folds, one side column, retention tiles; styles only. Phone page height 2.97 and 2.92 screens in two states (was 3.87 and 4.68), 3.80 part way (was 5.09), over the budget there; desktop within 3 screens. Review high: 7 of 9 fixed. See `handoffs/UX1.md`.
- 2026-11-02: #411 merged (`1c425309`), deploy smoke, Playwright smoke, live signed-in check and Vercel green. Owner closed PRs #77 and #177; their Neon preview branch deleted (Neon now 2 branches). Session git and Vercel tools cannot delete branches or deployments: a verified owner-run script removes 115 merged branches and 73 old deployments (keeps production plus 4 rollback builds). PR 3 full check caught 4 new admin forms missing from the accessibility guard; fixed.
- 2026-11-02: #410 merged (`ae4e2c97`). Lane A integrated on the designated branch (PR 2): code review 10 fixed plus 1 follow-up, security review clean. Lane E fixed all 10 review findings (pinned DNS lookup, daily job that starts on Dhaka Saturday and finishes leftovers, oldest-first 40 per call, one candidate per change, manual check limits); awaits PR 3 and its security review.
- 2026-11-02: P0 review (`/code-review high`, 10 findings): 9 fixed (format 1 sort tie-break, UTF-16 wording for format 2, necessity vs provenance names, ratchet extension required for request and guest tables, lane persistence rule, locked-source check in CI, known-issues chunk, golden test no longer pins a storage detail, readiness state mapping pinned instead of duplicated rule tests); 1 not applicable (SESSION-START is updated in the same PR by the repo's own rule).
- 2026-11-02: P0 complete locally: golden manifest test (11 tests) proven to fail when a manifest key is added; ledger filled from code (17 implemented, 29 partial, 18 missing, 1 content, 2 owner-blocked, 1 tested, 19 not yet audited); ADR 0026 written; Lanes A and E started in separate worktrees.
- 2026-11-03: UX6 step 1 built on the designated branch: Add a Family Member inside Start a Group Trip and Add Travellers (existing person creation, authority confirmed, trip and ticked travellers proven first); no migration. Step 2 (companions and invitations) is briefed and waits for the owner's migrate word.
- 2026-11-03: #427 (sidebar and page edges) and #428 (UX6 step 1, family members in the trip forms) merged and deployed. UX5 (answers on the agency list) and UX7 part A (Add Documents one door) built on the designated branch; UX6 step 2 package 1 (companions service and access gate) is with a helper and needs the owner's migrate word before any migration run.
- 2026-11-03: #429 (UX5, UX7 A) and #430 (UX7 B) merged. UX6 package 1 (companions service, access gate, migration 0130 written and not run) built, reviewed at max, on the designated branch; it waits on the owner's migrate 0130 word to run the migration after merge. Packages 2 to 4 of UX6 and UX7 part C remain.
