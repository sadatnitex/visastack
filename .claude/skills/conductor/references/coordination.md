# Coordination (Guardian only)

Goal: units never collide, CI runs at most twice per PR (one proof run, one TURN run), merges and deploys go one at a time. Message formats are in SKILL.md section 6.

## 1. Work graph
One line per unit in the plan packet:
`U<n> | class A/B | model | owns: <globs> | reads: <paths> | after: U<m> or none | hotspot: <file: block name> or none`
- `owns` is exclusive: no other live unit, claim or open PR may match it. Check with the profile's claim tool before launch.
- `reads` lists files the unit depends on but never edits (contracts, shared types, schema).
- An edge `after` exists when a unit reads what another unit owns, or needs its migration.

| Situation | Run |
|---|---|
| Owned sets disjoint, no shared contract, no shared hotspot except marked blocks | Parallel |
| One unit defines an interface, type, API shape or schema another uses | Contract unit alone first; consumers in parallel after it merges |
| Same file in two units | Merge the units, or run them in sequence |
| Migration, lockfile change, CI or root config change | Alone in its window (other units may build, but merge after it) |
| Class A with large blast radius | Alone, merged and verified before dependants start |
| Fewer than about 10 tool calls of work | No new session; fold into an existing unit |
Cap: 4 builders, and never more branches than the profile's branch budget allows after hygiene.

## 2. Hotspots (serialized or Guardian-owned)
| Hotspot | Rule |
|---|---|
| Migration numbers | One migration unit per repository at a time. VisaStack: number only from `preflight --migration`; code tolerates the table missing until the owner's "migrate NNNN" install. Corridra: additive only, next file name checked against main and open PRs at plan time. |
| Lockfile, package manifests | One unit per window changes dependencies. Never hand-merge a lockfile: take main's, rerun the install. |
| Generated files (migration meta, route types, build output) | Never edited by hand. The owning unit regenerates; after a conflicting merge, regenerate. |
| Global stylesheet | Each unit appends only its own block starting with a `/* WP-<unit>` marker. VisaStack resolves at TURN with `scripts/agent/merge-css.py`. No tool in the repo: serialize. |
| i18n catalogues | Parallel only when each unit adds keys in its own named group; edits to existing keys are serialized. |
| Records (ledger, known-issues, work log, changelog, lanes table) | Guardian-authored text, applied by the builder at TURN as the last commit, so it always lands on current main. |
| Route manifests, nav, shared registries, CI workflows, root config | One owner per window, named in the graph. |
| Brand and design contract, governing docs | Changed only by a unit that ships the owner decision behind it; never edited in passing. |

## 3. Claims and records
- VisaStack: per unit `node scripts/steward/preflight.mjs --plan "<owns globs>" --topic "<words>"`. SERIALIZE: that unit waits for the owning lane. Topic hit: open that work first. Hot files print as "hot" (rules in `steward.config.json`). Builder claim commit as in the profile; a lane is an open PR or a `claude/` branch touched in 7 days.
- Corridra: the plan packet manifest is the claim; the Guardian adds the unit to the lanes table in docs/revamp/README.md in the next records commit, and runs `node scripts/check-git-branch-budget.mjs <branch>` before each launch.
- Records without conflicts: builders write a draft under "Records" in the PR description; the Guardian edits it and sends it in TURN. VisaStack: each PR carries its own ledger rows and the next known-issues chunk, numbered against main at TURN. Corridra: each PR carries its work-log entry; only the last PR of a run updates the ledger, records commit last. A solo unit gets its records text in the plan packet and pushes once.

## 4. Merge queue
1. Queue = DONE PRs that passed review, ordered by `after` edges, then by DONE time.
2. Announce `WINDOW` to live builders and the orchestrator. Nobody pushes outside TURN while a window is open.
3. Head of queue: send `TURN`. The builder merges main by merge commit, applies records, runs the named checks, pushes once. Wait for CI on that exact head in one background wait.
4. Rerun rules: main changed nothing in the unit's `owns` or `reads` and no lockfile: TURN checks are none beyond what the push triggers. Main touched its `reads` or the lockfile: TURN names the focused tests for those paths. Main touched its `owns`: should be impossible; stop and re-plan. No PR is updated because main moved, only at its TURN.
5. Merge with the expected head SHA, send `MERGED`. Send the next TURN at once so its CI overlaps the deploy check, but do not merge it until deploy and live checks for the previous SHA pass.
6. Freeze: no merges during a production install that needs a fixed main SHA, or while main is red. Announce `FREEZE`, then `THAW`.
7. Red main stops the queue. The Guardian fixes it first (revert PR or hotfix through the gate). PRs whose TURN ran on the red base take main again at their next TURN.
8. Stale events: every CI or PR event is matched to the current head SHA; anything for another SHA is ignored.

## 5. When main moves under a builder or requirements overlap
- Before DONE: the builder keeps working on its base; it merges main only if a `reads` file changed and the Guardian says so.
- Two requirements touch the same files: one work graph for both; the shared file gets one owner unit; the other requirement's unit runs `after` it. The orchestrator relays the order and promises no timing.

## 6. Failure handling
- Revert when production is harmed, data, security or money is at risk, or the fix is not certain in one small PR. Fix forward when the fix is small, certain and production is unharmed. Migrations are never reverted: fix forward with a new additive migration (owner's install word).
- Threshold: a session at 250k tokens, or 150k after a unit, or past an owner-supplied dollar cap, stops at a clean commit and writes a handover; the Guardian starts a fresh builder on the same branch.
- Dead session (`get_session` failed or no reply after its expected finish): read its last events and branch; resume from the pushed branch with a reconstructed handover. Unpushed work is lost, so checkpoint pushes are used where the profile allows. A dead Guardian: the orchestrator freezes the queue and starts a new one from the handover.
- Handover note: unit, branch, head SHA, PR, manifest, done versus remaining against acceptance, checks run with exit codes, open findings, messages owed, next concrete action, tokens used.

## 7. Desk tests
1. Two parallel UI units plus one migration unit. Graph: M1 (Class A, migration, owns migrations folder and schema) alone first; UI1 and UI2 parallel with disjoint page globs and their own stylesheet blocks; UI units that read the new schema get `after: M1`, others start at once. Queue M1 > UI1 > UI2; M1's install waits for the owner's word, code tolerates the missing table, so UI units still merge. CI runs: two per PR. Passed.
2. Main turns red mid-queue (after UI1 merged, UI2 at TURN). FREEZE; UI2's green run on the red base does not count. Guardian reverts or hotfixes through the gate, waits for green main and deploy, THAW, re-sends TURN to UI2. Gap found and fixed: step 7 now says TURN is repeated against the fixed main.
3. Two requirements at once, both touching globals.css and the ledger. Orchestrator sends two packets, no timing promised. Guardian builds one graph: each unit appends its own WP block (VisaStack merge-css at TURN; Corridra would serialize), ledger text is Guardian-authored and applied at TURN, so neither file conflicts. Gap found and fixed: SKILL.md intake row for several requirements. Passed.
4. A newer owner decision contradicts an older document. Plan item 9 names the stale document; the unit updates it, marks the old text "superseded, replaced by <date>" (VisaStack known-issues: appended), Corridra runs `authority.mjs check`. Gate item 9 blocks merge if any document still contradicts. Equal dates: both recorded, one owner question. Passed.
