# ADR-0006: Identity and tenancy via WorkOS AuthKit

- **Status:** Accepted (integration in Phase 1)
- **Date:** 2026-07-19
- **Deciders:** VisaStack product + engineering

## Context

VisaStack is multi-tenant: verified **agencies/organizations** and
individual applicants. The PRD requires passkeys, MFA, step-up
authentication, session revocation, agency verification, blocked
self-upgrade, and strict prevention of organization-wide data visibility.
Building this in-house is high-risk and slow.

## Decision

Adopt **WorkOS AuthKit** as the identity provider:

- Passkeys, MFA, and step-up flows out of the box.
- First-class **Organizations** and directory model that maps cleanly to
  agencies and tenant isolation.
- SSO/SAML available for future enterprise (employer/law-firm) scope
  without re-platforming.

Authentication is wrapped behind a `@visastack/auth` package so the rest
of the system depends on our interface, not the vendor SDK directly —
preserving the option to migrate.

## Consequences

- **Positive:** strong, audited auth primitives; org model fits the
  agency/tenant requirement; step-up and passkeys are supported natively.
- **Trade-offs:** external dependency and cost; requires WorkOS account
  and env configuration (`WORKOS_*` in `.env.example`).
- **Follow-ups:** design the tenancy + role model against the PRD's
  permission dimensions; implement verification and anti-self-upgrade
  logic in `@visastack/permissions`.

## Alternatives considered

- **Clerk** — excellent DX and passkeys/orgs, slightly less enterprise
  directory depth; strong second choice.
- **Supabase Auth** — consolidates vendors but org/verification/step-up
  need substantial custom build; rejected for the tenancy requirements.
- **Roll our own** — unjustified security risk; rejected.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
