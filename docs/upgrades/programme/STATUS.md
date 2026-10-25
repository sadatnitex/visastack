# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-X1 merged (#240, `6a72e64`); WP-X2 ready for CI
- Current main SHA: `6a72e64` (#240, case journey view)
- Branch: `claude/prog-x2-brief`, rebased on `6a72e64`
- Current package: WP-X2 grant review brief
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237), WP-V1 (#238), WP-V2 (#239), WP-X1 (#240)
- Owner decisions: D1 to D16, CR13 and CR14 approved; 25 Oct 2026 approved the case reminder line (WP-X1) and the download sentence (WP-X2). Pending: revised first-run preview (before WP-V3); email-only client invitations; a before or after tax detail for amounts (catalogue, D14); hiding the what-can-happen-next sentence on phones (WP-X1, reversible)
- Completed ledger ids: as before plus X05 after value; X02 and X04 extended to the sharing screen
- Files touched (WP-X2): `selected-scope-summary.tsx` and its test (new), `grant-form.tsx`, `page.tsx` and their tests (additions only; existing tests unchanged), `globals.css` (WP-X2 block), ledger, this file, known-issues
- Checks on the WP-X2 head: lint, typecheck, sharing and summary tests (40) pass; full local run before push. Independent review: three passes, all findings fixed, nothing blocking. Owner decision 25 Oct 2026: download wording only with Preview
- Review rule (owner, 25 Oct 2026): before every merge an independent Opus review agent reads the diff; its findings are fixed or answered first. CodeQL must show no new alerts; dependency review is enabled
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-X2 on green; then WP-X3

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
