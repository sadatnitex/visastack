# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 24 October 2026, WP-A0 after the owner's decisions
- Current main SHA: `84cc84ef18b3486c09c6537c25ecaed51539d499` (main CI run 644 green on 15 Oct, before the new advisories)
- Branch: `claude/prog-a0-audit` (draft PR #230), rebased on `claude/prog-sec-next-15-5-28` (draft security PR, Next.js 15.5.28)
- Current package: WP-A0, waiting for the owner's review and merge word. The security PR merges first
- Packages merged with the owner's word: none
- Owner decisions: D1 to D16, CR13 and CR14 approved 24 Oct 2026; allowlists approved (WP-P0 list follows its brief). Still pending: landing preview approval (after review of #230), revised first-run preview (before WP-V3), derived tints and dark-surface colours (before WP-C1)
- Completed ledger ids: X01-X14 baselines (local-lab, D16), U01-U10, E01-E04, W0-01 to W0-10, CR13, CR14, D12-D16
- Files touched: under `docs/design/harbor-v2/`, `docs/upgrades/`, `scripts/programme/`, plus `biome.json` (one ignore entry), `CLAUDE.md` (approved lines) and `docs/commercial-v1/known-issues.md` (appended). Nothing under `apps/`, `packages/`, `infra/` or `.github/`
- Checks: see the PR for exact results on the pushed head. Guard tests 11 of 11 pass; guard paths and `--no-emdash --exclude docs/design/harbor-v2` checked against the security branch base; Biome passes on the whole repo
- Blockers: the required check `Lint · Build · Typecheck · Test` also runs `pnpm audit --prod --audit-level high`. After the Next.js upgrade, high advisories remain for zod (via `@neondatabase/auth`) and undici (via `@vercel/blob`). The owner limited the security PR to Next.js, so this needs the owner's decision. Three AI-settings test timeouts: waiting for CI on a pushed head; if CI also fails, propose a separate PR with explicit timeouts. Master Profile files on hold (D14)
- Stop reason, if stopped: none
- Next action: owner decides the zod and undici fix, gives the merge word for the security PR, reviews #230 and approves the landing preview; then WP-L1 on `claude/prog-l1-landing`

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
