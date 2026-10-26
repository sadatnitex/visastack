# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 26 October 2026, WP-V4 per-case sharing exceptions built locally
- Current main SHA: `309625c` (#275, Needs Attention and the reordered Home)
- Branch: `claude/prog-v4-case-exclusions` from main `309625c`, local commits only (not pushed, no PR yet)
- Current package: WP-V4 per-case sharing exceptions (ADR 0017, owner approval 26 Oct 2026): table `grant_case_exclusions`, migration 0090 written and not run (pre-approved to run right after the merge); one case-scope rule in policy and SQL; the questions, answers and Allow This Case services; the Sharing page and Application Memory show exceptions. Prepare Again itself is the next WP-V4 PR. Then calendar export, the rest of WP-V4, WP-V5, WP-V6
- Packages merged: #230 to #242 (WP-A0 to WP-X3), WP-V3 parts 1 to 3 (#248, #261, #265), WP-V4 agency slice (#263), WP-V4 Home (#275)
- Also merged 25 and 26 Oct: #259, #260 (0087 run), #262, #264, #266 to #272 (0088 and 0089 run; 90 migrations applied), #274 docs
- In flight outside the programme: #177 (open sign-up) and #77 are older owner PRs, untouched
- Parked by the owner: payments, real redaction. Do not start them
- Owner decisions 26 Oct: ask each time a case is made with Prepare Again, no answer means no, pending all-cases invitations bound, fresh sign-in on Allow This Case only when the sharing needed one (ledger D17)
- Checks on this branch: targeted policy, services (12 files, 218 passed, ratchet baseline unchanged), db and web tests passed; pnpm run lint and pnpm run typecheck exit 0; guards proved to fail. Full suite, build, browser checks, /code-review, /security-review and CI not run yet
- Review rule (owner, 25 Oct 2026): independent Opus review before every merge; CodeQL no new alerts
- Blockers: none in the files list. Outside it and reported: backup reconciliation does not replay exceptions after a restore; account export omits them; the case page Self-reviewed note counts an excluded organization
- Stop reason, if stopped: none
- Next action: full local check, /code-review max and /security-review on `claude/prog-v4-case-exclusions`, then a draft PR for the owner's merge word and the 0090 run; then Prepare Again

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
