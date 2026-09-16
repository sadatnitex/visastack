# Commercial V1 Test Evidence

Records exact commands, commit, environment, and executed/passed/failed/skipped status for
every quality gate run during this programme, per Part 1 Section 9. This session runs on a
managed remote execution container (not the product's staging/production environment); all
runs below are local-workspace runs against the working tree, not deployed-environment runs.

## Part 1, run 1 (before dependency fix)

Commit: `2cb47e0ac91e8ce323956aff607bae9cd343e5a0` (origin/main), branch
`claude/lucid-lamport-70jivu` at the same commit. Node/pnpm per `.nvmrc`/`packageManager`
(Node 22, pnpm 10.33.0).

| # | Command | Exit | Result | Detail |
|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | 0 | PASS | Completed in 1m13.4s. |
| 2 | `pnpm run lint` | 0 | PASS | Biome, 288 files checked, no fixes applied. |
| 3 | `pnpm run typecheck` | 0 | PASS | `turbo run typecheck`, all packages. |
| 4 | `pnpm run test` | 0 | PASS | `turbo run test`, 7/7 tasks successful. `@visastack/services`: 26 test files, 338 tests, all passed, 149.51s. Other packages reported success with no separate file/test counts printed to this log (turbo cached/summarized). |
| 5 | `pnpm run build` | 0 | PASS | `turbo run build`, 1/1 remaining task (web) successful, 47.475s. Full Next.js route manifest printed (admin, agency, applicant, mission, privacy, shared routes all present). |
| 6 | `pnpm audit --prod` | 1 | **FAIL** | 13 vulnerabilities: 2 critical (Next.js unauthenticated RCE ×2), 9 high (7× `@xmldom/xmldom` via `mammoth`, 1× `sharp` libheif, counted with the 2 critical Next.js this is 2+8=10, plus 1 more high not double-counted — see `baseline.md` for the itemized list), 2 moderate (`@xmldom/xmldom`). Full log retained at `/tmp/claude-0/.../scratchpad/verification/audit.log` for this session's lifetime; advisory IDs and fixed-version ranges are recorded in `baseline.md` and `known-issues.md`. |

Fixes applied immediately after run 1 (see `baseline.md` for full detail): `next` bumped to
`^15.5.24`, `pnpm.overrides.sharp` bumped to `>=0.35.4`, `pnpm.overrides["@xmldom/xmldom"]`
added at `>=0.8.15`. All patch-level, no major-version change.

## Part 1, run 2 (after first dependency fix attempt — revealed a regression)

Commit: same working tree, with `next` bumped to `^15.5.24`, `pnpm.overrides.sharp` bumped to
`>=0.35.4`, and `pnpm.overrides["@xmldom/xmldom"]` added at `">=0.8.15"` (unbounded).

| # | Command | Exit | Result | Detail |
|---|---|---|---|---|
| 1 | `pnpm install --no-frozen-lockfile` | 0 | PASS | Lockfile regenerated. |
| 2 | `pnpm run lint` | 0 | PASS | |
| 3 | `pnpm run typecheck` | 0 | PASS | |
| 4 | `pnpm run test` | 1 | **FAIL** | `packages/adapters/src/text-extraction.test.ts`: "extracts text from a real DOCX file" — `outcome.ok` expected `true`, got `false`. 87/88 other adapters tests and all 127 web tests and all 338 services tests still passed. |
| 5 | `pnpm run build` | — | not reached (turbo stopped after the failed test task) | |
| 6 | `pnpm audit --prod` | — | not reached | |

Root cause, confirmed by a standalone repro script (`node` running `mammoth.extractRawText`
directly against the same minimal DOCX the test builds, outside vitest): the unbounded
`">=0.8.15"` override let pnpm resolve `@xmldom/xmldom` to `0.9.12`, not a `0.8.x` patch
release. `0.9.x` made a breaking API change: `DOMParser.parseFromString` now throws
(`TypeError: DOMParser.parseFromString: the provided mimeType "undefined" is not valid.`)
when called without an explicit, valid `mimeType`. `mammoth`'s own internal XML reader
(`mammoth/lib/xml/xmldom.js`) calls `parseFromString` without one, which worked under `0.8.13`
and broke under `0.9.12`. This is a real regression this session introduced and caught itself,
before committing, not a pre-existing defect. See `known-issues.md` item 11.

Fix: bounded the override to `">=0.8.15 <0.9.0"`, keeping resolution within the `0.8.x` line
where the CVE fix (`0.8.15`, the last `0.8.x` release on the registry) actually landed.

## Part 1, run 3 (after bounding the xmldom override — final)

Commit: same working tree, with the bounded override in place.

| # | Command | Exit | Result | Detail |
|---|---|---|---|---|
| 1 | `pnpm install --no-frozen-lockfile` | 0 | PASS | |
| 2 | `pnpm run lint` | 0 | PASS | |
| 3 | `pnpm run typecheck` | 0 | PASS | |
| 4 | `pnpm run test` | 0 | PASS | All packages, including the previously-failing `text-extraction.test.ts` DOCX case. |
| 5 | `pnpm run build` | 0 | PASS | |
| 6 | `pnpm audit --prod` | 0 | **PASS** | "No known vulnerabilities found." |

Resolved versions confirmed in `pnpm-lock.yaml`: `next@15.5.25` (patched range `>=15.5.24`),
`sharp@0.35.4` (patched range `>=0.35.4`), `@xmldom/xmldom@0.8.15` (patched, last `0.8.x`
release). Part 1's baseline verification is complete and green as of this commit.

## Part 2, chunk 2: protected-field encryption (SEC-03) + support-access grants (SEC-06)

Commit: working tree on top of the Part 2 chunk 1 commit, with migration `0028_unknown_sandman.sql`
(additive: `fact_versions` protected-field columns + check constraint, `data_keys`,
`support_grants`), the new `KeyManagementPort` port, `LocalEnvelopeKeyProvider` adapter,
`protected-fields.ts`, `support-access.ts`, and their wiring into `profile.ts`.

| # | Command | Exit | Result | Detail |
|---|---|---|---|---|
| 1 | `pnpm run lint` | 0 | PASS | Biome, including the 4 new/changed source files and the auto-generated migration snapshot. |
| 2 | `pnpm run typecheck` | 0 | PASS | All 7 packages, including the new `Uint8Array \| null` → `Uint8Array \| undefined` narrowing fixes needed for the new nullable bytea columns. |
| 3 | `pnpm run test` | 0 | PASS | 367 tests total (338 pre-existing, unmodified and still green, confirming the new migration and `EditFactInput.encryption` being optional broke nothing; plus 22 new in `protected-fields.test.ts`, 11 new in `support-access.test.ts`, 7 new in `packages/adapters/src/key-management.test.ts`). New coverage includes: encrypt/decrypt round-trip, fresh-nonce-per-write, GCM auth-tag tamper rejection, AAD-mismatch rejection (wrong applicant/record/field/version all independently tested), fail-closed with no port supplied, cross-port isolation (a port that never held the right master key cannot unwrap another port's data key), the `support_grants` max-60-minute and no-self-approval check constraints holding even when a test inserts directly and bypasses the service layer, and the support-admin actor path through the real `authorize()` policy engine (granted actions allowed, ungranted actions denied, expired grants denied, revoked grants immediately excluded). One test bug caught and fixed during this session's own verification, not left in: an in-process key cache made an early version of the cross-port-isolation test pass for the wrong reason (stale same-process cache, not real cross-port rejection); fixed by resetting the cache to simulate a fresh process before that specific assertion. |
| 4 | `pnpm run build` | 0 | PASS | Full monorepo build including `apps/web`. One pre-existing build warning (`unpdf`'s `import.meta` usage, unrelated to this session's changes — traced to `packages/adapters/src/text-extraction.ts`, untouched by this chunk) did not fail the build, as before. |
| 5 | `pnpm audit --prod` | 0 | PASS | "No known vulnerabilities found" — still clean after this chunk's changes (no new dependencies were added; Node's built-in `crypto` module is used for all encryption, not a new package). |

Full detail on what this chunk does and does not cover: `docs/commercial-v1/architecture-decisions.md`
AD-01/AD-02; open items: `docs/commercial-v1/known-issues.md` items 14/15.

## Part 2, chunk 3: organizations.ts test coverage + audit checkpoints (SEC-04)

Commit: working tree on top of `888e344` (Part 2 chunk 2), with migration
`0029_wide_colossus.sql` (additive: `audit_checkpoints` table, append-only RULEs), the new
`audit-checkpoints.ts` service, and `organizations.test.ts`.

| # | Command | Exit | Result | Detail |
|---|---|---|---|---|
| 1 | `pnpm run lint` | 0 | PASS | Biome, 299 files checked, no fixes applied. |
| 2 | `pnpm run typecheck` | 0 | PASS | All 7 packages. |
| 3 | `pnpm run test` | 0 | PASS | 386 tests total across 30 files in `@visastack/services` (367 pre-existing, unmodified and still green; plus 17 new in `organizations.test.ts`, 9 new in `audit-checkpoints.test.ts`), 174.57s. `organizations.test.ts` covers creation, independent step-up-gated review (including refusal of self-verification by an org member), suspension, membership add/deactivate, the last-active-owner rule under genuine concurrency (`Promise.all` racing two owners deactivating each other, never reaching zero active owners), cross-tenant IDOR (a membership ID from a different org refused even for an OWNER/ADMIN of the calling org), and OWNER-vs-ADMIN authority boundaries. `audit-checkpoints.test.ts` covers: refusing to checkpoint an empty chain, signature verification against the correct/wrong secret, tamper detection (chain verification fails after a hash is altered, proven by actually bypassing the `audit_events_no_update` RULE first, see below), sequential checkpoints covering only the new range, checkpoint-with-no-new-events as a no-op, `getLatestAuditCheckpoint`/`listAuditCheckpoints` agreement, `eventsInCheckpointRange` ordering, and the `audit_checkpoints` table's own append-only enforcement at the database level. One test bug caught and fixed during this session's own verification, not left in: the tamper-detection test's first version issued a raw `UPDATE audit_events SET hash = ...` expecting it to take effect, but `audit_events_no_update` (migration 0000, `DO INSTEAD NOTHING`) silently absorbed it, so the hash never actually changed and the test passed for the wrong reason (`verifyCheckpointAgainstChain` returned `true` when re-run standalone, then `false` was expected but not obtained (caught as a genuine failing assertion, not a silent false-pass), because the test's `expect(...).toBe(false)` failed against the unchanged hash). Fixed by having the test explicitly `ALTER TABLE audit_events DISABLE RULE audit_events_no_update` immediately before the tampering write and `ENABLE RULE` immediately after, actually reproducing "a party who bypassed the append-only protection" rather than a no-op. See `known-issues.md` item 17. |
| 4 | `pnpm run build` | 0 | PASS | Full monorepo build including `apps/web`. Same pre-existing `unpdf`/`import.meta` warning as chunk 2, unrelated to this chunk. |
| 5 | `pnpm audit --prod` | 0 | PASS | "No known vulnerabilities found", no new dependencies added. |

Full detail on the checkpoint design: `docs/commercial-v1/architecture-decisions.md` AD-03;
open items: `docs/commercial-v1/known-issues.md` items 16/17.

## Part 3, chunk 1: real malware scanning via ClamAV (SEC-05/EVI-02), upload limit correction (EVI-01)

Commit: working tree on top of `21e3041` (Part 2 complete), with the new
`packages/adapters/src/clamav-scanner.ts` (+ test), the `structuralCheck` extraction from
`scanner.ts`, provider/commercial-readiness/capabilities wiring, the `quotas.ts` 20 MiB
correction, and the CI ClamAV setup step. A real ClamAV 1.5.3 daemon was installed and run in
this session's own sandbox for genuine live verification (not simulated), using a minimal
hand-authored EICAR-only signature since this sandbox's outbound network policy blocks
`database.clamav.net` (confirmed via the agent proxy's own status endpoint).

| # | Command | Exit | Result | Detail |
|---|---|---|---|---|
| 1 | `pnpm run lint` | 0 | PASS | Biome, 301 files checked, no fixes applied. |
| 2 | `pnpm run typecheck` | 0 | PASS | All 7 packages. Caught and fixed 3 real type errors before this run: a possibly-undefined regex capture group in `parseClamdResponse`, an `exactOptionalPropertyTypes` mismatch in `providers.ts`'s `ClamAvScanner` construction (fixed via conditional spread, matching `ai.ts`'s existing pattern), and an index-signature access rule conflict on `process.env.CLAMAV_TEST_SOCKET_PATH` (fixed via a local `readEnv` helper, matching the established codebase pattern). |
| 3 | `pnpm run test` | 0 | PASS | 704 tests total across all 7 packages (i18n 6, core 2, policy 29, db 26 + 1 skipped, adapters 118, web 136, services 386), run with `CLAMAV_TEST_SOCKET_PATH` set to the real local daemon. `clamav-scanner.test.ts`: 23 tests, 0 skipped in this run (2 live-only tests genuinely executed against the real daemon: authentic EICAR detection and clean-file pass-through, plus a raw `node:net` PING/PONG sanity check confirming the socket is genuinely clamd). The rest of that file exercises a fake wire-protocol-compatible server covering detection, threat naming, PDF now reaching the real-scanner path (ADR-0012 follow-up), structural-gate short-circuiting for executables, fail-closed behavior on an unrecognized response/connection reset/timeout/unreachable socket, `probeClamdVersion` (real reply when enabled, `undefined` not a guess when disabled or unreachable), and `checkSignatureFreshness` against a real filesystem (fresh `.cvd`, stale `.cld`, missing directory, no-official-database-present). `route.test.ts`, `providers.test.ts`, `capabilities.test.ts`, `commercial-readiness.test.ts` updated: `MALWARE_SCANNER_PROVIDER=clamav` is now a supported value everywhere it was previously used as the "unsupported provider" example, with new tests covering the genuinely-supported path instead. `quotas.test.ts` updated for the 20 MiB default. Two real bugs caught by this session's own testing before committing, not left in: (a) two tests declaring the EICAR fixture as `application/octet-stream` were rejected by the structural gate before ever reaching the scanner, passing for the wrong reason; (b) Turborepo silently dropped `CLAMAV_TEST_SOCKET_PATH` when run via `pnpm run test` (`turbo run test`) because it was not declared in `turbo.json`, which would have made the live tests skip forever in CI without ever surfacing as a failure. Both detailed in `known-issues.md` items 21/22. |
| 4 | `pnpm run build` | 0 | PASS | Full monorepo build including `apps/web`. Same pre-existing `unpdf`/`import.meta` warning as prior chunks, unrelated to this one. |
| 5 | `pnpm audit --prod` | 0 | PASS | "No known vulnerabilities found", no new dependencies added (Node's built-in `net`/`fs` modules only, no new package for the ClamAV client). |

CI verification: the exact `.github/workflows/ci.yml` ClamAV setup script was extracted and
run end-to-end in this sandbox (not just read for plausibility) before committing, including
deliberately reproducing the real conditions CI will face differently (this sandbox's
network-blocked `freshclam`, exercising the EICAR-fallback branch; GitHub-hosted runners are
expected to reach `database.clamav.net` successfully, which this session cannot itself
confirm). Caught and fixed a real bug in that script this way (item 21(a) above) that reading
the script alone would not have surfaced, since `apt-get update`'s partial failure on this
sandbox's unrelated pre-installed third-party APT sources is not an obviously-wrong line of
YAML on inspection.

Full detail: `docs/commercial-v1/architecture-decisions.md` AD-04; open items:
`docs/commercial-v1/known-issues.md` items 18-22 (the 60-second delivery-token/live-
revocation-recheck gap and the missing safe-preview rendering are the two highest-priority
items carried into the next Part 3 chunk).

## Part 3, chunk 2: redemption-time access recheck for binary delivery (EVI-06/SEC-05)

Commit: working tree on top of `99ccd9d` (Part 3 chunk 1), with the new
`packages/services/src/document-access-token.ts` (+ test), `recheckDocumentAccess` in
`documents.ts`, the `DEFAULT_ACCESS_TTL_SECONDS` correction, and `/api/blob/[key]/route.ts`'s
new second-token verification and live recheck.

| # | Command | Exit | Result | Detail |
|---|---|---|---|---|
| 1 | `pnpm run lint` | 0 | PASS | Biome, 303 files checked, no fixes applied. |
| 2 | `pnpm run typecheck` | 0 | PASS | All 7 packages. Fixed a real design bug caught by typecheck itself along the way: an `as const` conditional-spread pattern produced a `readonly` tuple type incompatible with a mutable `Array<[string, string]>`, resolved by building the array with plain `.push()` instead. |
| 3 | `pnpm run test` | 0 | PASS | 731 tests total across all 7 packages (i18n 6, core 2, policy 29, db 26 + 1 skipped, adapters 118, web 136, services 413), run with `CLAMAV_TEST_SOCKET_PATH` set (live ClamAV verification from chunk 1 still genuinely exercised, not just carried by cache). `document-access-token.test.ts`: 16 new tests, pure unit tests of sign/verify/append/read with no database, including a tamper test for every individual field (exp, action, documentId, purpose, stepUpSatisfied) and a dedicated round-trip test for a purpose containing `&`, `=`, a space, and CJK characters, specifically to catch the double-encoding bug described below. `documents.test.ts`'s new `recheckDocumentAccess` describe block: 11 new integration tests against real PGlite Postgres semantics, covering: TTL is genuinely 60 seconds now; an owner's redemption succeeds immediately after mint; an owner's redemption fails once the version is marked unsafe between mint and redemption; redemption fails once the document itself is deleted; an organization member's redemption succeeds with a real, live-fetched active membership and active grant; redemption fails once that grant is revoked (`A08`'s named property, "revoked grant kills token"); redemption fails once the membership is deactivated even with the grant untouched; a direct individual recipient's redemption fails once their grant is revoked; a `support_admin` actor is denied identically at mint and at redemption (documenting the newly-found `support_grants`-not-loaded gap, `known-issues.md` item 23, rather than papering over it with a passing-for-the-wrong-reason test); an unknown documentId is denied; a malformed organization_member context (missing organizationId) is denied. One real design bug caught and fixed during this session's own testing, not left in: the first version of `document-access-token.ts` packed every field into one dot-delimited string, `encodeURIComponent`-escaping the purpose field once explicitly and then the whole packed string again via a blanket per-field encode, so a purpose containing any special character came back corrupted on decode and failed signature verification; caught by the round-trip test above, fixed by switching to `blob-token.ts`'s own already-correct per-query-parameter convention instead of inventing a new packed format. A second, smaller bug (a wrong assumption that mint-time `authorize()` independently re-verifies a caller-supplied `membership.active` claim against the database) was caught while drafting a test for it, before that incorrect test was ever committed; the actual, verified property is that mint-time trusts the caller-constructed `Actor` as given, which is precisely why the redemption-time recheck in this chunk (re-deriving membership fresh, never replaying the actor) is a real, not redundant, addition. |
| 4 | `pnpm run build` | 0 | PASS | Full monorepo build including `apps/web`. Same pre-existing `unpdf`/`import.meta` warning as prior chunks, unrelated to this one. |
| 5 | `pnpm audit --prod` | 0 | PASS | "No known vulnerabilities found", no new dependencies added (Node's built-in `crypto` module only, matching `blob-token.ts`'s and `step-up.ts`'s existing pattern). |

Full detail: `docs/commercial-v1/architecture-decisions.md` AD-05; open items:
`docs/commercial-v1/known-issues.md` item 19 (safe preview rendering, now the single
highest-priority remaining Part 3 item) and item 23 (support_admin document access wiring).
