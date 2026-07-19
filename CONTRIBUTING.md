# Contributing to VisaStack

VisaStack is built **remote-first**: there is no required local setup.
All work happens through GitHub and deploys through Vercel. CI is the
source of truth for quality — if it is green, the change is mergeable.

## Golden rules

1. **Traceability.** Every non-trivial change links to a PRD clause and/or
   Build Specification section. If the spec doesn't cover it, the spec
   changes first (via an ADR or RFC), then the code.
2. **No silent mutation.** Domain state changes go through explicit,
   versioned, approved proposals — never a quiet write.
3. **Fail closed.** When in doubt about a permission, deny and audit.
4. **Small, reversible steps.** One concern per PR.

## Branching

- `main` is protected and always deployable.
- Feature branches: `claude/<topic>` or `feat/<topic>`.
- Open a **draft PR** early; mark ready when CI is green and the
  acceptance criteria are met.

## Local commands (optional — CI runs all of these)

```bash
pnpm install            # install workspace
pnpm run lint           # Biome format + lint
pnpm run build          # build all apps/packages
pnpm run typecheck      # strict TypeScript across the workspace
pnpm run test           # unit tests
pnpm run check          # lint + typecheck + test in one shot
```

## Architecture boundaries

- `packages/core` (Universal Core) must not import framework or
  infrastructure code. Dependencies point **inward** toward Core.
- Infrastructure (DB, storage, auth, AI) lives behind its own package and
  is swappable without touching domain rules.

## Decisions

Significant technical decisions are recorded as ADRs in `docs/adr/`.
Propose one by copying `docs/adr/0000-template.md`.
