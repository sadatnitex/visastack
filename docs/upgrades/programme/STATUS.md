# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 26 October 2026, WP-V4 calendar export (U03) built locally
- Current main SHA: `309625c` (#275, Needs Attention and the reordered Home)
- Branch: `claude/prog-v4-calendar` from main `309625c`, local commits only (not pushed, no PR yet)
- Current package: WP-V4 calendar export (U03, last part): owner-only `listCalendarDates`, a multi-event calendar file, a choose, preview and download page, links from Home and Expiry (ADR 0016). Then the rest of WP-V4, WP-V5, WP-V6
- Packages merged: #230 to #242 (WP-A0 to WP-X3), WP-V3 parts 1 to 3 (#248, #261, #265), WP-V4 agency slice (#263), WP-V4 Home slice (#275)
- Also merged 25 and 26 Oct: #259, #260 (0087 run), #262, #264, #266 to #268, #269 (0088 run), #270, #271, #272 (0089 run; 90 migrations applied), #273, #274
- In flight outside the programme: #177 (open sign-up) and #77 are older owner PRs, untouched
- Parked by the owner: payments, real redaction. Do not start them
- Owner decisions 25 Oct: see the evening handoff; free AI tiers are never blocked until the owner says so (the training guard is built and off)
- Checks: merged PRs had a full local check and green CI on their final heads. Calendar branch (local head 3aec763): targeted services tests 23 passed with the ratchet baseline unchanged, targeted web tests 80 files 1122 passed, lint and typecheck exit 0, new guards proved to fail; full suite, build, browser checks, /code-review, /security-review and CI not run yet
- Review rule (owner, 25 Oct 2026): independent Opus review before every merge; CodeQL no new alerts
- Blockers: none. Renovate is installed by the owner but no Dependency Dashboard issue or Renovate PR has appeared; the owner should check the app has access to this repository
- Stop reason: none
- Next action: full local check, /code-review (max: personal data leaves the product in a file) and /security-review on `claude/prog-v4-calendar`, then a draft PR for the owner's merge word; import one file into Google, Apple and Outlook once; roadmap step 5 (signed step-up proof) once Programme X files are free

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
