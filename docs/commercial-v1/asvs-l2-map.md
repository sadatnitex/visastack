# OWASP ASVS 5.0 Level 2 Control Map

Chapter structure confirmed live against the current ASVS 5.0.0 CSV
(`OWASP/ASVS` GitHub repository, fetched this session; not from memory —
ASVS 5.0 restructured chapter numbering significantly from 4.0, so this session
did not assume the old numbering carried over). This is a verification target and
progress map, not a certification claim; see `docs/commercial-v1/threat-model.md`
for the underlying threat analysis this map is checked against.

Granularity: chapter-level with the specific sub-areas this codebase's own evidence
actually speaks to. Full control-by-control line items are added incrementally as
each part of the programme implements and tests the relevant area, per Part 1's own
instruction not to claim VERIFIED without evidence. "N/A" is used only where a
chapter genuinely does not apply to this system's architecture, with reasoning.

| Chapter | Implementation (this session's evidence) | Test evidence | Status |
|---|---|---|---|
| V1 Encoding and Sanitization | Not yet independently audited this session (output encoding, filename/note/AI-output sanitization). Directive Part 9 §6 explicitly lists this scope for later. | None yet | NOT_STARTED |
| V2 Validation and Business Logic | Service-layer input validation confirmed present at every function read this session (e.g. `profile.ts` rejects unknown field keys, non-repeating fields given a repeat key; `agency.ts` rejects empty/over-length notes, mismatched requirement kinds). Business-logic invariants (state-machine transitions in `missions.ts`, exactly-one-of factId/documentId in `selectEvidence`) are enforced in code, not just at the DB layer. | `packages/services` test suite (338 tests, all passing this session) exercises many of these paths per-function, e.g. `agency.test.ts`'s scope/read-authorization hardening block. | REUSE, partially verified |
| V3 Web Frontend Security | Not yet audited this session (CSP, security headers, cookie flags, CSRF). Directive Part 9 §6 scope. | None yet | NOT_STARTED |
| V4 API and Web Service | Server actions/API routes confirmed to call into `packages/services` for the functions read this session, not reimplement authorization inline (matches `docs/governance/integration-and-cleanup-directive.md`'s "All UI must call the canonical service layer" rule). Full route-by-route audit not yet done. | Partial (service-level only) | REUSE, partially verified |
| V5 File Handling | Real gap, confirmed: `realMalwareScanner` gate hardcoded `false`; `BasicSafetyScanner` is structural/magic-byte validation only (ADR-0011, not disputed by this repo itself). Part 3 scope. | `adapters.test.ts`'s `BasicSafetyScanner` suite (passing) proves the structural checks that do exist work as designed — it does not and cannot prove malware detection. | REPLACE, NOT_STARTED |
| V6 Authentication | WorkOS AuthKit is the identity provider (no parallel auth stack, confirmed). **Staff/reviewer/support/admin MFA is still not enforced anywhere as of this update, confirmed both in application code (`withSession`) and live against VisaStack's actual production WorkOS environment (`mfaEnabled: "Off"`).** Product owner decided universal MFA (`assumptions-and-blockers.md`); this session's own attempt to flip the live setting was refused by WorkOS itself (`FORBIDDEN`, the connected account's role lacks permission for that operation on Production). Blocked purely on the product owner making that one change directly in the WorkOS dashboard now, not on an open decision. Full detail: `threat-model.md`. | `step-up.test.ts` (passing) proves recency-based step-up works as designed; it does not test MFA-factor enforcement, because none exists to test yet. | REPAIR, confirmed gap, BLOCKED on product owner |
| V7 Session Management | Session lifetime targets (staff idle 30 min / absolute 12h, traveller 7 days) from the PRD not yet verified against actual configured values. `checkRecentAuth`'s 5-minute step-up window matches the PRD exactly (confirmed in `step-up.ts`). Server-side revocation on suspension/removal: `evaluateBase` in `authorize.ts` denies on `!membership.active`, re-evaluated per call, not cached — a real property, not yet traced all the way to a live HTTP request test. | `step-up.test.ts` (passing) for the 5-minute window. Session-timeout values not yet tested. | EXTEND, partially verified |
| V8 Authorization | The strongest-evidenced chapter this session. `packages/policy` is a real, tested, default-deny engine (`authorize.test.ts` exists); every service function read this session routes through it or an equivalent explicit ownership/grant check; denials are audited. Confirmed gaps: no scoped/time-limited support-access-grant object yet (SEC-06); full endpoint-by-endpoint coverage (lists, counts, cached results, jobs) not yet exhaustively audited across the whole `apps/web` surface. | `authorize.test.ts` (policy engine unit tests) plus extensive `agency.test.ts`/`missions.test.ts`-style coverage of the actual cross-tenant boundary cases (findings #3-#7, #31, #32 from the post-programme defect register), all passing this session. | REUSE, strong partial evidence |
| V9 Self-contained Tokens | WorkOS-issued access tokens are the only self-contained tokens in play; this app does not mint its own JWTs for primary auth. The step-up assurance token (`issueStepUpAssurance`/`verifyStepUpAssurance`, HMAC-signed, action/resource-bound, short-lived) is the one app-minted token and was read this session — signing-secret-gated, fails closed if unconfigured (`STEP_UP_NOT_CONFIGURED_MESSAGE`). | `step-up.test.ts` (passing). | REUSE, partially verified |
| V10 OAuth and OIDC | WorkOS handles the OAuth/OIDC relationship with upstream identity sources; this app is a relying party via AuthKit, not an OAuth/OIDC implementer itself. Live query this session also surfaced that only `isSsoEnabled` is true on production with every individual social-OAuth provider flag false — worth the product owner's attention as a possibly-incomplete sign-in configuration, though outside this chapter's direct security scope. | N/A beyond what V6 already covers | REUSE (delegated to WorkOS) |
| V11 Cryptography | Envelope-key architecture built and genuinely wired end to end (SEC-03): `KeyManagementPort`, AES-256-GCM with a fresh nonce and subject/record/field/version-bound AAD per write, `LocalEnvelopeKeyProvider` as an explicitly non-commercial dev/test adapter (self-refuses to construct once `DEPLOYMENT_MODE=commercial`). A real, previously-undocumented gap was found and fixed this update: the encryption logic existed but neither real caller (the manual-edit and AI-approval server actions) ever supplied a port, so every SENSITIVE/RESTRICTED save was failing closed for every real user, not silently plaintext, but also not usable. Now wired via `createKeyManagementPort()` (`apps/web/src/lib/providers.ts`). A retroactive backfill capability (`backfillProtectedFields`, `packages/services/src/encryption-backfill.ts`, plus a runnable CLI script) exists for any plaintext rows a future field reclassification produces. Remaining gaps: the deployed master key is not yet set in Vercel, so the fix is not yet live in production; no real KMS vendor is integrated (`LocalEnvelopeKeyProvider` is explicitly not one); AI proposals/OCR/snapshots/exports/cache are unprotected (Parts 7/8 scope). | `protected-fields.test.ts` (11 tests: round-trip, tamper/AAD-mismatch rejection, fail-closed with no port, cross-port isolation), `providers.test.ts`'s `createKeyManagementPort` block, `ai.test.ts`'s RESTRICTED-approval test, `encryption-backfill.test.ts` (7 tests), all passing. | REPAIR, implemented and wired, IN_PROGRESS |
| V12 Secure Communication | Deployment-edge HTTPS/TLS is a Vercel platform property, not application code; not independently re-verified this session. | None yet | NOT_STARTED |
| V13 Configuration | `.env.example` and the environment-variable table in `README.md` show a real, documented configuration surface; secrets are read via `process.env`, never hardcoded, in every file read this session. Full secret-handling audit (rotation, KMS-backing for AI provider keys per AI-07) is Part 8 scope. | N/A | REUSE, partially verified |
| V14 Data Protection | Overlaps V11. Retention/erasure (`legalHolds`, `retentionPolicies`, `erasureJobs`) is a real, tested, durable subsystem (erasure job leasing/fencing/multi-version handling read this session in `schema.ts`'s comments and confirmed passing in `erasure.test.ts`, 25 tests). Encryption-at-rest for protected fields is now implemented and wired, per V11 above, not a plain gap anymore, though not yet live in production pending the deployed master key. | `erasure.test.ts` (25 tests, passing); V11's evidence for encryption. | REUSE (retention/erasure) + REPAIR (encryption, implemented) |
| V15 Secure Coding and Architecture | Modular monolith, one canonical service layer, ports/adapters for storage/scanning/AI (ADR-0002, 0009, 0010, 0011) — matches the directive's own architecture invariants (Part 1 §8) closely; this is a genuine existing strength, not something this programme needs to build. | Full repository test suite (lint/typecheck/test/build all green this session). | REUSE, strong evidence |
| V16 Security Logging and Error Handling | `auditEvents` append-only hash-chained log (DB-level `RULE`s confirmed this session) covers domain-mutation logging well. Structured, PII-safe application error/request logging not yet independently audited. Periodic signed checkpoint/anchor now built (SEC-04): `audit-checkpoints.ts`'s `createAuditCheckpoint`/`verifyCheckpointSignature`/`verifyCheckpointAgainstChain`, HMAC-SHA256 over `(fromSeq, toSeq, chainHeadHash)`, `audit_checkpoints` append-only at the DB level via the same RULE pattern. Remaining: no scheduled/periodic caller wired up yet (operational wiring, later part); no true external anchor outside this database. | Extensive audit-event assertions across `profile.ts`/`missions.ts`/`agency.ts` tests (passing). `audit-checkpoints.test.ts` (9 tests, including a genuine tamper-detection test that disables the append-only RULE to simulate a bypass), passing. | REUSE (audit log) + NEW (checkpoint/anchor, implemented) |

## Summary for this part's own scope (Part 2: IAM-01/02, ARC-01..04, SEC-01/03/04/06/07)

### Update (2026-09-17)

**V11/V14 Cryptography/Data Protection** moved from NOT_STARTED to implemented and wired:
the architecture is built, a real wiring bug that made it unusable for every real user was
found and fixed, and a retroactive backfill capability now exists. It is not yet live in
production (the deployed master key is still pending) and no real KMS vendor is integrated.

**V6 Authentication** (staff MFA) is unchanged in outcome, still off in production, but the
open question is resolved: the product owner decided universal MFA and this session's own
attempt to flip it was refused by WorkOS's own permission system, not left undecided. It is
now blocked purely on the product owner completing that one WorkOS-dashboard action.

**V16 Security Logging** gained real evidence this update too: the periodic signed
checkpoint/anchor capability (SEC-04) that was previously unbuilt now exists and is tested.

Original summary, still accurate for what it covers: the two chapters with the most severe,
concretely-confirmed gaps directly in this part's primary requirement list were **V6
Authentication** (staff MFA, IAM-01/SEC-01) and **V11/V14 Cryptography/Data Protection**
(protected-field encryption, SEC-03). Both are addressed by this part's schema and
service-layer work; V6's full resolution additionally depends on a product-owner decision
recorded in `assumptions-and-blockers.md`, since the only fully-reliable mechanism this
session found (WorkOS's environment-wide `mfaEnabled` setting) is broader than the PRD's own
stated scope (staff-only, not traveller-mandatory), a decision the product owner has since
made (see the update above).


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
