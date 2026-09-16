# Commercial V1 Architecture Decisions

Format: one entry per decision, in the style of `docs/adr/`. This file tracks decisions
specific to the Commercial V1 programme; see `docs/adr/` for the repository's standing ADRs
(identity/WorkOS, persistence, provider stack, document pipeline, and so on), which this
programme extends rather than replaces, per the directive's architecture invariants
(Part 1 Section 8).

## AD-01: Protected-field envelope encryption (SEC-03)

**Decision.** Add a `KeyManagementPort` (`packages/services/src/ports.ts`) following this
repo's existing ports-and-adapters convention (`StoragePort`, `AiExtractionPort`,
`MalwareScannerPort`). It wraps/unwraps 256-bit data keys; field values are encrypted
directly with the unwrapped data key using AES-256-GCM (Node's built-in `crypto`, OpenSSL,
never a hand-rolled cipher), a fresh random nonce per write, and AAD binding subject
(applicantId), record (factId), field (fieldKey), and version (factVersionId) —
`packages/services/src/protected-fields.ts`. Only the KMS-wrapped form of the data key is
ever persisted (`data_keys.wrapped_data_key`), so a database dump alone cannot decrypt
protected fields.

**Schema.** Additive columns on `fact_versions` (`value_ciphertext`, `value_nonce`,
`protected_key_version`), a new `data_keys` table (wrapped keys only), migration
`0028_unknown_sandman.sql`. A check constraint enforces a row is never simultaneously
plaintext and protected, and the three protected columns are always set together or not at
all — see the constraint's own comment in `packages/db/src/schema.ts` for why it was written
permissively about "neither set" rather than assuming every existing/future row always has a
value.

**Why not per-record KMS calls.** A KMS call per field write/read (rather than per key
version) would be correct but slow and costly at scale. Wrapping once per key version and
caching the unwrapped data key in-process (`protected-fields.ts`'s `unwrappedKeyCache`) is the
standard envelope-encryption pattern and matches this repo's general preference for the
lowest-complexity correct option (directive Part 1 Section 8).

**Why `editFact`'s signature changed the way it did.** Adding a required positional
`KeyManagementPort` parameter would have touched roughly 37 existing call sites (found by
grep) for no functional benefit, since every field registered by existing code defaults to
`STANDARD` sensitivity and never needed protection. Instead, `encryption` is an optional field
on the existing `EditFactInput` object: omitted, behavior is unchanged; supplied, it's used
only when the field's registry sensitivity actually requires it. A SENSITIVE/RESTRICTED field
edited with no port supplied is a hard `encryption_unavailable` error, not a silent plaintext
write — fail closed, per the directive's own repeated instruction.

**What this covers today, and what it deliberately does not yet.** Only
`packages/services/src/profile.ts`'s fact/fact-version read/write path is wired
(`editFact`, `listApplicantProfile`, the new `revealFactVersionValue`). SEC-03's full stated
scope also names AI proposals/snippets, OCR text, corrections, snapshots, exports, and cache —
none of those are touched by this change. This is a deliberate, named scope boundary for this
Part 2 commit, not an oversight: those surfaces belong to the parts that actually build them
(AI proposals: Part 8; snapshots: Part 7; exports: Part 7). Tracked in
`docs/commercial-v1/known-issues.md`.

**What remains BLOCKED.** No real KMS account exists for this session (AWS KMS / GCP KMS /
etc — vendor choice not yet made, see `cost-and-vendor-register.md`). The pilot/dev/test
implementation, `packages/adapters/src/key-management.ts`'s `LocalEnvelopeKeyProvider`, wraps
with a locally-held master key rather than a real external KMS and explicitly refuses to
construct when `DEPLOYMENT_MODE=commercial` (mirroring how `NullEmailPort` is gated). A real
KMS adapter, and live verification that "a database dump cannot decrypt protected data" holds
against an actual external key service, are a genuine future PR — not simulable without a
live account.

**Historical plaintext.** No backfill of already-written plaintext `fact_versions` rows was
performed. This repository is a controlled pilot on synthetic/internal data (README's own
status banner), not live customer data, which lowers the urgency relative to a real
production migration; a resumable, dry-run-capable backfill (per directive Part 2 Section 8)
is still owed before commercial launch and is tracked as open work.

## AD-02: Support access grants (SEC-06)

**Decision.** A new `support_grants` table, distinct from the applicant-created `grants`
table `sharing.ts` already manages — this one is created BY a platform operator ABOUT an
applicant who never consented to it, so it carries mandatory `reason` and
`approved_by_account_id` fields, and the database itself enforces both a maximum 60-minute
duration and a no-self-approval rule via check constraints
(`support_grants_max_duration`, `support_grants_approver_not_actor`) — proven in
`support-access.test.ts` to hold even if a caller bypassed the service layer entirely, not
just as application-level convention.

**Why it reuses the policy engine's `Grant` shape instead of a new evaluation path.**
`packages/policy/src/authorize.ts` already had a real `support_admin` actor case, evaluated
identically to any other grant recipient. `loadSupportGrantsForPolicy`
(`packages/services/src/support-access.ts`) converts a non-revoked `support_grants` row into
that same `Grant` shape for merging into `AuthContext.grants`, so expiry/status/purpose/scope
enforcement is the same tested code path every other grant already goes through — not a
second, parallel authorization mechanism (directive Part 1 Section 8 forbids exactly that
kind of duplication).

**What remains.** No caller in `apps/web` invokes `createSupportGrant`/`revokeSupportGrant`
yet — this Part 2 commit delivers the service/schema/policy-integration layer with full test
coverage, not an admin UI. UI wiring (an actual "request support access" flow with
platform-role-gated approval) is Part 5/9 admin-workspace territory per the directive's own
sequencing (ADM-01), tracked in the requirements ledger rather than built prematurely here.

## AD-03: Externally-signed audit checkpoints (SEC-04)

**Decision.** `audit_events`' append-only RULEs (migration 0000) stop the application's own
runtime credential from editing or deleting history, but not a party with full database DDL
access, who could drop or disable the RULE, edit rows, and recreate it — nothing inside the
database alone would show that happened. `packages/services/src/audit-checkpoints.ts` adds a
periodic checkpoint: `createAuditCheckpoint(db, signingSecret, signingKeyVersion)` records
`(fromSeq, toSeq, chainHeadHash)` for every event since the last checkpoint, signed with
HMAC-SHA256 over a secret passed as an explicit parameter and never read from the environment
inside the service function itself — mirroring `step-up.ts`'s existing split between a pure
service function and its env-resolving caller in `apps/web`. A party who can only read/write/
alter the database cannot forge a new valid signature for a tampered range, and cannot make an
existing checkpoint's stored signature agree with a hash it no longer matches, because the
secret that produced it is not stored alongside it.

**Schema.** New `audit_checkpoints` table (`from_seq`, `to_seq`, `chain_head_hash`,
`signature`, `signing_key_version`), migration `0029_wide_colossus.sql`, append-only at the
database level via the identical RULE pattern already used for `audit_events`
(`audit_checkpoints_no_update` / `_no_delete`, both `DO INSTEAD NOTHING`) — the checkpoint
ledger gets the same tamper-resistance property it is itself providing for `audit_events`.
A check constraint (`audit_checkpoints_range_valid`) enforces `to_seq >= from_seq`.

**Two independent checks, and why both are required.** `verifyCheckpointSignature` proves the
checkpoint row itself has not been forged or edited by someone without the signing secret
(constant-time comparison via `timingSafeEqual`, so the check cannot leak the correct signature
one byte at a time via timing). `verifyCheckpointAgainstChain` proves the `audit_events` row
actually at `checkpoint.toSeq`, read fresh right now, still has the hash the checkpoint
recorded. Neither alone is sufficient: a tampered chain with an untouched checkpoint row passes
signature verification but fails chain verification, which is exactly the attack this exists to
catch. Proven in `audit-checkpoints.test.ts`'s tamper-detection test, which — to actually
reproduce that attack rather than a no-op — explicitly issues
`ALTER TABLE audit_events DISABLE RULE audit_events_no_update` before writing a tampered hash
directly, then re-enables it; seeing this the first time as a false-passing test (the RULE
silently absorbed a plain `UPDATE`) is recorded in `known-issues.md` item 17.

**What this genuinely proves, and what it does not yet.** A checkpoint that passes both checks
means the `audit_events` rows it covers are exactly what they were when the checkpoint was
created, provided the verifier trusts the copy of `signingSecret` being checked against. It does
NOT yet provide a true external anchor a compromised database operator cannot also reach — the
checkpoint row lives in the same database, protected only by its own append-only RULEs, the same
caveat `audit_events` itself has. Real external anchoring (exporting checkpoints to a separate
system, or a timestamping/transparency-log service) is not built here; no such service is
available to integrate against this session. Scheduling `createAuditCheckpoint` to run
periodically (a worker/cron on an interval) is operational wiring for a later part; this commit
delivers the capability, not its schedule. Both gaps are tracked in `known-issues.md` rather
than assumed complete.
