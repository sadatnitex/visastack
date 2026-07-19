# ADR-0002: Remote-first delivery (GitHub + Vercel, no local setup)

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** VisaStack engineering

## Context

The team operates without a standardized local development environment.
Delivery must be reproducible and not depend on any one machine. The PRD
mandates GitHub/Claude delivery governance and a concrete production
baseline.

## Decision

All development, verification, and deployment happen through hosted
services:

- **GitHub** — source of truth, CI (GitHub Actions), code scanning,
  branch protection, and governance.
- **Vercel** — preview deployments per pull request and production
  hosting for `apps/web`.

Local commands remain available and documented, but **CI is the
authority**: a change is mergeable if and only if CI is green. No workflow
step may require a developer's local machine.

## Consequences

- **Positive:** reproducible builds; every PR gets an isolated preview;
  no "works on my machine"; contributors need only a browser.
- **Trade-offs:** iteration depends on hosted runner latency; some
  capabilities (malware scanning, KMS, durable pipelines) require external
  services beyond Vercel primitives — provisioned per ADR-0007.
- **Follow-ups:** connect the Vercel project; configure preview env vars;
  document branch protection.

## Alternatives considered

- **Local-first with optional CI** — contradicts the operating constraint
  and weakens reproducibility; rejected.
