# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-C1 verified locally, stacked on WP-B1 (#235)
- Current main SHA: `6c420bc` (#234, Harbor landing)
- Branch: `claude/prog-c1-colour`, on top of `claude/prog-b1-brand` until #235 merges
- Current package: WP-C1 colour layer (after WP-B1 #235 merges)
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234)
- Owner decisions: D1 to D16, CR13 and CR14 approved. D3 applied in the shared header (allowlist note). Still pending: revised first-run preview (before WP-V3), derived tints and dark-surface colours (before WP-C1)
- Completed ledger ids: as before plus CL01-CL14 verified with file and symbol, X01, X08 and X13 after values (local-lab)
- Files touched (WP-C1): `globals.css` (tokens, tints, literals, dead old-landing classes), `layout.tsx` (`themeColor`), `agency-brand.ts` and its test (ink), `palette-contrast.test.ts` (new), `ux-public.spec.ts` (workspace background pin), `ui-ratchet.baseline.json` (lowered), `colour-map.md` (new)
- Checks on the WP-C1 head: audit exit 0, lint, typecheck, web unit tests and build pass; Playwright matches main (five sign-in checks need Neon Auth here); axe 0 serious or critical on 14 workspace screens; visible layout identical on 23 of 24 screens (the other is a live label). CI is the authority on the pushed head
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge #235, rebase WP-C1 on main, push, merge on green; then WP-P0 WorkOS retirement brief

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
