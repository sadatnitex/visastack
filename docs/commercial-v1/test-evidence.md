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
