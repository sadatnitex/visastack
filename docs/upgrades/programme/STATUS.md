# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, access gate merged (#257, `26f226d`); WP-V3 part 2 under final checks
- Current main SHA: `26f226d` (#257)
- Branch: `claude/prog-v3-tabs`, from `e52adb4`, main merged in
- Current package: WP-V3 in three reviewed parts: (1) first run, merged (#248); (2) four-tab shell and Record hub, this branch; (3) Application Memory and the prior-versus-current view, next
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237), WP-V1 (#238), WP-V2 (#239), WP-X1 (#240), WP-X2 (#241), WP-X3 (#242), WP-V3 part 1 (#248)
- Also merged today: production-only deploys (#247), Sliced V (#249), tax basis (#250), Title Case (#251), documents behind details (#252), schema drift guard (#253), AI review Phase 1 (#254), sign-in once per page (#255), WP-V4 W0 ledger (#256), access gate (#257)
- Owner decisions: D1 to D16, CR13, CR14; 25 Oct: medical, identity and financial documents restricted; restrictions to become admin switches (in progress); proto-session database branch deleted
- Pending owner answers: WP-V4 Q1 to Q5 (ledger); production migration go-ahead for the document protection switches
- Files touched (part 2): workspace-navigation.ts and test, app-nav.tsx, applicant layout, record/ page and tests, record-hub.ts, record-browser.tsx, record-sections.tsx, sharing page and grant form (one-document preselect), globals.css (WP-V3 part 2 block), V3-PART2-LINKS.md, known-issues
- Checks on the head: lint, typecheck, build pass; one wording-check failure fixed and re-run green; full local run and CI not yet re-run on this head. Independent review: no blocker, ten should-fix and nit items fixed, re-review verdict merge. Design fidelity check against the mockup mapping docs in progress
- Review rule (owner, 25 Oct 2026): independent Opus review before every merge; CodeQL no new alerts; dependency review passes
- Blockers: none. Live domain unreachable from the container; post-merge live evidence comes from Deploy Smoke and the Live signed-in check
- Stop reason, if stopped: none
- Next action: finish design fidelity fixes, full local run, merge part 2; then part 3

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
