# UMPE | VisaStack implementation execution kit

**Status:** ready-to-run implementation instructions, not evidence that any code has been changed. **Date:** 2026-11-02. **Repository:** `sadatnitex/visastack`. **Audit snapshot HEAD:** `ab6ce2a8b4f83623befac4b2aea68628385406bf` (#408). **Latest checked remote HEAD:** `d17d717cb02926dae11b1d749555206f69473a4c` (#409, payment recovery). Re-fetch before use; this may advance again.

## Exactly how to start

1. Unzip the kit into the VisaStack repository root so these files live under `docs/umpe/`. Keep the repository's pre-existing `CLAUDE.md` and `docs/SESSION-START.md` untouched.
2. In **one primary Claude Code session, inside the repository**, paste the whole content of `docs/umpe/prompts/01_LEAD_ORCHESTRATOR.md`, or enter: `Read docs/umpe/prompts/01_LEAD_ORCHESTRATOR.md and execute it as my implementation instruction, using docs/umpe/00_START_HERE.md.`
3. Allow that **one coordinator** to establish Git state, verify evidence and assign ownership. Do not start multiple uncoordinated agents on the same branch. The coordinator launches independent worktrees or instructs you which per-lane sessions to create.
4. Once architecture interfaces are frozen, run the independent lane prompts in `docs/umpe/prompts/`. **Never put two writing agents in the same working tree.** The integrator alone merges in dependency order.
5. Track completion in `docs/umpe/ledgers/REQUIREMENT_LEDGER.csv` with actual tests and commit evidence. Use `docs/umpe/operations/RELEASE_GATES.md` for the final operating verdict.

For Claude Code Desktop, create separate sessions in the same Git project (worktree isolation is supported) and paste the specific lane prompt. For CLI, use `git worktree` per lane or Claude's documented worktree isolation. Agent teams are **experimental, disabled by default**, and can consume extra tokens; if available and affordable, let the lead use them selectively. Standard independent worktrees are the reliable fallback. Do not invoke `/batch` indiscriminately on this entire 87-requirement programme: it can partition by filenames and accidentally overlap data-model decisions. Use the provided DAG and owner map.

## Non-negotiable precedence

1. **Product requirement:** `source/UMPE_LOCKED_Master_Product_Experience_v1.0_2026-11-02.md`, including its four intact annexes. The source's own interpretation and change-control rules apply.
2. **Field evidence:** `source/VisaStack_Field_Workflows_and_Document_Journeys_LOCKED_v1_2026-11-01.md`. Informs real-world journeys; do not turn it into a lead CRM.
3. **Audit hypothesis, not code truth:** `source/UMPE_Requirement_to_Repository_Audit_and_Execution_Plan_2026-11-02.md`, the 87-row matrix, and this implementation kit.
4. **Repository runtime and engineering truth:** code, migrations, live configuration, actual tests and verified deployment. The agent must independently check all old audit conclusions against current `origin/main`.
5. Existing repository engineering rules (`CLAUDE.md`, `docs/SESSION-START.md`, policy/ADR/testing discipline) are binding except where the owner has explicitly replaced product direction. Resolve contradictions, record them in the interface ledger and minimize destructive changes. Existing security and legal rights are never waived by product phrasing.

## Critical product invariants

- No feature removal. Preserve existing profile, document, case/mission, agency, sharing, invitation, permission, AI, lifecycle, retention, notification, billing, administration, history and deep-link functionality.
- One canonical record engine. No rival profile/vault/case/pack ontology; agency guest intake is deliberately **not** a fake applicant record.
- No AI-authenticated facts, auto-approved declarations, invented official requirements, unverified '100% accurate' claims or visa approval probability.
- Never treat country discovery pages as verified official route packs. Incomplete source coverage is explicitly marked unsupported/manual.
- Version-pinned issued checklists, chosen evidence, agency review and handoffs. Preserve historic checksum compatibility and legitimate deletions.
- No sharing on account lookup, invitation link opening, WhatsApp forwarding or mere upload. Verify recipient; require explicit grants/consent; revoke and expire correctly.
- Guest gives the agency a bounded record, **not** a persistent user wallet. Guest submission requires request-scoped identity proof and safe retry/resume.
- Saturday official-source checks are automated; material changes require official-source verification and governed publication. Source reachability is not legal verification.
- Never claim malware scanning works merely because structural checks or a worker module exists. Keep existing safe-serving rules and narrowly contain unsafe operations.
- Product strategy is commercial deployment, not perpetual synthetic pilot. This does **not** attest that sensitive-data operational gates have passed; record remaining real configuration separately.

## What is in the kit

- `prompts/01_LEAD_ORCHESTRATOR.md`: one-paste instruction for the Claude Code leader.
- `operations/DEPENDENCY_AND_OWNERSHIP.md`: DAG, exclusive hot files, worktree and integration rules.
- `operations/INTERFACE_FREEZE.md`: cross-lane API and data semantics, review before coding.
- `operations/TOKEN_TEST_GIT_PLAYBOOK.md`: efficient discovery, CI, PRs, branch lifecycle, conflict prevention and model budget.
- `prompts/LANE_*.md`: self-contained bounded mandates, each with permitted files, dependencies, tests, stop conditions and required handoff.
- `prompts/INTEGRATOR.md`: how the single integration owner lands parallel changes safely.
- `operations/RELEASE_GATES.md`: all-roles end-to-end, correctness, performance and operational acceptance.
- `operations/PR_HANDOFF_TEMPLATE.md`: one compact artifact for handoffs, no repetitive massive transcripts.
- `ledgers/REQUIREMENT_LEDGER.csv`: all 87 original map entries, traceable to evidence; status fields blank until verified.

## Practical launch order

**Immediately, concurrently, read-only:** lead verifies HEAD, policies and tests; architecture agent studies pack/schema invariants; importer agent studies upload/safety; agency agent studies invitation/guest boundary; governance agent studies source jobs. Their output is concise interfaces and conflicts, not four rewritten PRDs.

**One short sequential dependency:** lead publishes the **interface freeze** (only the unavoidable shared types/migration slots and access contracts) and P0/P1 compatibility tests. Nothing should block continuing analysis elsewhere.

**Then up to four implementation workers at a time:** ingestion, agency issuance, source monitoring and requirement/core package work, all in separate worktrees, each on exclusive files. Replacement workers (guest, trips/family, outcomes, UX) start as dependencies are satisfied. The coordinator adjusts worker count based on demonstrated independence, CI capacity and token cost, not a fixed aspiration to spawn as many as possible.

**Full completion means both code and behaviour**: the user and agency can perform complete journeys, on the exact tested commit and permitted live environment, without losing any existing path. Items lacking official route content, configured provider credentials or legal operational approval must be marked accurately rather than hidden.

## Lossless source preservation and repo style guard

The repository currently prohibits literal em dash characters in committed documents. If the repository has an additional policy forbidding compressed source artifacts, keep the original `.gz` files in a secure, accessible external folder and commit only verified working views; never discard the originals or weaken repository checks. The three readable `.md` files in `docs/umpe/source/` are **typographic working views** with only the em dash character replaced by `--` so they comply with the repository rules. **They are not the byte-for-byte originals.** Exact, unmodified source bytes are losslessly compressed as `docs/umpe/originals/<filename>.md.gz`. Run `node docs/umpe/operations/verify-locked-sources.mjs` to verify all three SHA-256 fingerprints and their working views; preserve these originals unchanged. UMPE product clauses and four source annexes remain authoritative in the unmodified compressed master. Do not overwrite, reinterpret or silently rewrite product clauses based on the typography conversion.
