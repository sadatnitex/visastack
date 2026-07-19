# ADR-0003: Monorepo with Turborepo and pnpm

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** VisaStack engineering

## Context

The product is a platform: a Universal Core, composable packs, a document
pipeline, an AI gateway, and a web app, each with its own lifecycle but
sharing types and domain rules. We need strong module boundaries with
cheap cross-package refactoring, and fast, cached CI.

## Decision

Use a single repository organized as a **pnpm workspace** (`apps/*`,
`packages/*`) with **Turborepo** orchestrating tasks (`build`, `typecheck`,
`test`, `lint`) and caching their outputs.

- Internal packages are consumed as TypeScript source via
  `transpilePackages`, keeping the inner dev loop free of build steps.
- Dependencies point **inward** toward `packages/core`; Core depends on
  nothing framework- or infrastructure-specific.

## Consequences

- **Positive:** atomic cross-package changes; shared types; incremental,
  cached CI; clear ownership via CODEOWNERS.
- **Trade-offs:** monorepo tooling has a learning curve; task graph must
  be kept honest (e.g. typecheck ordering vs. generated files).
- **Follow-ups:** add packages per concern (`auth`, `db`, `permissions`,
  `pipeline`, `ai-gateway`, `packs`, `i18n`) as their phases begin.

## Alternatives considered

- **Multi-repo** — high coordination cost for shared domain types;
  rejected for a tightly-coupled platform.
- **npm/yarn workspaces without Turborepo** — lose task caching and the
  orchestrated graph; rejected.
