# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-P0 merged (#237, `832967b`); WP-V1 ready for CI
- Current main SHA: `832967b` (#237, WorkOS retired)
- Branch: `claude/prog-v1-identity`, rebased on `832967b`
- Current package: WP-V1 invitation identity, neutral preview, return path
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237)
- Owner decisions: D1 to D16, CR13 and CR14 approved. D3 applied in the shared header. Still pending: revised first-run preview (before WP-V3); whether new client invitations must use an email address (phone-only invitations cannot be bound to a person)
- Completed ledger ids: as before plus W0-01 resolved, T03 verified (unit level), T04 verified (WP-V1 part); U07, R01, E01 partial with the remaining work named
- Files touched (WP-V1): `client-invitations.ts` and its test, `client-invitations/accept/page.tsx`, `invitation/page.tsx` and a new `page.test.tsx`, `neon-recency.test.ts`, ledger, this file, known-issues; all inside `allowlists/WP-V1.txt`
- Checks on the WP-V1 code (before rebase): audit exit 0, lint, typecheck, full unit tests, web suite and build pass; Playwright 4 failures, all part of main's sign-in baseline here. New guards proved to fail when the real check is disabled. CI is the authority on the pushed head
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-V1 on green, verify live; then WP-V2 version and time semantics

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
