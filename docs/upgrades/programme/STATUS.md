# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 24 October 2026, end of WP-A0
- Current main SHA: `84cc84ef18b3486c09c6537c25ecaed51539d499` (unchanged since planning; main CI run 644 green)
- Branch: `claude/prog-a0-audit` (draft PR, not merged)
- Current package: WP-A0 done, waiting for the owner
- Packages merged with the owner's word: none
- Owner decisions: D1 to D11 approved 24 October 2026. Still pending: revised first-run preview (before WP-V3), derived tints and dark-surface colours (before WP-C1), the landing preview in `previews/landing/` (before WP-L1 merge), all 12 draft allowlists, CR13 and CR14
- Completed ledger ids: X01-X14 baselines (some "not measured", with reason), U01-U10, E01-E04, W0-01 to W0-10, CR13, CR14 added; T and R rows list related existing tests
- Files touched: 82, all under `docs/design/harbor-v2/`, `docs/upgrades/` and `scripts/programme/`. Nothing under `apps/`, `packages/`, `infra/` or `.github/`
- Checks on this branch: typecheck pass; web Vitest pass (142 files); `pnpm run test` fail (3 tests in `apps/web/src/lib/ai.test.ts` timed out at 15 s in the parallel turbo run; they passed in the standalone web run; no code changed here); `pnpm run lint` fail on 9 Harbor files only (CR14), the other lint guards pass; web build pass; `pnpm audit --prod --audit-level high` fail: 1 critical, 3 high, new since main last ran CI (Next.js 15.5.25, fixed in 15.5.28; zod; undici); lockfile unchanged here; guard test 7 of 7 pass; guard proven to fail on a file outside the allowlist; `check-allowed-paths.mjs WP-A0.txt` paths OK (82 files), `--no-emdash` fails on 59 Harbor lines only (CR13)
- Blockers: URGENT, outside this package: the Next.js advisory covers the locked version (deployed version not verified) and needs its own bounded upgrade PR on a branch the owner names. CR13 (Harbor long dashes) and CR14 (Harbor format) need the owner's decision; until then the required lint check fails on this branch. Known-issues chunk not written because that file is outside the WP-A0 allowlist
- Stop reason, if stopped: conflicts CR13 and CR14 are outside the conflict register
- Next action: owner approves the Next.js security PR, decides CR13 and CR14, approves the allowlists and the landing preview, approves the CLAUDE.md lines; then WP-L1 on `claude/prog-l1-landing`

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
