# ADR-0010: Document pipeline & AI Gateway as provider-agnostic ports

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** VisaStack engineering
- **Spec link:** Build Spec §6, §8, §9; PRD §3.

## Context

Phase 2 (Document Intelligence) needs a safe upload pipeline, deterministic
parsing, and AI-assisted field extraction. Two of these depend on external
infrastructure not yet provisioned — a malware scanner and object storage (S3
+ KMS) for the pipeline, and a model provider (OpenAI GPT-5.6 Terra) for
extraction. We must not block the reviewable, testable domain logic on those
accounts, and we must never hard-code a provider or address (remote-first).

## Decision

- **Ports at every external boundary.** `ScannerPort`, the existing
  `StoragePort`, and `AiExtractionPort` are injected; the domain depends only
  on the interfaces. Real adapters (ClamAV/S3/KMS, OpenAI) are thin edge code
  added when keys exist. Tests use deterministic fakes.
- **Intake is a resumable state machine.** `processIntake` advances
  UPLOADING → QUARANTINED → SCANNING → NORMALIZING → EXTRACTING →
  AWAITING_REVIEW, each transition separately committed and audited. A thrown
  scan leaves the version parked (recoverable); re-running continues; an
  already-terminal version is a no-op (idempotent). Unsafe scans divert to
  NEEDS_ATTENTION and never reach processing.
- **Deterministic parsing before AI.** `parseTd3` reads passport MRZ with ICAO
  7-3-1 check-digit validation, rejecting misreads rather than trusting them.
- **AI proposes; humans approve.** `runExtraction` (consent-gated on
  AI_EXTRACTION, cost-budgeted, audited) returns `FieldProposal[]` and writes
  nothing. A proposal reaches the Master Profile only via `approveProposal`,
  which reuses `editFact` for an atomic, immutable, provenance-tagged approval
  (method DOCUMENT, source version, model/prompt). UNMAPPED/unknown fields are
  rejected. This structurally enforces "no silent mutation" and "no
  unsupported field ID persisted."

## Consequences

- **Positive:** the full pipeline and AI-proposal invariants are proven in CI
  against fakes, with zero external dependencies; wiring the real scanner,
  storage, and model is isolated, low-risk edge work.
- **Trade-offs:** the accuracy benchmark in the Phase 2 gate can only be
  measured once the real model adapter is connected; until then the gate's
  behavioral invariants (no silent mutation, no invented fields) are met but
  the numeric thresholds are pending.
- **Follow-ups:** S3+KMS storage adapter and ClamAV scanner adapter; the
  OpenAI GPT-5.6 Terra adapter; correction-feedback learning; embedded-text and
  table extraction beyond MRZ.

## Alternatives considered

- **Wait for AWS/OpenAI accounts before building** — rejected; it would stall
  all of Phase 2 behind external provisioning the user handles separately.
- **Let extraction write facts directly with a confidence threshold** —
  rejected; violates the non-negotiable "no silent mutation" rule (Build
  Spec §8).
