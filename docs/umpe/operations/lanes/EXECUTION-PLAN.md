# UMPE execution plan (lead, owner pre-approved everything on 2 Nov 2026 and is away)

## Owner mandate (verbatim intent)
Finish all UMPE work 100% correctly, 1-5 sessions in parallel, no disruption, no wasted tokens/time, no reruns/rework/conflicts, within UI principles (CCD style, colour/surface tokens, assets). Pre-approved: execute with best options, report at the end what/where/why.

## Interpretation recorded (to report)
- Production migrations for each UMPE unit: pre-approved, run once right after that unit merges, verified on Neon (count + objects).
- Merge only on green required CI on the exact head + lead full check + reviews (code-review max, security-review for auth/sharing/files/guest).
- NOT flipped without owner word (safety rules + locked contract): real applicant data, payments, turning AGENCY_COLLECTION_REQUESTS on in production. Built, merged, tested, ready.

## Merged so far
#410 P0 ae4e2c97; #411 P2 1c425309; #412 P10 9461ebe5 (+0115); #413 P1 7d617338 (+0116). #414 P6 in CI (0117 pre-approved).

## Waves and lanes (each lane = own cloud session = own container; lead integrates)
- W1: P3 document understanding (session_0187kU9syLSP95Jbs5mNHLpJ, branch umpe/p3-document-intelligence) | P8 guest proof (umpe/p8-guest-proof) | P7 account response (umpe/p7-account-response). P8/P7 start after #414 merges + 0117.
- W2: P4 trip package assembly (after P1+P3 merged): exact-version selection, Needs Attention / Ready for Final Review / Prepared for Handoff, freshness check at handoff (S05), continuous matching on active packages (R19), no auto-share. | P9 guest upload + agency review (after P8+P3).
- W3: P5 group trips over per-person cases (after P4) | P11 checklist correction suggestions + published-rule impact on active packages (after P4, uses P10) | P12 outcome attempts and private insights (after P4+P9).
- W4: P13 navigation (My Documents, My Trips, Sharing & Requests; nothing removed) after flows exist | P14 final verification: every UMPE ID, all-role journeys, ledger to final status, release verdict.

## Merge order and migration numbers
Order of merge decides numbers: next free = 0118. Lanes ship a TEMP migration as last commit; lead regenerates with drizzle-kit after merging main, renames file and journal tag to the next number, keeps the lane's reviewed SQL body (re-runnable, triggers), runs db tests.

## Exclusive ownership (hot files)
- notifications.ts / invitation-email.ts / email-design.ts / rate-limit.ts: P8 in W1; P4 in W2 (P9 asks lead); P11 in W3.
- packs.ts / pack-matching.ts / rule-conditions.ts: P11 in W3 only.
- missions.ts: P4 in W2; P5 in W3 (P11 and P12 read only via adapters).
- documents.ts / intake.ts / uploads.ts / upload route: P3 in W1; P9 in W2 via adapters only (request-scoped storage, no applicant FK).
- apps/web/src/app/collect/page.tsx and collect/** except collect/account/**: P8 then P9. collect/account/**: P7.
- app-nav / workspace navigation / layouts: P13 only (earlier lanes add entry points only behind their own switch, one line each, lead-approved).
- globals.css: each lane appends one block `/* WP-UMPE-Pn ... */`.
- services index.ts: each lane appends a `// UMPE Pn` block.

## Standard lane rules (in every prompt)
Read CLAUDE.md 3,4,6,7; ADR 0026 + addendum; the lane's discovery/brief; write a 40-line plan; synthetic data only; access ratchet for every new reader; never read schema at module load; no timing-dependent tests; prove 2 guards red; before hand-back: lint, typecheck, full web vitest + adapters + services targeted (or the repo full-check.sh in its own container), web build, a11y-forms/title-case/vocabulary/parity guards; /code-review max (+ /security-review where relevant); push only own umpe/* branch; hand-back file docs/umpe/operations/handoffs/Pn.md + final message; never merge, never PR-ready, never migrate production, never change Vercel/Neon.

## Lead loop
On each lane hand-back: read handoff; check diff stays in ownership; merge main into lane branch; regenerate migration; targeted tests on combined tree + typecheck + lint; push; open/ready PR; wait-ci; merge with expected SHA; run migration (pre-approved); wait-deploy; verify readiness + Neon; update ledger/known-issues/STATUS in the next records commit; launch the next lanes whose dependencies are now met. Self check-ins via send_later every ~40 min while lanes run (child sessions do not report back).
