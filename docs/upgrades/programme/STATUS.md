# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 26 October 2026, evening: architecture freeze for Small Commercial V1; Prepare Again built and reviewed, not yet merged
- Current main SHA: `174ae1a` (#280, docs only; last code merge #279)
- Branch: `ccr-847e092e-iee1pl` (pushed, no PR yet) holds Prepare Again plus the plan, the handoff and ADRs 0019 to 0021
- Current package: WP-V4. Next: ship Prepare Again (handoff package S1), then follow `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M in order. Programme X work in that list: S1 and S7 (WP-V4), S8 and S9 (WP-V5), S17 (WP-V6, merged with commercial acceptance)
- Packages merged: #230 to #242 (WP-A0 to WP-X3), WP-V3 parts 1 to 3 (#248, #261, #265), WP-V4 agency slice (#263), Home slice (#275), calendar export (#276), per-case sharing exceptions (#278), WP-REF reference codes (#279)
- Migrations: 92 applied on Neon; Prepare Again needs none
- Older owner PRs untouched: #177 (open sign-up), #77
- Parked by the owner: real redaction. Payments are now started (ADR 0020). Deferred: Bangla
- Owner decisions: `docs/SESSION-START.md` section 6 (26 Oct Small Commercial V1 entry added); merge rule CR15 in `PROGRAMME.md`
- Checks on the branch (head after this session's last commit): Prepare Again services suite 13 passed; product events and missions-related suites passed; web Prepare Again form, accessibility scan, title-case and vocabulary guards, case page and admin tests (22 files, 418) passed; services and web typecheck and Biome clean; allowlist and no-long-dash checks OK; `/code-review` (max) 12 findings all fixed; `/security-review` no findings; two mutations red. Not run yet: the full check, CI, browser and smoke checks on the final head
- Blockers: none for S1. Owner actions O1 to O12 in the handoff (repository is public; decide visibility first)
- Stop reason: owner switched this session to architecture and programme freeze (26 Oct)
- Next action: S1: run `PORT=3101 bash scripts/agent/full-check.sh <worktree> <logdir>`, open the draft PR with the template headings, wait for CI, merge per CR15, live check

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
