# Steward: one coordinator for every session and repository

The Steward keeps parallel sessions from colliding, repeating work or leaving clutter behind. It is a small kit (`scripts/steward`, `.claude/agents/steward.md`, `.claude/commands/steward.md`, a session-start hook and one scheduled workflow). It reads GitHub, never a half-finished checkout, so it works from a shallow clone and from any session.

## What each part does

| Goal | How it is met | Where |
|---|---|---|
| Plan once, no rework | A brief prints at every session start: main's head and CI, open PRs, live lanes, overlaps, next free migration number. Before building, `preflight --plan --topic` says whether the paths collide with a live lane and whether the work already exists. | `scripts/steward/preflight.mjs`, `.claude/settings.json` |
| Absorb outside instructions without clashes | The intake table in the agent classifies every new instruction: fold in, widen the claim, hand off as its own task, message the owning session, or stop because it is already done. | `.claude/agents/steward.md` |
| Stay inside branch and storage limits | Branches are deleted only with a proof or when the owner names them; old artifacts and caches go automatically; anything a person might want is listed once, in one batch. | `scripts/steward/hygiene.mjs`, `.github/workflows/steward-hygiene.yml` |
| No vulnerabilities, no orphan pages | One command runs the repository's own gates: production advisories, the supply-chain scan, the route graph check. | `scripts/steward/audit.mjs` |
| Many repositories | The kit is copied by `node scripts/steward/install.mjs <path> --repo owner/name`, each repository keeps its own `steward.config.json`. | `scripts/steward/install.mjs` |

## Claims: how sessions see each other

A lane is a branch with work on it: an open PR, or a `claude/` branch touched in the last 7 days. Two sessions collide when they change the same file. Preflight finds that from GitHub's branch comparison, so it needs no shared file.

Before a session has pushed any real work it makes itself visible with a claim: an empty commit on its own branch whose message ends with the block below, then a plain branch push. A branch with no pull request runs no CI and no preview, so this costs nothing. The same block goes into the PR description later.

```
Steward-claim:
- paths: apps/web/src/app/app/mission/**, packages/services/src/agency.ts
- migration: 0134
- area: case page
```

The next free migration number counts main, every live lane's migration files and every claim, so two sessions never take the same number. A claim lapses on its own: a branch with no PR and no activity for 7 days stops counting as live, and hygiene removes an empty claim branch after 48 hours.

Files that always conflict are listed in the config (`hotFiles`) with the rule to follow, for example the append-only evidence log, the shared stylesheet, the lockfile and generated migration metadata. Preflight reports them as "hot", not as a collision.

## Cleanup tiers

| Tier | What | Who acts |
|---|---|---|
| Delete now | Branches with a proof (nothing on them main lacks, or the PR merged and the tip equals the merged head, or every changed file is identical on main). Workflow artifacts older than 3 days. Caches of closed PRs and caches idle for 7 days (main's caches stay). | The scheduled workflow, daily, and `hygiene.mjs --apply`. Each deleted branch prints its sha and the restore command. |
| Ask once | A branch with work not on main, a parked `wip/` branch, a branch whose PR closed unmerged, any Neon branch, any Vercel setting. | The agent lists them in one batch with a recommendation. The owner answers. |
| Never | The default branch, protected branches, a branch with an open PR (as its head or as the base of another PR), the session's own branch, anything touched in the last 48 hours. | Refused even when the owner names the branch; change the config or wait. |

Neon branches follow the proof list in CLAUDE.md section 7 and always need the owner's yes for the exact list. There is no tool to delete Vercel deployments; the agent reports stale ones.

## Commands

```bash
node scripts/steward/preflight.mjs --brief
node scripts/steward/preflight.mjs --plan "apps/web/src/app/app/mission/**" --topic "case page tabs" --migration
node scripts/steward/hygiene.mjs
node scripts/steward/hygiene.mjs --apply
node scripts/steward/audit.mjs
```

In a session, `/steward start <task>`, `/steward intake <new instruction>`, `/steward close`, `/steward sweep`.

## Dropping branches the owner chose

The sweep never deletes unmerged work. When the owner decides to drop named branches, run the Steward hygiene workflow by hand with "delete_branches" set to the names and "apply" ticked (or `node scripts/steward/hygiene.mjs --delete a@sha,b --apply` where the token allows it). Without "apply" it is a dry run that shows what would go. Add `@sha` after a name to pin the tip the owner reviewed: a branch whose tip moved is kept. The same refusals as the sweep apply (default and protected branches, open pull requests as head or base, the current branch, anything touched in the last 48 hours), the tip is read again just before each delete, and a run where any named branch is not deleted fails so it cannot look green. Each deleted branch prints its sha and the restore command.

## Adding another repository

```bash
node scripts/steward/install.mjs ../other-repo --repo owner/other-repo
```

Add `--with-workflow` to also install the daily cleanup workflow; without it nothing is ever deleted automatically in the other repository. Then open `scripts/steward/steward.config.json` in that repository and set its required checks, protected branches, hot files, migration folder and audit gates. The installer never overwrites an existing config and never removes a hook that is already there.

## Limits (what it does not do yet)

- A session that has neither pushed nor claimed is invisible to the file comparison; the agent also asks the session list, which sees running sessions across repositories.
- Workflow caches cannot be listed from a cloud session (the session proxy blocks that path); the scheduled workflow handles them.
- Unused exports and dead code are not detected yet. Orphan pages are covered by the route graph check. A baseline-ratchet unused-code check is the next package.
- The audit runner needs the repository's dependencies installed for the gates that use them.
