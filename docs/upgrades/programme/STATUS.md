# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-X2 merged (#241, `c00259e`); WP-X3 ready for CI
- Current main SHA: `c00259e` (#241, grant review brief)
- Branch: `claude/prog-x3-chip`, rebased on `c00259e`
- Current package: WP-X3 phone context chip and navigation
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237), WP-V1 (#238), WP-V2 (#239), WP-X1 (#240), WP-X2 (#241)
- Owner decisions: D1 to D16, CR13 and CR14 approved; 25 Oct 2026 approved the case reminder line (WP-X1), the download sentence (WP-X2), email-only client invitations, a before or after tax detail for amounts, and a live signed-in check with a dedicated test account. Pending: revised first-run preview (before WP-V3)
- Completed ledger ids: as before; X06 after value extended to the phone top bar, X08 unit-level evidence for the chip
- Files touched (WP-X3): `workspace-shell.tsx`, `workspace-record-toolbar.tsx`, `globals.css` (WP-X3 block), `app-nav.test.tsx` (new), ledger, this file, known-issues
- Checks on the WP-X3 head: lint, web typecheck and the chip and navigation tests (10) pass; Chromium measurements at 320, 360 and 390 recorded in X06; full local run before push. Independent review: two passes, all findings fixed, nothing blocking
- Review rule (owner, 25 Oct 2026): before every merge an independent Opus review agent reads the diff; its findings are fixed or answered first. CodeQL must show no new alerts; dependency review must pass
- Queued after WP-X3, owner approved: the live signed-in check (written and reviewed), email-only client invitations (written, tests pending), the tax basis detail (catalogue additions through `CATALOGUE-GUIDE.md`; `profile-fields.ts` stays frozen), then WP-V3, V4, V5, V6
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-X3 on green; then the live signed-in check

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
