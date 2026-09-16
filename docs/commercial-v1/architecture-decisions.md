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
