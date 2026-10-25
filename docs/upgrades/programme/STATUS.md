# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-V2 merged (#239, `c53d95f`); WP-X1 ready for CI
- Current main SHA: `c53d95f` (#239, dates, change impact and consistency foundation)
- Branch: `claude/prog-x1-case`, rebased on `c53d95f`
- Current package: WP-X1 case journey view
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237), WP-V1 (#238), WP-V2 (#239)
- Owner decisions: D1 to D16, CR13 and CR14 approved. Pending: revised first-run preview (before WP-V3); email-only client invitations; a before or after tax detail for amounts (catalogue, D14); hiding the what-can-happen-next sentence on phones (WP-X1, reversible)
- Completed ledger ids: as before plus X02, X04 and X06 after values for the case page
- Files touched (WP-X1): case `page.tsx`, its new `page.test.tsx` (characterization first, then the new behaviour), `mission-buttons.tsx` (snapshot button label, style and alignment props; allowlist line added under the autonomous mandate), `globals.css` (WP-X1 block), ledger, this file, known-issues
- Checks on the WP-X1 head: audit exit 0, lint, typecheck, full tests, web suite and build pass; Playwright matches the sign-in baseline here. Independent review: two passes, nothing blocking left
- Review rule (owner, 25 Oct 2026): before every merge an independent Opus review agent reads the diff; its findings are fixed or answered first. CodeQL must show no new alerts; dependency review is enabled
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-X1 on green; then WP-X2

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
