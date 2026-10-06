# Part 10 sections 5 to 7 and 11: release-candidate run, security scans, restore drill (A30), independent review (A35)

Run 2026-10-06 on code `a27cefb8bd40e0f766870309b02a848c1917307d` (main after PR 172; production runs the same SHA, deployment `dpl_EBYqheEpDEEdNmvSSsSbCn4mDtxV`). Environment: local sandbox (Node 22, pnpm 10, 4 CPUs, 16 GB, PGlite for service tests, plain Postgres 16 for load, a production build served on port 3100 with dummy sign-in values). Results are read from each step's own exit code and log, not from a workflow tick. Nothing here is reused from another SHA.

## Run record

| Step | Started (UTC) | Exit | Result |
| --- | --- | --- | --- |
| Install with frozen lockfile | 13:04:57 | 0 | PASSED |
| Lint | | 0 | PASSED |
| Typecheck | | 0 | PASSED (8 packages) |
| Unit and service tests, uncached | | 0 | PASSED: 2,759 passed, 3 skipped (the same three named skips as the checkpoint), 0 failed. services 1,332; web 1,018; adapters 325 with 2 skipped; db 34 with 1 skipped; policy 32; load 10; i18n 6; core 2 |
| Production build | | 0 | PASSED |
| Production dependency audit, high and above | | 0 | PASSED, see "Dependency audit" for what remains |
| Supply-chain scans | | 0 | PASSED 7 of 7 |
| Scan self-tests | | 0 | PASSED 12 of 12 (each plants a bad input and watches the scan fail) |
| Browser checks (public pages, headers, sign-in redirects) | 13:22:00 | 1 | 75 passed, 2 failed. The 2 failures are the known sandbox-only sign-in redirect tests (the sign-in provider is unreachable from here; they pass in CI) |
| Smoke against the local build | | 0 | PASSED 10 of 10 |
| Load run (launch size) | 13:22:48 | 0 | PASSED, see "Load" |

Not run, and why: authenticated single-account and cross-account browser tests (need two staging identities and the agency fixture); rule golden suites (none exist); AI, email and scanner live synthetic runs against real providers (none configured); deployment to an isolated staging environment (none exists). Two of these are named in the directive's section 11 list and are therefore recorded as NOT EXECUTED, never as passed.

## Section 6: scan table

Counts are job-level: executed, passed, failed, skipped.

| Scan the directive names | Executed | Passed | Failed | Skipped | Detail |
| --- | --- | --- | --- | --- | --- |
| Dependency audit | yes | yes (production, high and above) | 0 | 0 | Production: 0 critical, 0 high, 1 moderate. Development tools: see below |
| Secret scan | yes | yes | 0 | 0 | 827 tracked text files, 14 credential shapes. **History not scanned**: this clone is shallow. CI scans full history on every pull request |
| Static analysis | yes | yes | 0 | 0 | 350 shipped files, 10 rules. Rule-based; it does not replace CodeQL |
| Licence scan | yes | yes | 0 | 0 | 111 production packages, 11 licence types, 1 reviewed exception (an LGPL image library inside Next.js image handling) |
| CodeQL or equivalent | no | n/a | 0 | 1 | CodeQL is skipped on a private repository. The rule-based static check above is the equivalent that runs; it is weaker. Reported as skipped, not as passed |
| Browser bundle, prompt, fixture, preview credential checks | yes | 4 of 4 | 0 | 0 | 102 browser files; 15 prompt templates; 166 fixture files; 8 workflow files |
| Authorization suites | yes | yes | 0 | 0 | `tenant-isolation.test.ts` (18), `authorize.test.ts` (32), plus the per-service tests; all inside the 2,759 |
| SSRF | no | n/a | 0 | 1 | No test exists. Nothing in the product fetches a user-supplied address today (A22: a custom AI endpoint field is deliberately not built). When that field is added, an SSRF test is required first |
| Upload and malware | yes | yes | 0 | 0 | Scanner adapter (23 tests), content limits (11), zip structure, DOCX validation. **Real scanner not configured in production**, and none ran in this load run (see below) |
| Encryption | yes | yes | 0 | 0 | `key-management.test.ts` (7), `protected-fields.test.ts` (15), backfill. Master key has no escrow or rotation |
| Audit integrity | yes | yes | 0 | 0 | `audit-checkpoints.test.ts` (9) and chain report tests. Not run against the production audit trail |
| Browser security and CSP | yes | yes | 0 | 0 | `csp.test.ts` (32), middleware and report tests; `browser-security.spec.ts` green in the browser run |
| Rate limits | yes | yes | 0 | 0 | `rate-limit.test.ts` (25). Not load-tested at the edge |

Totals across these 13 rows: executed 11, passed 11, failed 0, skipped 2 (CodeQL, SSRF).

## Dependency audit: what remains open

| Where | Severity | Item | Exposure |
| --- | --- | --- | --- |
| Production | Moderate | `sprintf-js` (denial of service through unbounded precision); no patched version exists | Comes in through the DOCX reader (`mammoth`, then `argparse`). No code of ours calls it. The flaw needs attacker-chosen format precision; that this cannot happen through a DOCX upload was not proved. Tracked |
| Development only | **Critical x3, High x1**, Moderate x6 | The test runner and build server (`vitest` below 3.2.6, `tinypool` below 2.1.2, `vite` up to 6.4.2) | Never deployed and never reachable from the internet: they run only on a developer machine or in CI while tests run. Not part of the shipped app. The fix is a major-version upgrade of the test runner (2.x to 3.2.6 or later), which touches every package's tests and is out of scope for this task. **Counted honestly in the security totals below as open, development-only.** |

## Load (re-run on this SHA)

Launch size: 20 agencies plus one that sees every case, 210 staff, 5,000 profiles, 1,000 open cases, 30,050 documents. Database next door, no network delay, 60 second runs.

| Target | Measured at this SHA | Result |
| --- | --- | --- |
| 50 sessions with 5 document workers | 2,903 screen views (48 a second), 0 errors, p50 16 ms, p95 39 ms, p99 57 ms. Slowest screen p95: audited save, 62 ms. Database connections at most 7. Machine 20% busy | MET on this machine |
| Stress (no thinking time) | 214 views a second, 0 errors, p50 211 ms, p95 376 ms, p99 520 ms, machine 68% busy | No failure at 4x the launch rate |
| Scanner outage stops release | File ended QUARANTINED, release stopped | MET |
| p95 safe processing of a 10-page PDF under 90 s | **NOT MEASURED at this SHA.** No ClamAV in this run; the built-in scanner refuses every PDF, so all 150 files ended QUARANTINED. The earlier figure (p95 0.41 s with a real scanner) belongs to an earlier SHA and is not reused | NOT MEASURED |
| 99.9% monthly availability | Cannot be measured from a sandbox | NOT MEASURED |
| Rehearsal against a Neon branch at launch size, same region as the app | Not done (needs the owner's approval of a branch) | NOT DONE |

## Section 5: restore drill (A30)

**State: BLOCKED. No restore was performed.**

| Directive item | Status |
| --- | --- |
| Isolated recovery infrastructure | Not created. The plan needs a Neon history branch; the owner has not approved one, and production data must not be touched |
| Database restore, audit chain and checkpoint (`verify:audit-chain`, `reconcile:restored-branch`) | Tooling exists and is unit-tested (`backup-reconciliation.test.ts`, audit chain report tests). Never run on a restored branch |
| Original object data | **No independent backup of document files exists.** Nothing to restore from |
| Encryption keys and configuration | **The master key has no escrow.** A restore without it leaves protected fields unreadable |
| Deletion tombstones and revocations not resurrected | Reconciliation logic is tested in isolation; not proved on a restore |
| Measured RPO and RTO | None. Target stays RPO 15 minutes, RTO 4 hours. The target is not rewritten. The provider tier's history window and restore time have not been confirmed against it |

To unblock: (1) approve a Neon test branch; (2) fund a second store for document files and run it for a period; (3) create and escrow the key with two named holders; then a drill can be run and timed.

## Section 7: independent security review (A35)

**State: BLOCKED. Commercial admission stays blocked.** No outside report or penetration test exists or was supplied. Reviews done by this assistant, by earlier sessions, or by other automated tools are internal checks. They are not independent and are never to be called a penetration test. If the owner supplies a report: ingest it, classify each finding, fix Critical and High, retest, and link the evidence here.

## Security counts used in the final report

| Severity | Open | Notes |
| --- | --- | --- |
| Critical | 3, development tools only | `tinypool` x2 and `vitest`; none shipped. Production: 0 |
| High | 1, development tools only | `vite`. Production: 0 |
| Medium | 7 | 1 in production (`sprintf-js`), 6 in development tools |
| Low | 0 reported by the audit | The scan does not grade lower findings |
| Known design gaps (not scanner findings) | see `threat-model.md` | Staff MFA not enforced; master key without escrow; no document backup; no outside monitoring |


## Addendum 2026-10-06 (afternoon): test tools upgraded, whole run repeated

The Critical and High advisories in development tools were cleared by upgrading the test runner (vitest 2 to 4) and pinning its build server (vite 6.4.3 or later). Files changed since `a27cefb`, outside `docs/` and the README: package manifests, the lockfile, three small test configuration files (explicit 60 second limits for the packages that start an in-process database per test), and one test file (typed mock filters). **No shipped source file changed**; the lockfile difference is development tools only.

Run on `3fbaeef143e33ca039ff353c9212f70fd9d3b165` (the release-candidate branch head at the time):

| Step | Result |
| --- | --- |
| Install with frozen lockfile, lint, typecheck, build | PASSED |
| Unit and service tests, uncached | PASSED: 2,759 passed, 3 skipped, 0 failed (same counts as before) |
| Production audit, high and above | PASSED |
| Full audit (including development tools) | 2 moderate only: a build-tool advisory (`esbuild`) and the DOCX-reader advisory (`sprintf-js`). **0 Critical, 0 High, 0 other** |
| Supply-chain scans and self-tests | 7 of 7 and 12 of 12 PASSED |
| Browser checks | 75 passed, 2 failed (the same two sandbox-only sign-in tests) |
| Smoke | 10 of 10 PASSED |

Two honest notes. First, an intermediate run failed: one database-backed test hook timed out at the 10 second default when all packages ran at once on 4 CPUs, and two web tests timed out while I ran other commands in parallel. They passed alone (28 seconds for that package). This was treated as a real test-robustness defect, not dismissed: the limits were made explicit and the whole run was repeated cleanly. Second, the load run and the browser/CSP behaviour are unchanged by this work and were not repeated for load.

Security counts now: **Critical 0, High 0, Medium 2** (1 production, 1 development), Low not graded. This replaces the counts in the table above for the branch head. Production itself still runs `a27cefb`; this branch is not deployed.
