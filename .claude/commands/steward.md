---
description: Steward - check for clashes before a task, absorb a new instruction, clean up after a merge, or sweep for clutter and risk
argument-hint: start <task> | intake <new instruction> | close | sweep | audit
---

Follow the playbook in `.claude/agents/steward.md` for this request, in the mode named first: $ARGUMENTS

Run the mode inline: the scripts print short summaries, so a separate agent is only worth it for `sweep` (Neon and Vercel inventory), where you may delegate to the `steward` agent with a complete brief. If no mode is named, treat it as `start`.

Report briefly and plainly. End with what was done and one next step.
