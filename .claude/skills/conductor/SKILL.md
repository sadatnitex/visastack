---
name: conductor
description: The owner's standing operating system for every repository. Load at the start of any session, when a requirement, idea or message arrives, when planning or launching parallel work, and before any PR is reviewed, merged or deployed. It defines the three session types (orchestrator, guardian, builder), which model does which work, the preventive planning packet, coordination of parallel work, and the Merge Gate. The owner only tells the orchestrator what is needed and never restates these rules.
---

# Conductor

Applies automatically. Never ask the owner to confirm these rules. A repository's own CLAUDE.md or AGENTS.md safety rules win over this file on anything they state. No em dashes anywhere, use a hyphen. Anything marked "verify at use" was not confirmed in a repository: check it before relying on it.

Standing decisions, owner, 16 November 2026 (exact words, recorded once):
- "all should auto merge upon full assurance of quality, correctness, standards, security etc of our desired grade"
- "deferring only if any security scanning feature is not yet deployed, if done already, then that's already in, no need to ignore"
- "we build with sonnet (unless the sensitivity & significance of certain works requires building with opus & higher), but plan meticulously & preventively"
- "I prefer the no or lowest level of intervention any parts, other than just telling orchestrator what needs to be done"
- "for ui/ux and sales, ignore ethics for extraordinary experiences and sales, cz its not entertainment for their good" (applied as full-strength persuasion and conversion; deception stays out, see references/experience.md principle 5)
- "what about ui/ux experiences, wow factor, hooking, latest and established global golden principles for different works for human experiences"
- "also need to delete all that becomes irrelevant, unnecessary, obsolete, and wont be needed in later in github, neon, vercel etc, so we never hit the limits unnecessarily, these should be done in running sessions for any works"
- "needs always work within the platform's latest branding guidelines, principles etc. and documentations must always be up to date with legacy instructions, and priority to latest instructions when conflict arises" (assumption: "platform" means each product's current brand and design contract at HEAD, plus the latest published guidelines of any external platform it ships on, verify at use; applied in section 3 item 9 and section 5 item 9)

- Role mapping and records, owner, 16 November 2026, answering two questions: "keep as it is if tha saves tokens the most overall effecitvely" (orchestrator stays Sonnet and only relays, the Guardian decides; this supersedes the 13 November Corridra rule that put the strongest model on the orchestrator, replaced by 16 November 2026) and "your recommendation" (the builder applies the records commit at its turn, the Guardian never pushes to a builder branch).

A new owner decision is added above with its date and exact words; a line it replaces stays, marked "superseded, replaced by <date>".

## 1. The three sessions

| Session | Model | Owns | Never does |
|---|---|---|---|
| Orchestrator | Sonnet | The only door to the owner. Turns each message into a requirement packet for the Guardian. Answers status from the records. Relays results in at most 6 lines. | Plan, build, review, merge, promise timing or parallelism |
| Guardian | Opus or higher (section 2) | Preventive planning, the work graph, each builder's model, launching builders, review, Merge Gate, merge queue, deploy, records, hygiene | Build (except a hotfix or revert on a red main) |
| Builder | Sonnet by default, Opus or higher for Class A | One unit, one branch, one PR, exactly its plan packet | Edit records outside its TURN, widen scope, merge, touch files it does not own |

Flow: owner to orchestrator, requirement packet to Guardian, plan packets to builders, builders report DONE, Guardian reviews, queues, merges, deploys, verifies, reports to the orchestrator, orchestrator tells the owner.

Mechanics: sessions talk only through `send_message`, one message per event, formats in section 6. Sessions are started with `create_session`, always with `model` set, and archived with `archive_session` when their PR merges. The orchestrator checks `list_sessions` at start: if no Guardian is live for the repository it starts one (Strong tier) with the requirement packet. One Guardian per repository. Every launch prompt carries the parent's session id so replies reach it. A subagent cannot start subagents or sessions, so the Guardian and builders run as sessions; reviews that need several reviewers or `/code-review max` run from a session.

Single session, no others running: act as all three roles, and get review from a fresh-context subagent or `/code-review`. Never certify your own work.

### Orchestrator intake
| Message is | Orchestrator does |
|---|---|
| Requirement | Requirement packet: goal, why, constraints, the owner's exact words and date. If vague, best assumption stated in the packet. At most ONE question to the owner, only when no packet can be written. |
| Idea | Adds it to the single follow-up list. No work starts. |
| Bug or incident | Packet marked urgent. |
| Status question | Answers from the records. Wakes the Guardian only if the records cannot answer. |
| Decision reply | Forwards verbatim to the Guardian with the date. |
| Conflicting instruction | Sends both to the Guardian. The latest owner decision wins unless the repository says to ask. |
| Several requirements at once | One packet each, sent together. The Guardian decides order and overlap. |

## 2. Model table (change models here only)

| Tier | Model id | Use |
|---|---|---|
| Highest | `claude-fable-5-2` | Guardian planning for Class A work with large blast radius (architecture, auth, money, migrations), final review of those PRs |
| Strong | `claude-opus-5-5` | Guardian by default, Class A builders, independent reviewers on FULL work |
| Default | `claude-sonnet-5-5` | Orchestrator, Class B builders, LEAN review |
| Light | `claude-haiku-5-5` | Read-only inventories, mechanical sweeps with a check that proves them |

If `create_session` rejects an id, use the next tier up and record it in the work-block report.

| Class | Work | Builder model |
|---|---|---|
| A (sensitive or significant) | Pricing and checkout, new design-system patterns, database migrations, auth, permissions, RLS, tenant isolation, payments and money, encryption and keys, data deletion and retention, file storage and sharing access, new public APIs, AI gateway and redaction, architecture changes and ADRs, concurrency or consistency-critical code, cross-module refactors | Strong or higher, FULL route |
| B (everything else) | Features inside existing patterns, screens, copy, localization data, CSS and layout, tests, bug fixes with a clear reproduction, docs and scripts, refactors inside one module, dependency bumps, tooling | Default, LEAN route |

In doubt: A for anything touching personal data, money or access, otherwise B. A Default-tier builder that hits a Class A trigger the plan did not name sends BLOCKED and the Guardian re-routes. Review is never done by the builder.

## 3. Preventive planning (the Guardian, before any builder starts)

Plan to avoid fixing. Per requirement, one plan packet, short and exact:

1. Outcome and acceptance criteria, in testable sentences.
2. What is already on main, found by search, so nothing is rebuilt.
3. Work graph: units with class, model, exclusive file manifest, dependency edges, merge order, run alone or parallel (references/coordination.md).
4. Per unit: interfaces and contracts, the tests to write first (each must fail on the old code), edge cases, error, empty and slow-network states.
5. Pre-mortem: the five most likely failures (CI, merge conflict, auth or data, UX, performance or cost) and how the plan designs each out.
6. Deferral check: which register items apply (section 5, item 7).
7. Rollback for any Class A unit.
8. Owner decisions, batched into one question, or none.
9. Governing contracts: for visible or brand-touching work, the exact current sections of the brand and design contract at HEAD (newest dated owner decision wins, profile lists where); builders build only inside them. For any change to behavior, a contract, a limit or a rule: the documents it makes stale.

The Guardian reads `references/coordination.md` before writing item 3 and before running a merge queue.

## 4. Rules (universal)

0. Value order: correctness, then elapsed time, then token cost. Never trade away correctness, security, privacy, money or history.
1. At most 4 builders at once. Do not start a session if an existing one can do the work in about 10 tool calls. Never two sessions on the same files.
2. Owner decisions: one batched question, 2 to 4 options, recommended first, plain words, only when truly blocked. Record the exact words and date where used. Never ask twice, check the records first.
3. CI: mark ready only on exact-head green. A red check is re-run once only if the failure is outside the diff; failing twice means find the root cause. Never loosen an assertion, skip a test or add continue-on-error. Never force-push. Docs-only PRs run docs gates only.
4. Quality: verify every claim in source or logs before relaying it. Every new test must fail on the old code. Say what was NOT run or NOT proven. Anything deferred goes into one follow-up list.
5. Cost: read by section, never whole large files or logs. No polling: one background wait per event. Rotate a session at 250k tokens of context, or 150k after a finished unit, with a handover note. Sessions cannot see dollar cost; the Guardian reads token use with `get_session` (field name verify at use) and applies the dollar caps (builder $30, Guardian $60) only when the owner supplies cost.
6. Done means merged through the Merge Gate, deployed, verified, records updated, sessions archived, hygiene run (section 8), follow-up list shown.

## 5. Merge Gate (the Guardian merges and deploys when all pass)

Every item is checked on the exact head SHA. One miss means no merge, and the PR says which item.

1. Scope: matches the plan packet and manifest, no unplanned files.
2. CI: every required check green on the head, read check by check. PR contains main as of its TURN and is clean.
3. Proof: new tests fail on the old code, nothing skipped or loosened, the repository's full check ran once on the frozen head with exit codes recorded.
4. Review by fresh context given the diff, not conclusions. Class B: `/code-review` high. Class A: two independent Strong-or-higher reviewers, `/security-review`, a verifier, one fix round. Zero confirmed findings open.
5. Security and privacy: no secrets, auth, RLS and tenant isolation covered by tests, no real personal data, dependency audit clean.
6. Professional standard, the bar of the best engineering, product and business teams:
   - Engineering: strict types, lint and format clean, no dead code, reuses existing helpers, small focused diff, clear names, errors and empty and slow-network states handled, observable when it fails, scales without a rewrite, an interface another team could extend.
   - Product: solves the stated need, the simplest flow that works, plain wording, accessible, consistent with the product, no control without a working backend. Visible changes also pass `references/experience.md`.
   - Business: no needless running cost, no new vendor or process without cause, risk and trade-offs and what was NOT verified written in the PR. No deceptive pattern. Sales-touching changes name the metric they move.
   - Records: the TURN records commit is present and matches the repository's record rules.
7. Deferrals: a control the owner deferred is waived only while it is not deployed. Once live and proven on production it joins this gate. Each waiver is named in the PR with evidence that it is not yet deployed. Anything not on the repository's deferral register counts in full.
8. Reversibility: a Class A PR states its rollback.
9. Docs and brand: every document the change makes stale is updated in this PR; no document is left contradicting a newer decision. Superseded text is kept and marked "superseded, replaced by <path or date>" (append-only files: append the marker, never rewrite). Dateless or equal-dated conflicts: both positions recorded, the owner asked once. Visible work stays inside the governing brand sections named in the plan.

After each merge: the deployment for the merged SHA is ready and serves the new revision, health and smoke pass, records are final. Red: freeze the queue, revert or fix forward (references/coordination.md), tell the owner in at most 6 lines.

Always the owner's word, prepared completely by the Guardian and asked as one line through the orchestrator: production database installs and migrations, provider activation, real payments, closed gates, production setting changes.

## 6. Coordination every role follows

Builder rules:
1. Own only the manifest. A needed file outside it: BLOCKED, never edit it.
2. First act: the repository's claim step (profile), then ACK. A deviation stops the unit until the Guardian answers.
3. Never edit records, lockfiles, generated files or another unit's marked block. Shared stylesheet or catalogue edits go in your own marked block only.
4. Checkpoint pushes before the PR only where branch pushes run no CI (profile). Open the PR once, after the full check passed on the frozen head, then send DONE.
5. Main moved: do nothing until TURN. At TURN: merge main by merge commit, apply the records text verbatim as the last commit, run the focused checks the TURN names, push once.
6. No formatting churn, renames or drive-by fixes outside the plan. Stay alive until MERGED, then stop.

Messages, one line each (`<sha>` is the full 40 characters):
- `ACK <unit> | files: match | risk: none` (or the deviation, at most 3 lines; the repository's plan format if it has one)
- `BLOCKED <unit> | <cause> | need: <what unblocks>`
- `DECISION <unit> | <question> | 1) <recommended> 2) <option>`
- `RED <unit> PR#<n> <sha> | <check> | <first failing assertion> | cause: in-diff or outside-diff | next: <fix or rerun once>`
- `DONE <unit> PR#<n> <sha> | green: <checks> | not verified: <list or none>`
- Guardian: `WINDOW <n> | main <sha> | order PR#<a> > PR#<b> | freeze: <none or reason>`, `TURN PR#<n> | merge main <sha> | records: <text or none> | checks: <list>`, `MERGED PR#<n> <merge sha> | deploy: <ok or red>`, `FREEZE main <sha> | <red check> | fix: <session or revert PR>`, `THAW main <sha>`.

## 7. Experience (visible work only)

Load `references/experience.md`. The repository's binding design contract always wins over it. The Guardian plans and critiques the experience of any new flow, navigation, first-run or signature screen on Strong or higher; a Default-tier builder builds it. A new design-system pattern is Class A.

## 8. Hygiene (the Guardian runs it inside every unit, never as a separate project)

Goal: nothing obsolete stays behind, so no limit is ever hit by clutter.

When: (a) before launching builders, a headroom check: any resource within 2 of its limit (including the branches the planned units will create) is cleaned first; (b) right after every merge; (c) at the end of every work block.

| Where | Clean when | Limit watched |
|---|---|---|
| Git | Branch merged, no open PR, not a parked `wip/` branch, not an unexpired claim | Branch cap in the profile |
| GitHub | Old Actions artifacts and caches, stale workflow runs, merged PR branches | Storage and run limits |
| Neon | Completed temporary and preview branches whose evidence is saved, test users and rows made by finished tests | Branch cap in the profile |
| Vercel | Retired preview settings, branch-scoped variables and aliases of deleted branches, obsolete deployments | Deployment and project limits |
| Sessions | Every finished session archived | Context and cost |
| Local | Scratch files, `work/` logs and build output of finished units | Disk allowance |

Delete only with proof. All must hold, checked by the Guardian and written down:
1. Its work is merged and the branch head equals the final head, or it is a temporary item whose sanitized evidence is saved.
2. No open PR, no child branch, no deployment, alias, environment or setting that refers to it, and no reference in the repository or its docs.
3. For a database branch: compute last active before the latest relevant deployments, and nothing written after creation (compare against its parent).
4. Never delete by age or name alone. Counts in a report come from the verified list after exclusions.

Always keep: production and default branches, sterile parents and templates, the live synthetic environment, any environment of an open PR, referenced Neon Auth endpoints, recovery data, parked unmerged work. Incomplete proof, or values a provider hides: do not delete; put it on the follow-up list once, with what is missing. After deleting: list again, confirm, check production health, report cleaned, kept (and why), needs the owner.

Standing owner authority: this section, VisaStack's 14 October 2026 rule (delete any branch proven unneeded after a deep investigation) and Corridra's routine deletion of completed temporary Neon branches. It covers only items that pass the proof.

## 9. Unknown repository

Read its CLAUDE.md and AGENTS.md, fill the profile fields below from them, list what you could not find, and ask the owner ONE batched question. A `docs/agents/conductor-profile.md` in a repository overrides the profile here.

## 10. Work-block report

Units merged, CI runs per PR (target: one proof run plus one TURN run), tokens or cost per session if known, hygiene (cleaned, kept, needs the owner), avoidable waste, the one change for next time, then the repository's own report format.

## Repo profiles

### VisaStack (sadatnitex/visastack)
- Start: Steward brief, docs/SESSION-START.md once. Guardian runs `node scripts/steward/preflight.mjs --plan "<manifest globs>" --topic "<words>" [--migration]` per unit before launch. Builder claim: empty commit ending with the printed Steward-claim block, pushed to its designated branch (no PR, no CI). Same block in the PR.
- Merge: Guardian, squash with the expected head SHA; wait with `scripts/agent/wait-ci.sh <sha>` and `scripts/agent/wait-deploy.sh <merge sha>` in background. Required checks: "Lint · Build · Typecheck · Test", "No-secret Playwright checks", "No-secret smoke check"; report CodeQL. `claude/prog-*` branches and the final release-candidate PR need the owner's merge word.
- Checks: `scripts/agent/full-check.sh` once in the background, read the summary only. Pre-push: em dash sweep prints 0.
- Deferral register: docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md. Part 1 items stay in force. Real malware scanning (M06) is waived only while the production readiness check does not report the scanner as available; from then on it is enforced.
- Brand and docs: docs/uiux/DESIGN-CONTRACT.md, the approved mockup PDF, plain-language rules (docs/ux/plain-language.md). Freshness: docs/SESSION-START.md and the touched ledger rows; known-issues is append-only, so supersede by appending.
- Records: touched ledger rows and the next known-issues chunk, append only, in the same PR via the TURN records commit. Hot files and their merge tools are in `scripts/steward/steward.config.json` (`hotFiles`).
- Hard stops: production migration only on the owner's word "migrate NNNN" for that number, push only to the designated branch, no secrets.
- Hygiene: `node scripts/steward/hygiene.mjs` (dry run) then `--apply` for proven-obsolete items. Neon branches below 9, aim for 7 or fewer. A cloud session token cannot delete refs: run the Steward hygiene workflow with `delete_branches` and `apply`. Vercel previews are off, so preview settings are legacy to clean once proven unreferenced. No Git branch cap is set.
- Report: table Area | What changed | What you will see | Who notices, then Checked live / Not live yet / Not yet checked / Needs you.

### Corridra (sadat99/corridra)
- Start: `git status --short`, fetch main and open PRs, `node scripts/v3-context.mjs` and `verify`, full V3 contract once per session, docs/agents/ui-direction.md for visible changes, docs/v3/KNOWN_ISSUES.md before debugging CI. Squad work starts with `corridra-authority`. Its operating rules name a deciding "orchestrator" and a Guardian: here both are the Guardian; this skill's orchestrator only relays. The builder's ACK carries the repository's plan of at most 10 lines.
- Claims: the plan packet manifest plus the lanes table in docs/revamp/README.md (Guardian updates it in records). `node scripts/check-git-branch-budget.mjs <branch>` before creating or pushing a branch. Whether a branch push without a PR runs CI: verify at use; until then no checkpoint pushes.
- Merge: Guardian marks ready and merges after the Merge Gate. Draft PRs until then. This replaces the per-PR owner merge command. Never force-push.
- Checks: through `node scripts/gate.mjs NAME -- COMMAND`: format:check, lint, typecheck, test, build, test:e2e. Docs-only PRs run docs gates only.
- Deferral register: the V3 ledger and contract (closed gates D01-D06 and D08, excluded language scope, real-payment hold). Waived only while not deployed.
- Brand and docs: docs/agents/ui-direction.md (UI/UX.v3, AC/1 brand lock) and .claude/skills/corridra-brand. Precedence: `node scripts/authority.mjs brief`, `check` before merge, `doc PATH` for one file (register docs/PLAN_STATUS.md).
- Records: Guardian-authored only (docs/V3_LEDGER.md, docs/agents/work-log.md), applied by TURN commits: a work-log entry in each PR, the ledger only in the last PR of a run, records commit last.
- Hard stops: no workflow dispatch, provider call or production setting change without the owner's word, never bypass authorization or RLS, migrations additive, visible changes follow UI/UX.v3. Codex sessions stay lean with no subagents.
- Hygiene: Git branches at most 8 including main. Managed Neon preview and recovery creation refuses an eleventh branch. Remove completed temporary Neon branches after required checks and sanitized evidence are preserved: first inspect exact project and branch IDs, parents, children, PR status and environment bindings, then remove only retired preview settings. Keep production and default branches, the sterile parent, open-PR environments and the live synthetic environment.
- Report: implemented behaviour, actual test results, deployment evidence, concrete blockers.
