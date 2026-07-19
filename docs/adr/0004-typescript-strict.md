# ADR-0004: TypeScript everywhere, maximally strict

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** VisaStack engineering

## Context

The platform handles sensitive data with hard correctness requirements
("no silent mutation", fail-closed permissions, recoverable failures).
We want to make illegal states unrepresentable and catch defects at
compile time rather than in production.

## Decision

All code is **TypeScript** compiled with a strict base config
(`tsconfig.base.json`) that enables, beyond `strict`:
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`,
`noPropertyAccessFromIndexSignature`, and `verbatimModuleSyntax`.

Domain conventions in `packages/core`:

- **Branded types** for identifiers so, e.g., an `ApplicantId` cannot be
  passed where a `WorkspaceId` is expected.
- A **`Result` type** for expected, recoverable failures instead of
  throwing — the failure branch cannot be silently ignored.

## Consequences

- **Positive:** far fewer runtime type errors; refactors are safe;
  correctness guarantees are enforced by the compiler.
- **Trade-offs:** stricter flags occasionally require more explicit code;
  worth it for this domain.
- **Follow-ups:** carry these conventions into every new package.

## Alternatives considered

- **JavaScript + JSDoc** — weaker guarantees; rejected.
- **Default (non-strict) TS** — permits the exact classes of bug we most
  need to prevent; rejected.
