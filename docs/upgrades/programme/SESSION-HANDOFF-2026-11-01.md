# Session handoff, 1 November 2026

Supersedes `SESSION-HANDOFF-2026-10-29.md` for current state (older handoffs stay as history). Read `CLAUDE.md`, then `docs/SESSION-START.md`, then this. Main was `b8bb2df4` (#405) when this was written; check the head SHA before acting.

Every fact below was checked on main and on GitHub on 1 Nov 2026 unless it says "not verified".

## 1. What is live

| Area | State | Where the detail lives |
|---|---|---|
| Resource Lifecycle Programme | Complete and accepted by the owner ("G-Z accepted"). Lanes F #381, G1 #379 (+#380), G2 #382, G3 #389, A2 #388, B #393, A1 #395, C #396, D #399, E #400, Z #403 (+ docs #404). Removal requests are switched on | `docs/roadmap/lifecycle/STATUS.md` |
| Paid traveller plans (ADR 0025) | T1 to T6 merged: T6a #375 (migration 0112), T6 #377 `ad452237`, T6 metrics #398 `63df73a0` (migration 0114). Built, but selling stays off: the coordinator reports `TRAVELLER_PLANS_ENABLED` is not on (Vercel settings are not readable from this session, so not verified here), and readiness reports `payments` unconfigured, so no live gateway can take money. Waits on D7 (the accountant's VAT answer), D12 (lawyer's wording review) and O6 (live payment account), then the owner's "go live" | `docs/adr/0025-paid-traveller-plans.md`, `docs/roadmap/OWNER-ACTIONS-SMALL-COMMERCIAL-V1.md` |
| Scroll Budget programme | Complete. WP-SB0 #378 to WP-SB11 #402. Every scroll-budget browser check enforces; no known exception remains (Documents on a phone fixed by lane Z: 6 rows a page) | `docs/uiux/SCROLL-BUDGET.md` section 2 |
| Small Commercial V1 | S1 to S18, S20 to S23, S27 to S29 and S19 step 0 (the payment provider registry) merged (S18, S19 step 0, S20, S21, S28 and S29 together in #354, with migrations 0104 to 0107; S22 in #355 with 0108 and 0109). Left: S24 commercial acceptance (owner's explicit word, never automatic), S25 Bangla (owner's word), S19 proper only if the owner names a second payment provider | `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M |
| CI | #376 `7704ec58`: one web build for both browser checks, four test workers per shard, browser install during the build. About 7 to 9 percent faster pull request checks (measured in the PR) | `.github/workflows/` |

**Database:** the repository holds 113 migrations, up to `0114_traveller_plan_metrics` (0098 and 0099 are unused numbers). Production runs, each on the owner's word for that run: 0112 (run 41233325574, 31 Oct 19:15Z, on `2dd9fc87`), 0113 (run 41263156493, 1 Nov 01:57Z, on `9d5bb99a`), 0114 (run 41289963351, 1 Nov 09:42Z, on `63df73a0`); all three succeeded. **No migration is pending.**

**Readiness** (`https://visastack-five.vercel.app/api/health/ready`, read 1 Nov 2026 by this session): `ready`, `controlled_pilot`; `aiExtraction`, `redactedDownload`, `aiConnector`, `publicSignup` available; `malwareScanning` and `payments` unconfigured; `realApplicantData` and `commercialClaims` disabled. Readiness reports not ready while any shipped migration is pending, so `ready` also confirms none is.

**Main CI on `b665fd4e`:** "Lint · Build · Typecheck · Test", "No-secret Playwright checks", "No-secret smoke check", CodeQL and the live signed-in check all succeeded; the Vercel status is success.

**Switches set by the owner since 29 Oct:** `DOCUMENT_REMOVAL_REQUESTS=on` in Vercel Production, then a redeploy (deployment `dpl_CHa5srZp3PyLaDkoxaCBu9KfR8Va`, reported READY by the coordinator; this session cannot read Vercel settings). The owner checked on screen that Ask Us to Remove This File appears (owner check, 1 Nov 2026, reported by the coordinator). The code accepts `on`, `true`, `1` or `yes`, any case, spaces ignored (`apps/web/src/lib/env.ts`, `documentRemovalRequestsOn`).

## 2. Owner decisions in force (new since 29 Oct, newest first)

The full list is `docs/SESSION-START.md` section 6.

- Founding A follow-up, both YES: a REJECTED application also ends Founding Access; backup reconciliation replays SUBSCRIPTION_ENDED.
- "G-Z accepted": the Resource Lifecycle Programme is accepted.
- "Founding A", refined to "Close the record": Founding Access is free and never invoiced, so on agency withdraw or terminate the current plan ends at that moment, a waiting downgrade and its notice are cancelled, SUBSCRIPTION_ENDED is audited, no refund. Merged as #405 (`b8bb2df4`), no migration.
- "switch on removal requests" and "G-D approved": the Compliance Admin role reviews removal requests, each decision needs a fresh sign-in, no new role; wording approved as shipped.
- "migrate 0114" and "migrate 0113": each run once, as above.
- "G3 A": one written access-ratchet exception for `organizations#withdrawOrganizationApplication`.

## 3. Open work, in order

1. **Founding A follow-up** (in progress, session VS-XYZ-02): the owner answered both YES (reported by the coordinator, 1 Nov 2026): a REJECTED application also ends its Founding Access subscription, and backup reconciliation must replay SUBSCRIPTION_ENDED. Session VS-XYZ-02 is building both; not merged when this was written.
2. **PGlite speedup for tests** (next engineering item, deferred from #376): fewer database copies per test so CI gets faster. Not started.
3. **Lifecycle cleanup** (not urgent): the per-request presence checks for the lifecycle tables can go now that 0113 is confirmed on production.
4. **Paid plans go-live**: owner items D7, D12, O6, then "go live"; T7 (privacy and launch) and T8 (after launch) per ADR 0025.
5. **Deferred items** recorded by lane Z: H30 voluntary agency closure, H31 automatic Safe Copy for a surviving duplicate, H32 storage-plus-database restore drill for removed documents (`docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md`).
6. S24 commercial acceptance and S25 Bangla, each only on the owner's word.

## 4. Sessions still running

- VS-XYZ-02 (`session_0187kU9rUiifEY59CgmeDcu4`): built Founding A (#405, merged); now building the Founding A follow-up (rejected applications, backup replay).
- The coordinator (`session_0187kU9trzEd3LaoJQDzkYT4`) started this documentation session.
- Old owner-held PRs #177 (open sign-up switch) and #77 (WorkOS staging, obsolete): leave them open.

## 5. Not verified

- A signed-in live click-through of the new lifecycle actions (Archive, Replace, Delete Duplicate, Recently Deleted, Ask Us to Remove This File and the staff queue, traveller Archive).
- The finished-case packet download after a removal in a real browser; the H32 restore drill.
- The main domain `vs.obsidianglobal.studio` from cloud sessions: the session proxy refuses the connection, so only the fallback domain was probed.
- Real signed-in pages at phone and desktop widths for the Scroll Budget work (the checks measure fixtures that copy each page's layout).

## 6. Pitfalls (new in this run)

The standing list is `docs/SESSION-START.md` section 8 and `CLAUDE.md` section 7. New:

- Test fixture dates must not be absolute dates near today: one that expired on 1 Nov 2026 turned every branch red (fixed by lane G1 in #379).
- Heavy tests need explicit timeouts: the `packages/adapters` HEIC converter test now has 180 s (lane E, #400).
- `scripts/agent/full-check.sh` used `grep -q "$BUILD_ID"`, which breaks when a build id starts with `-`; fixed as `grep -qF --` in lane A1 (#395).
- A PR that shows no checks 15 minutes after a push usually conflicts with main: GitHub runs no `pull_request` workflow on a conflicting PR. Merge main.
- A blocked lane messages the coordinator; writing "Blocked" in the lane file alone is not seen.
- A database change word ("migrate NNNN") covers only that number.
- Some sessions rightly refuse security-test or billing edits relayed from another session; the owner then types the decision in that session.
