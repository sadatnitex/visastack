# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 25 October 2026, WP-V1 in CI (#238); WP-V2 built on top of it
- Current main SHA: `832967b` (#237, WorkOS retired)
- Branch: `claude/prog-v2-time`, based on `claude/prog-v1-identity`; rebased onto main once WP-V1 merges
- Current package: WP-V2 version and time semantics, change impact, consistency foundation
- Packages merged: WP-A0 (#230), security (#232), public beta wording (#233), WP-L1 (#234), WP-B1 (#235), WP-C1 (#236), WP-P0 (#237)
- Owner decisions: D1 to D16, CR13 and CR14 approved. Still pending: revised first-run preview (before WP-V3); whether new client invitations must use an email address
- Completed ledger ids: as before plus T06, T10, T12, R05, R06 (owner path), W0-03, W0-04 resolved, W0-05 decided (no new storage yet); U04, U05, E03, T11 partial with the remaining work named
- Files touched (WP-V2): `consistency.ts` and its test (new), `profile.ts` (unknown effective date stays null), `wallet.ts` and its test (replacement bumps the case revision), `acknowledgements.test.ts`, `services.test.ts` (old default rule updated; allowlist line added under the autonomous mandate), `index.ts`, ledger, this file, known-issues
- Checks on the WP-V2 code: services typecheck clean; consistency 22 of 22, wallet, material-revision and acknowledgement suites pass; guards proved by mutation. Full local run before push. CI is the authority on the pushed head
- Blockers: none. Live domain still unreachable from the container, so live checks use the fallback address
- Stop reason, if stopped: none
- Next action: merge WP-V1 on green; rebase WP-V2, verify, push, merge on green; then WP-X1

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
