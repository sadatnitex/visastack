# Session handoff, 29 October 2026

Supersedes `SESSION-HANDOFF-2026-10-26-afternoon.md` for current state (older handoffs stay as history). Read `docs/SESSION-START.md` first, then this. Check every head SHA before acting: main was `47f18e57` (#337) when this was written.

## 1. Workstreams

| Workstream | Who | Status lives in |
|---|---|---|
| Small Commercial V1 (S-packages) | this session line | `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M. S1 to S16, S23 and S27 are merged (S23 as #339, with live fixes #340 and #341; main `424e525d`); S17 is in progress |
| Calm Core With Depths and Programme X (CCD, WP-C2) | another session | `docs/upgrades/programme/STATUS.md` (owned by that workstream; do not rewrite it) |

What is live by area: `docs/public-beta/CURRENT-STATE.md`, section "Update, 2026-10-29".

## 2. Open branches

- `claude/focused-ptolemy-p7wax1`: the designated push branch for this session line. Push only there unless the owner allows another.
- `s17-wip`: S17 recurring invoices, reminders, overdue handling and reactivation, built by a helper in a scratchpad worktree (`<session scratchpad>/s17`) from main `424e525d`. **Not pushed and not merged.** A scratchpad worktree vanishes when the container ends: commit and push (no PR) before stopping. (`s23-wip` is merged as #339.)
- Old open PRs #177 (open sign-up switch) and #77 (WorkOS staging, obsolete) are owner-held, stale and not part of this track: leave them open.

## 3. How to resume S17 safely

1. Find the branch: `git -C <s17 worktree> log --oneline origin/main..HEAD` and `git status`. If the worktree is gone and nothing was pushed, restart S17 from ADR 0020 (Phase 2 and the S17 amendment) and `docs/operations/billing-cycle.md`.
2. Migration 0103 (`billing_settings`, the history cause, one live invoice per period): it runs in production only on the owner's word ("migrate S17") right after the merge, and only after the duplicate check in the runbook returns no rows. Code works while it is missing.
3. Reviews: `/code-review` max (payments), `/security-review`, design accessibility review of the Billing Rules page; then one guarded full check; then the draft PR, CI on the exact head, and the owner's merge rules.
4. Automatic Grace and Suspended stays off until the owner sets O13, including the decision on traveller uploads while an agency is suspended.

## 4. Owner decisions and actions

- Decisions in force (newest first): `docs/SESSION-START.md` section 6. New since 26 Oct: interface style rule, documentation rule, connector switched on, Calm Core With Depths, the pause rule.
- Pending owner actions, each with what it unlocks and where: `docs/roadmap/OWNER-ACTIONS-SMALL-COMMERCIAL-V1.md`, section "Status at 29 Oct 2026".

## 5. Open, unproven items

- A CI-only pixel comparison (documents and profile appearance at 1600px, about 48 px) failed once after UX-B; not reproducible locally. Not explained.
- "account menu opens above a trigger that sits low" failed once on a GitHub runner during the #317 run and passed on retry; not caused by S16. Not explained.
- Not verified: a real Claude or ChatGPT connection to `https://vs.obsidianglobal.studio/mcp`; the first daily backup capture, freshness check and prune report after #337. (Migrations through 0102 are applied in production: 100 rows verified on Neon on 29 Oct, newest 0101, then 0102 run with the owner's word after #339.)

## 6. Pitfalls

`docs/SESSION-START.md` section 8 (new on 29 Oct: guarded full check in background mode, `.next` after route-group moves, merging append-only files and `git merge -s ours`, re-subscribed PR activity, re-scroll to a hash after data loads).

Also new on 29 Oct (afternoon), from the S23 live fixes:

- A package marked external in `next.config` (`serverExternalPackages`) must also be a direct dependency of the web app, or production cannot load it (#340); a guard test now checks this.
- Storage object keys must be opaque (`isOpaqueObjectKey` in `packages/services/src/storage.ts`); the test storage fake refuses any other key, so a readable key fails in tests, not in production (#341).
- No deploy smoke check yet renders a document preview or prepares a safe copy, so a break there is not caught after a deployment.
