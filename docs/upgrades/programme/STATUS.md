# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 26 October 2026, end of session: calendar export merged, case exceptions handed over
- Current main SHA: `77084ed` (#276, WP-V4 calendar export)
- Branch: `claude/prog-v4-case-exclusions` (pushed, no PR): per-case sharing exceptions with migration 0090; last commit is a WIP of review fixes, unverified
- Current package: WP-V4 per-case sharing exceptions. Remaining fixes listed in `WP-V4-CASE-EXCLUSIONS-NEXT.md` on that branch. Then visible reference codes (`WP-REF-PLAN.md`, migration 0091), then Prepare Again, request screens and colour polish to close WP-V4, then WP-V5 and WP-V6
- Packages merged: #230 to #242 (WP-A0 to WP-X3), WP-V3 parts 1 to 3 (#248, #261, #265), WP-V4 agency slice (#263), Home slice (#275), calendar export (#276)
- Also merged 25 and 26 Oct: #259, #260 (0087 run), #262, #264, #266 to #274 (0088 and 0089 run; 90 migrations applied)
- Older owner PRs untouched: #177 (open sign-up), #77
- Parked by the owner: payments, real redaction. Deferred: Bangla
- Owner decisions: `docs/SESSION-START.md` section 6 (auto-merge WP-V4 PRs when correctly ready; migrations 0090 and 0091 pre-approved; helpers at most 2 to 3, no overlap)
- Checks: #276 had three independent reviews, a full local check (2,020 web tests, all package tests, build, 202 browser checks, smoke 11/11, supply chain 7/7) and green CI on f088f49; its post-merge checks were running at handoff (not verified in this file). The case-exceptions branch had a code review and a security review; their fixes are not yet verified
- Review rule (owner, 25 Oct 2026): independent review before every merge; strictest plus security review for permissions, sharing, documents and anything hard to reverse
- Blockers: none. Renovate shows no activity yet; the owner should check the app can see this repository
- Stop reason: session end (token discipline: one package per session)
- Next action: finish the case-exception fixes from `WP-V4-CASE-EXCLUSIONS-NEXT.md`, re-review, full check, merge, run migration 0090, verify; then reference codes

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
