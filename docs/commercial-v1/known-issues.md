# Commercial V1 Known Issues

Carried forward from `docs/roadmap/remaining-commercial-blockers.md` (prior engagement, still
accurate as of this session's baseline check) plus anything found during this programme. Each
item gets its own requirements-ledger row once classified against the new directive.

## Carried forward, still open

1. ~~Real malware scanner not implemented.~~ **RESOLVED (Part 3).** `ClamAvScanner`
   (`packages/adapters/src/clamav-scanner.ts`) is a real `MalwareScannerPort` backed by an
   actual ClamAV daemon; `commercial-readiness.ts`'s `realMalwareScanner` gate is now a live
   configuration check, not a hardcoded `false`. `BasicSafetyScanner` (structural/magic-byte
   only, ADR-0011) remains the DEFAULT when `MALWARE_SCANNER_PROVIDER=clamav` is not
   explicitly configured, which is intentional (fail toward the conservative existing
   behavior, never silently assume a scanner is present), not a residual gap. Full detail:
   `architecture-decisions.md` AD-04.
2. 8 cross-account E2E tests in `apps/web/e2e/authenticated-workspace.spec.ts` are
   unconditionally `test.skip(true, reason)` with empty bodies. They need real journey
   implementations against a second synthetic WorkOS identity. Directive Part 10 Section 2
   closes this; PR #77 provisioned the identity and the CI wiring but not the test bodies.
3. ~~Preview-deployment builds fail (`BUILD_FAILED`, terminal in under 2 seconds, no build
   logs) while production deployments of the same commit succeed. Root cause hypothesized
   (likely `DATABASE_URL` not scoped to the Preview environment in Vercel, or a Hobby-tier
   build-concurrency ceiling) but not confirmed; no session so far has had Vercel dashboard
   access to confirm. Does not block this programme's own verification (which runs locally
   and against production post-merge) but does block reviewers from getting live PR preview
   URLs.~~ **RESOLVED (Part 4, infra recovery checkpoint).** Root cause confirmed via direct
   Vercel API inspection, not the hypothesis above: the Neon marketplace integration's
   `free_v3` plan has a 10-branch limit, and the project had accumulated exactly 10 (`main`
   plus 9 archived Vercel-created preview branches), so every new preview deployment failed
   at Vercel's own resource-provisioning step (before the build container ever started,
   hence zero build logs) trying to provision an 11th. Confirmed by the product owner
   deleting the 9 archived branches externally, then a redeploy of the same commit that had
   just failed getting past provisioning cleanly (install completed, buildCommand started).
   See item 36 for the second, distinct issue that redeploy then surfaced.
4. `pnpm audit --dev` reports 8 findings as of the Part 3 checkpoint re-run (1 critical, 1 high,
   6 moderate; originally 6 findings/4 moderate at Part 1's baseline, 2 new moderate advisories
   published against the same chain since), all rooted in `vitest@2.1.9` / `vite@6.4.x` /
   `esbuild`, none shipped in the production bundle. `pnpm audit --prod` remains clean, re-run
   fresh at every checkpoint rather than assumed to still hold (see `test-evidence.md`). Fixing
   the dev findings requires a major `vitest` version bump across the monorepo, deliberately
   deferred by the prior engagement as out of scope for its own PR, and still deferred here for
   the same reason (no production impact, a monorepo-wide test-runner upgrade is real work
   deserving its own change, not a drive-by inside a Part 3 checkpoint).
5. AI provider wiring is OpenAI-only, confirmed this session by reading
   `apps/web/src/lib/ai.ts`: `createAiExtractor` explicitly returns `undefined` for any
   `AI_PROVIDER` other than `openai` ("only the OpenAI adapter exists so far"), and
   `packages/adapters/src/openai-extraction.ts` is the only adapter implementing
   `AiExtractionPort`. Cost accounting is confirmed approximate: `ai.ts` converts a fixed
   `APPROX_USD_PER_MILLION_TOKENS = 10` constant, documented in its own comment as "very
   rough ... NOT a billing source of truth," with no per-model or per-unit-type pricing.
6. `MissionSnapshot` over-collection is confirmed this session by reading
   `packages/services/src/missions.ts`: `snapshotMission` calls
   `loadFactInstancesByKey(db, mission.applicantId)` and `loadDocumentInstancesByType(db,
   mission.applicantId)`, both scoped to the whole applicant, then includes every returned
   fact/document in the snapshot content unconditionally, not filtered to the mission's
   selected evidence. Applicant acknowledgement is confirmed missing: no acknowledgement
   entity, table, or service function was found in `packages/services/src/missions.ts`; the
   mission state machine's terminal pre-close states are `READY_TO_EXPORT` and `LOCKED`,
   with no acknowledgement step between review and lock.
7. ~~Mission notes carry no visibility classification and no author-organisation ID.~~
   **RESOLVED (Part 4).** This was a live, currently-exploitable cross-tenant leak, not just a
   missing feature: two organizations both holding a valid grant on the same shared mission
   could each read the other's internal notes, since `listNotes` returned every row on the
   mission unfiltered. `missionNotes` now has a required `visibility`
   (`AGENCY_INTERNAL`/`TRAVELLER_SHARED`, no default) and `authorOrganizationId`; `listNotes`
   filters per row to `TRAVELLER_SHARED` notes plus only the calling organization's own
   `AGENCY_INTERNAL` notes. Proven by a real two-organization integration test, not assumed.
   Full detail: `architecture-decisions.md` AD-09, `requirements-ledger.md` CAS-05.
8. The mission state machine (`packages/services/src/missions.ts`) is confirmed to use the
   legacy states the PRD names for additive migration: `DRAFT`, `IN_PROGRESS`,
   `READY_FOR_REVIEW`, `UNDER_REVIEW`, `READY_TO_EXPORT`, `LOCKED`, `CLOSED`, `CANCELLED`.
   None of the new canonical states (`INTAKE`, `AWAITING_APPLICANT`, `SUBMISSION_READY`,
   `SUBMITTED`) exist yet.
9. Profile facts (`packages/services/src/profile.ts`, `editFact`) write `value: string`
   directly onto `factVersions` rows with no field-level protection distinction by
   sensitivity; `fieldDefinitions.sensitivity` exists as a column but nothing in this file
   branches on it to encrypt or otherwise protect high-risk values before persisting.

## Found this session

10. `pnpm audit --prod` reported 13 vulnerabilities (2 critical, 9 high, 2 moderate) on the
    first run this session, contradicting `remaining-commercial-blockers.md`'s claim that it
    was clean as of PR-F1 (either new advisories were published since, or something
    regressed; not investigated further since the fix is the same either way). Two were
    critical unauthenticated RCEs in `next` (fixed in `>=15.5.24`, resolved was `15.5.21`);
    the rest were `@xmldom/xmldom` (via `mammoth`, no override in place, fixed at `>=0.8.15`)
    and one `sharp` issue (existing override floor of `>=0.35.0` was below the fix at
    `>=0.35.4`). Fixed in this Part 1 commit: `next` bumped to `^15.5.24`,
    `pnpm.overrides.sharp` to `>=0.35.4`, `pnpm.overrides["@xmldom/xmldom"]` added. Full
    detail and advisory links in `baseline.md`.
11. Self-correction within this same session: the first `@xmldom/xmldom` override
    (`">=0.8.15"`, unbounded) let pnpm resolve to `0.9.12`, a minor line with a breaking API
    change (`DOMParser.parseFromString` now requires an explicit `mimeType`) that `mammoth`'s
    own code does not supply, which broke real DOCX text extraction
    (`packages/adapters/src/text-extraction.test.ts`, confirmed by a standalone repro against
    the installed package, not just the test's boolean assertion). Caught by this session's
    own re-verification run before committing, not by a later report. Fixed by bounding the
    override to `">=0.8.15 <0.9.0"`, matching the style of this file's other overrides and
    staying within the 0.8.x line where the CVE fix (0.8.15, the last 0.8.x release) actually
    landed. Recorded here as a general lesson for this programme: an unbounded `>=` override
    is not safe by itself, even for a "patch-level" security fix; it must be paired with an
    upper bound and a green test run before being trusted.

12. (Part 2) Staff/reviewer/support/platform-admin MFA is enforced nowhere, confirmed both
    in application code (`apps/web/src/lib/session.ts`'s `withSession`, the single entry
    point nearly every server action uses, does nothing authentication-strength-related
    beyond calling WorkOS's `withAuth()`) and live against VisaStack's actual production
    WorkOS environment (`mfaEnabled: "Off"`, queried via the connected WorkOS MCP connector
    this session). Full analysis in `threat-model.md`; the architectural tension (the only
    reliable mechanism found is environment-wide, but the PRD wants staff-only) is recorded
    as a decision required in `assumptions-and-blockers.md`, not resolved unilaterally.
13. (Part 2) No scoped, time-limited support-access-grant object exists (SEC-06 requires
    actor, subject/resource scope, reason, approver, start, expiry, max 60 minutes,
    revocation, audit trail). `packages/policy/src/authorize.ts` already has a real
    `support_admin` actor case that evaluates against a grant the same way any other
    recipient's grant is evaluated, but nothing today actually issues, time-bounds, or
    audits such a grant as a first-class object for that code path to consume. Confirmed by
    reading `schema.ts` in full; no matching table exists.

14. (Part 2) Protected-field encryption (SEC-03) is implemented and tested for
    `packages/services/src/profile.ts`'s fact read/write path only. AI proposals/snippets,
    OCR text, corrections, snapshots, exports, and cache — all named in SEC-03's full scope
    — are not yet protected; each belongs to the part that actually builds that surface
    (AI: Part 8; snapshots/exports: Part 7). No backfill of historical plaintext
    `fact_versions` rows was performed (this repo holds only synthetic/pilot data per its own
    README status banner, which lowers urgency but does not remove the obligation before a
    real commercial launch). Live KMS adapter/verification remains BLOCKED: no AWS KMS/GCP
    KMS/other vendor account exists for this session; `LocalEnvelopeKeyProvider`
    (`packages/adapters/src/key-management.ts`) is an explicitly non-commercial dev/test
    adapter, gated to refuse construction when `DEPLOYMENT_MODE=commercial`. Full design:
    `architecture-decisions.md` AD-01.
15. (Part 2) Support access grants (SEC-06) are implemented and tested at the
    service/schema/policy layer (`packages/services/src/support-access.ts`), but no caller in
    `apps/web` invokes `createSupportGrant`/`revokeSupportGrant` yet — there is no admin UI
    for a support operator to actually request, or a security admin to approve, access. That
    is Part 5/9 admin-workspace scope (ADM-01), tracked there rather than built prematurely
    in Part 2. Full design: `architecture-decisions.md` AD-02.

16. (Part 2) `packages/services/src/organizations.ts` has real, security-critical logic (last
    active owner protection against concurrent deactivation, cross-tenant IDOR prevention on
    membership IDs, independent step-up-gated organisation review with no self-verification)
    that had zero test coverage before this session, confirmed by absence of an
    `organizations.test.ts` file. Closed this Part 2 chunk with 17 new tests, including a
    genuine concurrency test (`Promise.all` racing two owners deactivating each other) rather
    than a single-threaded approximation. See `requirements-ledger.md` IAM-02.
17. (Part 2) The SEC-04 periodic signed checkpoint capability's own tamper-detection test
    initially passed for the wrong reason: it issued a raw `UPDATE audit_events SET hash = ...`
    expecting the row to actually change, but `audit_events`' pre-existing append-only RULE
    (`audit_events_no_update`, migration 0000) silently absorbs a plain UPDATE
    (`DO INSTEAD NOTHING`) exactly as designed, so the first version of the test was validating
    nothing. Caught by this session before committing (not by a later report): the fix makes the
    test explicitly `ALTER TABLE audit_events DISABLE RULE audit_events_no_update` before
    tampering and re-enable it after, actually reproducing "a party who bypassed the append-only
    protection," which is the exact scenario a checkpoint exists to detect. General lesson for
    this programme, same shape as item 11: a test against an append-only-by-RULE table must
    explicitly defeat the RULE to simulate the threat it claims to test, or it silently tests
    nothing.

18. ~~The binary-delivery token runs a 300-second TTL... redemption checks only signature+
    expiry, never live grant status.~~ **RESOLVED (Part 3).** TTL corrected to 60 seconds;
    redemption now replays the full authorization decision against live state via a second
    signed token and `recheckDocumentAccess`. 11 new tests prove a grant revoked, a membership
    deactivated, or a document version erased between mint and redemption each correctly kill
    an otherwise-still-valid token. Full design: `architecture-decisions.md` AD-05.
19. ~~Safe preview (EVI-02/EVI-06: "safe rendered previews with active content removed") does
    not exist. `'redacted'` is hardcoded to return `501`. An owner "previewing" their own
    document today receives the actual original bytes inline, not a safe derivative; a
    non-owner with a valid grant cannot preview at all.~~ **RESOLVED (Part 3).**
    `PreviewRendererPort`/`BuiltinPreviewRenderer` renders a genuine active-content-stripped
    derivative per content type (PDF rasterized to PNG, images decoded/redrawn, DOCX extracted
    to text, text normalized), wired into `/api/blob/[key]/route.ts` in place of the `501`.
    The owner-gets-raw-original shortcut was also removed, not just the third-party `501`:
    preview is now always the `redacted` derivative, for owner and non-owner alike, matching
    the PRD's explicit "originals are explicit downloads, never an untrusted inline PDF
    shortcut" over an earlier build's narrower reading. Full design, including the honest gap
    against the PRD's "in an isolated worker" phrasing (this renders on demand, in-process, not
    precomputed at ingest): `architecture-decisions.md` AD-06.
20. (Part 3) `DEFAULT_UPLOAD_QUOTAS.maxUploadBytes` (`packages/services/src/quotas.ts`) was
    10 MB, a prior-engagement pilot default, against EVI-01's explicit "20 MiB per original."
    Corrected to 20 MiB this chunk, per this program's standing instruction to follow the
    newer PRD's numbers over an older build's where they conflict.
21. (Part 3) Two genuine bugs caught by this session's own testing before committing, not left
    in: (a) the CI ClamAV-setup script originally chained `apt-get update && apt-get install`,
    so an unrelated third-party APT source failing (a stale PPA signing key, nothing to do
    with ClamAV) made `apt-get update` exit non-zero and short-circuit the whole install via
    `&&`, even though the actual packages needed were still fetchable from the primary Ubuntu
    archives, caught by literally running the extracted script end-to-end in this sandbox,
    not by reasoning about it, and fixed by gating only on the install command's own exit
    code. (b) Turborepo 2.10.5 does not pass an env var through to a task's child process
    unless it is declared in `turbo.json`'s `globalEnv` or the task's own `env` list (this
    repo's `turbo.json` had neither `globalEnv` nor any task `env` before this chunk), so the
    live-ClamAV test's `CLAMAV_TEST_SOCKET_PATH` was silently dropped when run via
    `pnpm run test` (which invokes `turbo run test`), even though it was correctly exported in
    the shell and worked when vitest was invoked directly, meaning the CI wiring would have
    silently skipped live verification forever without ever showing as a failure. Caught the
    same way (empirically running the actual command CI runs, not assuming turbo passes
    through the whole environment), fixed by adding `"env": ["CLAMAV_TEST_SOCKET_PATH"]` to
    the `test` task in `turbo.json`.
22. (Part 3) A test-design bug in `clamav-scanner.test.ts`, caught by this session's own live
    verification (not left in): two tests declared the EICAR fixture bytes under
    `contentType: 'application/octet-stream'`, which `structuralCheck`'s plain-text path does
    not recognize (only `text/plain`/`text/markdown` are accepted as text), so the object was
    rejected as "unrecognized file type" by the structural gate before ever reaching the
    scanner, so the tests were passing (`safe: false`) for the wrong reason and never actually
    exercised real/fake-server EICAR detection. Caught when the LIVE version of this test
    failed with the honest detail string ("unrecognized file type" instead of an
    EICAR-mentioning one); the fake-server version of the same bug had been silently
    coincidentally passing and was fixed at the same time once the pattern was recognized.
    Fixed by declaring the fixture as `text/plain`, matching how a real EICAR.com upload
    (which is plain ASCII by design) would actually be typed.

23. ~~`support_admin` document access is structurally unreachable today regardless of any
    support grant that exists. `accessDocument`/`recheckDocumentAccess` only ever load
    ordinary grants via `loadGrantsForPolicy`, never `support_grants` via
    `loadSupportGrantsForPolicy`.~~ **RESOLVED (Part 3).** A new `loadGrantsForActor` helper
    (`packages/services/src/documents.ts`) merges in the actor's active support grants,
    converted via the already-correct, already-tested `loadSupportGrantsForPolicy`, whenever
    the actor is `support_admin`, at both mint (`accessDocument`) and redemption
    (`recheckDocumentAccess`). No change to `authorize()` itself was needed: its `support_admin`
    case already filtered candidate grants by `recipientAccountId` correctly, matching the
    shape `loadSupportGrantsForPolicy` already produced; the grants list handed to it was
    simply incomplete. Proven by two new tests: a support_admin actor with no grant remains
    denied (default-deny, unchanged); a support_admin actor with a real, approved,
    action-matching support grant now succeeds at both mint and redemption, and correctly
    remains refused for an action (`DOWNLOAD_ORIGINAL`) the grant does not cover, proving this
    is a scoped fix, not a blanket bypass. This does not, and never did, reflect badly on
    SEC-06's own support-grant issuance/approval/revocation machinery, which was already
    correctly implemented and tested; only this wiring into the document-access decision point
    was missing. The admin-workspace/support-access UI itself (a real caller constructing a
    `support_admin` actor) remains Part 5/9 scope (ADM-01); this item was specifically about
    the authorization path being reachable at all once such a caller exists, which it now is.

24. (Part 3) Two more genuine bugs caught by this session's own review before committing, not
    left in: (a) `next.config.mjs`'s `bodySizeLimit` was still `15mb`, a margin computed
    against the *old* 10 MiB upload quota, silently re-introducing the exact "uploads rejected
    before reaching the real quota check" bug already fixed once in item 20, this time for any
    upload between 15 and 20 MiB. Caught by reading this file while adding `@napi-rs/canvas` to
    `serverExternalPackages` for the preview renderer, not by a report; fixed by raising it to
    `25mb`, the same proportional margin over the current 20 MiB quota. (b) the first draft of
    `/api/blob/[key]/route.ts`'s new redacted-serving branch constructed its `Response` from
    `rendered.bytes.buffer` directly, missing the exact defensive copy the adjacent
    `original`-variant branch already used (and documents why: a `Uint8Array` can be a view
    over a larger, possibly pooled backing buffer, so serving `.buffer` as-is risks sending
    bytes beyond the intended slice). Caught by re-reading the route for correctness, not by a
    test failure, since the bug would not reliably reproduce against small fixtures; fixed by
    factoring the existing copy into one `freshArrayBuffer` helper used by both branches, and
    by making `BuiltinPreviewRenderer`'s own plain-text passthrough return an independently
    owned copy as a postcondition of the port itself.
25. (Part 3) `/api/blob/[key]/route.ts`'s own wiring (token parsing, the variant branch, the
    call into `recheckDocumentAccess` and the preview renderer) has no direct route-handler
    test, matching `headers.test.ts`'s own stated rationale for this exact route ("simple early
    returns with no independent logic worth mocking a database for") and this codebase's
    established pattern of testing `apps/web` routes without a real/PGlite database. This was
    already true of the `501` this chunk's safe-preview work replaces (item 19), so it is a
    pre-existing gap in this one route's own test coverage, not a new one introduced this
    chunk; recorded honestly rather than implied to be newly covered. The service-layer
    functions the route calls (`previewDocument`/`downloadDocument`/`recheckDocumentAccess`)
    and the renderer itself (`BuiltinPreviewRenderer`) are both directly, thoroughly tested.
26. (Part 3) A genuine `pnpm run build` failure caught and fixed before committing, not left
    in: adding `@napi-rs/canvas` as a plain dependency of `packages/adapters` was not enough
    for `apps/web`'s production build to succeed. Even with `@napi-rs/canvas` (and every
    platform-specific sibling package) listed in `next.config.mjs`'s `serverExternalPackages`,
    the documented mechanism for excluding a native-binary dependency from webpack's bundle,
    the build still failed: `Module parse failed: Unexpected character` on the platform
    package's own `.node` binary, reached transitively through `@visastack/adapters` (a pnpm
    workspace package) via both a Server Action (`applicant/[id]/actions.ts`) and a plain Route
    Handler (`/api/blob/[key]/route.ts`). `serverExternalPackages` alone did not stop webpack
    walking into `@napi-rs/canvas`'s own internal `require` of the platform binary in this
    pnpm-workspace-transitive-import shape; caught only by actually running the real production
    build and reading the failure, not by assuming the documented option would work. Fixed with
    an explicit `webpack()` config override (a function-based `externals` matcher on the
    `@napi-rs/canvas` request prefix, applied only for the server compiler), which does work,
    confirmed by a subsequent clean `pnpm run build` producing the full route manifest
    including `/api/blob/[key]`. `serverExternalPackages` is left in place alongside it, since
    it is still the right signal for Vercel's own deployed-function file tracing to include the
    native binary, a separate concern from webpack's bundling step this override fixes.
27. (Part 3) EVI-01's "initial configurable limits" (page count, megapixels, batch count) were
    entirely unenforced beyond upload byte size. Page count (50 PDF pages) and image resolution
    (40 megapixels) are now real: `ContentLimitsPort`/`BuiltinContentLimitsChecker` runs in the
    intake pipeline's NORMALIZING step. Batch count ("10 files per user batch") remains
    deliberately unimplemented: no server-side concept of an upload "batch" exists anywhere in
    this codebase today (uploads are reserved and processed one at a time, `uploadIntents` has
    no grouping column), and inventing one (a time window? an explicit client-generated batch
    id? per calendar day?) is a real product decision this session is not positioned to make
    unilaterally, unlike the page-count/megapixel numbers, which the PRD states as exact,
    unambiguous figures. Tracked here rather than silently left off the ledger.
28. (Part 4) Two gaps found and deliberately left open while closing item 7's cross-tenant
    leak, recorded rather than silently left implied to be covered by that fix: (a) the new
    `listNotesForOwner` (`packages/services/src/agency.ts`) has no caller anywhere in
    `apps/web`; the applicant-facing mission view has no notes section at all today, so this is
    a still-missing feature (an owner-facing read surface for shared notes), not a regression,
    and not yet built this chunk. (b) `individual_recipient` actors (a direct, personal grant
    recipient who is not part of an organization) have no notes-read path anywhere in this
    codebase: they can call `addNote` when their grant permits `COMMENT`, but nothing lets one
    list notes back. This is a pre-existing gap, confirmed to predate this chunk's changes, not
    worsened or introduced by the visibility fix; tracked here since it was noticed while
    auditing every `missionNotes` read path, not because this chunk caused it.
29. ~~SHR-01's "categories do not automatically include future documents by default; expanding
    scope requires a displayed confirmation" is unimplemented.~~ **RESOLVED (Part 4, AD-11).**
    `getRecipientWorkspace` (`packages/services/src/sharing.ts`) re-evaluated `authorize()`
    against every document currently on the applicant on each read, live, with no notion of
    which documents existed when the grant's `categories` were set; a document uploaded after a
    category-scoped grant existed, if it matched that category, became visible immediately, with
    no owner action and no confirmation. `createGrant` now snapshots the matching document set at
    creation (`grants.documentScopeSnapshot`); the policy engine enforces it for document
    resources; `previewScopeExpansion`/`expandGrantScope` give the owner a real, explicit,
    displayed-confirmation path to widen it later. Correction to this item's own prior text: it
    previously also named `bulkExport` (`packages/services/src/agency.ts`) as affected; that was
    wrong (`bulkExport` exports facts only, never documents) and is corrected here rather than
    silently dropped. Full detail: `architecture-decisions.md` AD-11.
30. (Part 4) Found while confirming AD-11's own reach, not fixed there: `documents.ts`'s
    `accessDocument`/`recheckDocumentAccess`, the real byte-serving preview/download path behind
    `/api/blob/[key]`, never populate `resource.category` when calling `authorize()`. Combined
    with the policy engine's own pre-existing rule that a `categories`-scoped grant denies
    outright when `resource.category` is absent, a grant restricted to `categories` with no
    explicit `documentIds` can never actually pass real document preview/download through that
    route today. This is a distinct, over-restrictive bug (denies access that should work), not a
    leak, and not something AD-11 introduced or was asked to fix (AD-11 closes
    under-restriction, `getRecipientWorkspace`'s live visibility list, which never calls
    `accessDocument`). Tracked here so it is not lost, since finding it required reading every
    document-resource `authorize()` call site in the codebase, work not likely to be repeated
    incidentally.
31. ~~EVI-03's remaining scope after AD-12: duplicate detection and the
    PENDING/ACCEPTED/REPLACEMENT_REQUIRED/IRRELEVANT/DISPUTED document review-state enum.~~
    **RESOLVED (Part 4, AD-13).** `findDuplicateVersions` (same-applicant-only, advisory) and
    `documentReviews` (append-only, all five outcomes) are both real and tested.
32. (Part 4) AD-13's own remaining scope: no UI anywhere, owner-facing or agency-facing, calls
    the new `recordDocumentReview`. The service function is complete and tested, but a reviewer
    has no page to actually use it from yet, matching this session's established pattern of a
    still-missing feature rather than a regression. Also open: EVI-03's "replacement... notifies
    affected open cases" needs a real notification system, which does not exist anywhere in this
    codebase yet (Part 5 scope, `NullEmailPort` only `console.warn`s); tracked as a Part 5
    dependency, not silently dropped.
33. (Part 4) AD-14's own remaining scope: no UI action lets an owner actually call
    `supersedeDocument` yet. The read side of EVI-04 (lifecycle status badges, mission usage,
    and access summary) is real and wired into the existing documents page; a "mark this as
    superseded by that" two-document-picker UI is a larger, separate piece of work, not built
    this chunk. Also open: the 30-day "expiring soon" threshold in `documentLifecycleStatus` is
    a documented provisional default, not a PRD-given number, pending Part 5's Expiry Centre
    (NTF-01).
34. (Part 4) Found while building AD-15: `factVersions.status`'s `AGENCY_REVIEWED` value has
    existed since Build Spec §9 and is treated as trusted by `ai.ts`'s `TRUSTED_FACT_STATUSES`,
    but nothing in the service layer has ever written it, `recordMissionDecision` never touches
    `factVersions`, so it stays unreachable in production even after this chunk. Deliberately not
    fixed by wiring a literal write: doing so would require loosening `editFact`'s owner-only
    authorization to let an org write a new fact version, a separate, larger authorization change.
    Instead, "agency reviewed" is derived read-side in `assurance.ts` from the existing
    `missionDecisions`/`selectedEvidence` join, naming the exact mission/requirement/reviewer/date
    rather than a bare status flag, which serves EVI-05's actual display need without the literal
    enum value ever needing to become reachable. Tracked as a deliberate design choice, not a
    silently-dropped fix.
35. (Part 4) AD-15's own remaining scope: no UI prompts a case manager to select evidence for a
    requirement before trying to record an issuer confirmation against it; `recordIssuerVerification`
    refuses cleanly with a clear message, but the agency console gives no upfront guidance. Also
    open: fact-level sharing to an organization still does not exist as its own concept (the same
    limitation AD-05/AD-13 already note for other surfaces), so the assurance view
    (`getFactAssurance`/`listApplicantAssurance`) remains owner-only with no agency-facing read
    path, even though `recordIssuerVerification` itself is agency-facing.
36. ~~`apps/web/vercel.json`'s `buildCommand` ran `pnpm --filter @visastack/db db:migrate &&
    next build`, applying migrations automatically on every single Vercel build (preview and
    production alike). Once item 3's Neon branch-limit blocker was cleared, the very next
    redeploy got past provisioning and reached this step, then failed:
    `CREATE TABLE "support_grants"` (migration 0028 of 34) against a database that already had
    it, `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`. The connection/auth itself succeeded (a real query
    ran and failed on its own terms), ruling out a credential mismatch from the product owner's
    manual secret rotation as the cause.~~ **RESOLVED (Part 4, infra recovery checkpoint).**
    This directly contradicted the codebase's own stated design: `packages/db/src/migrate.ts`'s
    own header comment says migrations should run "deliberately (not on every deploy)... an
    intentional, reviewed operation", and a separate, human-gated
    `.github/workflows/db-migrate.yml` (`workflow_dispatch`, requires typing "migrate" to
    confirm) already exists for exactly that. `buildCommand` changed to plain `next build`
    (confirmed safe: every route is server-rendered on demand per the build's own route
    manifest, none are statically generated against the database at build time; this exact
    command was already being run and passing via `apps/web/package.json`'s own `build`
    script, both locally and in the "Lint · Build · Typecheck · Test" GitHub Actions check,
    throughout this session). Left open, deliberately not done here: nothing in this fix
    applies migrations 29-34 (everything since Part 4 chunk 3) to whatever database Preview
    now points at; the preview app can still runtime-error on pages touching those tables
    until the product owner deliberately runs `db-migrate.yml` (a live-database write, so left
    to that existing human-gated workflow rather than triggered autonomously here). Whether
    Preview deployments get their own fresh Neon branch per deployment or share one persistent
    database also remains unconfirmed; this fix does not depend on the answer either way.
37. (Part 3) A genuine, previously-untracked security bug found and fixed this chunk while
    auditing A07's "exact storage version" acceptance scenario:
    `recheckDocumentAccess` (`packages/services/src/documents.ts`) re-derived "the latest
    document version by version number" fresh at redemption time, entirely independent of
    which version the blob token's storage object was actually bound to at mint time
    (`accessDocument`). A version added between mint and redemption could make the recheck
    verify safety of the wrong row: either wrongly allowing redemption of a now-unsafe minted
    version (a clean newer sibling masking it), or wrongly denying redemption of a still-safe
    minted version (an unsafe newer sibling blocking it). This directly violated directive
    Part 3 Section 10's explicit requirement that redemption re-evaluate the exact version.
    Fixed by adding `documentVersionId` to `DocumentAccessTokenFields`, signed and pinned at
    mint time exactly like every other field, and looked up by exact ID (never "latest") at
    redemption. Proven by two new tests in `documents.test.ts` exercising both directions of
    the exploit, both confirmed to fail without the fix. Full design:
    `architecture-decisions.md` AD-05 (extends the redemption-recheck work already recorded
    there); ledger detail: `requirements-ledger.md` EVI-06.
38. (Part 3) A genuine, previously-unknown, already-shipped production bug found while auditing
    the worker pipeline's "bounded CPU/memory/time" (directive Part 3 Section 5): neither
    `content-limits.ts`'s `checkPdf` nor `text-extraction.ts`'s `extractPdf` ever called
    `pdf.loadingTask.destroy()` on the `PDFDocumentProxy` they resolved via `unpdf`'s
    `getDocumentProxy`. Confirmed by an isolated reproduction against the real library that an
    undestroyed proxy left open in a warm, reused process (ordinary Vercel serverless
    container-reuse behavior, not an edge case) corrupts pdfjs's in-process fake-worker
    transport for a LATER, completely unrelated document's own PDF call: processing one PDF
    during intake could make a later, unconnected PDF's preview render (or even its own later
    intake) fail with a cryptic "Cannot transfer object of unsupported type" error, purely as a
    function of container warmth and processing order, never reproducible from a single
    isolated request in this sandbox's own tests until two real PDF calls happened to land in
    the same process. Fixed by destroying the resolved proxy in a `finally` block at all three
    call sites (`checkPdf`, `extractPdf`, and `preview-renderer.ts`'s `renderPdf`, which also
    gained its own new page-count re-check in this same chunk). Proven by a dedicated
    cross-adapter regression test. Same chunk also closed the two adjacent, less severe gaps
    that prompted this audit: no wall-clock timeout at all on `checkPdf`/`extractPdf`'s parse
    step, and `renderPdf` never re-checking the page-count limit at render time (only at
    intake). Full detail: `requirements-ledger.md` SEC-05.
39. ~~Directive Part 3 Section 3's "delete abandoned objects/reservations after 24 hours" was
    unimplemented: the 10-minute `RESERVATION_TTL_MS` only ever excluded an abandoned upload
    reservation from quota sums, never cleaned anything up, and a request killed between the
    blob write and `finalizeUpload`/`failUpload` left a permanently `RESERVED` row and possibly
    orphaned quarantine bytes with nothing ever revisiting either.~~ **RESOLVED (Part 3).** New
    `sweepAbandonedUploads` runs on its own scheduled cron (`/api/jobs/process-abandoned-uploads`),
    deletes bytes under the abandoned intent's own known object key, and marks the intent
    `FAILED`. Full detail: `requirements-ledger.md` EVI-01.
40. (Part 3) Directive Section 13's monitoring signals ("queue age; job failures; scanner
    availability; signature age; render failures; object-storage errors; abandoned uploads")
    were confirmed completely unwired: `ObservabilityPort`/`ConsoleObservabilityPort` existed
    with zero call sites anywhere in the codebase. Two of the seven signals are now wired
    (`job_failure` on every failed intake job attempt; `abandoned_upload_cleaned` per sweep that
    cleans something), chosen as the clearest hooks into already-existing code rather than new
    instrumentation surfaces. Five remain genuinely open: queue age, a dedicated continuous
    scanner-availability/signature-age signal (today only inferable from a `SCAN_FAILED`
    job-failure spike, not observed independently), render failures, and object-storage errors.
    Not silently dropped: tracked here and in `requirements-ledger.md` OPS-03, likely revisited
    alongside Part 9's own monitoring/performance scope rather than gold-plated in this chunk.
41. ~~Directive Part 4 Section 5's "secure member invitations" did not exist: the only "add
    member" path required the invitee to already hold a VisaStack account, with no token, no
    expiry, no single-use consumption, and nothing sent to anyone, so an org admin could not
    actually invite a genuinely new colleague at all.~~ **RESOLVED (Part 4).** New
    `packages/services/src/invitations.ts` implements a real, hashed, single-use, race-safe
    invitation token; `addMemberAction` falls back to it automatically when no account exists.
    Full detail: `requirements-ledger.md` IAM-02.
42. ~~Directive Part 4 Section 6's "agency invites a traveller as a new client" (IAM-03) did not
    exist at all. Found and fixed while building it: the initial implementation of
    `acceptClientInvitation` created a grant to the inviting organisation and then immediately
    called `assignMember` to wire up the named case owner, but a freshly created grant is
    `PENDING_ACCEPTANCE` and `authorize()` (`packages/policy/src/authorize.ts`) denies it
    outright until accepted, so `assignMember`'s own `orgGrantPermits` check would have failed
    on every single real acceptance, and its result was being logged and swallowed as "best
    effort" rather than surfaced, meaning the case owner an agency admin named at invite time
    would silently never actually be assigned, with no error visible anywhere.~~ **RESOLVED
    (Part 4).** The traveller's acceptance now also accepts the grant on the inviting admin's
    behalf, re-verified live as an active org OWNER/ADMIN by `acceptGrant` itself rather than
    trusted from invitation-creation time, and `MANAGE` was added to the default client-grant
    scope (`assignMember` requires a `MANAGE`-scoped grant on the mission). A failed grant
    acceptance is now fatal to the whole transaction rather than swallowed. Proven by a test
    that asserts the assignment row actually exists after acceptance, not just that the call
    returned ok. Full detail: `requirements-ledger.md` IAM-03.
43. ~~Directive Part 4 Section 7's "subject/guardian relationship" (IAM-04) had separate subject
    IDs and a relationship label, but nothing distinct for "explicit authority": a caller could
    create a MINOR_GUARDIAN or FAMILY_MEMBER record by picking one dropdown value, with no
    separate confirmation that they actually held authority to act for that person, and no
    persisted record of that confirmation either way. Separately, the PRD's "V1 family cases
    remain separate linked cases with a shared itinerary reference" had no implementation at
    all: no way for a guardian managing several of their own applicants' missions to visually
    link them as one family trip.~~ **RESOLVED (Part 4).** New `authorityConfirmedAt` column on
    `applicants`; `createApplicant` now refuses a non-SELF relationship without an explicit
    `authorityConfirmed: true`, wired into the applicant-creation form as a required checkbox
    shown only for non-SELF relationships. New nullable `itineraryRef` on `missions`, settable
    via `setMissionItineraryRef`, with a dedicated `listMissionsByItineraryRef` read always
    scoped to the caller's own applicants only, proven to never cross accounts even given an
    identical reference string. Full detail: `requirements-ledger.md` IAM-04.
44. ~~Evidence requests (`respondEvidence`) let the applicant owner mark any request FULFILLED or
    DECLINED with nothing behind the click: no fact, no document, no safety check, no processing
    status, no link to anything real. An applicant could "fulfil" a document request without
    ever having submitted a document, and an agency reading the response had no way to know
    whether it meant anything real had been provided.~~ **RESOLVED (Part 4).** Replaced entirely
    with Commercial V1 Part 4 §10's exact six-state model
    (OPEN/RECEIVED/UNDER_REVIEW/ACCEPTED/NEEDS_REPLACEMENT/CANCELLED); a request can now only
    reach RECEIVED by linking an actual fact or document the applicant owns, and a document must
    currently pass the same safety/processing/erasure check `missions.ts` readiness already uses
    or the submission is refused outright. Full detail: `requirements-ledger.md` CAS-03.
45. ~~CAS-06's "reviewer must differ from preparer" had no implementation at all: any org member
    could both prepare and decide on the same case with nothing stopping them.~~ **RESOLVED
    (Part 4).** New `organizations.requireDifferentReviewer` setting, enforced in
    `decideEvidenceResponse`. Caught during implementation, before it shipped: the first design
    compared the deciding account against `selectedEvidence.selectedByAccountId` on
    `recordMissionDecision`, which would have been dead code in practice, since `selectEvidence`
    is owner-only and can never name an org account, so the check could never trigger for the
    real agency-reviews-a-case scenario. Re-grounded in the PRD's own CAS-06 text ("Reviewers
    accept or request replacement of selected evidence"), which maps to `decideEvidenceResponse`
    (built for CAS-03) rather than `recordMissionDecision`, and "preparer" to
    `evidenceRequests.requestedByAccountId`, a genuine agency-internal signal. Full detail:
    `requirements-ledger.md` CAS-06.
46. ~~Case creation (`createMission`) had no jurisdiction/consular context, service category,
    agency owner, target deadline, or travel dates anywhere on a mission, and no manual-route
    mode for a destination with no automated requirement pack, so a case built for one of those
    routes had no way to record that fact anywhere the UI or an export could show it.~~
    **RESOLVED (Part 4).** Seven new nullable/defaulted columns on `missions` (`jurisdiction`,
    `serviceCategory`, `travelStartDate`/`travelEndDate`, `targetDeadline`,
    `ownerOrganizationId`, `manualMode`), all purely descriptive and none gating any
    authorization or readiness decision; new `updateMissionCaseDetails` for post-creation
    partial edits; `snapshotMission` now captures all of it. The PRD's other two named gaps,
    "assigned manager" and "explicit traveller grant binding at creation," needed no new work:
    both were already covered by the pre-existing `assignMember`/`assignments` mechanism and
    the pre-existing grant-lifecycle invariant respectively. Full detail:
    `requirements-ledger.md` CAS-01.
47. ~~The agency org console had no case search at all (name/stage/destination/assignee, or any
    other dimension), and its one "Case inbox" rollup was admin-only, showing just assignment
    status and an open-request count -- nothing for overdue tasks, approaching dates, review
    issues, a readiness result, or acknowledgement status, all of which CAS-02 names as things a
    case workspace must present together.~~ **RESOLVED (Part 4).** New `case-search-form.tsx` (a
    plain GET form) filters by name/case-id, stage, destination, and assignee, strictly over
    cases the viewer is already authorized to see -- never a separately or more broadly queried
    set, and never a passport-number or wallet-content search. The rollup now shows, per case:
    assignment, open requests, review issues (evidence requests sent back for replacement),
    overdue tasks, approaching dates, a real readiness result (or an honest "Manual mode"/"No
    pack attached" state, never a computed figure once a case is in manual mode), and an explicit
    "not yet tracked" placeholder for acknowledgement (TRU-02 doesn't exist yet, Part 7 -- the
    directive's own text for this section allows a placeholder here). While building this,
    found that the admin-vs-assigned-only visibility rule (a non-admin org member may only see
    cases they're personally assigned to) had never actually leaked -- the page component's own
    existing filter was correct -- but lived ONLY there, meaning any future caller of the
    underlying list query could have forgotten it entirely. Centralized into a new
    `listVisibleMissionsForMember`, now the single source both the default listing and search run
    through. Full detail: `requirements-ledger.md` CAS-02, CAS-04.
48. ~~CAS-08's "contributor request" (a sponsor or family member submits exactly one named
    document without ever getting a wallet, profile, or case view) did not exist anywhere in the
    codebase.~~ **RESOLVED (Part 4).** New `contributor-requests.ts` reuses the existing
    hashed-token invitation primitive and the applicant's own real upload/malware-scanning
    pipeline end to end, gated by a new, narrow alternate authorization on
    `documents.ts`'s `registerDocument`/`addDocumentVersion` (previously hard owner-only):
    accepting a bound, currently-claimed contributor request, verified against the database, not
    merely trusted from a caller-supplied flag. Proven not to weaken the existing owner-only
    boundary by every pre-existing document/wallet test (76 tests) still passing unchanged
    alongside 8 new ones covering the authorization boundary itself, race-safety, and the
    "not copied into the reusable wallet without contributor permission" rule (a new
    `documents.walletVisible` column, read by the wallet view, deliberately left out of
    readiness/docType matching). Full detail: `requirements-ledger.md` CAS-08.
49. ~~`authorize()`'s `organization_member` case checked only the individual
    membership row's own status, never whether the organization itself was
    still ACTIVE -- so a suspended or closed organization's members kept
    full, live, functional access to every applicant that had ever granted
    that organization access, through every one of the 5 places in the
    codebase that construct an `organization_member` Actor (`agency.ts`'s
    `orgGrantPermits`/`bulkExport`, `documents.ts`'s `recheckDocumentAccess`,
    `sharing.ts`'s `getRecipientWorkspace`, `wallet.ts`'s `getWalletView`).
    This was a live, exploitable access-control gap, not a cosmetic one:
    SHR-02's own "enforcement, revalidation" requirement is meaningless if
    organization standing is never part of what gets revalidated.~~
    **RESOLVED (Part 4).** `Membership` gained `organizationActive: boolean`,
    `DenyReason` gained `'organization_not_active'`, and `authorize()`'s
    `organization_member` case now denies outright when the organization is
    not active; every one of the 5 call sites now supplies real organization
    status rather than omitting the field. Proven by a pure policy-unit test
    and two real service-integration tests (`bulkExport` and
    `orgGrantPermits` via `assignMember`). Full detail:
    `requirements-ledger.md` SHR-02.
50. ~~`resumeGrant` never checked `expiryAt`, so an owner could resume a
    paused grant back to `status: 'ACTIVE'` after it had already expired
    while paused, leaving a misleading "Active" status nothing else
    corrected (`authorize()`'s own independent live `expiryAt` recheck meant
    this was never an actual access-control hole, only a data-integrity/
    honesty one).~~ **RESOLVED (Part 4).** `resumeGrant` now refuses the
    transition outright once `expiryAt` has passed, proven by a new test.
    Full detail: `requirements-ledger.md` SHR-01, SHR-02.
51. ~~SHR-03's "show... accesses" (an actual log of what happened to an
    applicant's data, distinct from what a grant theoretically permits) did
    not exist anywhere in the product, despite the underlying `auditEvents`
    chain already recording everything comprehensively; and the sharing
    page's grant rows showed only an action COUNT, never which actions or
    what scope (categories, documents, mission) were actually granted.~~
    **RESOLVED (Part 4).** New `listAuditEventsForApplicant` (owner-scoped,
    tenant-isolation-tested, actor resolved to an email) backs a new
    "Access log" card; a full `ACTION_LABELS` map and richer row rendering
    now surface the real scope already present on the `Grant` type but
    never rendered. Full detail: `requirements-ledger.md` SHR-03.
52. ~~SHR-04 names "external issuer contact" as a consent type separate from
    SHARING; it did not exist anywhere in the product, and
    `recordIssuerVerification` dispatched real outbound issuer-contact
    actions with zero consent gate at all.~~ **RESOLVED (Part 4).** Added
    `ISSUER_CONTACT` end to end (`CONSENT_TYPES`, English + Bangla copy,
    both UI label maps, migration `0046`), and `recordIssuerVerification`
    now refuses with `consent_required` when it is absent. Full detail:
    `requirements-ledger.md` SHR-04.
53. ~~PRO-01's field-by-field audit against its own 13 named Master Profile
    sections found two that did not exist as distinct concepts at all:
    "current/historical passports" had only a single non-repeating
    passport_number/passport_expiry pair, with no way to record a second,
    prior, or otherwise-held passport; "self-employment" had no
    representation distinct from the investor/entrepreneur-oriented
    "business" pack. Also a real formatting gap: every monetary field
    (annual_income, monthly_salary, investment_amount) was a single
    unstructured string with no ISO currency ever captured, contradicting
    PRO-01's own "Currency: decimal + ISO currency" rule.~~
    **RESOLVED (Part 4).** Added a new repeating `historical_passport` group
    alongside the untouched (zero data-risk) current passport fields, a
    `self_employment` section under the professional pack, and a paired
    `..._currency` select (new `options` support on `ProfileFieldDef`, a
    34-code ISO 4217 subset) for every monetary field. Closed smaller
    precision gaps in the same pass: `country_of_residence`,
    `marital_status`, and `name_alternate`. Full detail:
    `requirements-ledger.md` PRO-01.
54. ~~PRO-02's "conflict creates a review issue/task" had a real mechanism
    (`computeReadiness`'s `unresolved_conflict` reason, rendered as a
    distinct red badge on the mission page) but it only fires for a mission
    with an attached pack -- a conflict arising before any case exists, or
    on a manual-mode/no-pack case, had no visibility anywhere except an
    easy-to-miss per-field badge on the Master Profile page itself.~~
    **RESOLVED (Part 4).** Added a page-level notice on the Master Profile
    page whenever any fact is CONFLICTED, reusing already-fetched data (no
    new query), so a conflict is now guaranteed visible independent of any
    particular case. Full detail: `requirements-ledger.md` PRO-02.
55. ~~CAS-05's `listNotesForOwner` (traveller-visible, `TRAVELLER_SHARED`-only
    notes) was correct but unreachable: no page in `apps/web` ever called
    it, so a traveller had no way to actually see a note an agency chose to
    share with them, despite the read path itself being safe.~~
    **RESOLVED (Part 4).** Wired it into a new "Notes from your agency" card
    on the mission page; `listNotesForOwner` now also resolves the author to
    a real email (`OwnerVisibleNote`) instead of a raw account id. Every
    other §12 rule (legacy-note restriction, AI/search/export non-leakage,
    no bulk publish) was audited against the real code and confirmed already
    correct, not merely assumed. Full detail: `requirements-ledger.md`
    CAS-05.
56. ~~CAS-04's own directive text (§11 "Tasks and appointments") names far
    more than the prior minimal slice covered: explicit timezone, priority,
    an IN_PROGRESS task state, a wholly distinct Appointment concept (local
    date/time, timezone, place/channel, add-to-calendar download),
    reassignment, "a removed member may not remain sole owner of an active
    case," and "create reassignment queue." None of it existed, and none of
    it is deferrable to Part 5 by the PRD's own wording -- only "reschedule
    *notifications*" is named as later.~~ **RESOLVED (Part 4).** Built all
    of it: `priority`/`dueTimezone` on `missionTasks`, a real OPEN ->
    IN_PROGRESS -> DONE/CANCELLED task state machine, a new
    `missionAppointments` table and full CRUD (owner and org side, org side
    newly gated exactly like `recordMissionDecision`'s own assigned-member
    bar), a real RFC 5545 `.ics` "add to calendar" download, `unassignMember`
    plus `listUnassignedActiveMissions` (the reassignment queue), and
    `setMembershipActive` now auto-unassigns a deactivated member from every
    active mission where they were the SOLE assignee, in the same
    transaction as the deactivation itself -- proven by a test that a
    co-assigned mission's assignments survive a deactivation untouched.
    Full detail: `requirements-ledger.md` CAS-04.
57. ~~CAS-06's own directive text (§13 "Review") names four review outcomes:
    accepted evidence; replacement requested; contradiction; proposed
    correction. Only the first two were ever reachable by a human reviewer
    -- an existing code comment had quoted just "accept or request
    replacement," dropping the other two, which led an earlier chunk to map
    "contradiction"/"proposed correction" onto `FACT_STATUSES` CONFLICTED
    and `field_proposals`, both AI-extraction-only mechanisms with no path a
    human reviewer could actually reach.~~ **RESOLVED (Part 4).** Added
    `CONTRADICTION`/`CORRECTION_PROPOSED` as real `decideEvidenceResponse`
    outcomes (migration `0048`), routing to the same request-status
    transition as NEEDS_REPLACEMENT while the decision record keeps the
    specific classification, surfaced to the applicant on the evidence page
    with its own label. Honestly scoped: a proposed correction is the
    reviewer's plain-text suggestion, not a structured `field_proposals`
    row -- that would need decoupling `field_proposals` from its required
    `aiExtractionRunId`, a real, separate, deliberately undone enhancement.
    Full detail: `requirements-ledger.md` CAS-06.
58. ~~No expiry concept existed for case-specific document freshness (e.g. "a
    bank statement must be dated within 90 days for this route"), and the
    two expiry concepts that DID exist (`documents.expiresAt` intrinsic,
    `issuerVerifications.validUntil` verification) had no shared
    classification logic -- three separate call sites each computed their
    own ad-hoc `validUntil.getTime() <= Date.now()` boolean, with no
    reminder-threshold ladder anywhere and `documents.documentDate` a
    genuinely dead column (declared in the schema, never read or written by
    any code path).~~ **RESOLVED (Part 5, NTF-01).** New
    `packages/services/src/expiry.ts`: `classifyExpiry` (intrinsic/
    verification, a graduated `unknown/ok/reminder/expired` status against a
    90/60/30/7/0-day default ladder) and `classifyStaleness` (case-specific,
    `not_applicable/unknown/fresh/stale`) as two deliberately separate
    functions, matching the directive's "track separately." New
    `packRequirements.maxAgeDays` (migration `0049`) is the case-specific
    freshness rule; a new `setDocumentDate` (`documents.ts`) is a real,
    strictly-validated human write path for the previously-dead
    `documentDate` column, since a freshness rule with no way to ever record
    a date would be permanently unreachable. A confirmed-stale document now
    genuinely blocks requirement satisfaction (`MissingRequirement` reason
    `stale_evidence`); an unknown one does not, deliberately, matching the
    same fail-open-on-missing/fail-closed-on-confirmed posture already used
    for conflicted facts. New applicant "Expiry" tab shows all three signals
    in three separate cards. Full detail: `requirements-ledger.md` NTF-01.
59. ~~No notification mechanism of any kind existed: no outbox, no delivery
    worker, no in-app notification list, and `NullEmailPort` was the only
    email path (logs a warning, never sends). None of the directive's
    eleven notification-worthy events (evidence requests, case status
    changes, expiry, etc.) reached the applicant in any form.~~ **PARTIALLY
    RESOLVED (Part 5, NTF-02).** Built the transactional outbox mechanism in
    full: new `notifications` table (migration `0050`) with the directive's
    exact six delivery states, a composed idempotency key, and lease-based
    concurrent-safe claiming; `packages/services/src/notifications.ts`'s
    `runNotificationWorker` dispatches IN_APP immediately and EMAIL via the
    injected port with a real 5-attempt/24-hour backoff schedule, and
    RE-VERIFIES the recipient's authorization at send time rather than
    trusting enqueue time. Wired to two real domain events
    (`requestEvidence`, `recordMissionDecision`) as proof, both notifying
    the applicant owner in-app and by email (still via `NullEmailPort`,
    since NTF-03's real provider is unstarted). New applicant "Notifications"
    tab. Deliberately NOT a full resolution: nine of the eleven event types
    remain unwired, and the date-threshold sweep (NTF-04) that would turn
    NTF-01's expiry classification into an actual reminder does not exist
    yet. Full detail: `requirements-ledger.md` NTF-02/03/04. **Update
    (2026-09-22, Part 5 §4):** the date-threshold sweep now exists --
    `notification-sweep.ts`'s `sweepTaskDeadlineReminders`/
    `sweepExpiryReminders`, DST-safe (calendar-date, never millisecond,
    arithmetic), hourly via `/api/jobs/process-notification-sweeps`. The
    nine unwired event types remain open. **Update (2026-09-22, Part 5 §5):**
    `NullEmailPort` is no longer the only path -- `lib/providers.ts`'s
    `createEmailPort` returns a real `ResendEmailPort`
    (`packages/adapters/src/email.ts`) when `EMAIL_PROVIDER=resend` is
    configured (`docs/adr/0013-transactional-email-resend.md`), and
    `NullEmailPort` now refuses to construct at all in commercial mode and no
    longer logs the recipient or subject at all. Delivery/bounce/complaint
    state now updates from a real, HMAC-verified webhook
    (`packages/adapters/src/resend-webhook.ts`,
    `/api/webhooks/resend`) rather than staying frozen at "provider
    accepted." Full detail: `requirements-ledger.md` NTF-03. Still open, not
    this chunk's scope: the nine unwired event types noted above, and (see
    item 61 below) live A18 verification against a real Resend account.
    **Update (2026-09-22, Part 5 §2/§4 continued):** five more of the nine
    wired -- replacement requests and final review (both via
    `decideEvidenceResponse`), appointments scheduled, and platform-role
    grant/revoke (`agency.ts`, `platform-roles.ts`) -- plus the separately
    directive-required obsolete-notice cancellation mechanism (§4: "invalidates
    obsolete notices"; A17: "stale scheduled messages cancelled"), previously
    entirely missing (`notifications.ts` had no way to stop a still-QUEUED row
    at all). Four of the remaining event types are now honestly closed, not
    just unwired: acknowledgement invalidation and rule-pack impact are
    confirmed BLOCKED on Part 7/Part 6 respectively (grepped, no such concept
    exists anywhere in the codebase yet); material case status/readiness
    changes is confirmed narrow by architecture (`computeReadiness` has no
    stored previous value to diff against, so there is no second moment to
    hook beyond what `recordMissionDecision` already covers); invitations is a
    deliberate, reasoned deferral (the accept flow's bearer token exists in
    plaintext only as one function's return value today -- persisting it in
    `notifications.payload` needs a real send-then-redact design, not a rushed
    bolt-on). Full detail: `requirements-ledger.md` NTF-02.
60. ~~`applicants` had no timezone concept at all; `wallet.ts`'s
    `EXPIRING_SOON_DAYS` comment had explicitly named this as Part 5's
    eventual responsibility, and no local-date (as opposed to raw
    UTC-instant) threshold math existed anywhere for a task's own due date,
    leaving `dueDate`/`dueTimezone` (CAS-04) write-only -- nothing ever
    read them to decide when to remind anyone.~~ **RESOLVED (Part 5,
    NTF-04).** `applicants.timezone` (migration `0050`, default
    `Asia/Dhaka`, editable at the schema level though no UI yet lets an
    owner change it) plus `notification-sweep.ts`'s calendar-date math
    (`toLocalDateParts`/`localDateDiffInDays`) now correctly answers "is
    this task 7 days out, 1 day out, or how many weeks overdue" in the
    subject's own timezone, proven by a test that the same calendar day
    produces the same verdict across a UTC-instant boundary that falls
    mid-day locally. Full detail: `requirements-ledger.md` NTF-04.
61. Real transactional email (Resend, `docs/adr/0013-transactional-email-resend.md`) is
    implemented and unit-tested against the documented Svix/REST protocol --
    `ResendEmailPort`, `verifyResendWebhookSignature`, `/api/webhooks/resend`,
    `applyEmailDeliveryEvent` -- but no real Resend account, API key,
    verified sending domain, or webhook secret exists in this sandbox. Live
    A18 (an actual synthetic send plus a real signed webhook round-trip)
    cannot run without one -- BLOCKED, not fabricated as passing, exactly the
    outcome directive §5 itself anticipates for a credential-less sandbox.
    Provisioning a real account and a verified sending domain (for
    SPF/DKIM) is a genuine operational step requiring billing and DNS
    access this session does not have, not something further code changes
    here can close. Full detail: `requirements-ledger.md` A18.
independently confirmed findings; the missing PRD file is tracked as Blocker 1 in
`assumptions-and-blockers.md` (now resolved) rather than here, since it blocked the
programme rather than being a product defect.
