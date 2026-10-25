# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-C1 merged (#236, `408c293`); WP-P0 ready to merge
- Current main SHA: `408c293` (#236, Harbor colour layer)
- Branch: `claude/prog-p0-workos`, rebased on `408c293`
- Current package: WP-P0 WorkOS retirement (brief approved under the autonomous mandate)
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236)
- Owner decisions: D1 to D16, CR13 and CR14 approved. D3 applied in the shared header (allowlist note). Still pending: revised first-run preview (before WP-V3), derived tints and dark-surface colours (before WP-C1)
- Completed ledger ids: as before plus CL01-CL14 verified with file and symbol, X01, X08 and X13 after values (local-lab)
- Files touched (WP-P0): 63 code and test files under `apps/web`, `.env.example`, `apps/web/package.json` and `pnpm-lock.yaml` (WorkOS removed), plus the brief and allowlist; list in `allowlists/WP-P0.txt`
- Checks on the WP-P0 code (before rebase): audit exit 0, lint, typecheck, full unit tests and web suite (1473) pass, build passes; Playwright 4 failures, all part of main's sign-in baseline here (one fewer than main); re-verified after the rebase on `408c293`. CI is the authority on the pushed head
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-P0, verify sign-in live; then WP-V1 invitation identity

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
