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
