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

**Update: pinning the exact minted version (2026-09-17).** Step 5 above, as first built, actually
re-derived "the latest version by version number" fresh at redemption, independent of which
version the accompanying blob token's storage object was bound to at mint. A version added
between mint and redemption could then make the recheck evaluate the wrong row: a clean newer
sibling could mask an unsafe minted version, or an unsafe newer sibling could block redemption of
a still-safe minted version. This broke the directive's own "exact version" clause even though
step 5 was written to satisfy it. Fixed by adding `documentVersionId` to
`DocumentAccessTokenFields`, pinned at mint time in `accessDocument` and signed like every other
field, so `recheckDocumentAccess` now loads that exact version by ID rather than re-deriving
"latest." Proven by two new tests exercising both directions of the exploit, both confirmed to
fail without the fix. Recorded as a distinct finding in `known-issues.md` item 37, since it was a
real gap in already-shipped code, not a new requirement.

## AD-06: Safe rendered previews, replacing the `redacted` 501 (EVI-02/EVI-06)

**Decision.** The PRD is explicit: "Use safe rendered previews with active content removed;
originals are explicit downloads, never an untrusted inline PDF shortcut" (§5). Before this
chunk, `/api/blob/[key]/route.ts` honoured only the `original` variant; any `redacted` request,
which was every non-owner preview, was a hardcoded `501`, and `documents.ts`'s `accessDocument`
gave the applicant owner the raw `original` variant for their own preview as a Milestone 2
shortcut. Both are closed this chunk: a new `PreviewRendererPort` (`packages/services/src/
preview-rendering.ts`), implemented by `BuiltinPreviewRenderer` (`packages/adapters/src/
preview-renderer.ts`), renders a genuinely inert derivative per content type, and
`accessDocument`'s preview branch now always requests `redacted`, for the owner and any third
party alike; only `downloadDocument`'s separate `DOWNLOAD_ORIGINAL` action (its own policy check
plus step-up) ever reaches the stored original.

**Correcting the owner-gets-original shortcut.** An earlier build's read of Milestone 2 gave the
applicant owner the clean original inline on preview, reasoning that the owner is already
authorized to see their own document. The newer PRD text is explicit that this is wrong: preview
is never a path to original bytes, for anyone, regardless of ownership; only an explicit download
is. Per this programme's standing instruction to follow the newer PRD's direction over an older
build's where they conflict, `accessDocument`'s owner-scoped branch (and its now-dead
`isApplicantOwner` helper) was removed rather than kept as a special case.

**Rendering strategy per content type**, chosen to avoid repeating this codebase's own PDF
post-mortem (a hand-rolled PDF parser hunting for active-content markers was abandoned after 20
correctness findings across 8 review rounds; see `scanner.ts`'s module doc comment and AD-04):

- PDF: rasterize page 1 to a PNG via `unpdf`'s `renderPageAsImage` (pdfjs, the same renderer
  Firefox ships) plus `@napi-rs/canvas`. A raster image cannot carry a PDF's JS actions, launch
  actions, embedded files, or form fields regardless of what the source PDF actually contained;
  this is the strongest available "active content removed" guarantee, and, deliberately, not a
  parser of any kind. Page 1 only: a preview thumbnail, not a full-document viewer.
- PNG/JPEG: decode, then redraw onto a fresh canvas, re-encoded as PNG. This strips EXIF/ICC
  metadata and any bytes past the real decoded pixels, closing the polyglot-file class of attack
  (an image with HTML/script bytes appended past its real image data cannot survive a
  decode-and-redraw); proven by a dedicated test that appends a `<script>` tag past a real PNG's
  bytes and asserts it is absent from the rendered output.
- DOCX: `mammoth.extractRawText`, the same parser `text-extraction.ts` already uses and this
  codebase already trusts, served as plain text. Strips macros, OLE objects, external template
  references, and tracked-changes/comment metadata; only the visible text survives.
- `text/plain`/`text/markdown`: passthrough, normalized to `text/plain`. Already inert (no
  execution model); the markdown-to-`text/plain` normalization is defense in depth so redacted
  text output is never later reinterpreted as markup by some future consumer.
- Anything else: `{ rendered: false }`, honestly, surfaced by the route as its own `501` detail
  string rather than silently guessing or falling through to raw bytes.

**Why `unpdf` was upgraded from 1.6.2 to 1.8.1.** `renderPageAsImage` needs `@napi-rs/canvas` as
its Node canvas implementation (there is no default on Node; `loadImage`/`createCanvas` are
required), and `unpdf@1.6.2` only declared a peer range of `^0.1.69`, an old major version of
`@napi-rs/canvas` with a different, less-maintained API. `unpdf@1.8.1` widened that peer range to
`^0.1.69 || ^1.0.0`, letting the adapter use the current `@napi-rs/canvas@1.0.x` cleanly. Verified
safe for the already-shipped text-extraction feature (which also depends on `unpdf`) by rerunning
its full existing test suite after the upgrade, 22/22 still green, not by reading a changelog and
assuming.

**Why on demand, with no persistent cache, for this chunk.** Both storage backends were read
before choosing: `NeonBlobStorage` addresses bytes purely by `objectKey` with no dependent DB
row, but `VercelPrivateBlobStorage.getObject` looks up `storage_objects` by `objectKey` first to
learn the bucket, so caching a derived rendition under a synthetic key would need a new
`storage_objects` row per cached rendition on that backend, not a free byte-store write. A
persisted cache is a real, worthwhile future optimization once preview volume is measured to
justify it (the natural shape: a background job writes one derived object per document version,
looked up instead of re-rendered), but building it speculatively now, before any evidence it is
needed, would be exactly the kind of premature complexity this programme's own engineering
principles argue against. Rendering is bounded enough per call (single PDF page, single image
redraw, one DOCX text extraction, all against already size-capped originals) that generating on
every request is a reasonable, honestly-documented starting posture, not a hidden shortcut.

**Defensive bounds added, and why.** This chunk is the first place this codebase decodes
image/PDF bytes server-side into memory rather than only passing them through or magic-byte
sniffing them, so it is squarely this chunk's responsibility to bound that, not a pre-existing gap
deferred elsewhere:

- A pixel-count cap (40 megapixels) is enforced by reading PNG IHDR / JPEG SOF header bytes
  directly, before ever calling the decoder, so a small, highly-compressible file with an absurd
  declared pixel count (for example a solid-colour 60000x60000 PNG comfortably under the 20 MiB
  upload cap) is rejected without the multi-gigabyte allocation a full decode would otherwise
  attempt. Proven by a test that hand-crafts a PNG header claiming such dimensions with no real
  pixel data behind it, and confirms it is rejected without ever reaching the decoder.
- Every render is wrapped in a 10-second wall-clock timeout (`Promise.race` against a timer),
  since PDF parsing in particular has no other bound available short of hand-rolling a parser,
  which this codebase has already tried and abandoned once. This mechanism is not independently
  exercised by a test (doing so would mean mocking `unpdf`/`@napi-rs/canvas` module internals for
  one defensive edge case); it is a standard, well-understood `Promise.race` pattern, verifiable
  by inspection, and this is stated here plainly rather than claimed as tested.

**A buffer-slicing bug caught, and fixed, before it shipped.** The `original`-variant serving path
already copied bytes into a fresh, exactly-sized `ArrayBuffer` before constructing a `Response`,
with a comment explaining why: a `Uint8Array` can be a view over a larger, possibly pooled backing
buffer, and serving `.buffer` directly risks sending bytes beyond the intended slice. The first
draft of the new redacted-serving branch used `rendered.bytes.buffer` directly, missing that same
guard. Caught by re-reading the route once more for correctness rather than by a test failure
(the bug would not reliably reproduce against small fixtures), and fixed by factoring the existing
copy into one `freshArrayBuffer` helper used by both branches, and by making
`BuiltinPreviewRenderer`'s own plain-text passthrough return an independently-owned copy as a
postcondition of the port itself, not something every future caller must remember to add.

**A second, unrelated bug found and fixed while in this file.** `next.config.mjs`'s
`bodySizeLimit` was still `15mb`, a margin computed against the *old* 10 MiB upload quota (fixed
to 20 MiB earlier in Part 3; see `known-issues.md` item 20), silently re-introducing the exact
"uploads rejected before reaching the real quota check" bug that comment itself describes, for any
upload between 15 and 20 MiB. Corrected to `25mb`, the same proportional margin over the current
20 MiB quota. Caught by reading this file while adding `@napi-rs/canvas` to
`serverExternalPackages`, not reported separately.

**What this proves, and what it does not.** `BuiltinPreviewRenderer` is proven against real
bytes, not fakes: a real hand-built PDF rasterized and checked for PNG magic bytes; a real
canvas-generated PNG/JPEG decoded, redrawn, and checked that appended polyglot bytes do not
survive; a real hand-built DOCX extracted and checked for its actual text; the pixel-cap and
unsupported-type paths exercised directly (12 tests, `preview-renderer.test.ts`). The
`previewFilename` helper is unit tested directly (5 tests). `documents.ts`'s corrected
owner-always-redacted behaviour is proven against real PGlite Postgres (`documents.test.ts`,
48 tests across that file and `sharing.test.ts`, all green after this change). What this does not
cover: `/api/blob/[key]/route.ts`'s own wiring (token parsing, the variant branch, the call into
the renderer) has no direct route-handler test, matching `headers.test.ts`'s own stated rationale
for this exact route ("simple early returns with no independent logic worth mocking a database
for") and this codebase's established pattern of testing `apps/web` routes without a real/PGlite
database; this was true of the `501` this chunk replaces too, so it is a pre-existing gap in this
one route's own test coverage, not a new one introduced here. The render-timeout wrapper's actual
firing is likewise not independently exercised, as noted above.

## AD-07: Wiring `support_grants` into document access (EVI-06, closing known-issues.md item 23)

**Decision.** AD-05 named this gap explicitly rather than leaving it implicit: `accessDocument`
and `recheckDocumentAccess` (`packages/services/src/documents.ts`) only ever called
`loadGrantsForPolicy`, which reads the ordinary `grants` table, never `loadSupportGrantsForPolicy`
(`packages/services/src/support-access.ts`), which reads `support_grants`. `authorize()`'s
`support_admin` case (`packages/policy/src/authorize.ts`) was never the problem: it already
filtered candidate grants by `g.recipientAccountId === actor.accountId`, exactly the shape
`loadSupportGrantsForPolicy` already converts a support grant row into. The grants list handed to
it was simply always missing support grants, so no support_admin actor could pass regardless of
having a perfectly valid, active, approved support grant.

The fix is a single new helper, `loadGrantsForActor(db, applicantId, actor)`, called at both
decision points in place of the bare `loadGrantsForPolicy` call: it always loads ordinary grants,
and additionally loads and merges in the actor's active support grants only when
`actor.kind === 'support_admin'`. No change to `authorize()`, `loadSupportGrantsForPolicy`, or
either table's schema was needed; the fix is entirely in which rows get handed to an
already-correct evaluation.

**Why gated on actor kind rather than always merging.** A support grant that does not match the
current actor is harmless noise to `authorize()` (it is simply filtered out by the
`recipientAccountId` predicate like any other non-matching grant), so unconditionally merging
would still be *correct*. It would also mean an extra database query on every ordinary
owner/organization-member/individual-recipient preview or download, the overwhelming majority of
calls, to fetch rows that can never apply to that actor. Gating on `actor.kind` avoids the wasted
query for the common case while changing nothing about the `support_admin` case's own result.

**What this proves, and what it does not.** Two new tests in `documents.test.ts`: a support_admin
actor with no support grant at all remains denied at both mint and redemption, unchanged
default-deny behaviour; a support_admin actor with a real support grant, created through the
actual `createSupportGrant` service function with a genuine distinct approver (never a hand-built
row bypassing that function's own validation), now succeeds at both mint and redemption, and is
still correctly refused for `DOWNLOAD_ORIGINAL` when the grant's `actions` only cover `PREVIEW`,
proving the fix is exactly as scoped as an ordinary grant would be, not a blanket bypass for any
support_admin actor once any grant exists. What this does not cover: no real caller anywhere in
`apps/web` constructs a `support_admin` actor yet (the admin-workspace/support-access UI is Part
5/9 scope, ADM-01); this change makes the authorization path correct and reachable once such a
caller exists, not a claim that one exists today.

## AD-08: A new NORMALIZING pipeline stage for EVI-01's page/pixel limits, reusing `documentScanResults`

**Decision.** EVI-01 states exact, initial configurable limits a malware scan has no reason to
enforce: "50 PDF pages, 40 megapixels per image," alongside encrypted-PDF rejection with "a
clear request for an unlocked copy." None of these existed anywhere in the codebase before this
chunk. `intake.ts`'s own module doc comment already documented `NORMALIZING` as a reserved,
currently-empty pass-through step between SCANNING and EXTRACTING ("no real normalization work
exists yet, and this is stated here rather than implied"), which is exactly the right place for
a bounded-parsing gate that must run after a file is confirmed CLEAN but before its text is
extracted: a new `ContentLimitsPort`/`BuiltinContentLimitsChecker` pair (mirroring
`MalwareScannerPort`/`ClamAvScanner`'s exact shape) now does this real work there, threaded
through `processIntake` and `runIntakeWorker` as a fourth constructor-injected port, exactly
like the scanner and extractor already are.

**Why after the scan, not before or instead of it.** A genuinely clean, genuinely well-formed
PDF or image can still exceed these limits; conversely, checking page count or pixel dimensions
on a file that has not yet been confirmed safe would mean parsing untrusted bytes before they
are known safe, spending the same "trust the bytes enough to parse them" risk budget SEC-05's
"bounded parsing" language is already about, a second time, for no benefit; the scan gate stays
the single point that decides whether a file's bytes are worth parsing at all.

**Why `unpdf` for page count, never a hand-rolled parser.** Identical reasoning to AD-04's real
malware scanner and AD-06's preview renderer: this codebase already tried, and abandoned, a
hand-rolled PDF parser once (20 correctness findings across 8 review rounds; see `scanner.ts`'s
module doc comment). `unpdf` (pdfjs) is already a trusted dependency for exactly this kind of
parsing (`text-extraction.ts`, `preview-renderer.ts`), so page-counting through it, rather than
inventing a third from-scratch PDF reader in this codebase, was never seriously considered as an
alternative.

**Why the image-dimension header readers were extracted into their own shared module.** This
chunk needed the exact same "read PNG/JPEG pixel dimensions from a few header bytes, never a
full decode" logic `preview-renderer.ts` (AD-06, the previous chunk) had already built to bound
its own decode step. Copying it a second time was rejected outright: two independently
maintained copies of the same header-parsing logic is exactly the kind of drift this
codebase's own `structuralCheck` extraction (AD-04) was already built to prevent for the
scanner adapters. `pngDimensions`/`jpegDimensions`/`imageDimensions` moved to a new
`image-dimensions.ts`, imported by both `preview-renderer.ts` and `content-limits.ts`, with
its own dedicated unit tests (9 tests) now that it is a genuinely shared, independently
reusable unit rather than one file's private implementation detail.

**Why a new pipeline stage reuses `documentScanResults` rather than a new table.** The
alternative, a parallel `document_content_limit_checks` table mirroring `documentScanResults`
column for column, was considered and rejected: `documentScanResults`'s columns
(`scannerName`, `scannerVersion`, `safe`, `scanErrored`, `detail`) are not intrinsically about
malware specifically, and a content-limits check's outcome ("did this attempt find the file
acceptable, or not, and why") is the identical shape. Reusing it, distinguished only by
`scannerName` (`'builtin-content-limits'` vs. the real malware scanner's own name), meant zero
new migration, and `listScanResults()` already queries and returns every relevant attempt for a
version with no changes needed. The real cost, found empirically: three pre-existing tests
(`pipeline.test.ts`, `jobs.test.ts`) asserted an exact row count for `documentScanResults`
assuming only the malware scanner ever wrote to it; a fully successful pipeline run now writes
TWO rows (one per stage), not one, which broke those counts until each was fixed to filter by
`scannerName` first. This is recorded as a real, non-obvious consequence of the reuse decision,
not swept under a passing test; a future reader adding a third pipeline stage that also wants
durable evidence should expect the same.

**Why the two new limits are folded into `UploadQuotaConfig` rather than a separate config
type.** EVI-01 itself groups "20 MiB per original," "50 PDF pages," and "40 megapixels per
image" as one sentence of "initial configurable limits." `quotas.ts` already owns exactly this
concept (env-overridable, conservative pilot defaults, one `loadUploadQuotaConfig()` call).
Extending it with `maxPdfPages`/`maxImageMegapixels` (env vars `QUOTA_MAX_PDF_PAGES`/
`QUOTA_MAX_IMAGE_MEGAPIXELS`) keeps every EVI-01 number in one place with one loading function,
rather than a second, independently-evolving config module for two fields.

**What this proves, and what it does not.** `content-limits.test.ts` (10 tests) proves real
behavior against real bytes: a genuinely valid multi-page PDF (hand-built the same way
`text-extraction.test.ts`'s single-page fixture already is, extended to N pages) correctly
counted and accepted or rejected at an exact boundary; a real megapixel count read from a
hand-crafted PNG header and correctly rejected; DOCX/text passed through unconditionally,
matching EVI-01's own silence on a numeric limit for either. `pipeline.test.ts` proves the full
pipeline integration against real PGlite Postgres: a clean-scanned document that exceeds a
content limit still reaches NEEDS_ATTENTION (never EXTRACTING), with `safetyStatus` correctly
left `CLEAN` (the file itself was never unsafe, only oversized: `processingStatus` alone, via
`isServableProcessingState`, is what blocks servability, so no second, inaccurate "unsafe"
signal is invented for what is really a clean-but-oversized file); the same
fail-durable-then-resume contract SCANNING already had is proven for NORMALIZING too, including
the durable error row surviving a thrown check and a successful retry adding a second, non-error
row rather than overwriting it. What this does not cover, stated plainly rather than implied:
the password-protected-PDF rejection path's exact trigger (real encrypted-PDF bytes) has no
dedicated test, matching the pre-existing, already-accepted precedent for the identical
`/password|encrypted/i` pattern in `text-extraction.ts`'s own `extractPdf` (hand-rolling real
PDF encryption bytes for a test fixture was rejected for the same reason hand-rolling a PDF
parser already was); batch-count enforcement does not exist at all (`known-issues.md` item 27).

## AD-09: Mission note visibility (`AGENCY_INTERNAL` / `TRAVELLER_SHARED`), closing a live cross-tenant leak (CAS-05, known-issues.md item 7)

**Decision.** `missionNotes` gains a required, non-defaulted `visibility` enum
(`mission_note_visibility`: `AGENCY_INTERNAL` | `TRAVELLER_SHARED`) and a nullable
`authorOrganizationId` (FK to `organizations`, cascade delete). `addNote`'s input now requires
an explicit `visibility` on every call; there is no default, matching this codebase's standing
"never silently mutate a caller's request" rule (a caller that does not say which one it means
gets a compile error, not a guess). `listNotes` (the organization-facing read, gated on
`canReadMissionCollaboration` exactly as before) now filters its result set per row: every
`TRAVELLER_SHARED` note regardless of author, plus only the calling organization's own
`AGENCY_INTERNAL` notes, never another organization's. A new `listNotesForOwner` gives the
applicant owner a read path for the first time (none existed before): `TRAVELLER_SHARED` notes
only, from any author, since an `AGENCY_INTERNAL` note is never visible to the traveller by
definition. Migration `0030_safe_mentor.sql`, additive only.

**Why this was Phase A's first fix, ahead of everything else in Part 4.** This was not a gap in
PRD coverage found by reading requirements; it was found by auditing the actual running
behavior of a currently-shipped feature. Two organizations that both hold a real, active,
accepted grant permitting `COMMENT` or `MANAGE` on the same shared mission (an ordinary,
expected shape once a case is co-managed, e.g. a sponsor's agency and a visa consultancy both
collaborating on one applicant) could each read every note the other had written, including
notes explicitly meant to stay internal to one agency, because `listNotes` had no concept of
"whose note is this" at all: it returned every row on the mission to any org that passed the
mission-level read gate. A currently-exploitable cross-tenant confidentiality leak on live
collaboration data outranks any not-yet-built PRD feature, so it was fixed first, verified, and
shipped ahead of the rest of the Part 4 plan rather than queued behind it.

**Why `AGENCY_INTERNAL` requires organization authorship, rejected rather than silently
downgraded.** `addNote` tracks `authorizingOrganizationId`, set only when an organization's own
grant (via `orgGrantPermits` against one of the actor's active memberships) is what authorized
the write, never on the applicant-owner or individual-grant-recipient paths, even when one of
those also happens to succeed first for the same call. If a caller asks for `AGENCY_INTERNAL`
without that provenance, `addNote` returns a typed `invalid` error naming exactly why, rather
than silently writing the note as `TRAVELLER_SHARED` (or as `AGENCY_INTERNAL` with a null
author, which would make it permanently unreadable by any organization's own-notes filter). The
applicant owner and a direct individual grant recipient are never "an agency"; there is no
sensible organization to attribute an internal note to on those paths, so the request is refused
outright rather than coerced into something the caller did not ask for.

**Why the backfill default for existing rows is `AGENCY_INTERNAL`, the more restrictive value,
not `TRAVELLER_SHARED`.** Every note written before this migration predates the visibility
concept entirely; nobody who wrote one chose either value, and nobody who wrote one could have
known it might later become readable by the applicant it is about. Defaulting new NOT NULL
columns toward the safer, more restrictive interpretation of unlabeled legacy data (never wider
exposure than before) matches this codebase's general default-deny posture, so a legacy row's
`authorOrganizationId` also backfills `null`. A `null`-author `AGENCY_INTERNAL` row is therefore
unreadable by any organization's own-notes filter (`authorOrganizationId` equality can never
match `null` for a real organization) and, correctly, still excluded from the owner's
`TRAVELLER_SHARED`-only view; a dedicated test proves a legacy row stays restricted from the
traveller rather than silently exposed by the migration itself.

**What this proves, and what remains deliberately out of this fix's scope.**
`tenant-isolation.test.ts` gained 4 new tests: the actual leak scenario (two organizations, each
with its own internal note plus a shared note on the same mission; each org sees only its own
internal note, both see the shared note, the traveller sees only the shared note); the applicant
owner's `AGENCY_INTERNAL` attempt rejected while their `TRAVELLER_SHARED` note still succeeds;
a direct individual grant recipient's `AGENCY_INTERNAL` attempt rejected the same way; and the
legacy-row backfill case above. Two known, unclosed gaps are recorded rather than left implicit:
no page in `apps/web` yet calls the new `listNotesForOwner` (the service function is complete
and tested, but the applicant-facing mission view has no notes section at all today, so there is
no UI regression, only a still-missing feature, tracked in `known-issues.md`); and
`individual_recipient` actors have no notes-read path anywhere in this codebase, a pre-existing
gap this fix did not introduce, worsen, or close (they can `addNote` via `COMMENT`, but nothing
lets one list notes back), also tracked in `known-issues.md`.

## AD-10: Grant duration bounds, 30-day default and 90-day maximum (SHR-01)

**Decision.** `createGrant` (`packages/services/src/sharing.ts`) no longer treats an omitted
`expiryAt` as "never expires." `GRANT_MAX_DURATION_DAYS` is corrected from an inherited `365` to
the PRD's own explicit number, `90` ("maximum initial duration 90 days"); a new
`GRANT_DEFAULT_DURATION_DAYS = 30` ("default duration is 30 days") is applied whenever the caller
names no expiry at all. The resolved value, never the raw caller input, is what gets persisted.
An explicit expiry from the caller is still validated exactly as before (must be in the future,
capped at the same 90-day bound), so a caller asking for a shorter, bounded window is unaffected;
only the previously-unbounded "no expiry" case changes.

**Why this was a real, live gap, not a theoretical one.** `apps/web`'s own sharing UI
(`grant-form.tsx`) is the only production caller of `createGrant`, and its `expiryDays` field was
optional with the placeholder "Leave blank for no expiry," and its own live summary told the
owner outright: "Access never expires unless you revoke it." Every grant created through this
platform's one sharing flow without the owner manually typing a number was, and until this fix
remained, permanent, directly contradicting the PRD's explicit default. This was found by reading
`createGrant`'s validation branch while auditing Part 4's sharing/grant-lifecycle requirements,
not reported; no existing test in `sharing.test.ts` exercised expiry defaulting or the maximum
bound at all, confirming this had never been verified either way before now.

**Why the fix lives entirely in the service, not the UI form.** `grant-form.tsx` already passes
`expiryAt` through only when the owner supplies a number; leaving the default and cap to
`createGrant` itself means every caller (this UI today, any future caller: an API, a CLI, a
contributor-request flow) gets the same correct, PRD-compliant behavior automatically, rather
than each needing to reimplement "default to 30 days" on its own and risk drifting out of sync.
The UI change made alongside this is copy-only: the placeholder and live summary no longer claim
grants can be permanent, and the input gains a `max="90"` affordance; the actual enforcement was
already, and remains, server-side.

**Why no migration or backfill.** This changes only what a *new* `createGrant` call persists, not
the schema (`grants.expiry_at` was already a nullable timestamp) and not any existing row. Grants
already sitting at `expiryAt: null` from before this fix keep working exactly as before: `authorize()`
and the two `isNull(expiryAt) OR expiryAt > now` queries in `agency.ts` already treat a null
expiry as "no time bound," which remains correct for that pre-existing data. Retroactively forcing
an expiry onto a grant a recipient already accepted under a no-expiry promise would revoke access
the recipient was told they'd keep, a real behavior change to existing relationships this fix does
not make; only grants created from this commit forward get a bounded expiry.

**What this proves, and what SHR-01 still needs.** Four new tests in `sharing.test.ts` prove,
against real `createGrant` calls, not just the validation function in isolation: an omitted
expiry lands within a few minutes of exactly 30 days out; a requested 91-day expiry is rejected;
an explicit, valid 60-day request is honored exactly as given; and an expiry already in the past
is rejected (the last of these was, like the other three, previously untested). Left open,
tracked rather than silently assumed covered by this fix: SHR-01's own further clauses
("renewal is an explicit action"; "categories do not automatically include future documents by
default; expanding scope requires a displayed confirmation") are separate, larger pieces of the
same requirement row, not yet built: see `known-issues.md` and `requirements-ledger.md` SHR-01.

## AD-11: Category-scope snapshotting and explicit expansion (SHR-01)

**Decision.** `grants` gains `documentScopeSnapshot`, a nullable document-id array populated only
when `categories` is set. `createGrant` computes it once, at creation, against the applicant's
CURRENT documents (`documentIdsMatchingCategories`, `packages/services/src/sharing.ts`); the
policy engine (`Grant.categoryScopeDocumentIds`, `packages/policy/src/types.ts`) then requires a
DOCUMENT resource under a `categories`-scoped grant to also appear in that snapshot, not merely
match the category live. A document uploaded after the grant exists, however well it matches the
category, is invisible until the owner explicitly says otherwise. Two new functions are the only
way the snapshot ever grows: `previewScopeExpansion` (what a confirmation dialog should show) and
`expandGrantScope` (the owner's actual confirmation, re-verified against the grant's own
categories at that moment, never trusted from an earlier preview call). A new section on the
sharing page (`ScopeExpansionForm`) is the real "displayed confirmation" PRD SHR-01 requires:
named documents, checkboxes defaulted on, one explicit submit.

**Why documents only, never facts.** SHR-01's own sentence is specific: "categories do not
automatically include future *documents*." `evaluateGrant`'s new check is gated on
`resource.documentId !== undefined`, so a fact resource (`VIEW_METADATA`, no `documentId`) is
completely unaffected by the snapshot and continues to match `categories` live, exactly as
before. Extending the same restriction to facts was considered and rejected as inventing a
requirement the PRD does not state: facts are versioned differently (an edit creates a new
version of an EXISTING fact under an existing field key; a genuinely new field key appearing
inside an already-granted category is a much rarer event than a new document upload), and this
programme's standing rule is to implement what the PRD says, not what might rhyme with it.

**Why the correction to Part 4 chunk 2's own documentation.** That chunk's test-evidence and
requirements-ledger entries stated `bulkExport` (`packages/services/src/agency.ts`) was, like
`getRecipientWorkspace`, part of this gap. Re-reading `bulkExport` while building this fix found
that claim wrong: `BulkExportRow` is `{applicantId, displayName, facts}`, facts only; `bulkExport`
never touches documents at all, so it was never affected by "future documents" regardless of this
fix. Recorded here as an explicit, named correction rather than silently amended, per this
programme's own standing precision requirement; `requirements-ledger.md` SHR-01 is corrected in
this same commit.

**Why creation time, not acceptance time, for the snapshot.** The owner's actual decision, the
moment they look at their document list and choose categories, happens at `createGrant`, not
whenever the recipient later gets around to accepting. Snapshotting at acceptance would let an
unrelated delay between creation and acceptance silently change what the owner is understood to
have agreed to, for better or worse, neither of which the owner actually chose at the moment they
acted. Creation time is also simply where the owner-facing form already runs, so the snapshot
reflects exactly the document list state that could have informed their choice.

**A separate, real gap found while building this, deliberately not fixed here.** Auditing every
document-resource `authorize()` call site to confirm this fix's reach found that
`documents.ts`'s `accessDocument`/`recheckDocumentAccess` (the real byte-serving preview/download
path behind `/api/blob/[key]`) never populates `resource.category` at all. Combined with
`evaluateGrant`'s existing (pre-dating this session) rule that a `categories`-scoped grant denies
outright when `resource.category` is absent, this means a grant restricted to `categories` with
no explicit `documentIds` can never actually pass real document preview/download through that
route today, regardless of this fix. This is a distinct, over-restrictive bug, not a leak, and
not something this chunk's own scope (closing under-restriction, not over-restriction) covers;
`getRecipientWorkspace`'s own visibility list (the actual live feature this fix protects, per
`apps/web/src/app/app/shared/[grantId]/page.tsx`) is unaffected since it never calls
`accessDocument`. Tracked honestly as its own item rather than folded into this fix or left
undiscovered: `known-issues.md` item 30.

**What this proves.** Two new policy-layer unit tests (`authorize.test.ts`) prove the core rule
in isolation: a category-matching document outside the snapshot is denied, one inside it is
allowed, and a grant with no snapshot at all (facts, or a category grant that predates this
chunk) is unaffected. Six new integration tests (`sharing.test.ts`) prove it end to end against
real PGlite Postgres: the snapshot captures exactly the pre-existing document at creation; a
document uploaded afterward stays invisible through `getRecipientWorkspace`, the platform's real
recipient-facing feature, not just a mocked check; `previewScopeExpansion` lists exactly the new,
not-yet-included document; `expandGrantScope` adds a confirmed one, and it becomes visible on the
very next workspace read; a request to expand with a document that does not actually match the
grant's categories is refused, not silently ignored; and both functions are owner-gated, denying
a stranger, including the grant's own recipient.

## AD-12: Wiring existing classification output into document metadata (EVI-03)

**Decision.** `documents.docType`/`issuer`/`expiresAt` and `documentVersions.pages` existed as
schema columns but were never written by any real code path; every real upload left them null
forever. The pipeline already computes everything needed: `classifyDocumentText` (EXTRACTING
stage, `intake.ts`) already produces a confidence-scored `classifiedType`, and for a PASSPORT with
a valid, check-digit-verified MRZ, already parses `issuingCountry`/`expiryDate` too, previously
used only to build a proposed filename string and then discarded. `runExtractionStep` now also
persists `result.pageCount` onto the version and, when classification clears review
(`classifiedType` set, `reviewRequired: false`), copies `classifiedType` into `documents.docType`
and, for PASSPORT specifically, the MRZ's `issuingCountry`/`expiryDate` into `documents.issuer`/
`expiresAt`. Each column is set only if currently null, never overwritten.

**Why "only if null."** No code path lets anyone correct or override these values yet (no manual
edit UI, no review-decision flow). Once one exists, a later, possibly worse-quality re-extraction
overwriting an already-good value, machine-derived or human-corrected, would be a real regression.
Guarding on null now costs nothing (nothing else ever sets these fields) and means this fix never
needs revisiting when a correction flow is eventually built.

**Why only PASSPORT gets issuer/expiresAt.** `BANK_STATEMENT`/`EMPLOYMENT_CERTIFICATE` are
confidence-scored keyword matches with no structured fields to draw from; inventing NLP date or
issuer extraction for them was out of scope and not asked for. Only `classifiedType` is set for
those. `documentDate` and `subject` (EVI-03's other named fields) remain unpopulated: TD3 MRZ
encodes date of birth and expiry, never an issue date, and "subject" (whose document this is,
relevant mainly for third-party/sponsor evidence) has no existing signal anywhere in this codebase
to derive it from. Recorded honestly as still open, not silently implied covered by this fix.

**What this proves.** `pipeline.test.ts`'s existing passport-classification test gained new
assertions computing the expected `issuingCountry`/`expiryDate` via the same `parseTd3` the
pipeline itself uses (never hand-typed, so the test can't silently drift from the parser it is
checking), plus a `pages` assertion. Two new tests prove the two edge cases that matter: a
keyword-classified BANK_STATEMENT sets `docType` alone, leaving `issuer`/`expiresAt` null; and a
document with `docType` already set (simulating a prior version or a future manual correction) is
never overwritten by a disagreeing re-classification.

## AD-13: Duplicate detection and document review outcomes (EVI-03, closing known-issues.md item 31)

**Decision, duplicate detection.** A new `findDuplicateVersions(db, {applicantId, sha256,
excludeDocumentId})` (`packages/services/src/documents.ts`) finds other documents belonging to
the SAME applicant with a version sharing the given hash. The real upload action
(`apps/web/.../applicant/[id]/actions.ts`) calls it right after a successful upload, appending an
informational note to the success message when a match is found. Advisory only: it never blocks
or rejects the upload it runs against, matching EVI-03's own framing ("duplicate detection," not
"duplicate prevention"). Checks every version of every other document, not only each one's
latest, since a duplicate of a superseded version is still meaningfully "you already have this
file." The `applicantId` filter is not an optimization; it is EVI-03's explicit safety
requirement ("do not reveal cross-customer hash matches"), proven by a dedicated test with two
real applicants sharing an identical hash and confirming zero cross-tenant matches.

**Decision, document review outcomes.** A new append-only `documentReviews` table (mirroring
`missionDecisions`'s own shape exactly: outcome, reason, actor, timestamp, latest row per subject
is "the" current state) backs `recordDocumentReview`/`getCurrentDocumentReview`/
`listDocumentReviews`, supporting exactly EVI-03's five named outcomes
(PENDING/ACCEPTED/REPLACEMENT_REQUIRED/IRRELEVANT/DISPUTED). This is a judgment on the EVIDENCE
itself, distinct from `missionDecisions` (a requirement-scoped, mission-specific judgment) and
from `processingStatus`/`safetyStatus` (pipeline state, not a reviewer's opinion).

**Who may record a review, and why this reads `missionDecisions` differently.**
`recordMissionDecision`'s own doc comment is explicit that a mission decision is "deliberately not
something the applicant can record on their own mission, or the concept collapses into
self-attestation," so it authorizes org members only. `recordDocumentReview` authorizes BOTH the
applicant owner and an org member whose organization holds a grant currently permitting `COMMENT`
on the applicant, a deliberately different, wider call: EVI-03 places document review under
evidence/metadata management, not under the mission-decision/case-readiness section
`missionDecisions` itself serves, and an owner has a legitimate, non-self-attesting reason to
flag their own document (e.g., "I know this bank statement is stale, mark it
`REPLACEMENT_REQUIRED` while I get a new one") that is not a claim about case-readiness the way a
mission decision is. Recorded plainly as an interpretation, not a certainty: if a later,
more explicit product decision narrows this to org-only, `recordDocumentReview`'s own
authorization block is the only place that needs to change.

**Why `orgGrantPermits` was exported rather than reimplemented.** The org-standing check
`recordDocumentReview` needs is byte-for-byte the same question `addNote`/`bulkExport`/
`recordMissionDecision` already answer via `agency.ts`'s own (previously unexported)
`orgGrantPermits`. Re-deriving the same grant/scope/status/expiry logic a second time in
`documents.ts` was rejected outright, the same reasoning this codebase already applied to
`structuralCheck` (AD-04) and `image-dimensions.ts` (AD-08): one implementation, reused, not two
independently maintained copies that can silently drift apart. No circular import results
(`agency.ts` does not import from `documents.ts`, directly or transitively).

**What "replacement creates a new immutable version and notifies affected open cases" still
needs.** The "new immutable version" half is already true structurally: `documentVersions` rows
are never mutated or deleted by any normal write path, and `addDocumentVersion` always appends
rather than overwrites. The "notifies affected open cases" half genuinely cannot be built yet:
this codebase has no real notification system at all (Part 5 scope, `NullEmailPort` only
`console.warn`s). Tracked honestly as a Part 5 dependency, not silently dropped or stubbed with a
fake notification.

**What this proves, and what remains open.** Four new tests for duplicate detection
(`documents.test.ts`) prove: a same-applicant match is found; a matching hash across two
different applicants is never returned (the tenant-isolation requirement itself); a document
never matches itself; and no match when no other document shares the hash. Four new tests for
review outcomes prove: the owner can review their own document; an org member with a real,
accepted, covering grant can too; a stranger with no standing is denied; and the full history
survives multiple reviews, with `getCurrentDocumentReview` correctly returning only the latest.
Left open, tracked rather than assumed covered: no UI surface anywhere calls
`recordDocumentReview` yet (neither an owner-facing nor an agency-facing one exists), and the
notification half of "replacement" above.

## AD-14: The Document Wallet (EVI-04)

**Decision.** A new `packages/services/src/wallet.ts` implements EVI-04's own three parts.
`documentLifecycleStatus` is a pure function computing CURRENT/EXPIRING/EXPIRED/SUPERSEDED from a
document's `expiresAt` (real for passports since AD-12) and new `supersededByDocumentId` column
(plain uuid, no FK, matching this codebase's own established self-reference convention, e.g.
`ai_extraction_runs.served_from_cache_run_id`, since a same-table FK has no sensible `ON DELETE`
behavior here). `getWalletView` is the owner's read: every document with its status, which
missions use it as selected evidence (`selectedEvidence`), and which accounts/organizations
currently hold real access to it (`authorize()` evaluated per grant, reusing the canonical policy
engine rather than re-deriving scope rules a third time). `supersedeDocument` is "passport
renewal": links the old document forward, never mutating or deleting it, and creates a real,
visible `missionTask` on every mission using it as evidence, the "flags cases using it" EVI-04
requires.

**Why 30 days for "expiring."** Unlike SHR-01's exact grant-duration numbers, EVI-04 names no
specific "expiring soon" window. 30 days is a provisional, explicitly-documented default; Part
5's Expiry Centre (NTF-01, "intrinsic vs staleness distinction") is this number's eventual real
owner and may formalize or override it. Recorded as a judgment call, not invented silently.

**Why "an agency cannot browse unselected wallet contents" needed no new code.** `getWalletView`
is owner-only, and no agency-facing caller of it exists anywhere in `apps/web`; an agency's own
visibility into an applicant's documents already flows entirely through the separately-scoped
`getRecipientWorkspace`/evidence-request paths, neither of which lets an org enumerate an
applicant's full document list. This constraint is satisfied structurally by what does not exist,
confirmed by reading every caller, not assumed.

**Why `missionTask`, not a new "flag" concept.** EVI-04's "flags cases using it" needs a real,
visible, in-app signal, not (yet) an external notification, which Part 5 alone can provide
(`NullEmailPort` only `console.warn`s today). `missionTasks` already exists as exactly "an
assignable checklist item scoped to a mission"; creating one is a real, actionable signal already
displayed in the mission UI (`listTasks`), reusing established infrastructure instead of
inventing a parallel one for a single new caller.

**Why `agency.ts`'s `orgGrantPermits`/`sharing.ts`'s `DOC_TYPE_TO_PACK` pattern repeats here.**
`getWalletView`'s access computation needed the identical document-to-category mapping
`getRecipientWorkspace` already has; `documentCategory` is now exported from `sharing.ts`
wrapping the same private table, rather than a third copy. Same reasoning as AD-08/AD-13.

**What this proves, and what remains deliberately out of scope.** 12 new tests: 5 pure unit
tests for `documentLifecycleStatus` covering all four states, including that supersession
overrides expiry; `getWalletView` proven against real PGlite Postgres for owner access, a real
mission-usage link via `selectEvidence`, and a real organization access entry via an accepted
grant; `supersedeDocument` proven to link correctly without mutating the old row, to flag exactly
the missions using the old document (a real `missionTask` row, not a mocked call), to refuse a
cross-applicant pair, and to refuse both a non-owner and a second supersession of an
already-superseded document. Left open, tracked rather than silently folded in: no UI action lets
an owner actually call `supersedeDocument` yet (the read side, lifecycle badges plus usage/access
summary, is wired into the existing documents page; the write side needs a two-document picker
UI, a larger, separate piece of work); `documentDate`/`subject` remain the only EVI-03 metadata
fields with no derivation signal (AD-12, unchanged by this chunk).

## AD-15: The assurance ladder (EVI-05), scoped to facts

**Decision.** EVI-05 asks for five separate, always-shown statements per claim: applicant
declared, document supplied, named machine checks performed, agency reviewed, issuer confirmed.
Scoped to FACTS, not documents: `factVersions.status` already carries most of this exact ladder
(Build Spec §9's own `DECLARED`/`DOCUMENT_SUPPORTED`/`AGENCY_REVIEWED` values, with the comment
"Generic 'Verified' is forbidden"), and the PRD's E3 wording ("exact claim") is fact-shaped, not
document-shaped, a document is simply supplied or not, with no meaningful "declared but not yet
supplied" state the way a fact has. New `packages/services/src/assurance.ts` assembles all five
per fact, reusing four of them from data this codebase already had: "declared" and "document
supplied" from `factVersions.status`/`sourceDocumentVersionId`; "named machine checks performed"
from `documentClassifications`/`extractionRuns`/`documentScanResults`, joined via
`sourceDocumentVersionId`; "agency reviewed" from `missionDecisions`, joined via
`selectedEvidence` (never a bare boolean, the exact mission/requirement/reviewer/date is shown,
which is more precise than a flag would be anyway). Only "issuer confirmed" needed new
infrastructure: a new `issuerVerifications` table and `recordIssuerVerification`.

**`AGENCY_REVIEWED` was dead code before this chunk.** It has existed in `FACT_STATUSES` since
Build Spec §9 and is treated as a trusted status by `ai.ts`'s `TRUSTED_FACT_STATUSES`, but nothing
in the entire service layer ever wrote it: `recordMissionDecision` (the one place an agency judges
a requirement) never touches `factVersions` at all. Rather than wiring `recordMissionDecision` to
write a new fact version with that status, which would require loosening `editFact`'s
current owner-only authorization (a separate, larger authorization change, explicitly out of
scope here), "agency reviewed" is instead derived read-side from the existing
`missionDecisions`/`selectedEvidence` join. This is deliberately more honest than flipping a
status bit would be: it names which mission, which requirement, who decided, and when, not just
that some review happened at some point.

**Why `issuerVerifications` allows either a `factId` or a `documentId`, not one fixed choice.** An
issuer confirmation is fundamentally about a claim (`exactClaim`, free text), which may reference
a specific fact, a specific document, both, or something not cleanly reducible to either (e.g. a
phone call confirming overall employment status ahead of any one field being edited). A DB check
constraint requires at least one so every row stays reachable from a real UI surface; forcing a
single fixed choice between "fact feature" or "document feature" would have been a false one the
PRD itself does not impose. `validUntil` is required NOT NULL (never open-ended), matching SHR-01's
own refusal to let a grant have no expiry: nothing in this ladder is presumed to hold forever.

**Why `recordIssuerVerification` is deliberately NOT owner-permitted, unlike `recordDocumentReview`
(AD-13).** The top assurance tier only means something if it is independent of the party whose
claim it is. `recordDocumentReview` allowing the owner was defensible because judging "is this
scan legible" is a low-stakes, symmetric judgment; letting an applicant self-certify their own E3
would undercut the one guarantee that tier exists to give, so this chunk deliberately diverges
from that precedent rather than copying it uniformly. It requires a MANAGE-level org grant (the
same bar `recordMissionDecision` uses, not `recordDocumentReview`'s lighter COMMENT bar), checked
with an optional `missionId` so a mission-scoped grant counts, not only an applicant-wide one.

**E0-E3 is a derived, secondary label, never the primary UI.** The PRD itself calls these
"internal labels." `deriveAssuranceTier` is a pure function: E3 only for a live (unexpired) issuer
confirmation; E2 needs a document PLUS a passing check or an accepted review, "E2 is never proof
of authenticity" holding structurally since neither alone reaches it; E1 for a document alone OR
an agency review alone (real progress over a bare declaration, even with nothing else behind it,
so it is never silently erased back to E0 for lack of a document); E0 otherwise. The five
statements are always assembled and displayed regardless of what single letter this derives to.

**Why the profile page changed but the documents page only gained a narrower slice.** The Master
Profile UI (`profile-editor.tsx`) was rendering exactly the single opaque status badge EVI-05
warns against (`STATUS_LABELS[status]`, one word, no breakdown); this is the real gap, now an
expandable per-field breakdown of all five statements. Documents already surface their other four
axes as separate, existing badges (safety, processing, EVI-04 lifecycle, EVI-03 review outcome),
so a second, overlapping ladder there would mostly restate them; only the genuinely new axis
(`listIssuerVerificationsForDocument`) was added to the Document Vault page instead.

**What this proves, and what remains open.** 20 new tests (`assurance.test.ts`): `deriveAssuranceTier`
covers every tier boundary as a pure function, including the "agency review alone still reaches E1"
correction found while writing the first integration test (it initially expected E2, tracked as a
correction, not a silent fix); `getFactAssurance`/`listApplicantAssurance` proven against real
PGlite Postgres for a bare declaration, a document with real scan/extraction/classification rows,
a real accepted `missionDecisions` row reached through `selectEvidence`, and owner-only access;
`recordIssuerVerification` proven for a granted org, an expired confirmation still shown but not
counted, missing-target/blank-field/past-date rejection, a COMMENT-only grant refused, the owner
themselves refused, and a cross-applicant fact refused. 3 more tests cover the new
`listSelectedEvidenceForOrg` (`missions.test.ts`), the org-scoped sibling of `listSelectedEvidence`
the agency console's write action needs to resolve a requirement's evidence without owner access.
Left open, tracked rather than assumed covered: no UI lets an org record an issuer confirmation
against a requirement with no evidence selected yet (the action refuses cleanly, but there is no
prompt guiding the case manager to select evidence first); fact-level sharing to an organization
still does not exist as its own concept (the same limitation AD-05/AD-13 already note), so
`getFactAssurance`/`listApplicantAssurance` remain owner-only with no agency-facing read path.
