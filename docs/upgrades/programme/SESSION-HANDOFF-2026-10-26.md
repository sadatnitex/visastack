# Session handoff, 26 October 2026

Supersedes `SESSION-HANDOFF-2026-10-25-evening.md` for current state (that file stays as history). Read `docs/SESSION-START.md` first, then this. Check every head SHA before acting.

## 1. Merged and live since the last handoff

| PR | What | Database |
|---|---|---|
| #269 | Profile photos | migration 0088 run |
| #270 | Status page AI state; "Download Safe Copies" | none |
| #271 | Visa photo sizes | none |
| #272 | AI provider data terms, training guard off | migration 0089 run (90 applied) |
| #273, #274 | Handoff, README and current-state docs | none |
| #275 | WP-V4 Needs Attention and the reordered Home (ADR 0016); the traveller's time zone decides past due everywhere (ADR 0015 amendment) | none |
| #276 | WP-V4 calendar export on the shared calendar core `@visastack/core/calendar` (ADR 0016 calendar sections); time zones always saved in their latest official name | none |

Post-merge checks for #276 were running at handoff: confirm with `bash scripts/agent/wait-deploy.sh 77084ed51142fa4b8aa7fe1789a2ccec100f364c` and readiness through the Vercel connector before reporting it live.

## 2. Work to finish next (in this order)

1. **Per-case sharing exceptions**, branch `claude/prog-v4-case-exclusions` (pushed, no PR yet). Feature, migration 0090 and the four owner-approved gap closures are committed; the last commit is a WIP holding partial, unverified review fixes. Everything to do is in `docs/upgrades/programme/WP-V4-CASE-EXCLUSIONS-NEXT.md` on that branch (16 numbered fixes from a code review and a security review, with the rules and tests to run); the design is `WP-V4-CASE-EXCLUSIONS-PLAN.md`; the security review's proof tests are in `WP-V4-CASE-EXCLUSIONS-POC/`. Then: one focused re-review of the fixes (security level), the full check, PR, CI, merge (auto-merge approved), run migration 0090 right after the merge (pre-approved), verify 91 migrations and the `grant_case_exclusions` table, live checks, report.
2. **Visible reference codes**, a new branch from main after step 1 merges: `docs/upgrades/programme/WP-REF-PLAN.md` (approved design, file list and allowlist). Migration 0091 pre-approved to run right after its merge. Strict review plus security review, full check, PR, merge, migrate, verify, report.
3. Then stop and write the next handoff. The remaining WP-V4 parts (Prepare Again, request screens, colour polish), WP-V5 and WP-V6 belong to the following session.

## 3. Owner decisions made in this session

All are in `docs/SESSION-START.md` section 6. The ones that drive the next steps: auto-merge and deploy WP-V4 PRs when correctly ready; migrations 0090 and 0091 pre-approved; Prepare Again asks per all-cases recipient, no answer means no, and exceptions follow the recipient; reference codes `P-`/`C-`/`D-`/`R-` plus 6 characters; time zones always in their latest official name; at most 2 helpers (3 with one short read-only check), no overlap.

## 4. Lessons from this session

- A session hit its weekly usage limit with several long-running helpers; resumed helpers reload their whole history. Brief completely, batch review findings, close helpers after one round, make small fixes yourself.
- Start the full check only after review fixes are in (several checks were thrown away).
- Settle the full design before building (the calendar needed three reviews because its scope grew mid-way).
- Work committed only in a session's temporary workspace is lost when the session ends: commit and push (no PR) at every stopping point.
