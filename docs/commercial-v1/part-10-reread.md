# Part 10 section 1: re-read and divergence record

Written 2026-10-06.

## What was read in this session, and what was not

The directive asks for a full re-read of the PRD, the ledger, the threat model, the architecture decisions, the blockers and the release gate before final verification. **A full re-read was not done in this session.** The programme's cost rules forbid reading the large documents whole, so each was read only where the work touched it:

| Document | Read in this session |
|---|---|
| Directive | Part 9 section 16 (4121-4163) and Part 10 sections 1 to 4 (4181-4317) |
| Requirements ledger | The journeys and acceptance tables, plus the Part 9 rows by id (status columns) |
| Release gate | Lines 30-60 only |
| Threat model, architecture decisions, blockers, PRD | Not re-read. The independent full re-read stays owed before the release candidate (Task 8) |

## Divergence from the previous session's base

| Item | Value |
|---|---|
| Previous base | `282c92b` (#170) |
| Current `origin/main` | `e62284e` (#171) |
| Difference | One merged change: critical states and signed-in accessibility (#171). Nothing else landed. |
| Open pull requests | #77 (old draft: second staging identity, `claude/workos-staging-e2e-second-identity`). Not absorbed, not merged, not closed: the owner decides. |
| Unrelated changes absorbed | None. |

## Findings from reading PR #77 and the staging workflow

1. #77 says the first identity pair (`WORKOS_STAGING_TEST_EMAIL/_PASSWORD`) was never provisioned either, and that no tool available to a session can write a repository secret. The second identity therefore cannot be assumed.
2. **Defect found and fixed:** the staging workflow ran on every successful deployment, including pull-request previews, with real identity secrets and the preview's own test code checked out. The directive forbids that. It now needs the Production environment (or a manual dispatch).
3. The eight cross-account tests still held unconditional skips. They now have real bodies, gated on two different identities and, for the agency tests, a staging agency fixture. They were not run: BLOCKED.
