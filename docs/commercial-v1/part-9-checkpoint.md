# Part 9 checkpoint

Written 2026-10-06 (Task 5). One run, one commit: **`d3c3902734fb1ccfc25043f8b9827acc3debe42b`** (code). Documents added after it change no code. Environment: local sandbox (Node 22, pnpm 10, Postgres 16 for the load suite, a production build served on port 3100 with dummy sign-in values) plus read-only fetches of production.

## PART 9 CHECKPOINT: BLOCKED

Blocked, not failed. Every automated check that can run here is green. The block is a list of things the directive wants proof of that this environment cannot give: a measured availability figure, a rehearsed restore, a screen-reader pass, a live document scanner, an incident owner. They are listed under UNRESOLVED LAUNCH BLOCKERS.

## What ran on that commit

| Check | Result | Detail |
|---|---|---|
| Lint | PASSED | 632 files |
| Typecheck | PASSED | 8 packages |
| Unit and service tests | PASSED | Run uncached (0 of 8 from cache): 2,759 passed, 3 skipped, 0 failed across 8 packages (services 1,332; web 1,018; adapters 325 with 2 skipped; db 34 with 1 skipped; policy 32; load 10; i18n 6; core 2). The 3 skips are existing, named skips in the adapters and db suites |
| Production build | PASSED | web app |
| Dependency audit (high and above, production) | PASSED | exit 0 |
| Supply-chain scans | PASSED, 7 of 7 | secret, licence, static analysis, browser bundle, prompt, fixture, preview credential. The secret scan covered the working tree only (shallow clone); CI scans full history. Static analysis is rule-based and does not replace CodeQL |
| Load suite | PASSED | see LOAD |
| Browser checks (public pages, security headers, sign-in redirects) | 75 passed, 2 failed, 21 skipped | The 2 failures are the known sandbox-only sign-in redirect tests (the sign-in provider is unreachable from here); they pass in CI. The 21 skipped are the staging-only authenticated tests (13) and the eight cross-account tests: BLOCKED, never counted as passed |
| Smoke check | PASSED | local production build |
| CI on the merged previous commit (`e62284e`) | green | CI, Deploy Smoke, Playwright Deploy Smoke succeeded; CodeQL and dependency review skipped by design; the staging job was skipped (not configured) |

Not run as a separate item: the keyboard-only and screen-reader passes (a person is needed).

## The block, item by item

**UX: PARTIAL.** Seven states inventoried for every screen (`docs/ux/critical-states.md`). Real defects found and fixed (outage page for route information, loading heading, misleading status words). Signed-in screens have never been opened in a real browser here; seven are scanned as whole pages with simulated data; five groups of screens are not.

**I18N: DEFERRED BY OWNER.** Bangla and all translation work are parked until the owner says the rest is done. This is not a pass and is not reported as one.

**ACCESSIBILITY: automated and keyboard-behaviour checks pass; screen-reader pass owed.** WCAG 2.2 AA is not claimed. Owed to a person: keyboard-only pass, screen-reader pass (NVDA or JAWS, VoiceOver, TalkBack), Safari and Firefox, zoom and text spacing.

**BROWSER SECURITY: PASS for what is testable here.** Per-request policy with scripts only by nonce, security headers, report endpoint; browser checks run on every page type in `browser-security.spec.ts` (green in this run). Preview-environment secret scoping cannot be read from the repository: the owner checks the Vercel dashboard.

**MONITORING: IMPLEMENTED, NOT PAGING.** Structured server-error events, operational signals and the health endpoints exist; production `/api/health/ready` returned ready after the last merge. There is no outside uptime probe and the weekly audit has no paging.

**PERFORMANCE and LOAD: MEASURED once, on one machine.** 4 CPUs and 16 GB, plain Postgres, in-memory file store, 60 second runs. Launch-sized data: 5,000 people, 1,000 cases, 21 organisations, 30,050 documents. At the launch envelope (50 concurrent sessions plus 5 document workers): 2,995 page views, 0 errors, p50 14.3 ms, p95 34.8 ms, p99 54.4 ms, 11 database connections at most, 150 documents processed with 0 failed. Stress (50 sessions, no think time): 6,592 views at 220 per second, 0 errors, p99 485 ms, 22 connections at most. Scanner outage drill: the file ended quarantined, release stopped. Limits: the built-in scanner refuses PDFs, no network delay to the database, no browser, no Neon at launch size.

**ANALYTICS: IMPLEMENTED.** Funnel events with label, measure and organisation, recording since the production migration of 2026-10-05; nothing earlier can be reconstructed.

**INCIDENT: DOCUMENTED, NOT RESPONDABLE.** Eight runbooks, roles, evidence rules, no 24 hour promise. No incident owner appointed and no tabletop held.

**RECOVERY PREP: DOCUMENTED, NOT REHEARSED.** Recovery and rollback guides exist; the audit-chain check is tested. No restore or rollback has ever been rehearsed; document originals have no independent backup; the master key has no escrow or rotation.

**A31 / A32 / A33:** A31 IN_PROGRESS (release record on every deployment, migration workflow main-only; rollback not rehearsed, migration role and environment not created). A32 BLOCKED (screen-reader pass owed; Bangla deferred). A33 NOT_EXECUTED against the launch target (measured here, no Neon rehearsal, availability unmeasured).

## UNRESOLVED LAUNCH BLOCKERS

1. Incident owner, backup owner and legal reviewer not appointed; no tabletop held.
2. No independent store for document originals; master key without escrow or rotation; restore and rollback never rehearsed.
3. Neon migration role, `MIGRATION_DATABASE_URL` and the `production-migrations` environment not created.
4. Document scanner unconfigured in production and the built-in one refuses every PDF: ClamAV needed.
5. Availability (99.9 percent) unmeasured; no outside probe; no Neon rehearsal at launch compute size.
6. Screen-reader and keyboard-only passes owed to a person; five groups of signed-in screens not scanned as whole pages.
7. No CodeQL or equivalent; weekly audit has no paging; preview secret scoping unverified.
8. Notifications and date checks run daily, not hourly; staff MFA not enforced.
9. Two staging identities and the agency fixture do not exist, so the eight cross-account tests and every journey are BLOCKED (Part 10).
10. Bangla deferred by the owner.

## FILES / COMMITS

`d3c3902` cross-account test bodies, trusted-only staging workflow. Docs: this file, `part-10-reread.md`, `part-10-journeys.md`, `part-10-acceptance-matrix.md`, ledger and known-issues chunk 46.

## NEXT

**Part 10 may not proceed to the release-candidate steps.** Sections 5 to 7 are blocked by the items above (restore drill, independent review) and section 3 by the missing staging identities. What can proceed once the owner decides: provisioning the two staging identities and the agency fixture (unblocks the eight tests and the journeys), then Task 7 (scans and independent review arrangements). The owner decisions that matter most: appoint the incident owner, backup owner and legal reviewer; choose and configure the document backup and key escrow; configure ClamAV.
