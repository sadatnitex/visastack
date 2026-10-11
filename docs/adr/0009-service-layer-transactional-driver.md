# ADR-0009: Applicant Core service layer runs on a transaction-capable driver

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** VisaStack engineering
- **Spec link:** Build Spec §8, §9, §11, §13, §14, §15.

## Context

The Foundation gave us the canonical schema (`@visastack/db`), the default-deny
policy engine (`@visastack/policy`), and the tamper-evident audit primitives.
Applicant Core (Build Spec Phase 1 / PRD 2) adds the **write side**: account
provisioning, separated consent, applicant/family records, and the manual
Master Profile editing path.

Two invariants shape the design:

1. **No silent mutation (Build Spec §9).** A profile value is never
   overwritten. An edit appends an immutable `factVersion` and atomically
   re-points the `fact` at it.
2. **Fail-closed audit (Build Spec §14).** Every audited mutation and its
   hash-chained `audit_events` row must commit together, or not at all. The
   chain's read-head-then-append must be serialized so it never gaps or forks.

Both require a **real, interactive database transaction** wrapping several
statements. The `neon-http` driver used by the stateless readiness probe
(ADR-0008) issues one HTTP round-trip per statement and does **not** support
interactive transactions.

## Decision

- **New package `@visastack/services`** holds the Applicant Core application
  services. It is driver-agnostic: it accepts a `Db` handle
  (`PgDatabase<…, schema>`) and never constructs a client.
- **Every mutation runs inside `db.transaction(...)`.** Within the transaction
  the service performs its writes and calls `appendAuditEvent`, which takes a
  Postgres **advisory transaction lock** (`pg_advisory_xact_lock`), reads the
  current chain head, and appends the next hash. Lock + transaction make the
  append race-free and atomic with the mutation.
- **Authorization is delegated to the policy engine.** `editFact` asks
  `authorize()` for an explicit decision (default-deny); denials are audited.
- **Consent gates data creation.** Creating a subject record or editing a fact
  requires the account's `CORE_PROCESSING` consent — fail-closed.
- **The runtime handle MUST be transaction-capable:** the pooled
  `drizzle-orm/neon-serverless` client in production, or PGlite in tests. The
  `neon-http` client remains only for the stateless probe.

## Consequences

- **Positive:** the "no silent mutation" and "fail-closed audit" guarantees are
  enforced structurally and proven in CI against in-memory PGlite (15 tests,
  including a full mixed-event hash-chain verification). Services read
  identically in tests and production.
- **Trade-offs:** wiring the services into Next.js route handlers (a later
  slice) must construct the pooled `neon-serverless` client, not reuse the
  `neon-http` probe client. This is documented at the `Db` type and enforced by
  runtime behavior (a transaction call throws on `neon-http`).
- **Operational hazard (WebSocket frame masking):** the pooled
  `neon-serverless` driver reaches Neon over a WebSocket via `ws`. When `ws` is
  bundled, its optional `bufferutil` require is mangled and frame masking breaks
  (`TypeError: b.mask is not a function` → "Connection terminated
  unexpectedly"), 500-ing every DB-backed page on its first query. Mitigated in
  code, and it must stay: `next.config.mjs` keeps `@neondatabase/serverless` and
  `ws` in `serverExternalPackages`, and the web app's `instrumentation.ts` sets
  `WS_NO_BUFFER_UTIL` / `WS_NO_UTF_8_VALIDATE` before `ws` evaluates so it uses
  the pure-JS masker, which survives bundling. `withSession` also attaches an
  `error` listener to the pool so a dropped idle connection can't crash the
  invocation, and logs the real cause behind Next.js's opaque digest. See the
  operations runbook.
- **Follow-ups:** account export + deletion workflow; then the WorkOS AuthKit
  login slice that supplies the authenticated `actorAccountId` these services
  expect; then wiring HTTP endpoints on the pooled driver.

## Alternatives considered

- **Keep using `neon-http` and emulate atomicity in application code** —
  rejected: no way to make the mutation and audit append atomic, so the audit
  could not fail closed.
- **A single batched multi-statement call** — `neon-http` batches are not
  interactive, so the read-head-then-append (which depends on a prior read)
  cannot be expressed; rejected.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
