# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 24 October 2026, WP-L1 merged (#234, `6c420bc`); WP-B1 brand assets ready to merge
- Current main SHA: `6c420bc` (#234, Harbor landing)
- Branch: `claude/prog-b1-brand`, rebased on `6c420bc`
- Current package: WP-B1 (owner requests: brand assets from the VisaStack design system; shorter version banner on phones), then WP-C1
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234)
- Owner decisions: D1 to D16, CR13 and CR14 approved. D3 applied in the shared header (allowlist note). Still pending: revised first-run preview (before WP-V3), derived tints and dark-surface colours (before WP-C1)
- Completed ledger ids: as before plus CL01-CL14 verified with file and symbol, X01, X08 and X13 after values (local-lab)
- Files touched (WP-B1): `components/brand-mark.tsx` and its test (new, inline mark used in `layout.tsx`, `auth-ui.tsx`, `app-nav.tsx`, `workspace-record-toolbar.tsx`), `public/icons/*` (new), `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`, `app/opengraph-image.png`, `app/twitter-image.png` and their alt texts, `app/manifest.ts` (new), `globals.css` (`.brand-mark` rules only), `browser-security.spec.ts` (brand checks), programme docs, known-issues
- Checks on the WP-B1 code head: audit exit 0; lint, typecheck (after the tuple fix), full unit tests, web suite and build pass; Playwright 189 pass including both new brand checks, the five failures are the sign-in checks that need Neon Auth and fail the same way on main here; smoke 9 of 11 with the same two. WP-L1 CI was green on `47ab7e2` before merge. CI is the authority on the pushed head
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-B1, verify live, then WP-C1 colours (derived tints and dark-surface colours proceed under the autonomous mandate with Harbor values, reported in the PR)

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
