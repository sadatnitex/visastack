# ADR-0008: Persistence — Drizzle migrations, PGlite-tested, append-only audit

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** VisaStack engineering
- **Spec link:** Build Spec §9, §14, §15.

## Context

Neon PostgreSQL is the mandated canonical writable store (ADR-0007). We need
reviewed, reversible migrations, and — because this is a remote-first project
with no local database — a way to test the schema, its constraints, and the
audit guarantees in CI without provisioning a live database.

## Decision

- **Drizzle ORM + Drizzle Kit.** The schema is defined in `@visastack/db`;
  `drizzle-kit generate` produces SQL migrations offline (no DB connection).
  Enums mirror the core domain vocabularies so the database and the type
  system share one source of truth.
- **PGlite for tests.** Tests run migrations against an in-memory Postgres
  (`@electric-sql/pglite`) and assert real behavior: FK enforcement, unique
  constraints, enum validation, and audit immutability. Same SQL that runs
  on Neon, no external service.
- **Append-only, tamper-evident audit.** `audit_events` carries a SHA-256
  hash chain (`hash = sha256(prevHash + canonical(fields))`) and database
  `RULE`s that make `UPDATE`/`DELETE` no-ops. Restricted operations still
  fail closed at the application layer if the audit row cannot be written
  (Build Spec §14).

## Consequences

- **Positive:** schema correctness and the append-only guarantee are proven
  in CI on every PR, with zero external dependencies; migrations are
  reviewable SQL.
- **Trade-offs:** the audit `RULE`s silently drop mutations (defense in
  depth), so the hash chain remains the primary *detection* mechanism; the
  read-latest-then-append step must run in a serialized transaction in
  production to keep the chain gapless under concurrency.
- **Follow-ups:** wire the Neon driver + `migrate` in the app/service layer;
  add the applicant-core tables (facts, documents, missions, grants) in
  their phases; add tenant-isolation integration tests over real rows.

## Alternatives considered

- **Testcontainers Postgres** — real Postgres but needs Docker, which the
  remote CI/dev model avoids; PGlite gives equivalent SQL coverage in-process.
- **Mocking the database** — would not exercise real constraints or the
  append-only rules; rejected.
