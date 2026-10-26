# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 26 October 2026, WP-V4 Home slice (U03) built locally
- Current main SHA: `a6b5523` (#272, AI provider data terms)
- Branch: `claude/prog-v4-home` from main `067df45`, local commits only (not pushed, no PR yet)
- Current package: WP-V4 Home parts (U03). Built: owner-only Needs Attention projection and ranking (`packages/services/src/attention.ts`, ADR 0016), Home recomposed per B13 (next step, Needs Attention, My Records, Active Requests and Work, My Next Journey, permissions). Calendar export is a separate later PR. Then the rest of WP-V4, WP-V5 and WP-V6
- Packages merged: #230 to #242 (WP-A0 to WP-X3), WP-V3 parts 1 to 3 (#248, #261, #265), WP-V4 agency slice (#263)
- Also merged 25 and 26 Oct: #259, #260 (migration 0087 run), #262, #264, #266, #267 account menu, #268 AI naming, #269 profile photos (0088 run), #270 status page AI state, #271 visa photo sizes, #272 AI data terms (0089 run; 90 migrations applied)
- In flight outside the programme: nothing open from this session; #177 (open sign-up) and #77 are older owner PRs, untouched
- Parked by the owner: payments, real redaction. Do not start them
- Owner decisions 25 Oct: see the evening handoff; free AI tiers are never blocked until the owner says so (the training guard is built and off)
- Checks: merged PRs had a full local check and green CI on their final heads. WP-V4 Home slice: targeted tests, lint and typecheck passed locally; full suite, build, browser checks, reviews and CI not run yet
- Review rule (owner, 25 Oct 2026): independent Opus review before every merge; CodeQL no new alerts
- Blockers: none. Renovate is installed by the owner but no Dependency Dashboard issue or Renovate PR has appeared; the owner should check the app has access to this repository
- Stop reason, if stopped: none
- Next action: full local check, /code-review and /security-review on `claude/prog-v4-home`, then a draft PR for the owner's merge word; then the calendar export PR; roadmap step 5 (signed step-up proof) once Programme X files are free

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
