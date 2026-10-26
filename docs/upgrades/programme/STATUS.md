# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 26 October 2026, afternoon: per-case sharing exceptions and visible reference codes merged, migrated and live
- Current main SHA: `dc420be` (#279, WP-REF visible reference codes)
- Branch: none open for Programme X work; `claude/prog-v4-case-exclusions` is merged (#278) and can be deleted
- Current package: WP-V4. Next: Prepare Again (create a case from a previous one and ask each all-cases recipient in the same transaction), then request screens and colour polish to close WP-V4, then WP-V5 and WP-V6
- Packages merged: #230 to #242 (WP-A0 to WP-X3), WP-V3 parts 1 to 3 (#248, #261, #265), WP-V4 agency slice (#263), Home slice (#275), calendar export (#276), per-case sharing exceptions (#278), WP-REF reference codes (#279)
- Migrations: 0090 and 0091 run right after their merges (owner pre-approval); 92 applied on Neon; `grant_case_exclusions` present; every person, case and document has a valid code (22 checked against the app's rule)
- Older owner PRs untouched: #177 (open sign-up), #77
- Parked by the owner: payments, real redaction. Deferred: Bangla
- Owner decisions: `docs/SESSION-START.md` section 6 (no new decisions this session)
- Checks: #278 had a code review, a security review and a security re-review (all confirmed findings fixed, 13 mutations red), a full local check (web 2,034, services 1,723, browser 202, smoke 11) and green CI on 4bb1fe3; post-merge CI, Deploy Smoke, Playwright Deploy Smoke and the Live signed-in check passed; readiness ready. #279 had a strict and security review (one Medium and seven Low fixed, 14 mutations red), a full local check (core 135, db 39, services 1,737, web 2,062, browser 202, smoke 11), a CodeQL fix with a regression test, and green CI including CodeQL on 624b86b; post-merge CI, Deploy Smoke, Playwright Deploy Smoke and the Live signed-in check (one re-run: the first timed out downloading the test browser before any test ran) passed; readiness ready. Not verified: the signed-in look of the new Sharing lines and code chips on the live site
- Blockers: none
- Stop reason: both session goals done (token discipline: start Prepare Again in a fresh session)
- Next action: read `SESSION-HANDOFF-2026-10-26-afternoon.md`, then build Prepare Again

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
