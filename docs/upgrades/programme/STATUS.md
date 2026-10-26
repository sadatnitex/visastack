# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 26 October 2026, night: Prepare Again merged and live; Small Commercial V1 plan merged
- Current main SHA: `9f93652` (#281, Prepare Again plus the architecture freeze)
- Branch: `ccr-847e092e-iee1pl` carries only this record update and the Sonnet session prompt
- Current package: next is **S2** (security minimum) in `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M. Start every implementation session with `docs/roadmap/SONNET-SESSION-PROMPT.md`. Programme X work in that list: S7 (WP-V4 close), S8 and S9 (WP-V5), S24 (WP-V6)
- Packages merged: #230 to #242 (WP-A0 to WP-X3), WP-V3 (#248, #261, #265), WP-V4 agency slice (#263), Home (#275), calendar export (#276), per-case exceptions (#278), reference codes (#279), Prepare Again (#281)
- Migrations: 92 applied on Neon; #281 needed none
- Older owner PRs untouched: #177, #77
- Owner, 26 Oct: payments, AI connector and product built now; only security and compliance deferred. O1, O3 and O4 later at the owner's risk; plan and order unchanged. Bangla last, on the owner's word (S25)
- Owner decisions: `docs/SESSION-START.md` section 6; merge rule CR15 in `PROGRAMME.md`; owner steps in `docs/roadmap/OWNER-ACTIONS-SMALL-COMMERCIAL-V1.md`
- Checks for #281 on head `bd29272`: all 12 PR checks green (Lint, Build, Typecheck, Test summary; No-secret Playwright; No-secret smoke; CodeQL). After merge on `9f93652`: CI, CodeQL, Deploy Smoke, Live signed-in check and Vercel success; Playwright Deploy Smoke passed on its one allowed re-run (attempt 1 hit the 10-minute limit while installing the browser, before any test ran); readiness ready; the Prepare Again page is live behind sign-in. Earlier: `/code-review` max (12 fixed), `/security-review` (no findings), two mutations red
- Not verified: the signed-in look of Prepare Again on the live site
- Blockers: none
- Next action: new Sonnet session with `docs/roadmap/SONNET-SESSION-PROMPT.md`; it does S2

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
