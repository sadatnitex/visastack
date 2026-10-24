# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 24 October 2026, WP-L1 merged (#234, `6c420bc`); WP-B1 brand assets ready to merge
- Current main SHA: `6c420bc` (#234, Harbor landing)
- Branch: `claude/prog-b1-brand`, rebased on `6c420bc`
- Current package: WP-B1 (owner request: brand assets from the VisaStack design system), then WP-C1
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234)
- Owner decisions: D1 to D16, CR13 and CR14 approved. D3 applied in the shared header (allowlist note). Still pending: revised first-run preview (before WP-V3), derived tints and dark-surface colours (before WP-C1)
- Completed ledger ids: as before plus CL01-CL14 verified with file and symbol, X01, X08 and X13 after values (local-lab)
- Files touched: `page.tsx`, `page.test.tsx`, `landing-c1.css` (new), `layout.tsx` (D3 header links), `hero-example` and its test (removed), `plain-language.test.ts`, `ux-public.spec.ts`, `flat-ui-support.ts` (capture wait), `check-flat-design` and its test (exact-path exception, D1), programme docs, known-issues
- Checks on the code head: lint, typecheck, full unit tests and the web suite pass; build passes; audit exit 0; Playwright: every landing check passes, axe clean on five public pages at 1440 and 390; the only failures are the five sign-in checks that need Neon Auth and fail the same way on main in this container; smoke 9 of 11 with the same two sign-in checks. CI is the authority on the pushed head
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-L1, verify live, then WP-B1 brand assets (owner request 24 Oct: logo, favicon set, app icons, share image from the VisaStack design system), then WP-C1 colours (needs the derived tints decision; proceeding under the autonomous mandate with the Harbor values and reporting them)

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
