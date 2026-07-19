# ADR-0005: Toolchain — Biome, Vitest, GitHub Actions

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** VisaStack engineering

## Context

A remote-first, CI-authoritative workflow rewards a fast, low-config
toolchain with few moving parts. We want formatting, linting, and testing
to be deterministic and quick on hosted runners.

## Decision

- **Biome** for formatting **and** linting (one binary, fast, replaces
  ESLint + Prettier). Config in `biome.json`.
- **Vitest** for unit tests (fast, TS-native, Jest-compatible API).
- **Playwright** for end-to-end tests (added when there are flows to
  drive; environment ships a preinstalled browser).
- **GitHub Actions** for CI: lint → build → typecheck → test, with
  concurrency cancellation and dependency caching.

## Consequences

- **Positive:** minimal config surface; fast feedback; fewer tool
  conflicts; single source of formatting truth.
- **Trade-offs:** Biome's rule set is narrower than the full ESLint
  ecosystem; framework-specific lint rules (e.g. Next.js) may be added
  separately if needed.
- **Follow-ups:** add Playwright + axe accessibility checks in the a11y
  phase.

## Alternatives considered

- **ESLint + Prettier** — more plugins, slower, more config drift;
  rejected for Phase 0. Revisit only if a needed rule is Biome-only-absent.
- **Jest** — slower startup, heavier config than Vitest; rejected.
