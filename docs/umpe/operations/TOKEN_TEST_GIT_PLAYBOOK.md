# UMPE efficient implementation playbook

## Objective

Minimize total **time to correct, merged, demonstrated behaviour**, not raw agent count, PR count or number of lines generated. Parallelize independent reasoning and disjoint edits. Serialize only shared schema, permissions, exact-history and global UX hot files. Repeated context reads, speculative abstractions, giant PRs and multiple expensive full checks are avoidable costs.

## Claude Code operating modes

**Preferred:** one lead with 2-4 independent worktrees. Agent teams may be used if the installed Claude Code build supports them and the owner accepts experimental behaviour and higher token use. A separate Claude Code Desktop session per worktree is a simple fallback. Do not assume identical command availability across CLI, Desktop and plans; run `claude --version`, inspect help/current docs once. **No hidden blanket automation** or disabling of approval prompts for high-risk operations. `/batch` is suitable only for cleanly separable leaf modules after this DAG, not for cross-cutting DB/security changes.

## Context budget

- Lead reads **contract synthesis**, source matrix and governing repo docs; individual annexes only on issue, never repetitively.
- Worker receives a bounded prompt + relevant requirement IDs + exact file and interface list + targeted source contract ranges. Ask it to output a **one-page handoff**, not a novel.
- `rg` by symbol/path. Read a 100-200 line window around functions rather than whole 3,000-line files when possible. Stop after direct call chain and relevant tests are understood.
- One discovery per topic; publish findings and source links to the integration ledger for others. Store unresolved issues rather than re-investigating each session.
- Stable decisions go into a short ADR or `operations/INTERFACE_FREEZE.md` versioned update. On session compaction/resume, read only new commits, the handoff and affected modules.
- Prefer test fixtures and deterministic parsers over additional model calls; compare AI cost and quality only on bounded evaluation corpus. Never send real applicant documents into development-model tests.

## Test economy and proof ladder

| When | Run | Do not run |
|---|---|---|
| Before editing | repo status, targeted baseline tests, migration current SHA | repetitive full test for every discovery subagent |
| During edit | nearest unit/test file, typecheck of affected package, focused auth negative test | the entire suite after every 10-line change |
| Before PR review | touched package test/coverage, migration PGlite, lint/typecheck, denial fixture | declaring security safe from a happy-path test |
| Final PR candidate | repo's `scripts/agent/full-check.sh` once on **unchanged exact SHA** plus independent review, CI | running full suite separately for every worker mid-edit |
| After merge | exact merge SHA, deployment ready check, representative authenticated browser flow | assuming source merge means production verification |
| Final P14 | all UMPE journeys across roles and devices, resource/performance limits, restoration/deletion, provider configuration | synthetic fixtures as a substitute for required actual runtime checks |

Repo source `docs/SESSION-START.md` documents `PORT=3101 bash scripts/agent/full-check.sh <worktree> <logdir>`, `bash scripts/agent/wait-ci.sh <full-sha>`, `bash scripts/agent/wait-deploy.sh <merge-sha>`. Verify scripts exist, usage and environment before running. If check changes SHA or worktree during execution, mark check stale and rerun once after stabilizing. Never falsify failure classifications.

## Git and workspace discipline

- `git fetch origin`; read current `origin/main` before every new PR. Check `git status --porcelain` and active worktrees; do not overwrite unrelated uncommitted work.
- One worktree/branch per delivery unit, e.g. `umpe/p2-import`, `umpe/p6-agency-issuance`, `umpe/p10-source-monitor`, with unique scratch and log directories. Branch creation from verified main or agreed integration SHA.
- Explicit file lease table for `schema.ts`, migrations, `packs.ts`, `missions.ts`, `documents.ts`, `client-invitations.ts`, access, exports, nav and scheduler. No same-file parallel edits even in separate branches if avoidable.
- If an API is blocked by upstream PR, work on independent consumer fixture/tests/mock contract only. When upstream merges, rebase/reconcile **only your own** branch and verify actual API.
- Keep PRs coherent and small. Schema migrations, tests and implementation for one capability belong together when safe; avoid an PR that only compiles with unmerged sibling branch unless explicitly stacked and tracked. Integrator updates PR base/order.
- Use project PR template, independent review, security review for auth/upload/guest, full check, exact required CI. Do not merge under red CI. Respect documented owner merge/production approval rules. Do not change them just for speed.
- After each merged unit update ledger, handoff/ADR/SESSION-START (if instructions require) and confirm new HEAD. The next worker rebases only after the integrator announces the new contract and base SHA.

## Tests that save more money than they cost

- Authorization matrix: same account/different account, same organization/different organization, guest/unregistered, expiry/revocation, forwarded token, old vs newly issued version.
- Immutable pack serializer golden tests for old and new formats.
- Storage/file idempotency and transient network loss, 80+ uploads, duplicate same hash vs recurring statement period, poisoned/unreadable PDF.
- User has zero profile yet, is underage, has two managed family members, has different nationality/residence, is a sponsor or a guest.
- An active package with a newly added document must not auto-share or mutate old approved snapshots.
- Source checker receives 304/unreachable/HTML changed/PDF changed/false positive/official conflict/invalid URL.
- Submitted to agency versus submitted to authority versus approved: each must have different observable event and access proof.
- UI remains operable with keyboard/mobile, 200% zoom, slow network, no AI provider and low-capacity phone.

## Model and cost policy

- Lead architect/critical security/serializer review: strong reasoning model and higher effort only for high-consequence choices.
- Bounded code + tests + UI integration: code-capable faster model with medium effort by default, escalate after targeted failure evidence.
- Read-only searches, formatting and routine fixture authoring: cheapest reliable worker, deterministic scripts when possible.
- A second independent reviewer spends its context on **risk and negative proofs**, not repeating implementation discovery.
- Per PR note LLM calls or token usage where available, plus AI-provider task usage in product; do not invent token or dollar savings. If parallel workers repeatedly block on same interface, reduce concurrency until contract stabilizes.

## Retrospective loop

Every 2-3 merged units ask: Did a shared file conflict occur? Were any tests repeatedly rerun because the base SHA changed? Is content editing (official route data) limiting value more than code? Which code layer is slowing delivery? Reassign ownership, change batching or stop low-value polish accordingly. Do not compromise privacy, historical truth or permissions for velocity.
