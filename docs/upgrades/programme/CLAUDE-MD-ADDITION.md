# Proposed addition to CLAUDE.md (needs the owner's approval)

Add this under section 2, Authority, in `CLAUDE.md`. It makes every Claude Code session on this programme find the same rules without pasting them.

```text
- Programme X (UX/UI upgrade plus upgrade.v1.2): for any task on a branch named claude/prog-*, read docs/upgrades/programme/STATUS.md first, then only your package in docs/upgrades/programme/WORK-PACKAGES.md. Master contract: docs/upgrades/programme/PROGRAMME.md. Functional spec: docs/upgrades/upgrade.v1.2.execution.md. Landing and colour reference: docs/design/harbor-v2/.
- For this programme only, every PR needs the owner's explicit merge word. This narrows the auto-merge rule in section 3. The final release-candidate rule is unchanged.
- Never edit a file outside the package allowlist (docs/upgrades/programme/allowlists/<package>.txt). Check with: node scripts/programme/check-allowed-paths.mjs <allowlist> --no-emdash
- If two sources conflict and the conflict register in PROGRAMME.md does not cover it, stop and ask the owner.
```

Why each line exists: the first routes a session to the right small set of files, the second records the owner's decision D6 so the standing auto-merge rule is not applied by mistake, the third is the drift guard, and the fourth stops silent compromises.
