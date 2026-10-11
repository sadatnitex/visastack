# Commercial V1 Supersession Map

Directive lineage in this repository, oldest first:

1. `docs/roadmap/master-build-pilot-commercialization-directive.md`, the original engagement
   brief. Milestones executed through the PR sequence in its own Section 26.
2. `docs/roadmap/commercial-recovery-completion-ux-directive.md`, received 2026-07-31.
   Supersedes 1 wherever they conflict on infrastructure, release sequencing, security scope,
   UX, or commercialization policy, per its own Section 1. Directive 1's Releases A to H (PRs
   #40 to #53) stand as completed history; directive 1's phase-plan and acceptance-criteria
   docs remain current inputs.
3. Post-programme defect-closure engagement (PR-A through PR-F1, corresponding to PRs #58
   through #76, all merged). Closed all 36 original GitHub review findings, 4
   baseline-discovered defects, and 18 Codex findings against its own new code, per
   `docs/audits/post-programme-defect-register.md` Section 5.2. This engagement explicitly
   operated on Vercel Hobby / WorkOS staging and did not claim any of the 19
   `commercial-readiness.ts` gates; see `docs/roadmap/remaining-commercial-blockers.md` for
   exactly what it left open.
4. PR #77 (`claude/workos-staging-e2e-second-identity`), a standalone follow-up at the user's
   explicit request to provision a second synthetic WorkOS identity. Still open, still draft,
   not part of 1 to 3 or of this new directive. See `baseline.md` for disposition.
5. `docs/roadmap/commercial-v1-implementation-directive.md` (this session), received
   2026-09-16, archived verbatim. States its own authority order (explicit user instruction,
   then the Commercial V1 PRD, then approved implementation decisions, then retained
   architecture/security invariants, then older PRDs as historical context only), and states
   older repository documents may not override it.

`docs/product/prd-v1.1.md` and `docs/product/build-spec-v1.1.md` are confirmed by the product
owner to be old files from a prior phase of the build, not a current parallel specification.
They remain historical reference only, consistent with 5's own authority order (older PRDs
are historical context and may not override the Commercial V1 PRD), and are not treated as
authoritative for any requirement 5 addresses.

Relationship: 5 is the current governing directive for any requirement it addresses,
consistent with its own stated authority order, once its named PRD dependency is resolved
(see `assumptions-and-blockers.md`, Blocker 1). It does not retroactively invalidate the
completed-history status of 1 through 3. Overlap exists between 5's scope and the still-open
items 3 left behind (`remaining-commercial-blockers.md`): real malware scanner (5's Part 3
versus the existing `realMalwareScanner` gate), multi-provider AI (5's Part 8 versus the
existing OpenAI-only wiring and blended-cost tracking), and the 8 unconditionally-skipped
cross-account E2E tests (5's Part 10 Section 2 versus `remaining-commercial-blockers.md`
Section 3, which is the same finding). Where 5 and the still-open items from 3 describe the
same gap, the requirements ledger treats them as one requirement, not two.

## Release-gate documents (2026-10-06)

- `release-gate.md` is rewritten as the real gate record; the earlier placeholder text ("not eligible, Part 1 blocked") is superseded by it.
- `final-report.md` supersedes the checkpoint verdict in `part-9-checkpoint.md` for the programme as a whole; the checkpoint stays as dated evidence.
- The README status paragraph was refreshed; its older "Part 8 in progress, Parts 9-10 not started" wording is superseded.
- The environment attestation flags described in `docs/operations/pilot-to-commercial-activation.md` are runtime switches, not release evidence. The release gate does not read them.



## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
