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
access, who could drop or disable the RULE, edit rows, and recreate it: nothing inside the
database alone would show that happened. `packages/services/src/audit-checkpoints.ts` adds a
periodic checkpoint: `createAuditCheckpoint(db, signingSecret, signingKeyVersion)` records
`(fromSeq, toSeq, chainHeadHash)` for every event since the last checkpoint, signed with
HMAC-SHA256 over a secret passed as an explicit parameter and never read from the environment
inside the service function itself, mirroring `step-up.ts`'s existing split between a pure
service function and its env-resolving caller in `apps/web`. A party who can only read/write/
alter the database cannot forge a new valid signature for a tampered range, and cannot make an
existing checkpoint's stored signature agree with a hash it no longer matches, because the
secret that produced it is not stored alongside it.

**Schema.** New `audit_checkpoints` table (`from_seq`, `to_seq`, `chain_head_hash`,
`signature`, `signing_key_version`), migration `0029_wide_colossus.sql`, append-only at the
database level via the identical RULE pattern already used for `audit_events`
(`audit_checkpoints_no_update` / `_no_delete`, both `DO INSTEAD NOTHING`): the checkpoint
ledger gets the same tamper-resistance property it is itself providing for `audit_events`.
A check constraint (`audit_checkpoints_range_valid`) enforces `to_seq >= from_seq`.

**Two independent checks, and why both are required.** `verifyCheckpointSignature` proves the
checkpoint row itself has not been forged or edited by someone without the signing secret
(constant-time comparison via `timingSafeEqual`, so the check cannot leak the correct signature
one byte at a time via timing). `verifyCheckpointAgainstChain` proves the `audit_events` row
actually at `checkpoint.toSeq`, read fresh right now, still has the hash the checkpoint
recorded. Neither alone is sufficient: a tampered chain with an untouched checkpoint row passes
signature verification but fails chain verification, which is exactly the attack this exists to
catch. Proven in `audit-checkpoints.test.ts`'s tamper-detection test, which, to actually
reproduce that attack rather than a no-op, explicitly issues
`ALTER TABLE audit_events DISABLE RULE audit_events_no_update` before writing a tampered hash
directly, then re-enables it; seeing this the first time as a false-passing test (the RULE
silently absorbed a plain `UPDATE`) is recorded in `known-issues.md` item 17.

**What this genuinely proves, and what it does not yet.** A checkpoint that passes both checks
means the `audit_events` rows it covers are exactly what they were when the checkpoint was
created, provided the verifier trusts the copy of `signingSecret` being checked against. It does
NOT yet provide a true external anchor a compromised database operator cannot also reach: the
checkpoint row lives in the same database, protected only by its own append-only RULEs, the same
caveat `audit_events` itself has. Real external anchoring (exporting checkpoints to a separate
system, or a timestamping/transparency-log service) is not built here; no such service is
available to integrate against this session. Scheduling `createAuditCheckpoint` to run
periodically (a worker/cron on an interval) is operational wiring for a later part; this commit
delivers the capability, not its schedule. Both gaps are tracked in `known-issues.md` rather
than assumed complete.

## AD-04: Real malware scanning via ClamAV (SEC-05/EVI-02)

**Decision.** `ClamAvScanner` (`packages/adapters/src/clamav-scanner.ts`) is a real
`MalwareScannerPort` implementation backed by an actual ClamAV daemon (`clamd`), speaking its
native `INSTREAM` protocol directly over a Unix socket or TCP, never a file path, so clamd
never needs OS-level read access to wherever the object store keeps bytes, matching the
directive's "isolated worker" boundary. Selected via the existing provider-registry pattern
(`apps/web/src/lib/providers.ts`'s `createMalwareScanner`, `MALWARE_SCANNER_PROVIDER=clamav`
plus `CLAMAV_SOCKET_PATH` or `CLAMAV_HOST`/`CLAMAV_PORT`), defaulting to the existing
`BasicSafetyScanner` when not configured, the same fail-toward-the-conservative-
existing-behavior posture `LocalEnvelopeKeyProvider` and `NullEmailPort` already use elsewhere
in this codebase, not a new pattern.

**Why ClamAV, and why this closes ADR-0012's own named follow-up.** ADR-0012 permanently
banned hand-rolled PDF content parsing in this codebase after 8 review rounds and 20
correctness findings on an abandoned custom parser, and named its own remedy explicitly: "a
real malware-scanner adapter for PDF... free to safely depend on a mature, battle-tested
PDF-parsing library rather than hand-rolled parsing." ClamAV's own PDF scanning (`ScanPDF`,
enabled by default) is that library. Nothing in `clamav-scanner.ts` parses PDF structure
itself; it only decides whether structural pre-checks pass, then streams bytes to clamd and
relays its verdict.

**Structural checks are reused, not duplicated, with one deliberate difference.**
`packages/adapters/src/scanner.ts`'s magic-byte deny-list, DOCX structural validation, and
plain-text heuristic were extracted into a shared `structuralCheck(bytes, contentType,
{maxBytes, allowPdf})` function. `BasicSafetyScanner` calls it with `allowPdf: false`
(unchanged behavior, refactor verified behavior-preserving against its existing test suite
before any new code was added). `ClamAvScanner` calls it with `allowPdf: true`: a
structurally well-formed PDF passes this layer and reaches the real engine, which is the only
thing in this codebase now permitted to make a PDF safety determination. Every file type,
not only PDF, still reaches clamd once structural pre-checks pass: a real engine can catch
content-level threats structural checks were never designed to.

**Fail-closed on every failure mode.** An unreachable daemon, a connection reset, a scan
timeout, or an unrecognized protocol response all return `safe: false` with a
`"scanner unavailable"`/`"unrecognized response"` detail, never fail open. Signature
freshness (`checkSignatureFreshness`, a real filesystem check against `.cvd`/`.cld` mtimes,
never a hand-authored test database) is enforced by default; a stale or absent official
database also denies release, matching the directive's 24-hour maximum age and "operational
degraded status" language. `enforceSignatureFreshness: false` exists only for test/dev
fixtures with no official database (e.g. this session's own sandbox, network-blocked from
`database.clamav.net`) and refuses to construct when `DEPLOYMENT_MODE=commercial`, mirroring
`LocalEnvelopeKeyProvider`'s `assertNotCommercialMode` guard exactly.

**Genuinely live-verified, not simulated, in this session.** A real ClamAV 1.5.3 daemon was
installed and run inside this session's own sandbox (`apt-get install clamav-daemon`); since
this environment's outbound network policy blocks `database.clamav.net` (confirmed via the
agent proxy's own status endpoint, not assumed), a minimal hand-authored `.hdb` signature
containing only the standard, publicly-documented EICAR test signature was loaded so the
engine itself could still be exercised for real. Against that real daemon, `ClamAvScanner`
genuinely detected the EICAR test string and passed clean content, proven via
`clamav-scanner.test.ts`'s live-only `describe.skipIf` block, which skips (not fakes) when no
reachable daemon is configured. CI (`.github/workflows/ci.yml`) installs and starts a real
`clamd` before the test step on every run, attempting a genuine `freshclam` signature fetch
(GitHub-hosted runners have full internet access this sandbox does not) with the same
EICAR-only fallback if that fetch fails, so the live path runs in CI too, not only locally.
The bulk of the adapter's own logic (protocol framing, error handling, the structural gate,
freshness checks) is additionally covered by a fast, deterministic fake-clamd test double
implementing the real wire protocol, so correctness does not depend solely on a live daemon
being available.

**What remains open, not assumed complete.** (1) Live signature-freshness enforcement against
a real, officially-signed `daily.cvd` has never been exercised in this sandbox specifically
(network-blocked here); CI's `freshclam` attempt is the first place this can genuinely happen,
and is not yet confirmed to have succeeded there as of this commit. (2) "Isolated worker
deployment," a separately-hosted or sidecar `clamd` process reachable from a real production
worker, as opposed to this dev container, is a hosting/infrastructure decision this session
has no tooling to provision; the adapter's TCP-mode support exists for exactly that future
topology, but the topology itself is not stood up anywhere. (3) SEC-05's decompression/
page-count/pixel/memory/CPU/time guards, ZIP-export safe-naming, and export-artifact lifetime
are not yet audited or built this chunk. All three tracked in `known-issues.md`, not silently
dropped.

## AD-05: Redemption-time access recheck via a second signed token (EVI-06/SEC-05)

**Decision.** `blob-token.ts` (`packages/adapters`) is a stateless HMAC capability token proving
"this object key and disposition were authorized, and this has not expired." It deliberately
carries no actor or grant information (it is storage-generic, reused by every backend), which
means it has nothing left to revoke once signed: a grant revoked one second after mint would
still redeem successfully for the token's whole remaining lifetime. The directive is explicit
that this is not acceptable ("redemption must recheck access", "revoking a grant before
redemption must make an already issued token fail", adversarial test A08).

The fix is a second, independent signed token, `document-access-token.ts`
(`packages/services`), minted by `accessDocument` alongside the existing blob token and
transmitted as its own set of query parameters (`adid`/`aak`/`aaid`/`aoid`/`aact`/`apur`/`asu`/
`aexp`/`asig`) on the same delivery URL. It carries the minimum needed to reconstruct the
original authorization context: which document, which kind of actor, which account (where
applicable), which organization (for a member), which action, purpose, and whether step-up was
satisfied at mint time. At redemption, `/api/blob/[key]/route.ts` verifies this token's own
signature and expiry (same as the blob token), then calls `recheckDocumentAccess`
(`packages/services/src/documents.ts`), which:

1. Re-fetches the document fresh; gone means denied.
2. Reconstructs the `Actor` fresh: for `organization_member`, this means a live
   `listMembershipsForAccount` query, never trusting whatever `active`/`role` the actor
   claimed at mint time (the mint-time `Actor` object is never replayed as-is; only the
   identifying account/org IDs are carried forward, and the mutable membership fact is
   re-derived).
3. Loads grants fresh via the existing `loadGrantsForPolicy` (already a live query, not
   cached), so a grant revoked, expired, or paused since mint is reflected automatically.
4. Calls the same `authorize()` the mint-time decision used, with this fresh actor and these
   fresh grants, against the same resource/action/purpose.
5. Re-runs the servability check (`isDocumentVersionUsable`/`hasActiveOrVerifiedErasureJob`)
   mint time already ran, so a version erased or otherwise made unusable between mint and
   redemption cannot still be served either, closing the directive's "exact version" clause,
   not just the grant-revocation one.

**Why a second token instead of extending the blob token or `StoragePort`.** `StoragePort` is
explicitly documented as "the seam between the domain and object storage": Actor/Grant are
domain concepts that do not belong leaking into a generic port also meant to support S3 later.
Keeping the two tokens separate means `NeonBlobStorage`/`VercelPrivateBlobStorage` and
`blob-token.ts` needed zero changes; the whole addition is new files plus one field added to
`DocumentAccessInput` (`accessTokenSecret`, reusing `BLOB_SIGNING_SECRET`, so no new secret to
provision) and a few lines at the point `accessDocument` already builds the response URL.

**Why per-field query parameters instead of one packed token string.** The first version of
this design packed every field into one dot-delimited, doubly-`encodeURIComponent`'d string. A
purpose value containing any character `encodeURIComponent` treats specially (a space, `&`,
non-ASCII text) came back corrupted on decode because the encoding was applied twice on the way
out and only undone once on the way back in, silently breaking signature verification for any
such purpose, caught by this session's own round-trip test before it ever reached a real
purpose string with special characters, not by a later report. Rebuilt to match `blob-token.ts`'s
own already-correct, already-tested convention exactly: one query parameter per field, each
read back via `URLSearchParams`, which decodes exactly once, correctly, by construction. Proven
by a dedicated round-trip test using a purpose containing `&`, `=`, a space, and CJK characters.

**What this proves, and what it does not.** Proven by 11 new integration tests (real PGlite,
not mocked): a grant revoked between mint and redemption denies redemption even though the
token has not expired; a membership deactivated between mint and redemption denies redemption
even though the grant itself is untouched; a document version erased between mint and
redemption denies redemption even for the document's own owner. What this does not cover:
`support_admin` document access, which is structurally unreachable today for a reason unrelated
to this change (`accessDocument` never loads `support_grants`, only ordinary `grants`), recorded
as a new, separate finding in `known-issues.md` item 23 rather than silently left unmentioned.
Step-up re-verification at redemption is carried forward from the mint-time value embedded in
the token rather than independently re-derived from a live session, since the serving route has
no session/cookie context today; this is a narrower, honestly-scoped gap than the grant/
membership/servability recheck this change actually delivers.
