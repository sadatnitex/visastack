# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-X3 merged (#242, `3acfba9`); WP-V3 part 1 ready for CI
- Current main SHA: `3acfba9` (#242, phone context chip)
- Branch: `claude/prog-v3-record`, from `3acfba9`
- Current package: WP-V3, in three reviewed parts: (1) task-first first run, this PR; (2) four-tab shell; (3) Application Memory and the prior-versus-current view with the changed-fields list in the WP-X1 alert
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237), WP-V1 (#238), WP-V2 (#239), WP-X1 (#240), WP-X2 (#241), WP-X3 (#242)
- Owner decisions: D1 to D16, CR13 and CR14 approved; 25 Oct 2026 approved the case reminder line, the download sentence, email-only client invitations, a before or after tax detail, a live signed-in check, and the revised first-run screen 3. None pending for WP-V3
- Owner-approved extras in flight: live signed-in check (#244), email-only client invitations (#245), before or after tax for income amounts (branch `claude/prog-tax-basis`)
- Completed ledger ids: X03 after value (two setup screens, unit level); E01 and R01 extended
- Files touched (WP-V3 part 1): `page.tsx`, `page.test.tsx` (new, characterization first), `first-run.tsx` and its test (new), `add-applicant-form.tsx`, `consent-button.tsx`, `globals.css` (WP-V3 block), ledger, this file, known-issues
- Checks on the head: the page, first-run, consent button, form behaviour and form accessibility tests (299) and the web typecheck pass; full local run before push. Independent review: one blocker and four should-fix points, all fixed
- Review rule (owner, 25 Oct 2026): before every merge an independent Opus review agent reads the diff; its findings are fixed or answered first. CodeQL must show no new alerts; dependency review must pass
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-V3 part 1 on green; then part 2, the four-tab shell

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
