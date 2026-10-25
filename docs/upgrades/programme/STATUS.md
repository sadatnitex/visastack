# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-V3 part 2 approved by the owner and going to merge
- Current main SHA: `ef6fbaf` (#260, document protection switches; production migration 0087 run and verified, 88 applied)
- Branch: `claude/prog-v3-tabs`, main merged in at `67cefec`
- Current package: WP-V3 in three reviewed parts: (1) first run, merged (#248); (2) four-tab shell and Record hub, this branch, owner approved the preview with three changes (travel documents beside the Passport details, Update Details on every profile section, a document with no kind needs a check); (3) Application Memory and prior versus current, built on `claude/prog-v3-memory`, independent review in progress
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237), WP-V1 (#238), WP-V2 (#239), WP-X1 (#240), WP-X2 (#241), WP-X3 (#242), WP-V3 part 1 (#248)
- Also merged on 25 Oct: #247, #249 to #257, AI review polish (#259), document protection switches (#260)
- In flight: WP-V4 agency slice (`claude/prog-v4-agency`, built, review in progress); AI data plan Phase 2 insights (`claude/ai-insights-phase2`, review fixes in progress); AI naming and sorting with owner approval (next package, owner request 25 Oct)
- Owner decisions 25 Oct: restricted documents and admin switches; reason required to remove protection; Record hub answers above; insights keep the safer default (restricted documents named by kind and section only); WP-V4 Q1 to Q5 option A
- Full local check on `4db3716` (before the main merge): audit, lint, typecheck, all package tests, web tests, build, 202 browser checks and smoke 11/11 pass; after the main merge lint and typecheck pass; CI pending
- Review rule (owner, 25 Oct 2026): independent Opus review before every merge
- Blockers: none. Live domain unreachable from the container; live evidence comes from Deploy Smoke, Playwright Deploy Smoke and the Live signed-in check
- Stop reason, if stopped: none
- Next action: merge part 2 on green CI; then review, check and merge part 3, the V4 agency slice and the insights page one at a time

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
