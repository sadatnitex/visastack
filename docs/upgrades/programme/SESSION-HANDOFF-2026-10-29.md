# Session handoff, 29 October 2026

Supersedes `SESSION-HANDOFF-2026-10-26-afternoon.md` for current state (older handoffs stay as history). Read `docs/SESSION-START.md` first, then this. Check every head SHA before acting: main was `47f18e57` (#337) when this was written.

## 1. Workstreams

| Workstream | Who | Status lives in |
|---|---|---|
| Small Commercial V1 (S-packages) | this session line | `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M. S1 to S16 and S27 are merged; S23 is in progress |
| Calm Core With Depths and Programme X (CCD, WP-C2) | another session | `docs/upgrades/programme/STATUS.md` (owned by that workstream; do not rewrite it) |

What is live by area: `docs/public-beta/CURRENT-STATE.md`, section "Update, 2026-10-29".

## 2. Open branches

- `claude/focused-ptolemy-p7wax1`: the designated push branch for this session line. Push only there unless the owner allows another.
- `s23-wip`: S23 real redaction, built by a helper in a scratchpad worktree (`<session scratchpad>/s23`). **Not pushed and not merged.** A scratchpad worktree vanishes when the container ends: commit and push (no PR) before stopping.
- Old open PRs #177 (open sign-up switch) and #77 (WorkOS staging, obsolete) are owner-held, stale and not part of this track: leave them open.

## 3. How to resume S23 safely

1. Find the branch: `git -C <s23 worktree> log --oneline origin/main..HEAD` and `git status`. If the worktree is gone and nothing was pushed, restart S23 from ADR 0022 and the approved plan below.
2. The approved plan, with its recorded deviations from ADR 0022: suggestions come from the PDF text layer's positions plus a passport's machine-readable band (no stored OCR word positions); safe copies are served through a new route behind `requireAccess`, and the blob route's redacted download stays closed; PDFs and images only; masks apply only to the latest version.
3. Migration 0102 (`redaction_masks`): generate with drizzle-kit only after main is merged in; it runs in production only on the owner's word ("migrate S23") right after the merge. Code must work while the table is missing.
4. Reviews: `/code-review` max, `/security-review`, design accessibility review; then one guarded full check (`docs/SESSION-START.md` section 4); then the draft PR, CI on the exact head, and the owner's merge rules.
5. Readiness keeps `redactedDownload` disabled until S23 is live and its migration has run.

## 4. Owner decisions and actions

- Decisions in force (newest first): `docs/SESSION-START.md` section 6. New since 26 Oct: interface style rule, documentation rule, connector switched on, Calm Core With Depths, the pause rule.
- Pending owner actions, each with what it unlocks and where: `docs/roadmap/OWNER-ACTIONS-SMALL-COMMERCIAL-V1.md`, section "Status at 29 Oct 2026".

## 5. Open, unproven items

- A CI-only pixel comparison (documents and profile appearance at 1600px, about 48 px) failed once after UX-B; not reproducible locally. Not explained.
- "account menu opens above a trigger that sits low" failed once on a GitHub runner during the #317 run and passed on retry; not caused by S16. Not explained.
- Not verified: a real Claude or ChatGPT connection to `https://vs.obsidianglobal.studio/mcp`; the first daily backup capture, freshness check and prune report after #337. (All 100 migrations through 0101 are applied in production: verified 29 Oct 2026 on Neon: drizzle.__drizzle_migrations holds 100 rows, equal to the 100 journal entries, newest = 0101.)

## 6. Pitfalls

`docs/SESSION-START.md` section 8 (new on 29 Oct: guarded full check in background mode, `.next` after route-group moves, merging append-only files and `git merge -s ours`, re-subscribed PR activity, re-scroll to a hash after data loads).
