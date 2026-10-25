# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-V3 part 3 going to merge
- Current main SHA: `d6f1ad0` (#263, WP-V4 agency slice)
- Branch: `claude/prog-v3-memory`, main merged in
- Current package: WP-V3 part 3, Application Memory and the then-and-now view (v1.2 U06, B08, E03): the changed-case alert lists what changed by name with Compare links; Application Memory page per traveller; Then and Now page for one detail with sensitive values and their notes hidden
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237), WP-V1 (#238), WP-V2 (#239), WP-X1 (#240), WP-X2 (#241), WP-X3 (#242), WP-V3 part 1 (#248), WP-V3 part 2 (#261), WP-V4 agency slice (#263)
- Also merged 25 Oct: #259 AI review polish, #260 document protection switches (migration 0087 run), #262 AI insights, #264 Title Case and form fields
- In flight outside the programme: account menu, AI naming and sorting, profile photos (migration 0088 waits for the owner), visa photo sizes, status page AI state and the redacted copy label, AI provider data terms and compliance review
- Parked by the owner: payments, real redaction
- Owner decisions 25 Oct: Record hub answers; insights safer default; AI suggestion on request; AI may suggest any kind with a warning; free AI tiers allowed until the owner says otherwise
- Checks on this branch: full local check (audit, lint, typecheck, build, 202 browser checks, smoke 11/11); after the last fix all 1818 web tests pass; one services-side health test timed out at 15 s under heavy machine load and passes alone; CI pending
- Review rule (owner, 25 Oct 2026): independent Opus review before every merge; CodeQL no new alerts
- Blockers: none
- Stop reason, if stopped: none
- Next action: merge part 3; then WP-V4 Home parts (U03) and the rest of WP-V4

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
