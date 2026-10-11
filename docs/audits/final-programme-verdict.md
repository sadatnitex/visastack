# Final verdict — post-programme defect closure

**Authority:** closing deliverable of the Post-Programme Defect Closure,
Controlled-Pilot Verification and Commercial-Activation Readiness Programme
(engagement brief received 2026-08-03), per PR-F1's own scope ("Integration
cleanup, documentation and final verdict") and the standing
[`docs/governance/integration-and-cleanup-directive.md`](../governance/integration-and-cleanup-directive.md).
Produced 2026-08-11, at the tip of `claude/visastack-pilot-commercial-readiness-lp1h5x`
before PR-F1 itself was opened.

**Companion documents, not duplicated here:**
[`post-programme-defect-register.md`](./post-programme-defect-register.md)
(every finding, individually cited against current code — this file
summarizes it, does not re-derive it);
[`integration-and-cleanup-map.md`](./integration-and-cleanup-map.md) (the
canonical-implementation-per-concern inventory);
[`../roadmap/remaining-commercial-blockers.md`](../roadmap/remaining-commercial-blockers.md)
(everything genuinely still open, and why).

## 1. The question this document answers

Not "is VisaStack commercially launched" (no — see §4, and nothing in this
programme ever claimed otherwise) but: **of the defects this engagement was
chartered to find and close, how many are actually closed, verified against
current code rather than trusted from memory, with tests that would fail if
the fix were reverted?**

## 2. Verdict: every tracked defect is closed

| Category | Count | Status |
|---|---|---|
| Original GitHub review findings (`#1`–`#36`) | 36 | **36 FIXED** |
| Baseline-discovered defects (D-T1, D-RT1, D-A1, plus D-T2/D-T3 documented as non-defects) | 4 (+1) | **All fixed or correctly explained as not requiring a fix** |
| Findings Codex raised against this programme's own new code (`#37`–`#54`) | 18 | **18 FIXED** |
| **Total numbered findings** | **58** | **58/58 closed** |

This is not merely a re-assertion of each PR's own claim at merge time.
PR-F1 independently re-verified every finding that still read
"STILL PRESENT"/"PARTIALLY FIXED" in the register's own text — 14 of them
(`#2`–`#7`, `#15`–`#18`, `#22`, `#23`, `#24`, `#32`) — against **current**
`main`, not against memory of what a PR claimed to do. Thirteen were
already fixed in code; the register's prose had simply never been updated
to say so (a documentation-currency gap, not a code gap — see §3). One
(`#24`, CI wiring for `ux-public.spec.ts`) was genuinely still open and was
fixed directly in PR-F1. One regression test (`#5`) was found to be
vacuous — it asserted an empty result without ever seeding data that could
have leaked, so it would have passed against the reverted bug too — and was
strengthened in place, with a fresh non-vacuousness proof (disable the fix,
confirm exactly that test fails and no other, restore, confirm
byte-identical).

Every "FIXED" verdict in the register cites exact current file/line
evidence and the regression test that proves it, verified non-vacuous by
disabling the mechanism and confirming the expected test failure before
restoring — the same discipline applied without exception across all seven
delivery PRs (PR-A, PR-B1/B2/B3R, PR-C1/C2, PR-D1/D2, PR-E1/E2, PR-F1).

## 3. A finding worth stating plainly: documentation lagged code

Thirteen closed findings sat in the register marked "STILL PRESENT" for the
bulk of this programme's duration — PR-A actually fixed them (its own
commit closed findings `#2`, `#15`, `#16`, `#17` by name, plus `#22`/`#23`
incidentally, plus `#3`–`#7` incidentally, plus `#32` as a side effect of
an unrelated later fix for finding `#51`), but the register's per-finding
prose was only updated for the findings each commit message named
explicitly. This is a real process gap: for most of the programme, a reader
of the register alone would have believed 13 more defects were open than
actually were. It did not cause a security regression — the *code* was
correct the whole time, re-verified fresh here rather than assumed — but it
is exactly the kind of drift a "final verdict" pass exists to catch. The
fix applied: re-derive ground truth from current source for every
ambiguous entry, not from the document's own prior claims, before writing
this verdict. `docs/audits/integration-and-cleanup-map.md`
(§"Tracking" in the cleanup directive) had an analogous, more severe gap —
it was never updated past its very first entry ("PR 1" of the *earlier*
11-PR commercial-recovery programme) for the entire duration of *this*
programme; PR-F1 rewrites it in full.

## 4. What "58/58 closed" does not claim

- **Not commercial-launch readiness.** `apps/web/src/lib/commercial-readiness.ts`'s
  19-gate guard — external pen-test, real malware scanner, production
  WorkOS, backup-restore verification, and 8 more — remains almost entirely
  unsatisfied, by design (most gates require a human attestation no server
  check can produce). See
  [`remaining-commercial-blockers.md`](../roadmap/remaining-commercial-blockers.md)
  §1. None of these gates were ever in this engagement's scope; none of
  this register's 58 findings depended on them being closed.
- **Not full deployed-E2E verification.** `authenticated-workspace.spec.ts`
  declares 21 tests: 13 with real journey implementations, structurally
  proven (they list and run correctly without credentials), and 8 that are
  unconditional stubs (`test.skip(true, reason)`, no journey steps inside)
  pending a second synthetic identity. No session across this entire
  engagement has had `WORKOS_STAGING_TEST_EMAIL`/`_PASSWORD` to run even
  the 13 implemented ones against a live environment once. (Corrected here
  in PR-F1 — Codex review caught this document, and
  `remaining-commercial-blockers.md`, both wrongly reporting 55, which was
  this session's own monorepo-wide vitest file count bleeding into a
  sentence about a single Playwright spec.) This caveat has been carried,
  disclosed, since before this programme started. See
  `remaining-commercial-blockers.md` §3.
- **Not a resolved Vercel preview-deployment failure.** Investigated with
  real evidence (not dismissed) in PR-E2; root cause hypothesized with
  strong support, not fixed — needs dashboard access no session has had.
  See `remaining-commercial-blockers.md` §2.
- **Not zero dependency-audit findings anywhere.** `pnpm audit --prod` is
  now clean (fixed in PR-F1); `pnpm audit --dev` still has 6 findings
  rooted in a major-version-behind `vitest`/`vite`, deliberately deferred
  as out of scope for a cleanup PR. See `remaining-commercial-blockers.md`
  §4.

## 5. Verification this document rests on

Run fresh during PR-F1, on the exact commit this document is committed
alongside (not inherited from an earlier PR's report):

- `pnpm run lint` — clean.
- `pnpm run typecheck` — clean.
- `pnpm turbo run test --continue --force` (non-cached, every package) —
  **55 test files, 616 passing + 1 skipped (617 total)**, zero failures,
  zero flaky. Up from the Phase 0 baseline's 49 files / 471 passed + 1
  skipped + 2 flaky (474) — 146 net new tests, and the two flaky timeouts
  (D-T1) eliminated.
- `pnpm run build` — clean, all packages.
- `pnpm audit --prod --audit-level high` — **no known vulnerabilities**
  (fixed in PR-F1; was clean at Phase 0 baseline too, then drifted to 1
  HIGH + 4 moderate as advisory databases updated against an unchanged
  lockfile — see `remaining-commercial-blockers.md` §4 for the exact
  mechanism).
- `packages/services/src/agency.test.ts` — the one test file PR-F1 modified
  (the finding `#5` strengthening) — re-verified non-vacuous independently
  of the full-suite run above.
- All four touched CI workflow YAML files (`playwright-smoke.yml` plus the
  three already-correct from PR-E2) parse cleanly.

## 6. Programme shape, for the record

Seven delivery PRs, each branched from the latest approved `main`, each
held for explicit human approval before merging, each run through this
programme's two-round Codex review stop-loss (never a third explicit
round — a "final verification" round's own findings get fixed and verified
via this repository's own tooling instead of triggering a further review
request):

| PR | Scope | Findings closed |
|---|---|---|
| PR-A | Access, consent, authorization closure | `#2`, `#15`, `#16`, `#17` (explicit); `#3`–`#7`, `#22`, `#23`, `#32` (incidental, corrected in the register by PR-F1); `#37`–`#54` (Codex, own new code, 9 review rounds) |
| PR-B1 | Erasure worker leasing and recovery | `#12` |
| PR-B2 | Multi-version erasure and legal-hold serialization | `#13`, `#14` |
| PR-B3R | Conservative PDF handling (replacing the abandoned PR #68 parser) | `#8`, `#9` (via policy change), `#10`, `#11` |
| PR-C1 | Processing job fencing and idempotency | `#19`, `#21`, D-A1 |
| PR-C2 | OpenAI budget, cache and evaluation integrity | `#20`, `#26`, `#27`, `#28` |
| PR-D1 | Mission snapshot and evidence integrity | `#29`, `#30`, `#33`, `#34` |
| PR-D2 | UX/UI completion and product coherence | `#25`, `#31` |
| PR-E1 | Provider validation, readiness and public disclosure | `#35`, `#36` |
| PR-E2 | Exact-SHA CI and deployed E2E verification | Process requirement (directive §8), not a numbered finding |
| PR-F1 | Integration cleanup, documentation and final verdict | `#24`; register-currency correction for `#2`–`#7`, `#15`–`#18`, `#22`, `#23`, `#32`; this document |

Every merge was verified against the exact resulting `main` SHA and the
live Vercel production deployment (`readyState: READY`, exact
`githubCommitSha` match, `aliasError: null`) before moving to the next PR —
never assumed from the merge API response alone.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
