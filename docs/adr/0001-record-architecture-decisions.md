# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** VisaStack engineering

## Context

VisaStack is a long-lived, security-sensitive platform that must be
"easy to manage, update, and upgrade" over many years and contributors.
Decisions made implicitly get re-litigated and eroded. We need a durable,
low-friction record of *why* the system is the way it is.

## Decision

We record significant technical decisions as **Architecture Decision
Records (ADRs)** in `docs/adr/`, using the format in
[`0000-template.md`](0000-template.md). ADRs are immutable once accepted;
a change of direction is a new ADR that supersedes the old one.

## Consequences

- **Positive:** onboarding is faster; decisions are traceable to context;
  reviewers can challenge the *decision*, not just the code.
- **Trade-offs:** a small authoring cost per decision.
- **Follow-ups:** link ADRs from PRs that implement or change them.

## Alternatives considered

- **Wiki / external doc** — drifts from code, not reviewed in PRs.
- **No formal record** — decisions become tribal knowledge; rejected.
