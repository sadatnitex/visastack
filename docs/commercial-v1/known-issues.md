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
6. ~~`MissionSnapshot` over-collection is confirmed this session by reading
   `packages/services/src/missions.ts`: `snapshotMission` calls
   `loadFactInstancesByKey(db, mission.applicantId)` and `loadDocumentInstancesByType(db,
   mission.applicantId)`, both scoped to the whole applicant, then includes every returned
   fact/document in the snapshot content unconditionally, not filtered to the mission's
   selected evidence.~~ **RESOLVED (Part 7 §1, TRU-01/A14).** `snapshotMission`'s `facts`/
   `documents` fields are now filtered to exactly the fact/document instances that appear
   somewhere in the snapshot's own `requirementMapping` -- reusing that already-correct,
   already-tested per-requirement candidate scoping (narrowed to an explicit selection once
   one exists) rather than a second, parallel scoping mechanism. A genuinely unclassified
   document (`docType` null -- AI classification never ran or stayed below threshold) can
   never appear in `requirementMapping` at all, so it is included whenever the pack needs at
   least one DOCUMENT-kind requirement (preserving finding #30's own "not silently dropped"
   guarantee) and correctly excluded when the pack needs no documents at all. A manual-mode/
   no-pack mission has no requirement-driven selection mechanism at all yet
   (`selectedEvidence.packRequirementId` is a NOT NULL FK, so there is no way to select
   evidence without a pack) -- there is no case-scoped subset to derive for it, so its
   snapshot is explicitly labelled `evidenceScope: 'all_applicant_evidence'` rather than
   silently indistinguishable from a correctly-scoped one; the snapshot viewer renders a
   visible notice whenever a snapshot carries that label, or carries no `evidenceScope` at
   all (any snapshot captured before this fix). Building real evidence selection for manual
   mode is a separate, still-open, smaller gap -- out of this fix's scope, not silently
   folded into "resolved." 2 new tests (`missions.test.ts`): the A14 minimisation proof
   itself (unrelated wallet facts/documents seeded, loaded, and confirmed excluded from a
   snapshot that DOES have a pack attached) and the manual-mode honest-labelling case. All
   56 `missions.test.ts` tests pass (54 pre-existing, unmodified, still green). Applicant
   acknowledgement is confirmed still missing: no acknowledgement entity, table, or service
   function was found in `packages/services/src/missions.ts`; the mission state machine's
   terminal pre-close states are `READY_TO_EXPORT` and `LOCKED`, with no acknowledgement step
   between review and lock. Tracked as its own item, TRU-02 (`requirements-ledger.md`).
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
62. COM-01 (plans/entitlements as data) is built and tested
    (`packages/services/src/plans.ts`, migration `0053`), but the three
    seeded catalog plans' entitlement numbers (seats/cases/storage/AI-
    allowance limits) are clearly-flagged PLACEHOLDERS, not a real
    product-owner pricing/capacity decision -- the PRD's own explicit
    instruction is that "numerical allowances/prices are product-owner
    configuration, not invented market truth," so none was invented here.
    `priceMinorUnits`/`currency` are left unset for all three seeded rows
    entirely, for the same reason. A platform owner can correct any of
    this later via `updatePlan`, with no code change or migration needed
    -- but until that happens, nothing in this system reflects a real
    commercial decision on what each tier actually costs or allows.
    Separately, and not this item's scope: ADM-01 (an admin UI for
    `createPlan`/`updatePlan`/`activateSubscription`/`endSubscription`,
    all real and tested but only reachable via a direct service call
    today, no UI yet) remains open. COM-02 (reconciling these entitlements
    with the existing flat, env-driven `quotas.ts` limits into real
    enforcement) has since closed its seats/case-creation/storage slice --
    see item 63 and `requirements-ledger.md` COM-02 for what it covers and
    what of its own scope remains open. Full
    detail: `requirements-ledger.md` COM-01.
63. COM-02 (quota enforcement) now genuinely gates four of the directive's
    dimensions -- seats, invitations, case creation, and storage -- each
    proven under real concurrency where the directive requires it
    (`packages/services/src/entitlement-enforcement.ts`), plus
    billing-suspension blocking (see item 64's update: closed), downgrade
    grace periods, and the platform-admin commercial override (see this
    item's own updates below: both closed). Honestly open, not built this
    pass: AI allowance enforcement (the directive's own §7 text defers it,
    "AI later" -- not a gap this chunk silently left; the only item
    remaining from COM-02's original scope). Full detail:
    `requirements-ledger.md` COM-02.
    **Update (2026-09-23):** the "downgrade grace periods" gap originally
    flagged here -- "effective dates; warning/grace; blocks NEW capacity
    use after grace; deletes nothing," with `subscriptions` supporting only
    an immediate cutover -- is now closed: a new `scheduledDowngrades`
    table (migration `0055`, modeled on `accountDeletionRequests`' own
    request/grace/sweep shape) plus `scheduleDowngrade`/
    `cancelScheduledDowngrade`/`executeScheduledDowngrade` (`plans.ts`) give
    a platform owner a real, warned, effective-dated downgrade path (default
    14-day grace), enacted by a new daily sweep
    (`triggerDowngradeSweep`, `/api/jobs/process-downgrades`) that performs
    the exact same atomic cutover `activateSubscription` itself uses once
    the effective date arrives -- costing `entitlement-enforcement.ts`
    nothing extra, since the existing four checks simply start comparing
    against the lower plan's numbers once the sweep flips it. Proven
    end-to-end, not just at the unit level: a test adds a second seat
    successfully during the grace window (still on the generous current
    plan), then shows a third seat refused via the real `addMembership`
    call site once the downgrade has executed and the org is over the new
    cap, while confirming both original members remain active ("deletes
    nothing"). `activateSubscription`/`endSubscription` auto-cancel any
    still-PENDING scheduled downgrade the instant they touch an
    organization's plan directly, so a stale schedule can never silently
    reapply itself over an admin's later, more immediate decision.
    **Update (2026-09-23, continued): the platform-admin "commercial
    override" bypass is now closed too.** "Platform admin; reason; expiry;
    audit; cannot bypass security/consent/release gates" -- new
    `commercialOverrides` table (migration `0056`) modeled directly on
    `support-access.ts`'s own scoped-grant shape (reason, expiry,
    revocable, audited, database-enforced maximum duration -- 30 days
    here, generous enough for a genuine billing dispute or migration,
    versus support access's 60 minutes for sensitive-data access), but
    deliberately NOT that file's two-person approver-distinct-from-actor
    control: a single platform owner (matching `activateSubscription`/
    `scheduleDowngrade`'s own single-actor pattern) is the right-sized
    control for bypassing a capacity number rather than consent-gated data
    access. New `packages/services/src/commercial-override.ts`:
    `grantCommercialOverride`/`revokeCommercialOverride`/
    `isCommercialOverrideActive`, the last wired into
    `entitlement-enforcement.ts`'s four gated functions as the very first
    check -- ahead of even billing suspension, so an active override
    bypasses both the suspension gate and every capacity number at once
    (the directive names no per-dimension scoping). "Cannot bypass
    security/consent/release gates" is structural, not a rule enforced in
    code: `isCommercialOverrideActive` is read by exactly these four
    commercial-capacity functions and nothing else, so there is no path by
    which it could ever reach security, consent, or release-gate logic. 7
    new tests (`commercial-override.test.ts`: grant/revoke authorization
    and validation, expiry, multiple independently-granted overrides
    coexisting since there is no uniqueness constraint) plus 6 more
    (`entitlement-enforcement.test.ts`'s new "commercial override bypasses
    every commercial check" describe block: one per gated function proving
    the bypass at the real cap, one proving it also lifts a SUSPENDED
    billing status, one proving revocation re-blocks immediately, one
    proving an expired-but-not-revoked override no longer bypasses). COM-02
    is now fully built against its original scope, with AI allowance
    enforcement the one item the directive itself deferred rather than
    left incomplete. Full detail: `requirements-ledger.md` COM-02.
64. COM-03 (manual billing) is built and tested
    (`packages/services/src/billing.ts`, migration `0054`): billing
    accounts with a real TRIAL/ACTIVE/GRACE/SUSPENDED/CLOSED state machine
    and append-only history, plus invoices tracking invoiced vs. collected
    amounts as two genuinely separate, DB-constrained columns. Deliberately
    mechanism only, same posture as COM-01/COM-02: no UI exists yet for a
    platform owner to actually open an account, issue an invoice, or
    record a payment (every function here is real, tested, and reachable
    only via a direct service call today) -- deferred to ADM-01, same as
    COM-01's plan-management actions and COM-02's own lack of an admin UI.
    **Update (2026-09-23):** the one gap this item originally flagged --
    a SUSPENDED billing account not actually blocking anything -- is now
    closed: `isBillingSuspended` is wired into all four of
    `entitlement-enforcement.ts`'s gated functions (seats, invitations,
    case creation, storage), each refusing outright once an organization
    reads SUSPENDED, independent of any entitlement number. Full detail:
    `requirements-ledger.md` COM-03.
65. COM-04 (agency branding) is built and tested
    (`packages/services/src/branding.ts`, migration `0057`): logo, agency
    name, and one accent color, real and owner/admin self-service --
    `isOrgAdmin`-gated (the same OWNER-or-ADMIN boundary
    `setRequireDifferentReviewer`/`addMembership` already use), not a
    platform-owner action, matching directive §11's "Agency owner should be
    able to... manage branding" rather than §10's admin-workspace list
    (which never mentions branding). "One ACCESSIBLE accent color" is
    genuinely WCAG-validated (real relative-luminance/contrast-ratio math,
    >=4.5:1 against white), not just a hex-format check. The logo composes
    the evidence pipeline's own lower-level primitives
    (`BlobStore`/`MalwareScannerPort`/`StoragePort`) directly rather than
    reusing `uploads.ts`/`documents.ts` themselves, since those are shaped
    around an applicant/quota/consent that an organization doesn't have;
    scanning runs synchronously in the request (a single small image, not
    evidence needing the async intake worker). "Agency A branding can never
    appear in Agency B context" is proven by a dedicated isolation test, not
    just asserted. Real owner-facing UI shipped: a Branding settings card
    in the org console (name, accent color, logo upload/replace/remove),
    reflected in a small branded header on the console and plan pages, and
    on the client-invitation accept-preview page (the PRD's own named
    "invitations" surface, PRD line 266) -- unlike COM-01/02/03's
    platform-admin actions, this one is NOT deferred to ADM-01, since it is
    an owner capability, not an admin one. Deliberately not built: any
    re-theming of the rest of the UI with the accent color beyond a small,
    tasteful application (the PRD scopes this to "logo; agency name; one
    accessible accent color," not a design system), and no admin-side
    logo-approval workflow (confirmed absent from both the directive's
    admin-workspace list and the PRD's own capability table -- "approved
    logo" reads as "passed the safety pipeline," not "admin sign-off").
    Full detail: `requirements-ledger.md` COM-04.
66. ADM-01 (admin workspace)'s prior ledger status ("TBD / not yet read this
    session") was itself stale: a full read of the existing 751-line
    `admin/page.tsx`/485-line `admin/actions.ts` this session found most of
    the admin workspace already real and working -- organisation
    verification, platform-role grant/revoke, pilot invitations, retention
    policies, legal holds, failed-job retry (both intake and erasure),
    orphan reconciliation, usage/spend cards, an audit-event view, and Pack
    Studio -- none of it built this session, all of it now correctly
    counted in the ledger for the first time instead of read as a gap. What
    was genuinely missing, and is what this session actually built: a
    per-organization commercial admin page
    (`/app/admin/organizations/[orgId]`) covering plan assignment, billing
    status/invoices, and commercial overrides -- the admin UI COM-01/02/03
    had each explicitly deferred. Building it surfaced a real, previously
    latent authorization gap: `getBillingAccountForOrganization`/
    `listBillingStatusHistory`/`listInvoicesForOrganization`
    (`billing.ts`) and `getUsageForOrganization` (`plans.ts`) gated reads on
    active organization membership only, with no platform-owner path --
    meaning a platform owner could already WRITE a billing/plan change for
    any organization via these same files, but could not READ what they
    were about to change for one they don't personally belong to (the
    normal case). Fixed by widening all four functions' authorization to
    active-member OR platform-owner, via new optional actor fields that
    default to the exact prior member-only behavior when omitted -- fully
    backward compatible with the one pre-existing member-facing call site.
    Genuinely still open, not built this session and not silently folded
    in: account-suspension UI (`suspendOrganization` exists, confirmed zero
    UI callers, and does not yet take a `stepUpSatisfied` parameter --  an
    open design question); notification-failure admin UI
    (`listNotificationsNeedingAttention`/`retryNotification` exist,
    confirmed zero UI callers); deletion-request admin visibility
    (`listDueDeletions` is wired into the automated cron sweep only, no
    admin-facing view of pending/due deletions); a support-grant admin UI
    (SEC-06's own row already names this gap -- `createSupportGrant`/
    `revokeSupportGrant` have zero UI callers, confirmed this session;
    deliberately not folded into this page, since a support grant needs a
    two-person approver-distinct-from-actor flow, a genuinely different
    actor model from this page's single-owner commercial actions); and the
    AI admin surface, correctly out of scope here since that is Part 8's
    multi-provider gateway, not a placeholder worth building ahead of the
    gateway it would control. Full detail: `requirements-ledger.md` ADM-01.
67. Part 6 (rules engine, RUL-01/02/03/05) Phase 1 closes the schema and
    engine foundations, real and tested, but deliberately does not yet
    change what any existing case sees. New `packages/services/src/
    rule-conditions.ts`: a typed, allowlisted rule-condition AST (existence,
    equality, membership, date/duration comparison, numeric bounds, Kleene
    and/or/not) with no `eval`/arbitrary-code path, a missing fact always
    evaluating to `unknown` rather than `false`. New nullable columns on
    `packRequirements` (`condition`, source URL/title/publisher/extract/
    interpretation/type, observed date, author, change reason) and
    `packVersions` (author, next-review date + documented-reason-if-later
    rule, effective date, withdrawn/superseded fields) -- every one
    additive, so every pre-existing pack (none of which has a `condition`)
    evaluates exactly as it always has. `WITHDRAWN` is now a real, reasoned,
    audited terminal state; the long-orphaned `DEPRECATED` enum value
    (declared with zero writer, confirmed by this session's own research)
    now means "superseded by a newer publish," set automatically. Author
    and reviewer distinctness is enforced for an `authoritative` pack only,
    never an agency's own custom checklist, matching the directive's own
    scoping. ~~**Not yet done, and explicitly not silently skipped:** the new
    AST is not wired into `computeReadiness`/`buildRequirementMapping` --
    that, plus RUL-04's richer per-requirement/overall result vocabulary it
    will feed, is the next PR in this Part, kept separate so "add the
    engine" and "change what readiness computes" stay independently
    reviewable.~~ **RESOLVED (Part 6 Phase 1b) -- see item 68.** Still open:
    RUL-05's review queue, version diff, and
    active-case impact list (admin UI, Phase 2); RUL-06 Public Trust Lite
    (untouched); and, as stated from the start of this Part, the two launch
    packs' actual rule content -- this sandbox has no live internet access
    (confirmed this session: the outbound egress proxy denies even the
    production URL, let alone an official government source), so real UK
    Standard Visitor / Schengen short-stay content stays honestly
    DRAFT/BLOCKED rather than fabricated. Full detail:
    `requirements-ledger.md` RUL-01/02/03/05.
68. Part 6 Phase 1b wires RUL-03's condition AST into
    `computeReadiness`/`buildRequirementMapping` (`missions.ts`) and
    implements RUL-04's full result-state vocabulary, closing item 67's one
    open thread. Every requirement now resolves to one of the directive's
    seven named states (SATISFIED/ATTENTION/CRITICAL_GAP/UNVERIFIED/
    CONFLICTING/EXPIRING_STALE/NOT_APPLICABLE) via a single cascade function
    (`resolveRequirementResultState`), and `Readiness` gained `overallState`
    (MANUAL_ONLY/NEEDS_ACTION/NEEDS_REVIEW/READY_FOR_APPLICANT_REVIEW) via
    `deriveOverallReadinessState`, matching "do not average scores; one
    blocking requirement remains visible." A conflicted or stale instance is
    now surfaced even when a sibling instance of the same repeating field
    would otherwise report the requirement satisfied -- the pre-existing
    boolean `satisfied` check only ever needed one eligible instance, which
    silently hid a conflict on a second one. Zero behavior change for any
    pre-existing pack: none has ever set a `condition`, so every requirement
    still resolves through exactly the same satisfied/reason logic as
    before, proven by a dedicated regression test. 7 new tests
    (`missions.test.ts`); all 52 tests in that file pass, unmodified ones
    included. **Not yet done, and explicitly not silently skipped:** the
    case-readiness UI itself (directive §10 -- surfacing state, source,
    freshness, and next action to an agency or traveller) is UI-layer work,
    out of this service-layer chunk. Full detail: `requirements-ledger.md`
    RUL-03/RUL-04.
69. Part 6 Phase 2a closes RUL-05's three remaining service-layer gaps named
    in item 67: `listPackVersionsDueForReview` (the scheduled review queue),
    `diffPackVersions` (a structural diff between two versions of the same
    pack, matched by kind + fieldKey/docType since a requirement is
    re-authored fresh in every new DRAFT version and never shares a row id
    across versions), and `listMissionsByPackVersion` (the active-case
    impact list, deliberately admin-scoped rather than owner-scoped, unlike
    every other function in `missions.ts`). 9 new tests across
    `packs.test.ts`/`missions.test.ts`. One genuine test-fixture bug found
    and fixed while writing the review-queue test: publishing three versions
    of the SAME pack in sequence silently auto-deprecated the first two, via
    RUL-05 Phase 1's own supersede-on-publish behavior working exactly as
    designed -- fixed by using three separate packs, the more realistic
    shape for a catalog-wide queue anyway. All 78 tests across both files
    pass. **Not yet done, and explicitly not silently skipped:** none of
    these three functions, nor RUL-05 Phase 1's `withdrawPackVersion`/
    `markRequirementSourceInaccessible`/`clearRequirementSourceInaccessible`,
    are wired into Pack Studio's actual UI yet (confirmed via this session's
    own research: no withdraw button, no review-queue view, no diff view, no
    impact-list view anywhere in `apps/web/src/app/app/admin/packs`) --
    Phase 2b. Full detail: `requirements-ledger.md` RUL-05.
70. Part 6 Phase 2b wires all of RUL-05 into Pack Studio's actual UI: a
    Review queue card on the catalog page; a WITHDRAWN status badge (never
    present before this, a real pre-existing gap closed incidentally); a
    reasoned Withdraw button on a PUBLISHED version (window-prompt pattern,
    matching ADM-01's `ReasonPromptButton` -- never a bare confirm); a
    mark/clear source-inaccessible button per requirement; an active-case
    impact count on PUBLISHED/WITHDRAWN versions; and a Compare-versions
    form leading to a new `[packId]/diff` route rendering the added/
    removed/changed/unchanged breakdown. `pnpm --filter web build`
    succeeds; no live database in this sandbox to click through the actual
    flow, honestly disclosed rather than claimed as tested. **One genuine
    gap found while building this, left open rather than papered over:**
    the directive's "explicit adoption/reviewer decision" (Part 6 §6) has
    no dedicated action for "reviewed this due item, still accurate, no
    content change" -- the only way to reset `nextReviewDate` today is
    `approvePackVersion`, which requires opening a whole new DRAFT version
    even when nothing actually changed. A real, small, separate follow-up.
    Full detail: `requirements-ledger.md` RUL-05.
71. Part 6 §10 wires RUL-04's richer result states into the actual live
    case-readiness UI (`/app/mission/[id]`), closing the gap RUL-04's own
    Phase 1b entry flagged as deliberately deferred. The Readiness card
    previously showed only a binary Complete/Incomplete badge and a
    "missing" list collapsed to three reasons; it now renders the exact
    seven-state model (SATISFIED/ATTENTION/CRITICAL_GAP/UNVERIFIED/
    CONFLICTING/EXPIRING_STALE/NOT_APPLICABLE) for every requirement,
    ordered so what still needs a decision surfaces first, plus the
    four-state overallState (previously computed and stored but never
    rendered anywhere). Each row shows its source (publisher/title/link,
    RUL-02) and observed date, a source-inaccessible flag when RUL-05 has
    marked one, and a next-action line -- a CONFLICTING field links to the
    profile page to resolve it, a CRITICAL_GAP/EXPIRING_STALE requirement
    links down to the evidence panel. The Requirement pack card now names
    the attached pack and badges it "Official requirement pack" vs. "Agency
    custom checklist" (`packs.authoritative`, directive §10's "distinguish
    official rule from agency custom request" -- previously not shown at
    all, not even the pack's name). The historical snapshot viewer
    (`/app/mission/[id]/snapshots/[id]`) gained the same per-requirement
    state badge for any snapshot captured since Phase 1b (every one of them
    already carries `resultState` in its stored JSON; the viewer had simply
    never read it), falling back to the old satisfied/not-satisfied badge
    for an older snapshot rather than breaking on it. Two new i18n keys
    (`mission.readiness.needsReview`/`.manualOnly`, EN+BN) extend the
    existing two-key precedent for the summary sentence rather than
    hardcoding English only. New `getPackVersion` service function (a
    trivial single-row getter, same pattern as `getPack`). **Not yet done,
    honestly still open:** UNVERIFIED's next-action text is generic
    ("depends on other case details not yet confirmed") rather than naming
    the specific field a condition actually reads -- nothing in the
    codebase currently walks a `RuleCondition` AST to extract its
    referenced field name(s) for display, only to evaluate them; a real,
    separate enhancement. No live database in this sandbox to click through
    the rendered page; `pnpm --filter web build` succeeds (both routes
    compile) and `pnpm --filter @visastack/services test` (`packs.test.ts` +
    `missions.test.ts`, 78/78) confirms zero regression to the underlying
    data this UI reads. Full detail: `requirements-ledger.md` RUL-04, J07.
72. Part 6 §9 (RUL-06 Public Trust Lite) Phase 1 closes the schema and
    service layer, UI deliberately deferred to Phase 2. New migration
    `0059`: eight nullable `packVersions` columns for a route description,
    an official fee (amount+currency paired by a CHECK constraint, plus a
    `officialFeeStaleAt` mark trackable on an already-PUBLISHED version
    without a new DRAFT, mirroring RUL-05's `sourceInaccessibleAt`), an
    official application channel, an official reporting link, and an
    explicit `publicTrustPublishedAt` opt-in gate kept separate from
    `publishedAt` -- a version can be usable by missions without ever being
    shown publicly. Six new `packs.ts` functions covering authoring
    (DRAFT-only, partial-update), publish/unpublish (PUBLISHED +
    authoritative-pack-only -- an agency's own unreviewed custom checklist
    can never be shown as public "trust" content), fee-staleness
    marking/clearing, and the public read itself: `getPublicTrustRoute`
    returns `null` (never a fabricated fallback) for anything not meant to
    be public, and deliberately does NOT carry a route's public exposure
    forward when a newer version supersedes an already-trusted one -- the
    new version needs its own explicit opt-in, so an unreviewed publish
    never silently goes live. "Official source" reuses the distinct set of
    publisher/title/URL already cited across the version's own
    RUL-02-sourced requirements, rather than a second field that could
    drift from them; "remove the fee amount when stale/unverified"
    (directive §9) is enforced by checking one staleness clock
    (`officialFeeStaleAt` OR the version's own overdue `nextReviewDate`),
    reused from RUL-05 rather than a second one that could disagree with
    it. 11 new tests (`packs.test.ts`, 35/35 green with the 24
    pre-existing); `packages/db/src/schema.test.ts` (20/20) and every
    affected package's typecheck also clean. One genuine test-fixture bug
    found and fixed while writing these: approving a version with zero
    requirements, which is `approvePackVersion`'s own pre-existing rule,
    not a RUL-06 defect. **Not yet done, honestly still open (Phase 2):**
    no admin UI at all to author, publish, or mark-stale this content --
    Pack Studio's pages are unchanged this chunk; no public `/trust/
    [packKey]` route yet; ScamShield Lite (the scam-warning checklist and
    official reporting links display) not yet built. Full detail:
    `requirements-ledger.md` RUL-06, J13.
73. Part 6 §9 (RUL-06 Public Trust Lite) Phase 2 closes the admin UI and the
    actual public surface, item 72's deferred half. `CreatePackForm` gained
    jurisdiction/route/purpose/authoritative fields -- a pre-existing gap
    (RUL-01's own row already flagged "no admin UI yet for entering the
    coverage fields") that now concretely blocked this chunk, since there
    was no way to create an authoritative pack through the UI at all and
    `publishToPublicTrust` refuses a non-authoritative one. A DRAFT version
    of an authoritative pack gets a form for the route description, fee,
    channel, and reporting URL; a PUBLISHED one shows its live status plus
    publish/unpublish and fee-staleness toggle buttons, mirroring RUL-05's
    `SourceInaccessibleButton` pattern exactly. Two new genuinely public,
    unauthenticated routes: `/trust` (a neutral catalog by route name,
    never agency name -- not the "agency ranking" the directive forbids)
    and `/trust/[packKey]` (route description; official fee shown only
    when currently verified, else an honest "not currently verified"
    badge, never a fabricated or stale number; effective/review dates; the
    official application channel as the primary call to action; the
    distinct official sources cited across the version's requirements;
    ScamShield Lite, a static platform-level warning-signs checklist with
    general fraud-reporting guidance, plus a route's own verified
    reporting URL when one is on file). An explicit notice disclaims
    embassy endorsement and agency preference; the official government fee
    is explicitly separated from an agency's own service fee, which is
    never itself shown as a number on this neutral page at all -- the
    safest way to honor "separate agency service fee" without drifting
    toward a ranking. New `lib/public-db.ts`'s `withPublicDb` extracts
    exactly the connection-lifecycle half of `withSession` (pool creation,
    idle-connection error listener, guaranteed cleanup) for a page that
    needs a database connection with no session at all -- every
    auth/pilot-access/provisioning concern deliberately stays in
    `withSession` itself, never duplicated. `middleware.ts` needed no
    change: its `matcher` is an allowlist of paths it even processes, so
    `/trust/*` already skips the auth gate by not being listed, the same
    as any other page that opts out. `pnpm --filter web build` succeeds
    (every new/changed route compiles); `pnpm run lint`/`pnpm --filter web
    typecheck` both clean; no live database in this sandbox to click
    through the actual rendered pages, honestly disclosed rather than
    claimed as tested. RUL-06 and Part 6 §9 are now closed. **Still
    genuinely open, not part of this chunk:** directive §11's A12/A13/A34
    acceptance-test IDs have not been written as their own dedicated,
    formally-mapped test suite -- the underlying functions are thoroughly
    unit-tested (item 72's 11 tests), but that is not the same claim as
    "A34 passes." Full detail: `requirements-ledger.md` RUL-06, J13.
74. (Part 7 §4) TRU-03 (case material revision) is built and tested, but has
    no consumer yet: nothing reads or checks `missions.materialRevision`
    today, since that is TRU-02's (acknowledgement, still NOT_STARTED) own
    job. This is by design, not an oversight -- a counter with nothing
    reading it cannot itself be "wrong," so shipping it ahead of its
    consumer is safe -- but it means TRU-03 alone changes no user-visible
    behavior yet. When TRU-02 is built, its own §4 requirement
    ("acknowledgement invalidation" in the SAME transaction as the material
    change) should hook `incrementMaterialRevision` itself
    (`material-revision.ts`) rather than re-deriving "does this mutation
    invalidate the current acknowledgement" separately at every call site
    that already calls it -- that function is already the one chokepoint
    every material mutation funnels through. Separately, honestly scoped
    out of this chunk after a real audit (not a guess): `erasure.ts`'s
    RETENTION_PURGE document-deletion path IS wired (a document erased while
    still selected as evidence on a live mission now bumps that mission's
    revision, proven by a dedicated `erasure.test.ts` test); the sibling
    ACCOUNT_DELETION path deliberately is NOT, confirmed correct by
    inspection rather than left as a gap -- `missions.applicantId` cascades
    on the applicant's deletion, so a mission whose revision would need
    bumping has already been deleted, along with its applicant, before that
    erasure worker step ever runs. Full detail: `requirements-ledger.md`
    TRU-03.
75. ~~(Part 7 §3) TRU-02 (acknowledgement) is backend-only so far: the
    `acknowledgements` table, `decideAcknowledgement`, and the
    invalidation wiring into `incrementMaterialRevision` are built and
    tested, but nothing in `apps/web` calls any of it yet.~~ **RESOLVED,
    partially (Part 7 §2/§3, Chunk B).** (a) The applicant review page did
    not need to be a NEW page: `mission/[id]/snapshots/[snapshotId]/page.tsx`
    (Part 7 §1's own work) already was the manifest/evidence bundle/selected
    facts/rule citations §2 describes -- this chunk added the decision layer
    (a new `AcknowledgementPanel`) directly onto it, with explicit copy
    stating acknowledging is not submission/official verification/approval.
    (b) The acknowledge/reject/request-correction buttons exist
    (`AcknowledgementPanel`, one shared form, three plain-HTML submit
    buttons), wired to a real `tryEstablishStepUp` call
    (`snapshots/[snapshotId]/actions.ts`) that mints a genuine WorkOS-backed
    assurance record or redirects to reauthentication -- never a
    client-asserted boolean. (d) `getLiveAcknowledgement` now backs a real
    status line in the org case workspace (`agency/[orgId]/page.tsx`,
    replacing CAS-02's own former "not yet tracked" placeholder), and
    `listAcknowledgementsForMission` backs the snapshot page's own
    acknowledgement history list. ~~Still genuinely open, not resolved by
    this chunk: part of (c) -- a case-workspace-WIDE "this case is dirty"
    banner (§5's own phrase) is NOT built; this chunk only labels an
    invalidated entry "Historical" within a single snapshot's own history
    list, which is a real but narrower reading of §5.~~ **Update (Part 7 §6,
    CAS-07).** The wider banner's own prerequisite has since landed:
    `SUBMISSION_READY` now exists and genuinely gates on a live
    acknowledgement (`transitionMission`), and the mission page shows a
    live-acknowledgement status line next to the state badge -- but a
    dedicated, case-workspace-wide "dirty" banner distinct from that status
    line was not itself built as part of CAS-07, so this specific gap
    remains open, now for its own sake rather than for a missing
    prerequisite. **RESOLVED (2026-09-27).** The main mission page now also
    fetches `listAcknowledgementsForMission`'s full history (not just the
    live one), so it can distinguish "never acknowledged" from "was
    acknowledged, then a material edit invalidated it, with no new live
    acknowledgement since" -- `getLiveAcknowledgement` alone renders
    identically for both, which is exactly why this stayed open through
    CAS-07. A `notice notice-warn` banner (matching the existing
    `manualMode` notice's own pattern) now renders whenever that dirty
    condition holds. Not verified in a live browser (sandbox limitation,
    same as every prior UI chunk this session). Full detail:
    `requirements-ledger.md` TRU-02, CAS-07.
76. ~~(Part 7 §7/§8/§9) TRU-04's non-submission-report scope is not started:
    outcome (§8 -- APPROVED/REFUSED/WITHDRAWN/CANCELLED/OTHER, with official
    wording and agency interpretation kept in separate fields, never
    blended) and complaint/feedback (§9 -- a case complaint workflow with
    owner/status/history/resolution, plus private post-case feedback
    restricted to authorized quality users, with no public review/ranking in
    V1) do not exist yet.~~ ~~**RESOLVED, partially (Part 7 §8, outcome).**
    `recordOutcome`/`listOutcomesForMission` (`packages/services/src/outcomes.ts`,
    migration `0064`) are real: every directive-named field, official
    wording and agency interpretation as structurally separate columns,
    optional evidence reusing the existing document vault rather than a new
    storage path, no computed approval probability anywhere. Deliberately
    does not touch `missions.state` -- an outcome is a fact about the world,
    not a workflow position, and a case remaining open after a refusal (an
    appeal) is a real scenario this chunk does not presume away. **Still
    genuinely open:** complaint/feedback (§9) do not exist yet.~~ **RESOLVED
    (Part 7 §9, complaint/feedback -- TRU-04 now backend-complete).**
    `packages/services/src/complaints.ts`/`feedback.ts` (migration `0065`)
    are real. Case complaint gets a genuine workflow (file/withdraw
    owner-side; assign/update-status/triage-list gated behind a new
    `QUALITY_ADMIN` platform role, since "authorized quality users" fit none
    of the four existing roles) and a dedicated append-only history table
    modeled on `billingStatusHistory`. Feedback is owner-submittable and
    readable only by the submitter or a `QUALITY_ADMIN` -- structurally no
    organization-facing read path exists anywhere, so the agency being
    reviewed can never see it. No rating/score field (the directive names
    only "feedback," and a score edges toward the same sentence's "no public
    review/ranking" warning). ~~The submission report (§7), outcome (§8), and
    complaint/feedback (§9) are all real (`requirements-ledger.md` TRU-04),
    but none has `apps/web` UI yet -- deferred intentionally to one combined
    UI chunk now that all three backends exist, the same backend-then-UI
    split TRU-02 already used.~~ **RESOLVED (2026-09-27, combined UI
    chunk).** The mission page now carries all three: a submission-report
    form (channel/description/reference/submitted-at), shown only once the
    case reaches `SUBMISSION_READY`; an outcome form (decision/date/official
    wording/agency interpretation, kept in separate fields as designed, plus
    an optional evidence-document picker sourced from the same candidates
    already computed for evidence selection); and a complaint panel
    (file/withdraw, full status history) plus a feedback panel, gated to
    once the case is `CLOSED`/`CANCELLED` per the directive's own
    "post-case" framing. A new `apps/web/src/app/app/admin/complaints`
    console (mirroring the `admin/organizations/[orgId]` dedicated-subpage
    pattern, not a card bolted onto the already-large main admin page)
    gives `QUALITY_ADMIN` staff the assign/status-transition/triage-list
    surface, linked from the main admin page only when the signed-in
    account actually holds `COMPLAINT_MANAGE` -- unauthorized staff never
    see the link at all. Confirmed by construction (`complaints.ts`'s own
    read functions) that no org-facing surface was added for any of the
    three: an agency can never see its own case's outcome, complaint, or
    feedback data, matching TRU-04's own confidentiality requirement. Also
    fixed a pre-existing, unrelated small gap found while touching the admin
    page: `PLATFORM_ROLE_LABELS` was missing a `QUALITY_ADMIN` entry, so a
    granted role would have rendered as the raw enum string. Repo-wide
    typecheck/lint and a production `apps/web` build all clean. Not verified
    in a live browser (sandbox limitation, same as every prior UI chunk this
    session).
77. (Part 7 §§11-14, PRV-02/03/04) Retention, erasure UX, legal-hold
    attributes, and export are each genuinely partial, per a dedicated
    audit (2026-09-26) that read the actual code rather than trusting a
    prior engagement's "genuinely complete" claim on
    `commercial-readiness.ts`'s `retentionDeletionWorkflow` gate -- that
    claim holds only for the narrow slice named below, not for the
    directive's actual §11-§14 scope.
    - **Retention (§11, PRV-02):** real and configurable for exactly one of
      the eight named classes (`retention_policies`, per-`docType`) plus a
      hardcoded (not admin-configurable) 24h abandoned-upload sweep. ~~Missing:
      invite-metadata 30d sweep (invitation rows accumulate indefinitely
      past their 7-day acceptance-window expiry)~~ **RESOLVED (Part 7 §11,
      Chunk 1).** `sweepAbandonedOrganizationInvitations`/
      `sweepAbandonedClientInvitations` now purge a PENDING invitation
      30+ days past its own `expiresAt`, or one REVOKED 30+ days ago (never
      an ACCEPTED one, a legitimate historical record); wired into a new
      daily cron, `/api/jobs/process-abandoned-invitations`. Still missing:
      OCR/export <=24h (investigated, Part 7 §11 Chunk 3 -- not a simple
      sweep: `extractionRuns.extractedText` is read on demand whenever a
      user triggers AI extraction, which can happen days after upload, so a
      naive 24h purge would silently and permanently break that action for
      anyone who doesn't act within the window; the directive's own "where
      possible" qualifier is read as license to hold this until a
      re-extraction fallback exists, not to build something that breaks a
      real feature), ~~AI-cache <=30d (`aiExtractionRuns`' cache-hit lookup
      has no age predicate at all)~~ **RESOLVED (Part 7 §11, Chunk 3).**
      `runExtraction`'s cache lookup now refuses to serve a match older than
      `cacheMaxAgeDays` (default 30, env `AI_CACHE_MAX_AGE_DAYS`) -- a
      behavior fix only, never a deletion: `aiExtractionRuns` rows are never
      purged, since `totalAiCostUnits` sums them all-time for the platform
      and per-document budget caps, and deleting old rows would silently
      undercount real spend. ~~app-log 30d~~ **N/A, not a gap:** application
      logs live in Vercel's own runtime log retention, not in any table this
      codebase owns or queries -- there is no code path here that could
      enforce or violate a 30d app-log retention, so this item is settled by
      construction, not by a sweep. ~~closed-case 12mo+30d-notice (no
      closure-triggered timer exists)~~ **PARTIALLY RESOLVED (Part 7 §11,
      Chunk 2, notice half only).** `missions.closedAt` now set once by
      `transitionMission` on first arrival at CLOSED or CANCELLED;
      `sweepCaseRetentionNotices` sends a real in-app+email notice once a
      case has been closed 12+ months (env-overridable), recorded on
      `missions.retentionNoticeSentAt`; wired into a new daily cron,
      `/api/jobs/process-case-retention-notices`. ~~Still missing: the actual
      PURGE 30 days after that notice~~ **RESOLVED (Part 7 §11, Chunk 4).**
      `sweepCaseRetentionPurge` deletes this mission's own workflow content
      (notes, tasks, snapshots not still referenced by a preserved
      submission, assignments, evidence requests/decisions, contributor
      requests, selected evidence, decisions, appointments, generated
      outputs, mission-scoped grants/notifications -- every one of these
      already had `onDelete: 'cascade'` in the schema) and then REDACTS
      (never deletes) the mission row itself: free-text/scheduling fields
      overwritten with a fixed placeholder/null, a new `missions.purgedAt`
      set. `mission_outcomes`, `mission_submissions`, `case_complaints`
      (+ `case_complaint_events`), and `case_feedback` are deliberately
      preserved as historical facts with their own oversight value (their
      own `mission_id` is NOT NULL, so a genuinely deleted mission row would
      have forced deleting them too, as an accident of the schema's cascade
      wiring rather than a real decision). Off by default --
      `CASE_RETENTION_PURGE_ENABLED` must be literally "true" to enable real
      deletion; also skips a case with an active legal hold on its applicant
      or an unresolved (OPEN/IN_PROGRESS) complaint, rechecked every run.
      Wired into a new daily cron, `/api/jobs/process-case-retention-purge`.
      ~~And the inactive-account half of "wallet original: until deletion/
      inactive-account policy" (no `lastActiveAt` tracking exists).~~
      **RESOLVED (2026-09-27, Part 7 §11).** New `accounts.lastActiveAt`
      (touched, throttled to roughly once per hour per account, by
      `touchAccountActivity` on every authenticated request in
      `withSession`) and `accounts.inactivityNoticeSentAt`. Mirrors the
      closed-case shape exactly (same 12-month notice / 30-day
      notice-to-action defaults, both env-overridable) since the directive
      names no specific inactivity threshold of its own.
      `sweepInactiveAccountNotices` sends a real notice once an account has
      been inactive 12+ months; `sweepInactiveAccountDeletionRequests`,
      30 days later if still genuinely inactive, opens a normal,
      cancellable deletion request through the EXISTING self-service
      machinery (`requestAccountDeletion`, extended with a new optional
      `method: 'SYSTEM'` parameter so the audit trail never misrepresents a
      policy-triggered request as the account holder's own action --
      defaults to `'API'`, every existing caller unaffected) rather than
      inventing a parallel deletion path. The request this creates is
      indistinguishable in the database from a self-requested one, so the
      privacy page's existing "pending deletion, cancel here" UI and the
      existing `process-deletions` execution cron both apply completely
      unchanged. `touchAccountActivity` clears `inactivityNoticeSentAt` the
      moment the account is active again -- even mid-throttle-window, so a
      user who signs back in during the 30-day window is taken out of the
      at-risk state on their very first request, and a later, separate
      inactivity period always gets its own fresh notice rather than
      immediately re-triggering the next stage from a stale flag. Off by
      default -- `INACTIVE_ACCOUNT_DELETION_ENABLED` must be literally
      "true" to enable real request-creation, matching
      `sweepCaseRetentionPurge`'s own safety gating. 11 new tests. Wired
      into two new daily crons, `/api/jobs/process-inactive-account-notices`
      and `/api/jobs/process-inactive-account-deletions`. Full
      `@visastack/services` suite, repo-wide typecheck/lint, and production
      build all clean. **Update (2026-09-27): "restricted security/audit
      metadata: 12m" re-classified N/A, not a gap.** This is the only one of
      the eight named retention classes the directive itself qualifies --
      "12m **subject to approved justification**" -- unlike every other
      class's flat duration. `audit_events`' own append-only DB rule
      (SEC-04), built deliberately for permanent tamper-evidence, is exactly
      that justification: a security audit trail that silently loses rows
      after 12 months cannot prove what happened in an incident investigated
      later, which is the whole reason this table is append-only in the
      first place. Retaining indefinitely is also the safer choice to build
      against without further sign-off -- reversible later if a specific
      compliance requirement ever calls for a real sweep, unlike a guessed
      deletion sweep against a security audit trail, which is not. No code
      change needed, settled by SEC-04's own existing, tested rule.
    - **Erasure workflow UX (§12, PRV-03):** the durable delete-then-verify
      outbox itself (steps 7-8 of the directive's 8-step flow) is genuinely
      solid, race-safe engineering (`docs/security/erasure-and-retention-boundary.md`).
      The requester-facing flow around it is not: `apps/web/src/app/app/privacy/page.tsx`
      offered a reason field and a confirm button, nothing else. ~~Missing:
      step 2 (no scope picker -- deletion is implicitly "everything"), step
      3 (no preview of what will be deleted)~~ **RESOLVED (Part 7 §12,
      Chunk 2):** since deletion is always whole-account, never partial,
      these two collapse into one accurate preview -- new
      `getDeletionImpactSummary` mirrors `executeAccountDeletion`'s real
      cascade (every owned applicant by name, mission count, document
      count, any platform-role grant to be revoked, any cross-case note to
      be anonymized) and the page renders it before the confirm button.
      ~~step 4 (the "an active legal
      hold blocks deletion" sentence is static copy, never queried against
      the actual requester's own holds -- no what/why/who-can-access/
      next-review detail)~~ **RESOLVED (Part 7 §12, Chunks 1-2):**
      `requestAccountDeletion` now genuinely refuses upfront when any of the
      account's applicants has an active hold (previously only checked 7
      days later, silently, at execution), and the page shows the real
      applicant name, reason, and placement date instead of a generic
      sentence, hiding the request form entirely rather than presenting a
      control that would only fail. Still missing: a next-review date, since
      the schema itself has none yet (see legal holds, below). ~~step 5
      (export exists as a wholly separate card,
      never offered as part of the deletion confirmation itself)~~
      **RESOLVED (Part 7 §12, Chunk 2):** the export link is now inlined
      directly above the confirmation form. ~~step 6
      (optional-processing consents are not revoked at request time, only
      incidentally when the account row is finally deleted after the grace
      window -- AI extraction/marketing can continue throughout)~~
      **RESOLVED (Part 7 §12, Chunk 1):** AI_EXTRACTION/SHARING/MARKETING/
      ISSUER_CONTACT are now revoked the moment deletion is requested, not
      just incidentally at execution; CORE_PROCESSING is deliberately left
      alone since the account still needs to function during the grace
      window.
      **Investigated (2026-09-27): "backup expiry target <=90 days" is a
      hosting-provider configuration, not an application code gap.**
      The directive's own wording ("backup expiry target: <=90 days unless
      approved narrower/other policy") describes the Neon Postgres project's
      own point-in-time-recovery/backup retention window, not a table this
      codebase writes to or a sweep it could run -- there is no code path
      here, and could be none, that reaches into the database provider's own
      backup subsystem to expire a backup (the exact same reasoning that
      settled "app-log 30d" as N/A, except the resolution here cannot be
      "already satisfied," since this session has no access to read or
      change the connected Neon project's actual configured retention
      window (no Neon API/dashboard tool is available in this sandbox,
      mirroring IAM-01's identical MFA-toggle blocker). Tracked as an
      operational pre-commercial-launch checklist item, not a code gap:
      **the product owner must confirm/set the Neon project's backup
      retention window to <=90 days (or record an approved narrower/other
      policy) directly in the Neon dashboard.**
    - **Legal holds (§13):** placement/release/enforcement are real and
      race-safe at every purge/deletion choke point, and agencies
      structurally cannot place or influence a hold (`COMPLIANCE_ADMIN`-only,
      a platform role no agency membership grants). ~~Missing entirely: a
      review/expiry field (the schema has no `reviewAt`/`expiresAt` at all,
      so directive §13's own "cannot become indefinite convenience" has no
      structural backstop)~~ **RESOLVED for new holds (Part 7 §13, chunk
      pending PR):** new nullable `legalHolds.reviewAt`; `placeLegalHold`
      now requires it and refuses a date not in the future. New
      `listLegalHoldsNeedingReview` surfaces any active hold whose review
      date has passed OR was never set (a pre-existing hold from before
      this column existed cannot be given a fabricated date by the
      migration, so it is treated as needing attention too, never silently
      excluded) -- not yet wired into a scheduled notification, only an
      on-demand query and the admin page's own badge (overdue in red, a
      real date otherwise). The admin form now requires a review date to
      place a hold at all. The traveller-facing hold explanation (privacy
      page) now shows the real next-review date too, alongside the
      applicant name and reason already added in PRV-03 chunk 2. Still
      missing: a structured authority/basis field (only a free-text
      `reason` -- the exact taxonomy of "authority/basis" categories is a
      legal/compliance policy decision, not invented here), scope
      granularity finer than the whole applicant, "who can access" in the
      traveller-facing explanation (what/why/next-review are now real;
      who-can-access would need a live grants query not yet built), and any
      scheduled reminder when a hold becomes due (today it is discoverable,
      not pushed).
      **RESOLVED (2026-09-27, Part 7 §13 -- who-can-access and scheduled
      reminder).** New `accessibleTo` field on `AccountLegalHold`, reusing
      `sharing.ts`'s own owner-facing `listAccessForApplicantDetailed`
      (never a second, independently-maintained "who has access" query),
      filtered to grants genuinely ACTIVE and unexpired right now -- a
      paused or revoked grant no longer means real access and is correctly
      excluded. The traveller-facing hold explanation (privacy page) now
      shows this alongside what/why/next-review, closing all four of
      directive §13's named explanation items. New `sweepLegalHoldReviewReminders`
      pushes a real in-app+email reminder to every current COMPLIANCE_ADMIN
      once a hold becomes overdue -- deliberately NOT a one-time notice like
      the retention/inactivity sweeps: a hold review left ignored is still
      the exact "indefinite convenience" §13 rules out, so this re-notifies
      every `LEGAL_HOLD_REMINDER_INTERVAL_DAYS` (default 7) for as long as
      the hold stays overdue, rather than firing once and going silent if
      that message is missed. Every current COMPLIANCE_ADMIN is notified,
      not just the original placer, since compliance is a shared platform
      responsibility. New `legalHolds.lastReviewReminderAt` column (additive
      migration). Wired into a new daily cron,
      `/api/jobs/process-legal-hold-reminders`. 5 new tests (`legal-hold.test.ts`,
      a new dedicated file for this module). Full `@visastack/services`
      suite, repo-wide typecheck/lint, and production build all clean.
      **RESOLVED (exact scope).** New optional, mutually-exclusive
      `legalHolds.missionId`/`documentId` (both null stays applicant-wide,
      the unchanged default). The actual data model was investigated before
      building anything: documents are applicant-scoped and reused across
      missions (the wallet model), while case-retention purge and document
      retention/erasure are already two independent subsystems -- so the two
      real narrower scopes are mission (new `missionBlockedByLegalHold`,
      blocks that mission's own case-purge) and document (new
      `documentBlockedByLegalHold`, blocks that document's own
      retention/erasure). A mission-scoped hold also reaches every document
      currently selected as that mission's evidence (reusing the existing
      `missionsSelectingDocument` helper) -- without that, a held case's own
      evidence could still silently expire via its own unrelated retention
      clock. A document-scoped hold does not reach back into any mission:
      case-purge never touches document bytes, so the document's own
      protection is already complete without also freezing the mission.
      Every call site (`case-retention.ts`, `retention.ts`, `erasure.ts`)
      updated; `deletion.ts`'s account-deletion pre-check is unchanged on
      purpose (any hold at any scope still blocks whole-account deletion).
      Admin form gained a scope selector; the traveller-facing explanation
      now states the real scope. 10 new tests. Still open, deliberately not
      attempted: a structured authority/basis taxonomy (a legal/compliance
      policy decision, not an engineering one).
    - **Export/portability (§14, PRV-04):** traveller self-export
      (`exportAccount`) and agency `bulkExport` are both real, authorized,
      and tested. Missing: original file bytes (only document *metadata*
      rows are exported, never the actual bytes via `storageObjectId`), ~~a
      manifest of what was included/excluded~~, ~~CSV (JSON only)~~, and the
      entire "large export" infrastructure the directive names (async
      durable job, encrypted transient storage, 24h artifact lifetime, ZIP
      path/traversal/duplicate/executable safety, access rechecked at
      download) -- both export paths are synchronous, unbounded,
      un-ZIPped in-memory responses today. **RESOLVED for the traveller
      export (Part 7 §14, Chunk 1):** new `AccountExportManifest` (real
      counts derived from the export's own already-assembled data, an
      `excludedByDesign` list, and a `knownGaps` list naming the original-
      bytes and CSV gaps honestly) plus a new `consentHistory` field (the
      full grant/revoke trail, not just current state -- closing the
      directive's separate "consent/share history" line). **RESOLVED for
      the traveller export (Part 7 §14, Chunk 2):** `?format=csv` on the
      same export route now returns a ZIP of one CSV table per entity kind,
      rendered from the exact same already-assembled export data (never a
      new query, so it cannot diverge from the JSON export or the
      manifest's counts), plus a copy of `manifest.json` inside the ZIP so
      a CSV-only download stays self-describing. Only original file bytes
      remain a gap for the traveller export now.
      **Progress (Part 7 §14, Chunk 1 of 3 -- large-export job
      infrastructure).** The directive's own "Large export" requirements
      (async durable job, encrypted transient storage, max 24h artifact,
      safe ZIP paths/names, no traversal/duplicates/executables, current
      access rechecked at download) needed new infrastructure this codebase
      had no equivalent of, so this is deliberately split into three chunks
      rather than one: Chunk 1 (this update) builds the complete async job
      lifecycle end to end -- proven at the service layer only, no HTTP
      route or UI yet, matching the established backend-then-UI split
      already used elsewhere in Part 7. New `accountExportJobs` table
      (PENDING/CLAIMED/READY/FAILED/EXPIRED) with the same lease/claim/CAS/
      backoff shape as `erasureJobs` (`enqueueAccountExportJob`,
      `claimAccountExportJobs`, `processAccountExportJob`,
      `runAccountExportWorker`, two new daily crons). A claimed job
      assembles the SAME JSON+CSV export content the existing routes
      already produce (no new query), ZIPs it via a new `ZipBundler` port
      (`JszipBundler` in `packages/adapters`, mirroring the existing
      `BlobStore`/`KeyManagementPort` hexagonal pattern), encrypts the
      bytes with new `protectBytes`/`revealBytes` (generalizing SEC-03's
      existing envelope-encryption primitive from strings to `Uint8Array`,
      same data-key cache, same AAD-binding discipline -- a ciphertext
      bound to one job's AAD fails closed if ever presented against another
      job), and stores the result in the existing `BlobStore` (bucket
      `CLEAN`) rather than a new storage mechanism. Fails closed, never
      silently unencrypted, when no key-management port is configured. A
      dedicated expiry sweep purges any artifact past its 24h (default,
      env-overridable) window, and separately any whose owning account was
      deleted mid-lifecycle -- `accountExportJobs.accountId` uses
      `ON DELETE SET NULL` specifically so a mid-export account deletion
      cannot orphan the encrypted blob outside the sweep's reach. The
      blob's own object key is scoped by the per-claim `leaseOwner` token
      (not just the job id), so a worker that loses its lease after writing
      the blob but before committing READY can never delete a concurrent
      winning attempt's own blob during its own cleanup. 14 new tests
      (`account-export.ts`/`.test.ts`, plus 4 new `protectBytes`/
      `revealBytes` tests in `protected-fields.test.ts`, including a
      deliberately-invalid-UTF-8 byte sequence proving the byte path never
      round-trips through string encoding). Full `@visastack/services`
      suite, repo-wide typecheck/lint, and production build all clean.
      Deliberately NOT yet done, tracked as Chunks 2-3: the actual original
      document bytes this feature exists for (Chunk 2 -- joining
      `storageObjects`, gating on `isDocumentVersionUsable`, safe
      deduplicated ZIP entry naming), and the HTTP download route plus
      privacy-page UI (Chunk 3 -- the access-recheck-at-download
      requirement is already built as `getAccountExportArtifact`, just not
      yet reachable over HTTP). `knownGaps` in the manifest is intentionally
      left unchanged by this chunk -- it still names "original document
      bytes" honestly, since this chunk's artifact does not yet contain
      them.
      **Progress (Part 7 §14, Chunk 2 of 3 -- real original document bytes).**
      `processAccountExportJob`'s bundling step now includes every
      currently-usable document version's real original bytes, gated by the
      exact same `isDocumentVersionUsable` predicate `accessDocument`'s own
      preview/download gate and `missions.ts`'s readiness computation
      already enforce -- never a separate, looser rule invented for export,
      so "no executables" holds by construction (a version that has not
      cleared malware scanning can never appear here, since
      `safetyStatus === 'CLEAN'` is one of that predicate's own conditions).
      Every version is bundled, not just the latest per document, keeping
      the ZIP's own file count consistent with the manifest's existing
      `documentVersions` count (full history, matching the JSON export).
      Names are built as `documents/<sanitized name> - v<versionNumber>.<ext>`;
      `sanitizeNameComponent` (already used by the automatic-naming feature,
      §11) strips path separators, `..`, and control characters before the
      version/extension are appended, so a hostile `originalName` can never
      escape the fixed `documents/` prefix ("safe paths; no traversal"),
      proven by a dedicated test using `../../etc/passwd.pdf` as the
      original name. A new `uniqueZipEntryName` guards the one remaining
      collision case sanitizing alone cannot: two distinct documents whose
      names happen to sanitize identically at the identical version number
      ("no duplicates"), proven by a dedicated test. A version excluded for
      not yet being usable, or because a sibling storage object already
      erasure-verified, is recorded honestly by reason in a new
      `documentBytes.excluded` list on the artifact's own manifest, rather
      than silently shipping a smaller ZIP with no explanation --
      `knownGaps` only drops "original document bytes" once the artifact
      genuinely contains at least one real file (`documentBytes.included > 0`),
      so an account with nothing yet usable still gets the honest gap
      statement rather than a false all-clear. The `fakeBundler` test double
      in `account-export.test.ts` was corrected at the same time: it
      previously round-tripped file bytes through a lossy UTF-8 text decode,
      harmless while only JSON/CSV text was ever bundled, but silently
      corrupting for real document bytes -- now base64-encoded, proven by a
      dedicated test using a deliberately-invalid-UTF-8 byte sequence. 4 new
      tests. Full `@visastack/services` suite, repo-wide typecheck/lint, and
      production build all clean.
      **Progress (Part 7 §14, Chunk 3 of 3 -- download route and UI,
      large-export feature now complete).** New
      `/app/privacy/large-export/[jobId]/download` route and a
      `LargeExportPanel` on the privacy page close the remaining gap: a
      "Request large export" button (`requestLargeExportAction`,
      `enqueueAccountExportJob`, step-up gated the same way the existing
      synchronous export already is -- a bulk export containing actual
      document images is at least as attractive a silent-exfiltration
      target as metadata alone) with the worker kicked immediately via
      `after()` for near-instant turnaround, matching every other
      opportunistically-triggered worker in this codebase; a status view
      (Preparing/Download/Failed/Expired) driven by the existing
      `listAccountExportJobsForAccount`; and the download route itself,
      built on the already-existing `getAccountExportArtifact` (built in
      Chunk 1) with no separate signed-token mechanism -- self-service
      download needs no signed reference the way third-party document
      access does, since the ambient WorkOS session already IS the one
      authorization this artifact was ever generated for, and
      `getAccountExportArtifact` re-verifies live ownership/status/expiry on
      every call, satisfying "current access rechecked at download" without
      re-requiring step-up a second time (design reasoning documented on the
      route itself). Every failure mode (wrong account, not ready, expired,
      no key management) collapses to a plain 404, never a distinguishing
      error. Verified via repo-wide typecheck/lint and a production build
      (no WorkOS staging credentials exist in this sandbox for a live
      click-through, the same limitation noted on every UI chunk since Part
      4). **The large-export feature (async job, encryption, expiry, real
      document bytes, safe ZIP naming, download route, UI) is now
      complete -- PRV-04/§14 has no further gaps.** Agency export
      (`bulkExport`) was not touched in either chunk and has no manifest or
      CSV rendering of its own yet. Agency export is also
      narrower than traveller export by design today (`bulkExport` returns
      facts only, never documents or snapshots -- `known-issues.md`'s own
      earlier note on this, cross-referenced here). ~~"Agency termination"
      rests on reversible `suspendOrganization`, not a true non-reversible
      `CLOSED` status (that enum value is defined but no code path ever
      sets it).~~ **RESOLVED (Part 7 §14, Chunk 3).** New `terminateOrganization`
      sets an ACTIVE or SUSPENDED org to `CLOSED`, permanently -- no
      reactivation path exists, unlike suspension. `orgGrantPermits` already
      denied any non-ACTIVE status "no standing at all," so the actual
      access-removal mechanism needed zero changes; a new test now proves
      this for CLOSED specifically (the codebase's SHR-02 test only ever
      exercised SUSPENDED before, despite its own title's claim). Traveller
      wallet data (applicants/facts/documents) is untouched by construction,
      also now asserted by a test. Also discovered `suspendOrganization` had
      no web-layer caller at all -- fixed by wiring both suspend and
      terminate into the admin UI (two new step-up-gated actions, two new
      `SECURITY_ADMIN`-gated platform permissions, two new confirm-gated
      buttons on `/app/admin`), rather than shipping a third unreachable
      function.
    - **Backup resurrection protection (§15):** ~~no design or code exists at
      all~~. **RESOLVED, design only.** New
      `docs/operations/backup-resurrection-reconciliation.md`: the threat
      (a genuine disaster restore promoted to production silently brings
      back anything deleted/revoked/deactivated after the restore point,
      since Neon's point-in-time restore is this codebase's entire backup
      mechanism and the restored branch reflects only that earlier moment),
      the governing principle (reconciliation only ever tightens -- deleted
      stays deleted, revoked stays revoked, a hold stays active even if the
      restore predates it -- never the reverse), an exact table of every
      audit event type that needs replaying (`ACCOUNT_DELETION_EXECUTED`,
      `ERASURE_VERIFIED`, `GRANT_REVOKED`, `CONSENT_REVOKED`,
      `MEMBERSHIP_DEACTIVATED`, `LEGAL_HOLD_PLACED`/`RELEASED`,
      `PLATFORM_ROLE_REVOKED`, `ORGANIZATION_SUSPENDED`/`TERMINATED`,
      `MISSION_RETENTION_PURGED`) against the action each one forces on the
      restored branch, and the honest limit of the design: it requires the
      pre-incident branch to still be reachable read-only, which is not
      true for a total-project-loss scenario. `docs/operations/recovery.md`
      cross-links it. **Reconciliation tool, partially built.** New
      `reconcileRestoredBranch(oldDb, newDb, restorePoint)`
      (`packages/services/src/backup-reconciliation.ts`) replays every
      reconciliation-relevant audit event on the old branch, in the exact
      global chronological order it actually happened (never per-type in
      isolation -- a hold placed then released, or an org suspended then
      terminated, must replay in that order to end up correct), as the
      equivalent forcing action on the new branch. Covers the 7 "simple"
      rules only -- a single column flip on an existing row, or inserting a
      full row that is missing entirely: `GRANT_REVOKED`, `CONSENT_REVOKED`
      (append-only -- inserts a new revoke record rather than mutating),
      `MEMBERSHIP_DEACTIVATED`, `LEGAL_HOLD_PLACED`/`RELEASED`,
      `PLATFORM_ROLE_REVOKED`, `ORGANIZATION_SUSPENDED`/`TERMINATED` (never
      downgrades an already-`CLOSED` org). Every forced change is itself
      audited on the new branch (`RECONCILIATION_<eventType>`, method
      `SYSTEM`), and a per-event failure (a hold whose applicant does not
      exist on the new branch either) is collected in the report rather
      than aborting the run. **Update: `ACCOUNT_DELETION_EXECUTED` replay
      also now covered**, the one rule that reuses a complex, multi-table
      cascading service function (`executeAccountDeletion`) directly rather
      than a column flip -- safe specifically because its one real
      precondition (a PENDING request whose grace window elapsed) naturally
      already holds during reconciliation: the request predates execution
      by the grace period (days), dwarfing this codebase's <=5 minute RPO,
      so the PENDING row is essentially always already mirrored onto the
      restored branch. Calling the real function with the original event's
      own timestamp as `now` reproduces the identical grace-window check
      that already passed once on the old branch; an already-deleted
      account is a clean no-op on a second run, proven by a dedicated
      idempotency test. **Update: a CLI wrapper now exists.** New
      `packages/adapters/src/reconcile-restored-branch.ts` (`pnpm --filter
      @visastack/adapters reconcile:restored-branch`), matching
      `backfill-protected-fields.ts`'s established operational-script shape
      exactly -- two required DB connection env vars
      (`RECONCILE_OLD_DATABASE_URL`/`RECONCILE_NEW_DATABASE_URL`, distinct
      from the shared `DATABASE_URL` candidates since both branches are
      required simultaneously), a required `--restore-point=` flag, all
      logic delegated to the tested `reconcileRestoredBranch` function,
      prints the report, exits nonzero on any collected error. This is now
      a runnable drill command, not just a library function. **Update:
      `MISSION_RETENTION_PURGED` replay also now covered.** New
      `purgeMissionUnconditionally` extracted out of
      `sweepCaseRetentionPurge` (`case-retention.ts`) -- the audit-append,
      per-table cascade delete, and mission-row redaction, with zero
      eligibility checks of its own. The sweep now calls it only after its
      own lock-and-recheck (grace days, complaint status, legal hold)
      passes; reconciliation's own `forceMissionRetentionPurged` calls the
      same function directly with no gating at all, since -- unlike the
      sweep, which must decide eligibility fresh on every run -- forcing a
      replay only needs to reproduce a decision already proven correct: the
      old branch's own `MISSION_RETENTION_PURGED` audit event is that
      proof. This is why mission-purge replay could not reuse the sweep
      itself the way account-deletion replay reuses
      `requestAccountDeletion` -- the sweep's eligibility recheck is
      against CURRENT hold/complaint state, the wrong precondition for
      reconciliation. A purged mission that never existed on the restored
      branch at all is a clean no-op, never an error, proven by a
      dedicated test alongside the main replay-and-idempotency test (12
      tests total now). **RESOLVED (2026-09-27), `ERASURE_VERIFIED`
      replay.** A follow-up investigation corrected the earlier scoping
      note above: case-retention (mission) purge does NOT touch erasure at
      all -- it redacts the mission row in place and never calls
      `enqueueErasureJob`, confirmed by reading `case-retention.ts` in
      full (no import of, or call into, `erasure.ts` anywhere in it). There
      are exactly two real enqueue sources, not three: account deletion (a
      single, ungated storage-object delete) and `retention.ts`'s
      `purgeExpiredDocuments` (gated behind every sibling storage object a
      document ever referenced also reaching VERIFIED, per
      `finalizeVerifiedJob`'s own completion check). Rather than
      reconstructing that job-by-job gating state machine on the restored
      branch, `forceErasureVerified` asks the one branch that actually
      knows the ground truth -- the old branch, right now -- whether the
      document is already gone there: gone means the full cascade
      genuinely completed on the old branch at some point, so the
      identical end state (including bumping material revision for any
      mission on the restored branch still selecting that document as
      evidence, exactly like `finalizeVerifiedJob` itself does before
      tearing the document down) is forced onto the restored branch; still
      there means this individual sibling's own bytes are gone but the
      document was never fully erasure-verified even by the old branch's
      own final state, so the restored branch is correctly left untouched
      too. The underlying bytes are already gone for real on both branches
      simultaneously by the time any of this runs -- Vercel Blob's
      `del()` is external, never branched alongside Postgres -- so no
      `erasureJobs` bookkeeping row is recreated on the restored branch at
      all; that table is pure operational queue state, not the
      privacy-relevant fact itself. The one place a document id needed
      recovering from (the audit event carries no such column) is
      `erasureJobs` on the OLD branch -- uniquely among the tables this
      reads, that one is designed to outlive the very domain rows it
      started from. 3 new tests: the simple account-deletion-reason branch
      plus its own idempotent second run; the full document+sibling
      cascade forced correctly, including the material-revision bump,
      plus its own idempotent second run; and the critical safety property
      that a document is left completely untouched when the old branch
      itself never finished verifying every sibling. **All 10 reconciled
      event types are now covered; backup resurrection reconciliation
      (§15) is complete.** Full `@visastack/services` suite, repo-wide
      typecheck/lint clean.

    Full detail: `docs/commercial-v1/privacy-data-map.md` §4 (summary,
    cross-referencing here rather than duplicating) and
    `requirements-ledger.md` PRV-01/02/03/04.
78. (Part 7 §§4-5, TRU-03) Found via a deliberate audit of what remains open in
    Part 7 after item 77 closed (not a guess): item 74 above closed the
    "acknowledgement invalidation" half of §4/§5 (any explicit material
    mutation -- reselect, edit, new document version, erasure -- correctly
    bumps `materialRevision` and invalidates the live acknowledgement, in the
    same transaction). But a document's own `expiresAt` simply passing was
    never such a trigger anywhere: it is not on §4's own "Material includes"
    list (only "selected document version/removal" is), yet §5 states its own,
    separate rule -- "If selected passport/evidence expires... mark case dirty
    and invalidate submission-ready use" -- and §4 additionally lists "expiry"
    as one of six things "final packet issuance must recheck," independent of
    acknowledgement validity. Confirmed by reading every consumer directly:
    `computeReadiness`'s own document-eligibility check already excludes an
    expired document from satisfying a requirement going forward (correct, but
    purely advisory -- a query-time answer nothing forces anyone to ask), and
    `recordSubmission` (the one and only path to SUBMITTED) rechecked
    acknowledgement liveness but nothing about expiry at all. Net effect: a
    case fully acknowledged before its selected evidence expired could still
    be reported SUBMITTED afterward, with nothing in the system ever flagging
    it. **RESOLVED.** Two fixes, matching the directive's two separate
    bullets: (1) `recordSubmission` now directly, synchronously rechecks every
    selected document's `expiresAt` against the current instant before
    allowing SUBMITTED -- the real, always-current gate, not dependent on any
    sweep's cadence. (2) `sweepExpiryReminders` (`notification-sweep.ts`) now
    also invalidates the live acknowledgement (via the existing
    `incrementMaterialRevision`) of every mission currently selecting a
    document that has genuinely expired, reusing `missionsSelectingDocument`
    -- the proactive "mark case dirty" §5 asks for, so a case shows as needing
    attention even before anyone attempts to submit. Self-limiting by
    construction, no new tracking column: once invalidated,
    `getLiveAcknowledgement` returns nothing for that mission on every later
    sweep, so repeated runs are free no-ops until someone re-acknowledges over
    still-expired evidence, which the next run then correctly invalidates
    again -- continuous enforcement for as long as the underlying defect
    persists. 4 new tests (`submissions.test.ts`, `notification-sweep.test.ts`).
    **Also investigated and confirmed already satisfied by construction, not
    gaps:** §4's "scan state" recheck (`isDocumentVersionUsable`'s
    `safetyStatus !== CLEAN` gate applies at every eligibility computation a
    selection could ever pass through; nothing in this codebase retroactively
    downgrades an already-CLEAN version's safety status after the fact, so
    nothing already selected could ever become unsafe later) and
    "authorization" (`getMissionForOwner`'s strict, grant-blind, owner-only
    check plus the step-up requirement, already `recordSubmission`'s own
    gate). **Still open, lower confidence, deliberately not guessed at:**
    §4's "grant" recheck -- no concrete mechanism in this codebase currently
    conditions a submitted packet's disclosed content on a contributor grant
    remaining valid at issuance time, and inventing a check against an
    unconfirmed interpretation risks solving the wrong problem; flagging for a
    dedicated look rather than silently dropping it. Full
    `@visastack/services` suite, repo-wide typecheck/lint, and production
    build all clean.
79. (Part 8, AI-03/AI-08/AI-09) Starting Part 8 (multi-provider AI gateway,
    admin control, OCR, budgets, privacy, evaluation, rollback). Per the
    directive's own §1 ("inspect the existing... EXTEND the canonical port;
    do not create a separate parallel AI system"), investigated the existing
    AI architecture in full before writing anything: exactly one
    `AiExtractionPort`/one adapter (`OpenAiExtractionAdapter`)/one run ledger
    (`ai_extraction_runs`)/one proposal-approval path (`approveProposal`,
    already atomic: fact version + evidence link + audit event together) --
    a genuinely mature pilot to extend, not a greenfield build. AI
    configuration today is 100% env-var (no admin UI, no DB-backed config at
    all); AI calls are fully synchronous (no job queue); the budget-check
    advisory locks are held across the outbound provider HTTP call itself,
    serializing every AI call platform-wide to concurrency 1 rather than the
    directive's own named default of 5; no SSRF-hardening utility exists
    anywhere in this codebase (immaterial today only because the one
    existing adapter's endpoint is a hardcoded literal, never
    admin-configurable).
    **Chunk 1 (this update) -- gateway contract hardening.** `AiUsage`
    widened with `provider`, `providerRequestId`, `inputUnits`/`outputUnits`/
    `cachedUnits` (alongside the existing blended `costUnits`, unchanged for
    budget enforcement), and `latencyMs`. `AiExtractionErrorCode` widened
    from three codes to seven (`timeout`/`auth_failed`/`refused`/`truncated`
    added), each its own explicit outcome rather than folded into generic
    `upstream_error` -- directly matching directive §4's named failure-mode
    list. `OpenAiExtractionAdapter` gained a request timeout (wrapping the
    existing shared `withTimeout` helper at the directive's own 60s
    default -- previously a hung call blocked indefinitely, holding a
    database transaction and two advisory locks open the entire time),
    401/403 classified `auth_failed`, the Responses API's own structured-
    output `refusal` field and `status: 'incomplete'` (truncation) both now
    explicitly detected rather than silently mis-parsed as ordinary
    proposals. New `ai_extraction_runs` columns (`provider`,
    `providerRequestId`, `inputUnits`, `outputUnits`, `cachedUnits`,
    `latencyMs`; additive migration) capture this richer telemetry, all
    nullable since a cache-hit row makes no new provider call and historical
    rows predate these columns. Verified the exact current OpenAI Responses
    API response shape (usage breakdown fields, `id`, `status`/
    `incomplete_details`, content-part `refusal`) against live provider
    documentation before relying on it, per directive §3's own "use latest
    official documentation" instruction. 8 new tests
    (`openai-extraction.test.ts`). Full `@visastack/services`/
    `@visastack/adapters` suites, repo-wide typecheck/lint, and production
    build all clean.
    **Deliberately not in this chunk, each its own future chunk:** Gemini
    and Anthropic adapters (AI-03); admin-configurable, versioned,
    DRAFT/ACTIVE/rollback AI settings with KMS-backed secret storage
    (AI-02/AI-07 -- the only close precedent, `retention_policies`, is a
    flat current-value table with no version history, genuinely new
    schema/service design, not an extension); the SSRF-hardening module
    (AI-07 §7) -- deliberately deferred rather than speculatively built,
    since it is only needed once a custom (non-built-in) endpoint field
    actually exists in the admin UI, which Chunk 1-4 do not add; the two new
    P0 AI tasks that do not already have a deterministic solution
    ("possible inconsistency flag," "explanation of an already-determined
    deterministic readiness gap" -- doc-type suggestion and filename
    suggestion are already deterministic and working, per directive §2's own
    "support only" framing this is read as a scope boundary on what AI may
    ever do, not a mandate to add a redundant AI path where a deterministic
    one already works); cache-key binding to a
    config version once AI-02 exists (§12); cross-provider fallback (§13,
    not meaningful until a second provider exists); generalizing the
    existing eval harness (`packages/adapters/src/eval/`, already covering
    all 13 directive-named document categories, but hardcoded to the OpenAI
    adapter) to run against any `AiExtractionPort` (AI-10). Real live
    evaluation runs against paid provider accounts remain BLOCKED regardless
    of adapter completeness, same shape as every other "needs real external
    credentials this sandbox cannot supply" item this session (IAM-01 MFA;
    Neon backup retention) -- directive §14's own wording anticipates this
    exactly ("adapter may be code-complete; but A19 remains BLOCKED for that
    provider").
    Full detail: `requirements-ledger.md` AI-03/AI-08/AI-09,
    `docs/audits/ai-gateway-boundary-map.md`.
    **Chunk 2 (this update) -- concurrency and budget-race safety (§11).**
    Closed the concurrency-1 serialization bug flagged above: `runExtraction`
    no longer holds either advisory lock across the outbound provider call.
    It now splits into three phases -- RESERVE (a short, locked transaction
    running every existing check, plus a new concurrency check, then
    inserting an `IN_FLIGHT` marker row instead of calling the adapter),
    CALL (the adapter call itself, with no transaction and no lock held),
    and RECONCILE (a second, unlocked transaction updating that same row to
    SUCCEEDED/FAILED with the real outcome). Genuinely concurrent AI calls
    are possible for the first time, capped at a new platform-wide
    `AI_MAX_CONCURRENT_CALLS` (default 5, directive §11's own named figure;
    threaded through `apps/web/src/lib/ai.ts`'s `aiMaxConcurrentCalls()` to
    the extraction server action). Directive §11 also requires "concurrent
    calls may not race available budget" as part of the SAME mechanism, not
    a separate one -- re-read after an initial, too-narrow plan would have
    shipped concurrency without this, which would have been a real
    directive violation, not a simplification. Closed it without inventing
    a per-model pricing/token-estimation formula (real pricing data for
    that does not exist in this codebase yet, and every existing budget test
    is calibrated to the stub adapter's fixed `costUnits: 3`, which any
    genuine worst-case token estimate would dwarf, breaking them for no
    real gain): every budget check now also reserves `maxObservedCostUnits`
    -- the highest `costUnits` any SUCCEEDED run has ever actually recorded,
    platform-wide -- for every call currently `IN_FLIGHT`, including the one
    about to be reserved. This is real evidence, never a guess: it starts at
    0 before any call has ever completed and only ratchets up from genuine
    recorded spend, deliberately coarser than a true per-call estimate but
    sufficient to close the actual race (N concurrent calls can no longer
    all pass the same check believing they are the only spender). A new
    `releaseStaleInFlightCalls` self-heals a reservation whose own call
    crashed or lost its connection mid-flight (5-minute grace period,
    comfortably longer than the adapter's own 60s request timeout), so an
    abandoned reservation cannot occupy a concurrency slot or inflate the
    budget reservation forever. New `ai_extraction_runs` status value
    `IN_FLIGHT` (additive `ALTER TYPE ... ADD VALUE`, migration `0074`).
    **Still genuinely open, not this chunk's scope:** the directive's
    literal "reserve conservative worst-case cost" via real per-model
    pricing/token-count data (today's historical-evidence reservation is a
    deliberately coarser stand-in, chosen specifically to avoid inventing an
    uncalibrated formula); "uncertain timeout outcome: keep reservation
    until reconciled" -- today, exactly as before this chunk, a timed-out
    call is costed at 0 the instant it resolves, since there is no mechanism
    yet to later confirm whether the provider actually processed and will
    bill for it (this would need a way to query the provider's own status
    for a given `providerRequestId` after the fact, which does not exist).
    Neither gap is new; both pre-date this chunk and are simply now
    precisely named rather than left implicit. 4 new tests (`ai.test.ts`'s
    "concurrency gate and budget-race safety" suite, simulating a genuinely
    in-flight call via a direct row insert -- PGlite fully serializes
    `db.transaction()` calls, so, like every other lock-dependent fix in
    this codebase, a real `Promise.all` race cannot be exercised here; see
    `docs/security/durable-jobs-and-upload-integrity-boundary.md`'s
    "PGlite testability" section). Full `@visastack/services` suite,
    repo-wide typecheck/lint, and production build all clean.
    Full detail: `requirements-ledger.md` AI-08/A24,
    `docs/audits/ai-gateway-boundary-map.md`,
    `docs/security/durable-jobs-and-upload-integrity-boundary.md`.
    **Chunk 3 (this update) -- evidence grounding (AI-04).** The system
    prompt already instructed the model to ground every value in "an exact,
    verbatim substring copied from the document text," but nothing checked
    that server-side -- a hallucinated or paraphrased citation would persist
    identically to a genuine one, with no signal distinguishing them for the
    human reviewer who is supposed to be able to trust the quote. Closed:
    `runExtraction` now searches for each proposal's `evidenceSnippet` as an
    exact substring of the deterministic text actually sent to the model,
    recording `charStart`/`charEnd` and a new `evidence_locations.verified`
    boolean on a match, `verified: false` (no position) otherwise. Never a
    reason to drop the proposal itself -- an unverified citation is still
    persisted and reviewable, just flagged, matching this codebase's
    established "proposals are advisory, never silently resolved" pattern
    (the same reasoning `approveProposal`'s CONFLICTED status already
    applies to a disagreeing trusted value). Deliberately exact-match only,
    no whitespace-normalized or fuzzy fallback: a false negative (a genuine
    quote reformatted by OCR/whitespace differences) costs only a moment of
    extra human scrutiny, while a false positive from a looser match would
    wrongly badge a fabricated citation as confirmed -- the wrong failure
    direction for a trust signal, and not worth inventing a normalization
    scheme to avoid. Cache hits copy the original run's `verified`/position
    forward unchanged, correct by construction since the cache key is bound
    to the same content hash. New `apps/web` surfacing: the proposal review
    card now shows an "Unverified quote" badge when the top evidence snippet
    failed verification, so the signal actually reaches the person deciding
    whether to approve. New `evidence_locations.verified` column (additive
    migration `0075`). 3 new tests (`ai.test.ts`'s "evidence grounding"
    suite). Full `@visastack/services` suite, repo-wide typecheck/lint, and
    production build all clean. Not verified in a live browser (sandbox
    limitation, same as every prior UI chunk this session).
    Full detail: `requirements-ledger.md` AI-04.
    **Chunk 4 (this update) -- admin-configurable AI provider settings
    (AI-02/AI-06/AI-07).** Before this chunk, AI configuration was 100%
    static env vars (`AI_ENABLED`, `OPENAI_API_KEY`, etc.) with no
    admin-managed, versioned, auditable configuration at all -- the
    directive's own §5 names a specific journey (choose provider, enter a
    write-only key, choose/type a model, set limits, set a reviewed data
    policy, save DRAFT, activate, rollback, emergency-disable) that simply
    didn't exist. New `packages/services/src/ai-provider-config.ts` and
    `ai_provider_configs` table (migration `0076`, additive): every row is a
    full, immutable configuration snapshot -- "activating" never edits a row
    in place, it flips which row currently holds ACTIVE (moving whatever
    held it before to SUPERSEDED), so the complete history of what the
    platform actually ran under is always reconstructable, the same
    append-history discipline `fact_versions`/`billing_status_history`
    already use. At most one row is ever ACTIVE at a time, enforced under a
    fixed advisory lock (the same `ai.ts`/`uploads.ts` pattern already
    proven for an identical platform-wide single-winner guarantee), proven
    by a dedicated test showing two sequential activations never leave two
    ACTIVE rows.
    Built: `createDraftAiProviderConfig` (save DRAFT; the API key is
    envelope-encrypted with the EXISTING `protectValue`/`revealValue`
    AES-256-GCM primitive from `protected-fields.ts` -- the same mechanism
    already protecting SENSITIVE/RESTRICTED profile fields, never a second
    encryption scheme invented for this table -- plus a masked fingerprint,
    e.g. `...9999`, for admin display); `activateAiProviderConfig` (atomic
    switch; refuses a config whose data policy isn't approved or whose key
    has already been revoked); `rollbackAiProviderConfig` (directive's own
    "last eligible known-good only" -- takes no target id, walks history
    newest-first among prior versions and skips any whose key has since been
    revoked or whose data policy is no longer approved, i.e. "cannot
    resurrect: revoked key; unapproved data policy," proven by two dedicated
    tests that each plant an ineligible version in the way and confirm it is
    correctly skipped); `emergencyDisableAiProviderConfig` (takes the
    current ACTIVE out of service; nothing is auto-promoted, so the platform
    runs no AI at all until an admin explicitly acts again);
    `revokeAiProviderConfigKey` (one-way; also disables the config in the
    same transaction if it happens to be the currently-ACTIVE one, so a
    revoked key can never remain the platform's live credential even for a
    moment); `getActiveAiProviderConfig`/`revealAiProviderApiKey` (the
    read-side the gateway itself will consult); `listAiProviderConfigHistory`.
    Authorization: a new `AI_SETTINGS_MANAGE` platform action, extending
    `SECURITY_ADMIN` rather than inventing a sixth platform role --
    credential/provider security is the same family as `SECURITY_ADMIN`'s
    existing organization-review actions, not a new, non-overlapping concern
    the way `QUALITY_ADMIN` was for complaints/feedback -- plus step-up,
    mirroring `platform-roles.ts`'s own established
    `canPerformPlatformAction` + `stepUpSatisfied` gate shape exactly, the
    same "more defensive, checked inside the service" choice `complaints.ts`
    already made for an identical no-web-UI-yet situation. 19 new tests
    (`ai-provider-config.test.ts`), plus one added assertion to
    `platform-roles.test.ts`'s own SECURITY_ADMIN concern-matrix test
    proving the new action is included. Full `@visastack/services` suite,
    repo-wide typecheck/lint clean.
    **Deliberately not in this chunk, so it changes zero runtime behavior:**
    nothing yet calls any of this from `createAiExtractor`/`runExtraction`
    -- the live extraction path (still 100% env-var-driven) is completely
    unchanged, so shipping this chunk carries no risk to it; the admin UI
    (`apps/web` was not touched at all this chunk); the synthetic connection
    test and task-evaluation runner §5 also names; "select tasks" (only one
    AI task, field extraction, exists today, so there is nothing yet to
    select between); the SSRF-hardening module (AI-07 §7, still correctly
    deferred -- no custom-endpoint field exists in this schema either, only
    a `provider`/`model` pair naming one of the built-in, host-locked
    adapters). Each is its own future chunk, most obviously the next one
    (wiring the kill-switch recheck and live config into the extraction
    path itself, per Part 8 §5's "kill switch: rechecked immediately before
    outbound call").
    Full detail: `requirements-ledger.md` AI-02/AI-07/A22.
    **Chunk 5 (this update) -- the kill switch is now genuinely live
    (AI-02).** Chunk 4 built the full DRAFT/ACTIVE/SUPERSEDED/DISABLED
    lifecycle, but nothing yet consulted it at runtime -- activating,
    disabling, or rolling back a configuration had zero effect on whether
    AI extraction actually ran, since `createAiExtractor`/`runExtraction`
    were still 100% env-var driven. Closed the "is dispatch allowed at all"
    half of that gap: `runExtraction` gained an optional `killSwitchCheck`
    callback, deliberately re-consulted at the START of phase 2 (immediately
    before the outbound call), not folded into phase 1's earlier checks --
    directive §5's own wording is explicit that the switch must be
    "rechecked immediately before outbound call, including queued jobs,"
    and checking only once, back at reservation time, would miss exactly
    that case. A refusal synthesizes a `disabled` outcome (a new
    `AiExtractionErrorCode` value) rather than ever invoking the real
    adapter, then flows through the exact same FAILED-recording path an
    ordinary adapter failure already uses.
    New `isAiDispatchAllowed(db)` (`ai-provider-config.ts`) is the switch
    itself: permissive on a fresh install where `ai_provider_configs` is
    still empty (today's env-only behavior, completely unaffected), but the
    instant a first row exists at all -- DRAFT or otherwise -- the table
    becomes authoritative: dispatch is allowed only while a row is genuinely
    ACTIVE. Without this distinction, `emergencyDisableAiProviderConfig`
    would look meaningful while silently doing nothing once no ACTIVE row
    existed. Wired into the one real call site,
    `runAiExtractionAction` (`apps/web/src/app/app/applicant/[id]/actions.ts`),
    as `killSwitchCheck: () => isAiDispatchAllowed(db)`.
    A genuine design gap surfaced and fixed while writing this chunk's own
    tests, not a pre-planned change: `rollbackAiProviderConfig` (built last
    chunk) required a currently-ACTIVE row to roll back FROM, which meant it
    could never recover from an emergency-disable at all -- nothing is
    ACTIVE immediately after one, so rollback would always refuse right when
    it is arguably needed most. Fixed by also treating DISABLED rows as
    eligible rollback candidates (under the identical revoked-key/
    unapproved-policy exclusions already in place) and letting the function
    proceed with no currently-ACTIVE row at all. This is exactly the kind of
    thing a thorough test pass is supposed to catch before it reaches
    production, not after.
    9 new tests (`ai.test.ts`'s "kill switch" suite: proceeds when allowed,
    refuses without ever reaching the adapter when disabled, defaults to
    allowed when unset; `ai-provider-config.test.ts`'s `isAiDispatchAllowed`
    suite: fresh-install permissive, true once ACTIVE, false the instant any
    row exists without one being ACTIVE, false after emergency-disable, true
    again after a rollback -- plus the new emergency-disable-then-rollback
    recovery test proving the fix above). Full `@visastack/services` suite,
    repo-wide typecheck/lint, and production build all clean.
    **Still deliberately deferred, its own future chunk:** which
    adapter/model/API key/limits to actually dispatch WITH still comes 100%
    from env vars, even once a DB config is genuinely ACTIVE -- only "is
    dispatch allowed at all" is DB-authoritative so far. Making the adapter
    itself DB-configurable (reading `getActiveAiProviderConfig`'s own
    provider/model/decrypted key/limits instead of process.env, with a
    graceful fallback while none is configured) is the natural next step,
    and would make an activated config's provider/model choice actually take
    effect rather than only its on/off state.
    Full detail: `requirements-ledger.md` AI-02.
    **Chunk 6 (this update) -- the adapter itself is now DB-configurable
    (AI-02, the remaining half).** Chunk 5 closed "is dispatch allowed at
    all" -- but which adapter, model, API key, and limits to actually
    dispatch WITH still came 100% from env vars, even once a DB config was
    genuinely ACTIVE, so activating a config with a different model had zero
    effect on what actually ran. Closed by a new
    `resolveAiExtractor(db, encryption)` in `apps/web/src/lib/ai.ts`, added
    alongside the existing `createAiExtractor()` rather than replacing it:
    on a fresh install where `ai_provider_configs` is still empty, it is
    `createAiExtractor()` unchanged -- today's env-only behavior untouched.
    The instant a first row exists at all, the DB becomes authoritative for
    WHAT runs too, not just whether anything runs, mirroring
    `isAiDispatchAllowed`'s identical "authoritative once touched" rule via
    the same shared `hasAnyAiProviderConfig` check, so the two functions can
    never disagree about which world is in effect. Once authoritative, it
    builds an adapter from the ACTIVE row's own `model`/`reasoningEffort`
    and decrypts its key via the existing `revealAiProviderApiKey`, and
    returns `undefined` (never a silent fallback to stale env vars) when
    nothing is genuinely ACTIVE, the ACTIVE config names a provider this
    codebase hasn't implemented yet (only `openai` exists today), or no
    encryption port is available to decrypt the key.
    `createAiExtractor()` itself was deliberately left completely
    unchanged: `commercial-readiness.ts`'s `productionOpenAiProjectReady()`
    gate checks `OPENAI_PROJECT_ID` specifically, a concept with no
    DB-config equivalent, so it should not be forced to become
    DB/async-aware, and its own existing passing tests stay exactly as they
    were. `storeResponses`/`projectId` also have no DB-config equivalent yet
    (Part 8 §5's "set limits"/"set reviewed data policy" journey doesn't
    cover them) -- `storeResponses` defaults to `false` (privacy
    minimization) rather than inheriting whatever `OPENAI_STORE_RESPONSES`
    happens to be set to.
    Wired into the one real call site, `runAiExtractionAction`
    (`apps/web/src/app/app/applicant/[id]/actions.ts`), replacing its
    `createAiExtractor()` call with `resolveAiExtractor(db,
    createKeyManagementPort())`.
    `apps/web` has `@visastack/db` as a dependency but not
    `@electric-sql/pglite`/`drizzle-orm` directly (unlike
    `packages/services`), which ruled out a real-PGlite integration test for
    `resolveAiExtractor` without a larger dependency-addition change out of
    this chunk's scope. Used `vi.mock` with `importOriginal` instead --
    mocking only the three `@visastack/services` entry points this function
    calls and preserving everything else -- the same "mock the boundary, run
    everything else for real" pattern `step-up.test.ts`/`providers.test.ts`
    already establish for this package; each mocked function's OWN
    correctness is already thoroughly covered by
    `ai-provider-config.test.ts`'s real-PGlite suite, so these tests exist
    only to prove `resolveAiExtractor`'s own orchestration. 5 new tests
    (`ai.test.ts`): falls back to `createAiExtractor()` on a fresh install
    and never touches the DB-read functions; builds the adapter from the
    ACTIVE config's own model/reasoning-effort while ignoring env vars
    entirely; returns undefined once any config exists but none is ACTIVE,
    even with env vars fully configured; returns undefined for an ACTIVE
    config naming an unimplemented provider; returns undefined when no
    encryption port is available. Full `@visastack/services` suite,
    repo-wide typecheck/lint, and production build all clean.
    **Still deliberately deferred:** the admin UI for the full settings
    journey; the synthetic connection test and task-evaluation runner §5
    also names; Gemini/Anthropic adapters (AI-03); the SSRF-hardening module
    (AI-07 §7, still blocked on a custom-endpoint field that doesn't exist
    yet); OCR/scanned-evidence support (§9); generalizing the eval harness
    beyond OpenAI-only (AI-10).
    Full detail: `requirements-ledger.md` AI-02.
    **Chunk 7 (this update) -- the admin UI for the settings journey now
    exists (AI-02, the last major piece of this row).** Every prior chunk
    built the backend lifecycle (create/activate/rollback/emergency-disable/
    revoke, the kill switch, the DB-configurable adapter); nothing yet let an
    admin actually reach any of it except by calling service functions
    directly. New route `/app/admin/ai-settings`
    (`apps/web/src/app/app/admin/ai-settings/{page,actions,forms}.tsx`),
    gated on `hasPlatformPermission(..., 'AI_SETTINGS_MANAGE')` (the
    dedicated-sub-page convention `complaints/`/`organizations/[orgId]/`
    already use, not the broader `isPlatformAdmin`), linked from the main
    admin page next to Pack Studio/Complaint triage. All five mutating
    actions (`createDraftAiProviderConfigAction`,
    `activateAiProviderConfigAction`, `rollbackAiProviderConfigAction`,
    `emergencyDisableAiProviderConfigAction`,
    `revokeAiProviderConfigKeyAction`) follow the exact
    `hasPlatformPermission` -> `tryEstablishStepUp` -> service-call ->
    `Result`-to-`ActionState` pipeline `grantPlatformRoleAction`/
    `placeLegalHoldAction` (`admin/actions.ts`) already establish, since
    every one of these five service functions is itself step-up-gated; each
    of the five carries a distinct step-up `action` id
    (`AI_SETTINGS_CREATE_DRAFT`/`_ACTIVATE`/`_ROLLBACK`/
    `_EMERGENCY_DISABLE`/`_REVOKE_KEY`) so a stale WorkOS session prompts
    reauthentication for exactly the mutation being attempted. Rollback and
    emergency-disable take no target id (the service's own design -- they
    always act on "whatever is currently ACTIVE") and reuse
    `purgeExpiredDocumentsAction`'s identical fixed `'platform-wide'`
    step-up-resource convention for an equivalent no-target-id, platform-wide
    mutation.
    The create-draft form collects everything `createDraftAiProviderConfig`
    accepts -- provider (a `<select>` with only the one real `openai` option
    today, deliberately not free text, so a stray case-typo like "OpenAI"
    can never silently save a draft the gateway's case-sensitive provider
    match would refuse to ever activate), model, an OpenAI-style reasoning
    effort selector, a write-only `type="password"` API key field (a
    genuinely new UI pattern -- no prior page in this codebase has ever
    collected a raw secret), the Part 8 §5 data-policy-reviewed attestation
    checkbox, and the same six budget/limit knobs
    `apps/web/src/lib/ai.ts`'s own env-var functions already expose --
    `usdToUnits` (previously private to that file) is now exported so the
    admin form's USD inputs convert to the ledger's cost-unit scale with the
    exact same approximate formula the env-var path already uses, rather
    than inventing a second one. The history list renders every version as
    its own card (`packs/[packId]/page.tsx`'s established versioned-snapshot
    layout), showing only the masked `apiKeyFingerprint` -- never a
    decrypted key, matching `revealAiProviderApiKey`'s own doc comment that
    it must stay gateway-internal -- with Activate/Revoke buttons rendered
    only when that row's own status makes the action legal (a DRAFT with an
    approved policy and an unrevoked key can activate; any row with an
    unrevoked key can have its key revoked), mirroring the service layer's
    own preconditions exactly so a doomed click can never appear in the UI.
    `getActiveAiProviderConfig` (no permission check of its own, by design)
    is deliberately never called from this page; "what's active" is instead
    derived from the already-gated `listAiProviderConfigHistory` result, so
    every value this page displays passed through one authorized read path.
    Matched existing convention throughout rather than inventing new
    patterns, confirmed by a dedicated research pass first: no component/
    form library, modal, or central nav-config exists anywhere in this
    codebase, so this page is hand-rolled CSS classes + native `<form>` +
    `useActionState`, `window.confirm` for destructive actions, and an
    inline `<Link>` added next to the other admin sub-page buttons --
    identical to every other admin surface. No i18n wiring (no admin page in
    this codebase uses `@visastack/i18n`; that remains a Part 9 concern, not
    an oversight here).
    Two things explicitly NOT done in this chunk, stated plainly rather than
    left implicit: (1) the six limit fields the create-draft form collects
    (budget, per-document budget, max attempts, max pages, cache age, max
    concurrent calls) are persisted on the row exactly as the schema and
    service layer already support, but nothing at runtime reads them yet --
    `ai.ts`'s own `aiBudgetLimitUnits`/`aiMaxAttemptsPerDocument`/etc. remain
    100% env-var-driven even once a config is ACTIVE, exactly like the
    adapter/model/key gap Chunk 6 closed for provider/model/key specifically;
    wiring these six into runtime enforcement is its own future chunk. (2) no
    unit tests were added for the new `actions.ts` -- confirmed first that
    zero of this codebase's 21 existing `actions.ts` files have a dedicated
    test file (they wrap `withSession`'s real WorkOS auth + DB pool, which
    nothing in this codebase unit-tests directly), so adding one here would
    invent a new pattern rather than follow one; the service-layer functions
    every action calls are already fully covered by
    `ai-provider-config.test.ts`. Not verified in a live browser (sandbox
    limitation: no `WORKOS_API_KEY`/`WORKOS_CLIENT_ID`/`DATABASE_URL`
    configured here, same limitation noted on every prior UI chunk this
    session) -- verified instead via a clean repo-wide typecheck, a clean
    `apps/web` production build (the new `/app/admin/ai-settings` route
    compiles and appears in the build manifest), the full `apps/web` test
    suite (184/184, including `ai.test.ts`'s existing coverage of the now-
    exported `usdToUnits`), and Biome clean.
    Full detail: `requirements-ledger.md` AI-02.
    **Chunk 8 (this update) -- the six persisted limit fields now actually
    govern dispatch (AI-02, closing the gap named at the end of Chunks 6/7).**
    The create-draft form (Chunk 7) already collected and persisted budget,
    per-document budget, max attempts, max pages, cache age, and max
    concurrent calls onto each `ai_provider_configs` row, but nothing at
    runtime read them back -- `ai.ts`'s six env-var cap functions stayed
    100% authoritative even once a config was genuinely ACTIVE, so
    activating a config with a tighter or looser budget had zero real
    effect. Traced every call site of those six functions first (only two:
    `runAiExtractionAction`'s `runExtraction(...)` call, and the admin
    dashboard's AI-spend meter -- both already inside a `withSession`
    callback with `db` in scope, so the blast radius was exactly these two
    reads, not a wide sync-to-async cascade). `resolveAiExtractor` (`ai.ts`)
    now returns `{ ai, limits }` instead of a bare adapter: the SAME ACTIVE
    config row it already fetches to build the adapter is reused to resolve
    `limits` too (never a second, separately-timed query, which would risk
    the adapter and its limits coming from two different rows if an admin
    activated/rolled back between reads). Each of the five optional columns
    (all but `budgetLimitUnits`, which the schema requires) falls back to
    its own env-var default individually when NULL on that row, since an
    admin may leave any of them unset when creating a draft. New
    `resolveAiLimits(db)` gives the same resolution as a standalone,
    read-only call for display contexts with no adapter to build (the admin
    spend meter), sharing the identical `hasAnyAiProviderConfig`
    "authoritative once touched" rule so a displayed number can never
    silently disagree with what dispatch actually used moments earlier.
    `runAiExtractionAction` (`apps/web/src/app/app/applicant/[id]/actions.ts`)
    now reads `resolved.limits.*` instead of calling the six env functions
    directly, removing that import entirely. The admin dashboard's AI
    Gateway spend meter now shows the ACTIVE config's own budget as its cap
    once one exists (previously always the env-var figure regardless of
    what was ACTIVE); its warning threshold stays env-var-only since the
    schema has no per-configuration warning column -- stated in the page's
    own copy, not left implicit. 8 new/updated tests in `ai.test.ts`
    (`resolveAiExtractor`'s limits resolved from a fresh install, from an
    ACTIVE config with every optional column NULL falling back individually,
    and from an ACTIVE config with every column set; a new
    `resolveAiLimits` describe block covering the same three states for the
    read-only path). Full `apps/web` suite (189/189), repo-wide typecheck,
    Biome, and production build all clean.
    Full detail: `requirements-ledger.md` AI-02.
    **Chunk 9 (this update) -- the Anthropic Claude adapter now exists
    (AI-03, the first of the two remaining providers).** Checked the
    directive's own §3 requirement first rather than assuming: it names all
    three providers as required ("ship production adapters for OpenAI API;
    Google Gemini API; Anthropic Claude API"), and §16's own checkpoint reply
    format requires a PASS/BLOCKED line for each of the three by name, so
    "multi-provider" was never optional scope. New
    `packages/adapters/src/anthropic-extraction.ts`'s
    `AnthropicExtractionAdapter`, structurally parallel to
    `OpenAiExtractionAdapter` (same `AiExtractionPort` contract, same
    privacy-minimization discipline -- only the deterministic text and
    allowed field keys are ever sent, never raw file bytes) but built against
    Anthropic's actual Messages API rather than assumed to look like OpenAI's:
    structured output via a FORCED tool call (`tool_choice: {type: "tool",
    ...}`), since the Messages API has no `json_schema`/`strict` response-
    format equivalent -- Claude's tool-use schema-following is best-effort,
    not hard-enforced, recorded as a known limitation per §3's own
    requirement to record one. Refusal detection covers both an explicit
    `stop_reason: "refusal"` and the case forced tool_choice would make
    structurally unusual but not impossible: a normal-looking stop that
    nonetheless produced no tool_use block at all, i.e. the model declined to
    comply despite being required to call the tool -- both surfaced as a
    positive `refused` outcome, never silently treated as zero proposals.
    `stop_reason: "max_tokens"` is `truncated`, checked before the refusal
    path so a cut-off response is never misread as a decline. Two more known
    limitations recorded in the adapter's own doc comment rather than
    silently guessed at: `storeResponses` (no per-call Messages API retention
    toggle exists, unlike OpenAI's `store` flag) and `reasoningEffort` (no
    "low/medium/high" dial equivalent -- Claude's own "extended thinking" is
    a token-budget mechanism, a different concept, deliberately not mapped in
    this first version to keep the core extraction path simple and reliable)
    are both accepted on the adapter for interface-shape parity but are
    currently no-ops.
    Wired into `resolveAiExtractor` (`apps/web/src/lib/ai.ts`): the single
    `config.provider !== 'openai'` check became a small `buildAdapterForConfig`
    switch plus an `IMPLEMENTED_PROVIDERS` set, checked BEFORE
    `revealAiProviderApiKey` runs, not after -- an unimplemented provider
    (Gemini, until it ships) must never pay for a real KMS decrypt of a key
    it will never use. A real ordering bug surfaced and fixed while writing
    this chunk's own tests, not a pre-planned change: the first version of
    this refactor called `revealAiProviderApiKey` unconditionally before
    checking whether the provider was actually implemented, which a test
    expecting the decrypt to never happen for a `gemini` config caught
    immediately. `buildAdapterForConfig`'s own `default` branch throws
    (rather than silently falling back to some adapter) if ever called for a
    provider `IMPLEMENTED_PROVIDERS` didn't already exclude -- an invariant
    violation from the two drifting out of sync should fail loudly, never
    silently misroute a decrypted key to the wrong provider's API. The admin
    UI's provider `<select>` (`ai-settings/forms.tsx`) now offers Anthropic
    alongside OpenAI, still a closed set rather than free text, so a
    Gemini/unimplemented-provider typo still can't silently save an
    undispatchable draft. `createAiExtractor()` (the env-var fallback path)
    stays OpenAI-only, unchanged, on purpose -- it exists only to cover a
    fresh install that has never touched AI Settings at all, and Part 8 §5's
    own admin-journey walkthrough starts with OpenAI before ever mentioning
    Gemini/Claude, so extending the env contract to other providers would add
    a whole new set of env vars for a path the DB config system is meant to
    supersede anyway.
    16 new tests (`anthropic-extraction.test.ts`, mirroring
    `openai-extraction.test.ts`'s own coverage: well-formed tool-use parsing,
    model/maxTokens overrides, the reasoningEffort/storeResponses no-op
    proof, type coercion, rate-limited/upstream-error/network-failure/
    invalid-response/timeout/auth-failed/truncated/both refusal shapes,
    and usage/latency/message-id capture), plus 2 new/updated tests in
    `ai.test.ts` (the previously-unimplemented-provider example changed from
    `anthropic` to `gemini`, since it is no longer true of the former; a new
    test proving `resolveAiExtractor` builds a real
    `AnthropicExtractionAdapter` from an ACTIVE `anthropic` config, and that
    its cache key never claims a reasoning-effort dependency it doesn't
    actually have). Full `@visastack/adapters` suite (193 passing, 2
    pre-existing live-ClamAV skips), full `apps/web` suite (190/190),
    repo-wide typecheck, Biome, and production build all clean.
    Real live-API verification against Anthropic's actual endpoint remains
    BLOCKED regardless of adapter completeness -- no `ANTHROPIC_API_KEY`
    exists in this sandbox, the same "adapter may be code-complete; but A19
    remains BLOCKED for that provider" shape directive §14 itself names, and
    identical to OpenAI's own adapter never having been live-verified here
    either. **Still remaining:** the Gemini adapter (the other named
    provider); the SSRF-hardening module (AI-07 §7, still blocked on a
    custom-endpoint field that doesn't exist); the synthetic connection test
    and task-evaluation runner (§5); OCR/scanned-evidence support (§9);
    generalizing the eval harness beyond OpenAI-only (AI-10).
    Full detail: `requirements-ledger.md` AI-03.
    **Chunk 10 (this update) -- the Gemini adapter now exists, closing the
    last of the three directive-named providers (AI-03).** Unlike the
    Anthropic adapter, this one's protocol details were verified against
    live Google documentation/ecosystem sources at implementation time
    rather than assumed from the other two adapters' shape (the directive's
    own §3 instruction) -- `ai.google.dev` itself is blocked by this
    sandbox's own egress policy, so verification used web search of its
    indexed content and current community/SDK sources instead of a direct
    fetch, a materially weaker verification than a live docs fetch would
    give and flagged as such in the adapter's own doc comment.
    New `packages/adapters/src/gemini-extraction.ts`'s
    `GeminiExtractionAdapter`, structurally parallel to the other two
    (same `AiExtractionPort` contract, same privacy-minimization
    discipline), calling `generativelanguage.googleapis.com`'s real
    `generateContent` endpoint with the `x-goog-api-key` header (not a
    bearer token, and not the key as a URL query parameter, which would leak
    it into access logs). Structured output via Gemini's own native
    `responseMimeType: "application/json"` + `responseSchema` --
    architecturally closer to OpenAI's real structured-output mechanism than
    Anthropic's forced-tool-use workaround, since Gemini has a genuine JSON
    response mode. A real, verified (not guessed) known limitation shaped
    the schema's own design: `responseSchema`'s documented `nullable: true`
    keyword has real-world reports of causing HTTP 400s in practice, so this
    adapter never sets it -- the four optional proposal fields are simply
    left out of the schema's `required` array instead, and the response is
    parsed defensively regardless of whether a given run omits, nulls, or
    strings each one, exactly the same "never trust the payload" posture the
    other two adapters already apply for their own reasons.
    Another verified (not assumed) protocol difference: unlike OpenAI's/
    Anthropic's clean 401/403 auth failures, an invalid Gemini API key comes
    back as a plain HTTP 400 with `error.message` containing "API key not
    valid" -- this exact, documented signature is checked to classify it as
    `auth_failed`, distinguished from an ordinary malformed-request 400
    (invalid model name, etc.) which correctly stays `upstream_error`; a
    dedicated test proves both cases land on the right code rather than
    collapsing an invalid-key 400 into the generic bucket. Refusal detection
    covers both `promptFeedback.blockReason` (the whole prompt blocked
    before any candidate is generated -- no candidate to inspect at all) and
    any candidate `finishReason` other than `STOP` (SAFETY, RECITATION,
    PROHIBITED_CONTENT, and any future content-filter reason this adapter
    doesn't yet name individually, caught by treating anything non-normal as
    a refusal rather than enumerating every possible value). `finishReason:
    "MAX_TOKENS"` is `truncated`, checked before the refusal path.
    Two more known limitations recorded rather than guessed at, the same
    shape `AnthropicExtractionAdapter` already established: `storeResponses`
    (no per-call retention toggle on this endpoint either) and
    `reasoningEffort` (Gemini's own "thinking" models take a token budget via
    `generationConfig.thinkingConfig`, a different mechanism, deliberately
    not mapped in this first version) are both accepted for interface-shape
    parity but are currently no-ops.
    Wired into `resolveAiExtractor`/`buildAdapterForConfig`
    (`apps/web/src/lib/ai.ts`) as a third case in the existing switch, and
    into `IMPLEMENTED_PROVIDERS`; the admin UI's provider select
    (`ai-settings/forms.tsx`) now offers all three providers, still a closed
    set. The `ai.test.ts` test that used `gemini` as its
    "provider not implemented yet" example was updated to use a clearly
    fictional provider name instead, since that example is no longer true;
    a new test proves `resolveAiExtractor` builds a real
    `GeminiExtractionAdapter` from an ACTIVE `gemini` config.
    18 new tests (`gemini-extraction.test.ts`, mirroring the other two
    adapters' own coverage plus the two Gemini-specific cases above: the
    401/400-API-key-invalid distinction, the schema-never-nullable proof,
    the whole-prompt-block case, and the any-non-normal-finishReason
    refusal), plus 2 new/updated tests in `ai.test.ts`. Full
    `@visastack/adapters` suite (211 passing, 2 pre-existing live-ClamAV
    skips -- one transient single-test timing-margin flake was observed and
    reproduced as pre-existing on the already-merged Anthropic adapter's own
    identical timeout test under the same full-suite load, not a regression
    from this chunk), full `apps/web` suite (191/191), repo-wide typecheck,
    Biome, and production build all clean.
    Real live-API verification against Gemini's actual endpoint remains
    BLOCKED regardless of adapter completeness -- no `GEMINI_API_KEY` exists
    in this sandbox, the identical shape directive §14 itself names and the
    same as both other adapters' own live-verification status here.
    **Part 8's own named provider trio is now code-complete: OpenAI,
    Anthropic, and Gemini all have production adapters.** Still remaining
    for Part 8 as a whole: the SSRF-hardening module (AI-07 §7, still
    blocked on a custom-endpoint field that doesn't exist); the synthetic
    connection test and task-evaluation runner (§5); OCR/scanned-evidence
    support (§9); generalizing the eval harness beyond OpenAI-only (AI-10);
    real live evaluation runs against all three paid provider accounts,
    BLOCKED regardless of adapter completeness for the reason stated above.
    Full detail: `requirements-ledger.md` AI-03.
    **Chunk 11 (this update) -- the synthetic connection test now exists,
    closing the "test" step of J15's own named admin journey ("config
    OpenAI; test; activate") left open since Chunk 7.** Two new
    SECURITY_ADMIN-only functions in `ai-provider-config.ts`:
    `getAiProviderConfigById` (fetches one configuration row by id -- the
    gateway's existing `getActiveAiProviderConfig` can only ever return the
    ACTIVE row, but testing must reach a specific DRAFT before it is ever
    activated) and `recordAiProviderConfigTest` (writes a single
    `AI_PROVIDER_CONFIG_TESTED` audit event). A deliberate distinction
    reasoned through explicitly while writing this chunk: `result` on that
    event is always `ALLOWED`, never `DENIED`, even when the connection test
    itself failed -- `result` is this codebase's own reserved field for the
    AUTHORIZATION decision (was the actor allowed to attempt this at all),
    which by construction already succeeded before the real call was ever
    made; whether the test itself succeeded or failed lives in `metadata`
    instead, alongside a short, non-sensitive message.
    `apps/web/src/lib/ai.ts` gained a new `resolveTestAdapter` function,
    mirroring `resolveAiExtractor`'s fail-closed rules (an unimplemented
    provider or a
    missing encryption port returns undefined, never a throw) but taking the
    caller's already-fetched config row directly instead of reading whatever
    is ACTIVE, and returning no `limits` at all -- a synthetic test never
    touches `runExtraction`'s budget, cache, or kill-switch machinery, and
    never writes a row to `ai_extraction_runs`, since it is not a billable
    extraction run. The new `testAiProviderConfigAction`
    (`ai-settings/actions.ts`) is gated exactly like every other action on
    this page (SECURITY_ADMIN + step-up, a new distinct
    `AI_SETTINGS_TEST_CONNECTION` step-up action id) and calls the resolved
    adapter's `.extract()` directly against fixed, synthetic content, never a
    customer document -- the directive's own explicit instruction for this
    exact step. A new `TestConnectionButton` (`ai-settings/forms.tsx`) is
    available on any configuration row whose key has not been revoked (the
    same eligibility bar `RevokeKeyButton` itself already uses), including a
    DRAFT that has never been activated, matching J15's own ordering; unlike
    activate/rollback/disable/revoke it needs no confirmation dialog, since
    it changes no configuration state at all.
    Distinguished on purpose from the directive's OTHER named §5 mechanism,
    the task-evaluation runner (running the full existing eval harness
    against a candidate config before activation) -- that one depends on
    AI-10 (generalizing the harness beyond OpenAI-only) landing first, so it
    is correctly sequenced as its own later chunk, not bundled into this one.
    5 new tests in `ai-provider-config.test.ts` (`getAiProviderConfigById`'s
    happy/forbidden/not-found paths; `recordAiProviderConfigTest`'s audit
    event verified by reading it back with `listRecentAuditEvents`, on both a
    successful and a failed synthetic test outcome), 4 new tests in
    `ai.test.ts` (`resolveTestAdapter` building directly from a DRAFT config
    without ever consulting the ACTIVE row, building the matching adapter for
    a non-OpenAI provider, and its two fail-closed paths). Full
    `@visastack/services` suite (30/30 in `ai-provider-config.test.ts`),
    full `apps/web` suite (195/195), repo-wide typecheck, Biome, and
    production build all clean.
    Only the task-evaluation runner (§5) now remains of AI-02's originally
    named admin-journey scope. Full detail: `requirements-ledger.md` AI-02.
    **Chunk 12 (this update) -- the evaluation harness
    (`packages/adapters/src/eval/`) is now provider-generic, closing AI-10's
    own "generalizing the eval harness beyond OpenAI-only" gap.** Investigated
    the harness
    first rather than assuming scope: `dataset.ts` (the 13 directive-named
    document categories) and `scoring.ts` (precision/recall/hallucination/
    evidence-accuracy/prompt-injection scoring) were ALREADY fully
    provider-agnostic -- both operate purely on the generic
    `AiExtractionPort`/`FieldProposal` shape every adapter shares, with zero
    OpenAI-specific code. Only `run.ts`'s own adapter-construction switch was
    ever OpenAI-only, so this chunk touched exactly that one file.
    `run.ts` now reads a new `AI_EVAL_PROVIDER` env var (`openai` by default,
    preserving every existing invocation's behavior unchanged), and builds
    the matching real adapter from that provider's own env contract:
    `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL_PRIMARY` for Anthropic,
    `GEMINI_API_KEY`/`GEMINI_MODEL_PRIMARY` for Gemini -- new env var names
    introduced specifically for this standalone CLI script, never added to
    the root `.env.example` (that file documents the DEPLOYED APP's own
    runtime contract, which stays OpenAI-only forever per Chunk 9/10's own
    reasoning; this eval tool is a separate, manually-invoked dev/CI script
    that has never been part of that contract). Directive §14 itself treats
    each provider as needing its OWN pass/fail verdict ("each provider must
    pass... all three real adapters must eventually be live-tested"), not one
    combined score, so this deliberately runs exactly one provider per
    invocation -- an operator (or a future CI matrix) runs it three times,
    once per provider, each producing its own independent
    `[ai-eval:<provider>] PASS`/`FAIL` report, matching J15's own "config
    OpenAI; test; activate; Gemini; Claude" journey rather than inventing a
    combined-score scheme the directive never asks for.
    The missing-credentials skip path (exit 0, "NOT pilot-verified," never a
    hard failure) is preserved exactly, now per-provider: an unset
    `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` skips cleanly with a message naming
    which var is missing, the same honesty pattern this script has always
    used for `OPENAI_API_KEY`.
    No test file was added for `run.ts` itself, matching this codebase's own
    established precedent for a real-credential-requiring CLI script (Part 8
    AI-02 Chunk 7's own reasoning for `actions.ts`: "confirmed zero of this
    codebase's existing files of this shape have one, since they wrap real
    external access" -- `run.ts` has had zero tests since it was first built
    in Chunk 1, for the identical reason, and this chunk's own new logic
    (`resolveProvider`/`buildAdapter`) is a small, directly-reviewed switch
    over three literal cases, not independently complex business logic).
    Verified instead via a clean repo-wide typecheck, a clean Biome check,
    and the full `@visastack/adapters` suite (211 passing, 2 pre-existing
    live-ClamAV skips -- unchanged, since no test file changed). CI never
    invokes this script at all (confirmed via a repo-wide search of
    `.github/workflows/`), so this chunk carries zero CI-behavior risk.
    **Deliberately NOT in this chunk, and still open:** the directive's own
    ">=50 representative documents/pages per task set" target (today's
    dataset has 13 cases total, one per directive-named category, not 50+
    PER category -- a large, separate content-authoring effort, not a
    generalization task); the task-evaluation runner itself (§5, gating
    activation on an eval run -- still correctly sequenced as its own later
    chunk now that its AI-10 dependency is closed); and real live-credentialed
    runs against all three providers, still structurally BLOCKED in this
    sandbox (no real API key for any of the three providers), the identical
    shape directive §14 itself names ("adapter may be code-complete; but A19
    remains BLOCKED for that provider").
    Full detail: `requirements-ledger.md` AI-10.
    **Chunk 13 (this update) -- the task-evaluation runner now exists,
    closing the last of AI-02's originally named admin-journey scope.**
    Part 8 §5 names "run task evaluation" as its own distinct admin step,
    separate from "run synthetic connection test": one synthetic call versus
    the full 13-case eval harness dataset. This chunk was correctly
    sequenced after AI-10 (closed in Chunk 12), since it depends directly on
    the harness being callable against an arbitrary already-built adapter,
    not just OpenAI's.
    New `runEvaluationSuite` (`packages/adapters/src/eval/harness.ts`) is
    the shared case-by-case loop extracted once a second real caller needed
    it: the standalone CLI script (`run.ts`) and this chunk's new admin
    action both run the identical dataset against an already-built adapter
    and need the identical aggregate report back. `run.ts` was refactored to
    call this shared function (its own per-case console output preserved via
    an optional callback parameter) rather than duplicating the loop --
    confirmed behavior-preserving by re-running its own typecheck (it has no
    dedicated test file, unchanged from every prior chunk that touched it).
    `runEvaluationSuite`/`AggregateReport`/`CaseScore`/`passesThresholds`/
    `PASS_THRESHOLDS` are now exported from `packages/adapters/src/index.ts`
    -- the eval harness's dataset/scoring internals were never part of this
    package's public API before, since only the CLI script needed them.
    New SECURITY_ADMIN-only `recordAiProviderConfigEvaluation`
    (`ai-provider-config.ts`), the identical shape and reasoning as Chunk
    11's `recordAiProviderConfigTest`: `result` is always `ALLOWED` (the
    caller has already confirmed permission + step-up before the real
    evaluation run this records), whether the evaluation itself PASSED lives
    in `metadata`, which carries only the aggregate numeric report -- case
    count, precision, recall, hallucination rate, evidence accuracy, prompt-
    injection resistance, whether any case errored, total cost units -- never
    individual case proposals or document text, matching Part 8 §16's
    "without sensitive content" posture the connection test already
    established.
    The new `runAiProviderConfigEvaluationAction` (`ai-settings/actions.ts`)
    is gated exactly like the connection test (SECURITY_ADMIN + step-up, a
    new distinct `AI_SETTINGS_RUN_EVALUATION` step-up action id) and, like
    it, never touches `runExtraction`'s budget/cache/kill-switch machinery
    and never writes to `ai_extraction_runs` -- an evaluation run is not a
    billable extraction, and every case uses the harness's own fixed
    synthetic documents, never a customer document. A real operational risk
    was reasoned through and closed before this shipped, not left implicit:
    13 sequential real provider calls, each individually capable of taking
    up to the adapter's own 60s timeout, would not reliably complete within
    a platform's default execution window. `ai-settings/page.tsx` now
    exports `maxDuration = 300`, following this codebase's own established
    convention for genuinely long-running server-side work (the
    `/api/jobs/*` sweep routes already do the same, at 60s -- this action's
    own worst-case is considerably larger, hence the higher figure); if the
    actual deployment's plan caps lower, Vercel clamps to that ceiling
    itself rather than erroring, so asking for more than might be honored is
    safe.
    A new `RunEvaluationButton` sits between `TestConnectionButton` and
    `ActivateConfigButton` in the admin UI, matching J15's own "config;
    test; activate" ordering (task evaluation being the journey's other
    named pre-activation step); same eligibility bar as the connection test
    (key not revoked), and the same "no confirmation dialog, changes no
    configuration state" reasoning, though its own label names the case
    count up front since it makes many more real provider calls than the
    connection test's single one.
    A genuine interpretive question was reasoned through explicitly, not
    assumed: §5 also states "Prior active version remains until replacement
    passes," immediately after the admin-journey bullet list that includes
    "run task evaluation." Read as a HARD gate (activation mechanically
    requires a stored passing evaluation), every deployment would need to
    burn real paid provider credits before ever activating anything, in
    every environment forever -- and J15's own acceptance-test sequence
    ("config OpenAI; test; activate; Gemini; Claude; rollback...") does not
    include a required evaluation step between "test" and "activate" either.
    Read instead as describing the eligibility checks `activateAiProviderConfig`
    already enforces atomically (data policy approved, key not revoked --
    the prior ACTIVE row is provably untouched unless and until those pass,
    which was already true before this chunk), "task evaluation" is an
    available admin TOOL exactly like the connection test, not a mechanically
    enforced prerequisite. This chunk implements the latter reading;
    revisit if a future directive re-read or explicit user instruction says
    otherwise.
    5 new tests (`harness.test.ts`, a stub-adapter-based proof of
    `runEvaluationSuite`'s own orchestration -- call count, per-case
    argument shape, error aggregation, callback invocation -- deliberately
    not re-proving `scoring.ts`'s own already-thorough scoring-correctness
    coverage), 2 new tests in `ai-provider-config.test.ts`
    (`recordAiProviderConfigEvaluation`'s audit-event shape on both a
    passing and a failing evaluation outcome). No dedicated test file for
    the new admin action, matching this codebase's established precedent
    (identical reasoning to Chunk 11's `testAiProviderConfigAction`). Full
    `@visastack/adapters` suite (216 passing, 2 pre-existing live-ClamAV
    skips), full `@visastack/services` suite, full `apps/web` suite
    (195/195), repo-wide typecheck, Biome, and production build all clean.
    **Part 8 §5's entire originally-named admin journey is now
    code-complete: choose provider, enter key, choose model, set limits, set
    reviewed data policy, save DRAFT, run synthetic connection test, run
    task evaluation, activate, rollback, emergency-disable.** Still
    remaining for Part 8 as a whole: the SSRF-hardening module (AI-07 §7,
    still blocked on a custom-endpoint field that doesn't exist); expanding
    the eval dataset toward the directive's ">=50 representative
    documents/pages per task set" target (today's 13 cases, one per
    category); OCR/scanned-evidence support (§9); real live evaluation runs
    against all three paid provider accounts, BLOCKED regardless of code
    completeness (no real API key for any provider in this sandbox).
    Full detail: `requirements-ledger.md` AI-02.
    **Chunk 14 (this update) -- OCR/scanned-evidence support (AI-05, Part 8
    §9) begins, with its own contract-first chunk, mirroring exactly how the
    multi-provider adapter rollout itself started (Chunk 1: widen the
    contract with zero runtime risk, wire it into a live path only later).**
    Read §9 fresh rather than assuming scope: "For image/scanned PDF: use
    approved OCR component OR configured evaluated vision model," with
    explicit bounds (pages/resolution/size -- already satisfied by EVI-01's
    existing `BuiltinContentLimitsChecker`, unchanged), named review signals
    (low quality; ambiguous date; unsupported script; missing text), a
    manual-entry-always-available escape hatch, and an explicit
    "do not market universal OCR" constraint.
    A genuine architecture fork existed here and was put to the user rather
    than assumed, since it reverses a boundary every single AI Gateway chunk
    this session has held as a point of pride: `AiExtractionPort`'s own
    "never send raw file bytes, text only" privacy-minimization discipline.
    OCR fundamentally has no text to extract FROM -- an image's bytes must
    leave the server by design, to somewhere. The two options directive §9
    itself allows: (a) reuse the existing, admin-configured AI Gateway
    providers (§5) by extending them with image input, or (b) a wholly
    separate, independently-configured OCR component/service. The user chose
    (a) -- reuse the existing providers -- so no new dependency or second
    admin-configuration surface is introduced; the tradeoff is that the
    admin's already-chosen text-extraction provider also becomes an
    image-receiving provider for OCR, a materially bigger data-sharing
    posture for that same relationship, made explicit and deliberate rather
    than silently implied.
    New `packages/services/src/ocr.ts` (`AiOcrPort`, `AiOcrInput`,
    `AiOcrResult`, `AiOcrUsage`, `AiOcrOutcome`, `AiOcrErrorCode`,
    `OcrReviewIssueCode`) -- structurally parallel to `AiExtractionPort` in
    `ai.ts` (same seven-way explicit failure-mode discipline: never a
    generic bucket), but deliberately its OWN file and its OWN port, not an
    optional image field bolted onto `AiExtractionPort` -- a caller must
    explicitly opt into this different data-sharing posture, never get it by
    accident through a field that happens to be set. `OcrReviewIssueCode` is
    a set (`readonly OcrReviewIssueCode[]`), not four separate booleans,
    since more than one genuinely can co-occur (a low-quality scan that is
    ALSO ambiguous about its date).
    New `packages/adapters/src/openai-ocr.ts`'s `OpenAiOcrAdapter` --
    structurally parallel to `OpenAiExtractionAdapter` (same Responses API
    endpoint, same `json_schema`/`strict` structured output, same
    timeout/error-classification shape, same defensive "never trust the
    payload" parsing discipline) but sends an actual image content part
    (`input_image`, a base64 data URI -- never a publicly-fetchable URL,
    which would leak the image outside this exact request) instead of
    deterministically-extracted text. Verification note: unlike the Gemini
    adapter's own live-verified protocol quirks, this adapter's multimodal
    input shape was built from training-data knowledge, judged reasonably
    reliable and stable for the same reason the original OpenAI/Anthropic
    text adapters were (a mature, well-documented, long-stable part of the
    Responses API) -- flagged here rather than silently assumed to be
    equally strong evidence as a live-verified detail.
    Only OpenAI is implemented in this chunk, matching the multi-provider
    text-adapter rollout's own precedent of always shipping the baseline
    provider first (Anthropic/Gemini OCR adapters are each their own future
    chunk, not attempted here).
    **Deliberately NOT in this chunk, so it carries zero runtime risk --
    nothing here is called by any existing code path yet:** wiring into
    `DeterministicTextExtractor`/the intake pipeline (when exactly OCR
    should fire as a fallback for an image-shaped or scanned-with-no-text-
    layer document); whether OCR needs its own, stricter consent distinct
    from the existing `AI_EXTRACTION` consent (a real, undecided question --
    raw image bytes leaving the server is a materially different act than
    text-only field extraction, and this needs its own deliberate answer,
    not an assumed one); a `resolveOcrAdapter`-style function in
    `apps/web/src/lib/ai.ts` (mirroring `resolveTestAdapter`) to actually
    build this adapter from an ACTIVE DB config; cost/budget accounting for
    OCR calls (its own ledger entry, or folded into the existing
    `ai_extraction_runs` table -- undecided); surfacing the four review-issue
    signals to an actual human reviewer (UI work, not started); Anthropic and
    Gemini OCR adapters; real live-credentialed verification against any
    provider's actual vision endpoint, structurally BLOCKED in this sandbox
    exactly like every other adapter this session (no real API key for any
    provider).
    17 new tests (`openai-ocr.test.ts`, mirroring `openai-extraction.test.ts`'s
    own coverage exactly, plus two OCR-specific cases: the base64-data-URI
    image content part is sent correctly, and an out-of-enum review-issue
    value from the model is filtered out rather than trusted). Full
    `@visastack/adapters` suite (233 passing, 2 pre-existing live-ClamAV
    skips), full `@visastack/services` suite, repo-wide typecheck, and Biome
    all clean; `apps/web` untouched this chunk so its own production build
    was not re-run (its typecheck was, transitively, and passed).
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 15 (this update) -- OCR's own consent type now exists, resolving
    Chunk 14's own explicitly-flagged open question.** That question was put
    to the user rather than assumed: does OCR need its own consent, distinct
    from the existing `AI_EXTRACTION` consent? Reasoning mirrors Chunk 14's
    own architecture-fork writeup -- consenting to `AI_EXTRACTION` today
    authorizes sending a document's already-extracted TEXT off-server for
    field proposals; OCR instead sends the raw image BYTES of a
    scanned/photographed document off-server so a vision-capable model can
    read them, a materially larger disclosure than text alone. The user
    chose a new, distinct consent type.
    New `AI_OCR` added to `CONSENT_TYPES` (`packages/core/src/domain.ts`),
    positioned directly after `AI_EXTRACTION`, with a doc-comment addition
    explaining the distinction above -- following the exact precedent
    `ISSUER_CONTACT`'s own comment already set for adding a narrowly-scoped
    new consent purpose. Because `CONSENT_TYPES` is wired directly into a
    real Postgres enum (`packages/db/src/schema.ts`'s
    `pgEnum('consent_type', CONSENT_TYPES)`), this required a genuine
    additive migration, not just a TypeScript-level change -- generated via
    `drizzle-kit generate` rather than hand-written, the same tooling-first
    approach used for every schema change this session: migration `0077`
    (`ALTER TYPE "public"."consent_type" ADD VALUE 'AI_OCR' BEFORE
    'SHARING'`), mirroring migration `0074`'s identical
    `ai_extraction_run_status` addition of `IN_FLIGHT` from earlier in Part
    8.
    `packages/services/src/consent.ts` (`getConsents`, `hasConsent`,
    `setConsent`, `listConsentHistory`) and
    `packages/services/src/backup-reconciliation.ts`'s `forceConsentRevoked`
    needed zero code changes -- both were already fully generic over
    `ConsentType`, so `AI_OCR` is usable through them automatically. The
    applicant-facing consent-granting card (`apps/web/src/app/app/page.tsx`)
    is likewise already generic (it maps over `CONSENT_TYPES` and renders one
    row per type via the existing, fully-generic `ConsentButton`), so it
    gained a new row with zero structural change -- only its
    `CONSENT_MESSAGE_KEYS` lookup map needed the one new entry
    (`AI_OCR: 'consent.ocr.title'`). New bilingual message key added to
    `packages/i18n/src/messages.ts` (English "AI OCR consent"; Bangla "এআই
    ওসিআর সম্মতি", transliterating "OCR" the same way "AI" itself is already
    transliterated as "এআই" in this same catalog for the sibling
    `consent.ai.title` key -- there is no established single-word Bangla
    translation for "Optical Character Recognition" in this codebase to
    follow instead). The consent-history page
    (`apps/web/src/app/app/privacy/page.tsx`) needed its own separate
    `CONSENT_LABELS` map extended too (`AI_OCR: 'AI OCR'`), since it is a
    second, independent exhaustive `Record<ConsentType, string>` rather than
    a consumer of the i18n catalog.
    One real, non-cosmetic gap was found and closed while auditing every
    `AI_EXTRACTION` reference for a needed parallel: `deletion.ts`'s
    `OPTIONAL_PROCESSING_CONSENT_TYPES` (PRV-03, Part 7 §12 step 6 -- every
    currently-granted OPTIONAL consent is auto-revoked the moment an account
    deletion request is opened, not only incidentally once the account is
    finally removed after the grace window) had not yet been told about
    `AI_OCR`. Left as-is, a granted `AI_OCR` consent would have stayed
    silently active for the full 7-day grace window after a deletion
    request -- the exact gap this array exists to close for every other
    optional consent. Added `AI_OCR` to that array, and extended
    `lifecycle.test.ts`'s own PRV-03 test (which exhaustively iterates and
    asserts every optional-processing consent type) to grant, then assert
    the auto-revoke of, `AI_OCR` alongside the other four. Two call sites
    that reference `AI_EXTRACTION` specifically were confirmed genuinely out
    of scope for this chunk and deliberately left untouched: `ai.ts`'s own
    `runExtraction` consent gate (text-extraction's existing gate, unrelated
    to OCR, which is not wired into any live call site yet) and
    `applicant/[id]/documents/page.tsx`'s `hasConsent(..., 'AI_EXTRACTION')`
    read (gates existing text-extraction UI only).
    **Deliberately NOT in this chunk, matching Chunk 14's own "contract
    first, wire later" discipline:** actually consent-GATING any OCR call
    (there is still no live OCR call site to gate -- that is Chunk 14's own
    already-named deferred item, wiring OCR into
    `DeterministicTextExtractor`/the intake pipeline); every other item
    Chunk 14 already deferred remains deferred (a `resolveOcrAdapter`, OCR
    cost/budget accounting, review-issue surfacing to a human reviewer,
    Anthropic/Gemini OCR adapters, real live-credentialed verification).
    Verified: `drizzle-kit generate` produced (never hand-written) migration
    `0077` and its matching snapshot/journal entries; full `@visastack/core`,
    `@visastack/i18n`, and `@visastack/db` suites all clean (the last
    including its own "applies the migration and round-trips" and "rejects
    an invalid enum value at the database level" tests, directly exercising
    the new enum value end-to-end against real PGlite-backed Postgres); the
    targeted `@visastack/services` consent/deletion/erasure/
    backup-reconciliation tests and the full suite both clean; the full
    `apps/web` suite (195/195) and a clean production build both clean
    (`apps/web` genuinely touched this chunk, unlike Chunk 14); repo-wide
    typecheck and Biome both clean.
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 16 (this update) -- `resolveOcrAdapter` now exists
    (`apps/web/src/lib/ai.ts`), the OCR-specific analogue of
    `resolveAiExtractor`.** First re-examined `intake.ts`'s own automatic
    deterministic pipeline (`processIntake`) to decide where OCR should
    actually be invoked from, rather than assuming. That pipeline is
    heavily concurrency-hardened (lease fencing, CAS transitions across
    several Codex-review rounds) and runs unconditionally on every upload
    with zero consent-gating, since deterministic parsing is local and
    free. `runExtraction` (AI field-proposal extraction, `ai.ts`) is
    deliberately NOT part of that automatic pipeline -- it is a separate,
    explicitly-triggered, consent-gated, budget-tracked action a human
    initiates once a document already sits in AWAITING_REVIEW. OCR sends
    raw image bytes externally, an even larger disclosure than text-based
    field extraction, and reuses the identical admin-managed provider/
    budget/kill-switch apparatus `runExtraction` itself is gated by -- so
    consistency with that existing, already-approved precedent (not a new
    judgment call) puts OCR in the same category: a future explicit action
    mirroring `runExtraction`'s own shape, never folded into
    `processIntake`. This chunk does not modify `intake.ts` at all.
    `resolveOcrAdapter(db, encryption)` mirrors `resolveAiExtractor`'s
    "authoritative once touched" rule and reads the exact SAME ACTIVE
    `ai_provider_configs` row (no separate OCR configuration surface,
    per Chunk 14's own reuse decision), but has no env-var fallback branch
    at all -- OCR is Commercial-V1-native and was never env-var-configurable
    the way text extraction historically was, so an install with no config
    row simply has no OCR available (the manual-entry path is always the
    fallback, per directive §9). A new, separate
    `IMPLEMENTED_OCR_PROVIDERS` set (`{'openai'}` only, smaller than text
    extraction's three-provider set) means an ACTIVE Gemini or Anthropic
    config -- real for text extraction -- correctly yields no OCR adapter
    yet. Deliberately returns the bare `AiOcrPort` only, not `{ai, limits}`
    the way `resolveAiExtractor` does: OCR's own cost/budget accounting
    (its own ledger vs. folding into `ai_extraction_runs`) is still an open
    question from Chunk 14, so this function does not prejudge it by
    attaching a `limits` shape nothing yet enforces. 6 new tests in
    `ai.test.ts`, mirroring `resolveAiExtractor`'s own test shape (no
    config, ACTIVE config builds the adapter, kill-switch-engaged,
    unimplemented provider x2, no encryption port).
    **Still nothing calls this function** -- zero runtime risk, matching
    Chunk 14's own discipline. Deliberately deferred, tracked here and in
    `requirements-ledger.md` AI-05: the actual OCR execution flow (a
    `runOcr`-equivalent of `runExtraction`, itself consent-gated on
    `AI_OCR`, budget-tracked, audited, and fetching real image bytes from
    storage); the OCR-triggering UI (a button once a document reaches
    AWAITING_REVIEW with an OCR-eligible failure code); OCR cost/budget
    accounting; review-issue surfacing to a human reviewer; Anthropic/
    Gemini OCR adapters; real live-credentialed verification.
    Verified: full `apps/web` suite (201/201), repo-wide typecheck, Biome,
    and a clean production build all clean; `packages/services` untouched
    this chunk.
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 17 (this update) -- a new `ocr_runs` table, resolving Chunk
    14's own explicitly-flagged "own ledger vs. fold into
    `ai_extraction_runs`" question.** Examined both existing candidate
    tables before deciding, rather than picking either arbitrarily.
    `extraction_runs` (deterministic parsing) has the right OUTPUT shape
    (`extractedText`) but its `processingRunId` foreign key ties it
    one-to-one to a single automatic-pipeline pass (`processingRuns`) --
    OCR is a later, separate, explicitly-triggered action (per Chunk 16's
    own reasoning), not part of that pipeline run, so reusing this table
    would mean fabricating a synthetic `processingRuns` row purely to
    satisfy a foreign key that was never meant to describe a manual
    action. `ai_extraction_runs` (field-proposal AI calls) has the right
    USAGE-TRACKING shape (`costUnits`/`provider`/`latencyMs`/`cacheKey`)
    but its cache key is composed from `parserVersion`/`schemaVersion`/
    `reasoningEffort`, none of which apply to OCR
    (`AiOcrCacheKeyComponents` is just `{model, promptVersion}`), and it
    has nowhere to store the extracted text or the four review-issue
    signals directive §9 names. Neither table fits without stretching its
    own meaning, so a new table is the union of what OCR actually needs:
    `ai_extraction_runs`'s own usage-tracking columns plus
    `extraction_runs`'s own text-output shape, plus a `reviewIssues`
    column. This was a technical-fit determination, not a subjective
    product tradeoff, so it did not need to go back to the user the way
    Chunk 14's own architecture fork did.
    New `packages/db/src/schema.ts` `ocrRuns` table and `ocr_run_status`
    enum (`IN_FLIGHT`/`SUCCEEDED`/`FAILED`, identical shape to
    `ai_extraction_run_status`), migration `0078`
    (`drizzle-kit generate`-produced, matching every prior schema chunk's
    own tooling-first discipline). `applicantId` is denormalized onto the
    table for the identical reason `ai_extraction_runs` already carries
    it -- audit/reporting queries that would otherwise need a join through
    documentVersions -> documents -> applicantId every time.
    **Deliberately NOT in this chunk, so it carries zero runtime risk --
    nothing writes to this table yet:** the actual `runOcr` service
    function (a `runExtraction`-equivalent: consent-gated on `AI_OCR`,
    budget-tracked, fetching real image bytes from storage, calling
    `resolveOcrAdapter`, persisting the result here); its triggering UI;
    OCR's own budget-limit knobs (whether it shares `runExtraction`'s
    existing per-document/platform budget or gets its own, still open);
    review-issue surfacing to a human reviewer; Anthropic/Gemini OCR
    adapters.
    Verified: `drizzle-kit generate` produced (never hand-written)
    migration `0078` and its matching snapshot/journal entries; full
    `@visastack/db` suite clean (including its own "applies the migration
    and round-trips" and "rejects an invalid enum value at the database
    level" tests, directly exercising the new table/enum against real
    PGlite-backed Postgres); repo-wide typecheck and Biome both clean;
    `packages/services` and `apps/web` untouched this chunk, so neither's
    own suite/build was re-run.
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 18 (this update) -- `renderOcrSourceImage`, the bytes-preparation
    step between a document version and the image bytes `AiOcrPort` needs.**
    Started scoping the actual `runOcr` execution flow (the last major piece
    before OCR is genuinely wired live) and found a real gap before writing
    any budget/consent logic: `AiOcrInput` requires `image/png`/`image/jpeg`
    bytes, but a document version can be a scanned PDF, a photographed JPEG,
    or anything else the vault accepts -- nothing yet turned the former into
    the latter. Rather than write new PDF-rasterization code, found and
    reused `PreviewRendererPort` (`packages/adapters/src/preview-renderer.ts`,
    built for EVI-02/EVI-06 document previews): it already rasterizes a
    scanned PDF's page 1 to PNG via `unpdf`/`@napi-rs/canvas` (the same
    pdfjs renderer Firefox ships) and already re-encodes a raw PNG/JPEG
    upload by decode-and-redraw, stripping EXIF/ICC metadata and any
    polyglot-appended bytes -- exactly the "active content stripped"
    guarantee OCR independently wants (never sending a provider more than
    the visible pixels). Reusing already-shipped, already-security-reviewed
    infrastructure here is safer than inventing a second rasterization path.
    New `renderOcrSourceImage(db, blobStore, previewRenderer,
    documentVersionId)` (`packages/services/src/ocr.ts`, alongside the
    existing `AiOcrPort` contract): loads the document version's storage
    object, fetches its bytes via `BlobStore.getObject`, renders via
    `PreviewRendererPort.render`, and returns either the clean PNG/JPEG
    bytes or one of five explicit failure codes
    (`document_version_not_found`/`storage_object_missing`/
    `object_bytes_missing`/`unsupported_format`/`render_failed`) -- the last
    a defensive guard against the renderer's own "always PNG" contract
    silently changing, never trusted blindly. Only page 1 of a multi-page
    scanned PDF, matching the renderer's own existing "preview thumbnail"
    scope; multi-page OCR remains a separate, larger, still-open gap.
    A real product decision was resolved before this chunk, put to the user
    rather than assumed: does OCR spend count against the same platform-wide
    AI Gateway budget cap as text extraction, or get its own? Both draw on
    the same admin-configured provider/API key in reality (one bill), and
    the directive's own language frames "a durable platform-wide cost
    budget" as one concept, not per-task ones -- but an admin could
    reasonably want OCR usage walled off from a cap sized for text
    extraction alone, so this was not assumed either way. **User chose a
    shared cap.** This chunk does not yet implement that budget check (still
    deferred to the `runOcr` function itself); recorded here so the decision
    is not silently re-litigated or forgotten when that function is written.
    6 new tests (`ocr.test.ts`, the first test file for this module),
    covering every failure code plus both success shapes (scanned PDF,
    direct JPEG upload), using a real PGlite-backed document version and
    fake `BlobStore`/`PreviewRendererPort` implementations.
    **Deliberately NOT in this chunk, so it carries zero runtime risk --
    nothing calls this function outside its own tests yet:** the actual
    `runOcr` service function (consent-gated on `AI_OCR`, enforcing the
    now-decided shared budget cap across both `ai_extraction_runs` and
    `ocr_runs`, calling `resolveOcrAdapter` + this new function, persisting
    into `ocr_runs`); its triggering UI; review-issue surfacing to a human
    reviewer; Anthropic/Gemini OCR adapters.
    Verified: full `@visastack/services` suite clean; repo-wide typecheck
    and Biome clean; `packages/adapters`/`apps/web` untouched this chunk.
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 19 (this update) -- the platform-wide AI Gateway budget/
    concurrency ledger is now genuinely shared between text extraction and
    OCR, implementing the decision Chunk 18 recorded but did not yet
    enforce.** Scoped narrowly on purpose: generalizes the six shared
    accounting helpers in `packages/services/src/ai.ts` to read across BOTH
    `ai_extraction_runs` and `ocr_runs`, but does not yet build the actual
    `runOcr` execution function that would write to `ocr_runs` for the
    first time -- that remains the next chunk, now with a correctly-shared
    foundation already in place to build on rather than retrofit later.
    Went through each of the six helpers individually rather than applying
    one blanket rule, since "shared" does not mean the same thing for every
    one of them:
    - `totalAiCostUnits`/`documentAiCostUnits` (platform-wide and
      per-document spend) -- summed across both tables. This is the literal
      decision the user made: both bill through the same admin-configured
      provider/API key in reality, one bill, so "spend" means combined
      spend. The admin dashboard's own spend meter
      (`apps/web/src/app/app/admin/page.tsx`) calls `totalAiCostUnits`
      directly, so it now shows true combined spend automatically, with no
      separate change needed there.
    - `countInFlightCalls`/`countInFlightCallsForDocument` (platform-wide
      and per-document concurrency) -- counted across both tables. A
      provider-side concurrent-request limit is a property of the ACCOUNT
      making the calls, not of which AI Gateway task each individual call
      happens to be for, so this follows the same reasoning as the spend
      caps even though the user was not separately asked about it.
    - `maxObservedCostUnits` (worst-case per-call reservation) -- takes the
      MAX across both tables. OCR and text-extraction calls can genuinely
      cost different amounts (image tokens vs. text tokens); using the
      higher of the two observed maximums stays conservative for either
      kind of in-flight call, never an under-estimate.
    - `releaseStaleInFlightCalls` (self-healing abandoned reservations) --
      releases stale rows in both tables, for the same reason as the
      concurrency counts: an abandoned OCR reservation would otherwise
      occupy a shared concurrency slot exactly as permanently as a stale
      text-extraction one.
    - `countAiExtractionAttempts` (per-document attempt limit) --
      deliberately left `ai_extraction_runs`-only, the one helper NOT
      generalized. An attempt limit bounds retries of a SPECIFIC task on a
      document, not overall spend; sharing it would wrongly block a
      document's first-ever OCR attempt just because text extraction had
      already exhausted its own attempt budget on that same document --
      two genuinely different actions a caller invokes separately, unlike
      spend and concurrency which are properties of the shared provider
      relationship itself.
    - The cache-hit lookup (a separate mechanism entirely, keyed by
      `ai_extraction_runs.cacheKey`) was already untouched by any of this
      and stays that way -- OCR's own future cache lookup will query
      `ocr_runs` on its own terms, since the two cache keys have
      structurally different components.
    Verified this is a genuine no-op for existing behavior, not just
    "should be": ran `ai.test.ts`'s full existing 32-test suite completely
    UNCHANGED before writing any new test, and it passed 100% -- proof the
    refactor doesn't alter `runExtraction`'s behavior while `ocr_runs`
    stays empty (today's reality, since nothing writes to it yet). Then
    added 3 new tests proving the union genuinely works: `totalAiCostUnits`
    and `documentAiCostUnits` correctly sum a directly-seeded `ocr_runs`
    row alongside real `ai_extraction_runs` spend (including a
    tenant-isolation-style check that a DIFFERENT document's OCR spend
    never leaks into another document's own total); and a third test that
    incidentally proves `maxObservedCostUnits`'s own union behavior too --
    a real text-extraction call only succeeded once its budget had
    headroom for a worst-case RESERVATION based on the seeded OCR row's
    own (higher) historical cost, not just the raw spend total, which is
    exactly the conservative-reservation behavior intended.
    Full `@visastack/services` suite, repo-wide typecheck, and Biome all
    clean; `packages/adapters`/`apps/web` untouched this chunk.
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 20 (this update) -- `runOcr` itself now exists: the actual OCR
    execution function, the last piece named in this row's own remaining
    scope besides the UI and the Anthropic/Gemini adapters.** Lives in
    `packages/services/src/ai.ts` alongside `runExtraction`, not in
    `ocr.ts`, so it can call the six shared budget/concurrency helpers
    Chunk 19 generalized directly, without needing to export them past this
    file's own boundary. Consent-gated on `AI_OCR` (proven distinct from
    `AI_EXTRACTION` by a dedicated test: holding only the latter still
    refuses). Same three-phase reserve/call/reconcile structure as
    `runExtraction`, reusing the identical fixed platform-wide and
    document-derived advisory lock keys -- an OCR call and an extraction
    call on the same document, or platform-wide, genuinely serialize
    against each other's reservation step, required for the shared budget
    to be race-safe rather than merely summed correctly after the fact.
    `imageBytes`/`contentType` are caller-supplied inputs (mirroring
    `RunExtractionInput.text`, likewise caller-computed), not rendered
    inside this function -- the caller runs `renderOcrSourceImage` first,
    keeping `runOcr` itself pure DB-plus-adapter logic.
    Deliberately simpler than `runExtraction` in two ways that are scope
    decisions, not oversights: no `maxPagesPerDocument` check, since
    `renderOcrSourceImage` already bounds every call to page 1 by
    construction (a page-count reservation would be checking a number that
    can only ever be 1); and no field-proposal/evidence step, since OCR's
    whole output IS the `ocr_runs` row (extracted text plus review issues)
    -- a later, separate step would run `runExtraction` over that text for
    field proposals, reusing it unchanged.
    OCR gets its own cache, closing a design question `ocr_runs.cache_key`'s
    own column comment already committed to at Chunk 17
    (`sha256(contentHash|model|promptVersion)`) but nothing had implemented
    yet. `contentHash` is a hash of the actual rendered image bytes about to
    be sent (computed fresh by `runOcr`), a deliberate choice over the
    tempting shortcut of reusing `document_versions.sha256` -- that column
    is caller-optional and can be null, while the rendered bytes handed to
    this function are always present. Proven with two tests: an identical
    second call is served from cache (adapter never invoked again, cost
    zero) and a genuinely different image never collides (billed again).
    OCR also gets its own attempt counter, `countOcrAttempts` -- deliberately
    NOT shared with `countAiExtractionAttempts`, the identical reasoning
    Chunk 19 already gave for why the shared ledger stops at spend and
    concurrency and does not extend to attempts: two different actions a
    caller invokes separately, each bounding its own retries.
    Two small ripples outside `ai.ts`, both required for the run to be
    fully observable, not just persisted: a new `AI_OCR_RUN` product-event
    type (`product-events.ts`'s `PRODUCT_EVENT_TYPES` -- a plain TS array,
    no migration needed) and its scorecard label in the admin page
    (`apps/web/src/app/app/admin/page.tsx`'s `SCORECARD_LABELS`, typed as
    `Record<ProductEventType, string>` so TypeScript itself would have
    refused to compile with the new type left unlabeled -- confirmed by
    the repo-wide typecheck passing only once the label was added). The
    three new audit event types (`AI_OCR_RUN`/`AI_OCR_FAILED`/
    `AI_OCR_CACHE_HIT`) needed no such change: `auditEvents.eventType` is
    free text, the same reason none of `runExtraction`'s own event names
    ever needed a migration either.
    A real nullability bug caught while writing this, not shipped: `provider`/
    `modelVersion`/`promptVersion` are NOT NULL on `ocr_runs` (unlike
    `ai_extraction_runs`, whose nullable `provider` exists only to cover
    historical pre-column rows `ocr_runs`, being new, has none of) -- a first
    draft of the FAILED-path update copied `runExtraction`'s own
    `outcome.provider ?? null` verbatim, which would have violated the NOT
    NULL constraint the instant a synthesized `disabled` outcome (no
    `provider` field at all) hit that path. Fixed to `outcome.provider ??
    'unknown'`, the same placeholder the IN_FLIGHT insert already uses,
    caught by deliberately re-checking each column's nullability against
    the sibling table rather than assuming the pattern would transfer
    unchanged.
    10 new tests in `ai.test.ts`'s new `runOcr` suite (consent distinction,
    persistence of text/review issues, failure recording, cache hit, cache
    miss on different bytes, the attempt counter, the kill switch, shared-
    budget exhaustion, authorization) alongside the pre-existing 35 (32
    original plus Chunk 19's own 3), all 45 passing together -- full
    `@visastack/services` suite (now 1063 tests) and full `apps/web` suite
    (201/201) both clean, repo-wide typecheck and Biome clean.
    Still deliberately deferred, unchanged from Chunk 14's original list:
    `runOcr`'s triggering UI; review-issue surfacing to a human reviewer;
    the Anthropic/Gemini OCR adapters.
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 21 (this update) -- `runOcr`'s triggering UI now exists, and
    review issues are shown, closing this row's entire originally-named
    scope except the Anthropic/Gemini OCR adapters.** New `runOcrAction`
    (`apps/web/src/app/app/applicant/[id]/actions.ts`), mirroring
    `runAiExtractionAction`'s own shape exactly: owner-authorization check,
    resolve the OCR adapter, run the operation, revalidate on success.
    Genuinely different in one place, not by oversight: `runOcr` takes
    already-rendered `imageBytes` as an input (like `runExtraction` takes
    already-extracted `text`), so the action calls `renderOcrSourceImage`
    itself first, using the same `createStorage`/`createPreviewRenderer`
    factories the existing preview route already uses -- no new bytes-prep
    code, only new wiring of pieces that already existed.
    Closed the design question `resolveOcrAdapter`'s own doc comment had
    flagged as "not yet decided" back at Chunk 14: since the shared-cap
    decision now exists and is implemented (Chunks 18-19), `resolveOcrAdapter`
    now returns `{ai, limits}` -- the identical shape `resolveAiExtractor`
    already returns, built from the identical `limitsFromConfig` machinery,
    so the two adapters can never resolve to different numbers for what is
    now one shared ledger. A new, cheap `isOcrConfigured(db)` gives the
    document page a display check with no KMS decrypt, mirroring
    `resolveOcrAdapter`'s own fail-closed provider logic exactly so the two
    can never disagree about availability.
    New `getLatestOcrRun` (`ai.ts`) mirrors `getLatestExtractedText`'s own
    shape (`intake.ts`) but returns the full row, not just text -- directive
    §9's literal requirement is to "show low quality; ambiguous date;
    unsupported script; missing text as review issues" alongside the
    extracted text, not the text alone.
    New UI: `RunOcrButton` (`ai-review.tsx`), gated identically to
    `RunAiExtractionButton` (core-processing consent for new processing,
    AI_OCR consent -- distinct from AI_EXTRACTION -- for the feature itself,
    a classification existing on the document, OCR genuinely configured);
    `OcrResultView` shows the most recent successful run's extracted text
    and a badge per review-issue code, with short human-readable labels for
    directive §9's own four named signals. The document page's existing
    AI-extraction consent banner gained a sibling for AI_OCR, wording its
    own larger-disclosure distinction explicitly rather than reusing the
    extraction banner's copy unchanged.
    A real scope boundary drawn deliberately, not from time pressure: no
    content-type ("is this actually a scanned image/PDF") auto-detection
    gates the button's visibility. `storage_objects` has no content-type
    column -- it lives only in blob-store object metadata, fetched via
    `BlobStore.getObject`, which returns the object's bytes alongside it, not
    a cheap headers-only read -- so detecting this for every document on a
    list page would mean fetching every document's bytes just to decide
    whether to show a button, a cost this chunk declined to add. The button
    shows whenever OCR is otherwise available; running it against a
    non-image document still works structurally (the renderer either
    produces a usable image or a honest `unsupported_format` refusal), it is
    simply not pre-filtered by file type. "Review-issue surfacing to a human
    reviewer" turned out, on rereading directive §9's literal text, to mean
    displaying the issues at all (done here), not a separate
    reviewer-role workflow -- no such role or queue is named anywhere in §9,
    so none was invented.
    No dedicated tests for `actions.ts`/`ai-review.tsx`/`page.tsx` (matches
    established precedent: zero of this codebase's `actions.ts` files have
    one, since they wrap `withSession`'s real WorkOS auth; `page.tsx` files
    are verified via typecheck/build, not unit tests, the same as every
    prior UI chunk this session). 2 new tests for `getLatestOcrRun`
    (`ai.test.ts`, services); `resolveOcrAdapter`'s existing 6 tests updated
    for its new `{ai, limits}` return shape, plus 4 new tests for
    `isOcrConfigured` (`apps/web/src/lib/ai.test.ts`). Full
    `@visastack/services` suite (1065 tests), full `apps/web` suite (205
    tests), repo-wide typecheck, Biome, and a clean production build all
    verified. Not verified in a live browser (sandbox limitation, same as
    every prior UI chunk this session).
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 22 (this update) -- the Anthropic and Gemini OCR adapters now
    exist, closing AI-05's entire originally-named scope.** New
    `packages/adapters/src/anthropic-ocr.ts`'s `AnthropicOcrAdapter` and
    `packages/adapters/src/gemini-ocr.ts`'s `GeminiOcrAdapter`, structurally
    parallel to `OpenAiOcrAdapter` and to each provider's own existing
    text-extraction adapter -- same endpoint, same structured-output
    mechanism, same timeout/error-classification shape -- but each sends a
    vision content part instead of text, since OCR has no
    deterministically-extracted text to send in the first place. Verified
    against live current documentation before writing either adapter, not
    assumed from the sibling text adapters' own shape: Anthropic's vision
    format (`https://platform.claude.com/docs/en/build-with-claude/vision`,
    a live fetch -- the legacy `docs.anthropic.com` host is blocked by this
    sandbox's egress policy, the same limitation the original text adapter
    already recorded) confirmed the `{type: "image", source: {type:
    "base64", media_type, data}}` content block, placed before the
    accompanying text block per the docs' own "images before text"
    guidance, coexisting in the same request as `tools`/`tool_choice`
    exactly as the text-only adapter already uses them. Gemini's vision
    format (`ai.google.dev` itself blocked, so verified via web search of
    its indexed content -- the same materially weaker verification the
    existing `GeminiExtractionAdapter` already flags for itself) confirmed
    `{inlineData: {mimeType, data}}` as an additional `part` alongside the
    text part; camelCase was chosen over an indexed snake_case variant for
    consistency with this exact request body's own already-established
    camelCase style (`generationConfig`, `responseMimeType`,
    `systemInstruction`), protobuf-JSON's documented canonical field
    naming, and because protobuf-JSON deserialization commonly accepts
    snake_case only as an input alias, never as the authoritative name.
    Both new adapters reuse the identical OCR system prompt and
    `OcrReviewIssueCode` set `OpenAiOcrAdapter` already established, so all
    three providers produce directive-comparable output for the same
    document. Wired into `buildOcrAdapterForConfig`/`IMPLEMENTED_OCR_PROVIDERS`
    (`apps/web/src/lib/ai.ts`), which now matches `IMPLEMENTED_PROVIDERS`'s
    own three-provider set exactly -- an ACTIVE config for any of the three
    directive-named providers now yields a working OCR adapter, not just
    OpenAI. Two of `resolveOcrAdapter`'s/`isOcrConfigured`'s own existing
    tests, written when only OpenAI was implemented, asserted `gemini`/
    `anthropic` configs yielded no OCR adapter -- now genuinely false, so
    both were updated to assert the opposite (an adapter IS built, with the
    right model in its cache-key components) rather than merely deleted,
    preserving the "does the implemented-provider set actually gate
    correctly" coverage with a real unimplemented-provider case
    (`mistral`) added in its place. 37 new tests across
    `anthropic-ocr.test.ts` (17) and `gemini-ocr.test.ts` (20), mirroring
    each provider's own existing text-adapter test suite combined with
    `openai-ocr.test.ts`'s own OCR-specific coverage (review-issue
    filtering, truncation, refusal). Full `@visastack/adapters` suite, full
    `apps/web` suite, repo-wide typecheck, Biome, and a clean production
    build all verified. Real live-credentialed verification against either
    provider's actual vision endpoint remains BLOCKED regardless of adapter
    completeness (no real API keys in this sandbox for any provider), the
    identical shape directive §14 itself anticipates for every adapter this
    session. **AI-05's entire originally-named scope (contract, OpenAI
    baseline, consent, resolver, ledger, budget sharing, execution,
    triggering UI, and now all three providers) is now code-complete --
    row moves to DONE**, matching AI-03's own identical final status (code-
    complete; only real-credential live verification remains, tracked as a
    standing BLOCKER rather than a code gap).
    Full detail: `requirements-ledger.md` AI-05.
    **Chunk 23 (2026-09-28, AI-06) -- multi-provider/multi-tenant data-boundary
    re-verified, closing this row.** Re-read `AnthropicExtractionAdapter.extract()`
    and `GeminiExtractionAdapter.extract()` in full against the exact boundary
    already proven for `OpenAiExtractionAdapter`: both construct their outbound
    request body using only `input.text` (Build Spec §6's own deterministically-
    extracted, size-capped text) and `input.allowedFieldKeys` --
    `input.documentVersionId`, the only other `AiExtractionInput` field, is never
    referenced in either adapter's request construction. The boundary is
    structural, not merely observed: `AiExtractionInput` itself carries no bytes
    field, so no code path through this port could send raw file bytes even by
    accident. `allowedFieldKeys` traced to its source (`runExtraction`,
    `schema.fieldDefinitions`) and confirmed genuinely platform-wide -- the table
    carries no account/org/tenant foreign key, only global canonical field-key
    metadata, so nothing tenant-specific enters the payload either. Both adapters
    already carry their own dedicated test asserting this exact boundary
    (`anthropic-extraction.test.ts`/`gemini-extraction.test.ts`, mirroring
    `openai-extraction.test.ts`'s own established "never raw file bytes" test),
    so the guarantee is CI-enforced going forward, not merely true today. No code
    change needed -- a genuine re-verification that found no gap.
    Full detail: `requirements-ledger.md` AI-06.
    **Chunk 24 (2026-09-28, AI-09) -- cross-provider fallback designation now
    exists (schema + admin config validation); execution/UI still to come.**
    Now genuinely actionable now that AI-03/AI-05/AI-06 are all DONE (all
    three providers exist for both extraction and OCR). Migration `0079`
    adds `fallbackEnabled`/`fallbackProviderConfigId` to `ai_provider_configs`
    and `triggeredByRunId` to both `ai_extraction_runs` and `ocr_runs`. A
    real architectural constraint shaped the design: `activateAiProviderConfig`
    already enforces a genuinely platform-wide single-winner ACTIVE invariant
    (queried with no provider filter), so a fallback target can never itself
    be the current ACTIVE row -- it is necessarily some other status, and
    eligibility is checked by content (data policy approved, key not
    revoked, a genuinely different provider) rather than by status.
    `activateAiProviderConfig` re-verifies this bar fresh at activation time,
    never trusting it permanently from whenever the fallback pointer was set.
    `rollbackAiProviderConfig` is deliberately NOT gated on fallback
    eligibility -- reasoned through, not overlooked: rollback's job is
    restoring a known-good PRIMARY fast during an incident, and a stale
    fallback pointer degrades safely at future dispatch-time re-check rather
    than ever risking dispatch to an ineligible provider, so gating rollback
    on it would only cost reliability for no safety benefit. Both new
    run-table columns are deliberately not real FK constraints (bare `uuid`,
    matching `servedFromCacheRunId`'s own established convention), and
    fallback is deliberately single-hop only, so no cycle detection is
    needed anywhere in this design. 9 new tests (`ai-provider-config.test.ts`).
    Full `@visastack/db` suite, full `@visastack/services` suite, repo-wide
    typecheck, and Biome all clean. Deliberately deferred, so this chunk
    carries zero runtime risk (nothing yet reads either new column): the
    actual fallback-triggering logic in `runExtraction`/`runOcr` (recoverable
    codes limited to directive §13's own literal `timeout`/`rate_limited`;
    "circuit breaker," the list's third named trigger, is deliberately not
    built this chunk since it is a materially separate, substantial feature
    not yet justified without real production traffic to tune it against);
    `resolveAiExtractor`/`resolveOcrAdapter` gaining fallback-adapter
    resolution; doubling the budget reservation when fallback is enabled
    (directive §11 lists "retries" and "configured fallback" as separate
    reservation line items); the admin UI for designating a fallback; and
    the document/review-page UI surfacing that a fallback actually fired
    (directive §13's own "visible in UI").
    **Chunk 25 (2026-09-28, AI-09) -- the fallback-triggering execution logic
    itself now exists in `runExtraction`/`runOcr`.** Both functions' phase 1
    (RESERVE) and phases 2-3 (CALL/RECONCILE) were factored into standalone
    functions so each can run a second time against a designated fallback
    adapter with zero duplicated logic -- every existing check (budget,
    per-document budget, page cap, cache lookup, attempt cap, concurrency
    cap) composes correctly for a fallback call for free. A genuine design
    insight: since the primary row is always fully reconciled before a
    fallback reservation ever begins, the two calls are sequential from the
    ledger's own perspective, never concurrent, so directive §11's "reserve
    against retries; configured fallback" is satisfied by honest sequential
    accounting through the same existing reservation math -- no separate
    doubled-reservation calculation was needed after all, closing Chunk 24's
    own open question. Fallback triggers on exactly the two directive-named
    recoverable codes, `timeout`/`rate_limited`; every other code (`refused`,
    `auth_failed`, `invalid_response`, `truncated`, `disabled`) deliberately
    never triggers it, satisfying both of directive §13's explicit rules in
    one gate: "do not retry" on auth/invalid-input/consent-denial, and never
    "shop for a desired answer" after a refusal. "Circuit breaker," §13's
    third named recoverable trigger, still has no implementation. A
    successful fallback run links back to the primary's row via
    `triggeredByRunId` (Chunk 24), and the returned summary reflects the
    fallback row while the primary stays in the ledger as a fully audited
    FAILED attempt. 12 new tests in `ai.test.ts`. Full `@visastack/services`
    suite, repo-wide typecheck, and Biome all clean. Deliberately still
    deferred, so this chunk carries zero runtime risk (nothing yet populates
    the new `fallback` field): `resolveAiExtractor`/`resolveOcrAdapter`
    actually building and passing one; the admin UI for designating a
    fallback; and the document/review-page UI surfacing that one fired.
    Full detail: `requirements-ledger.md` AI-09.
    **Chunk 26 (2026-09-29, AI-09) -- fallback is now genuinely live end to
    end.** New `getAiProviderConfigForFallback` (unauthenticated, like
    `getActiveAiProviderConfig`, since it is a platform-internal read on
    behalf of an already-authorized request, never a SECURITY_ADMIN action
    in its own right -- kept separate from the actor-gated
    `getAiProviderConfigById` rather than loosening that gate).
    `resolveAiExtractor`/`resolveOcrAdapter` each gained a `resolveFallback*`
    helper that re-verifies the ACTIVE config's designated target LIVE at
    resolve time (different provider, data policy approved, key not
    revoked, an implemented adapter) -- never trusting the pointer as
    permanent from whenever activation first validated it, since the
    target's own key-revoked state can change afterward. `runAiExtractionAction`/
    `runOcrAction` now forward the resolved fallback straight into
    `runExtraction`/`runOcr`'s own input. The full chain -- admin designates
    a fallback, resolver re-verifies and builds it live, execution logic
    dispatches to it on a recoverable failure -- is genuinely wired end to
    end, modulo the admin UI to designate one through the browser (the
    service-layer validation already accepts it) and the review-page UI
    surfacing that one fired. 10 new tests. Full `@visastack/services`
    suite, full `apps/web` suite, repo-wide typecheck, a clean production
    build, and Biome all verified.
    **Chunk 27 (2026-09-29, AI-09) -- the admin UI for designating a
    fallback now exists.** `CreateDraftConfigForm` gained an "Enable
    cross-provider fallback" checkbox plus a dropdown populated from the
    FULL configuration history (every status, not just ACTIVE/DRAFT) --
    deliberate, since the platform's single-winner ACTIVE invariant means a
    fallback target is necessarily some other status, most naturally the
    config a new activation will one day supersede. The real eligibility
    gate stays entirely server-side at activation time (Chunk 24's own
    validation, unchanged); the form never duplicates it client-side. Each
    history card now shows a "Fallback" row naming the target's
    provider/model when enabled. No dedicated tests, matching this
    codebase's established precedent that none of its `actions.ts` files
    have one. Full `apps/web` suite, repo-wide typecheck, a clean
    production build, and Biome all verified.
    **Chunk 28 (2026-09-29, AI-09) -- OCR's review page now shows when a
    fallback fired, closing §13's "visible in UI" for OCR.** `OcrResultView`
    gained a `usedFallback` prop rendered as a "Fallback provider used"
    badge; `documents/page.tsx` passes `latestRun.triggeredByRunId !==
    null` straight through -- zero new queries, since the already-fetched
    run row already carries that column. Deliberately scoped to OCR only:
    its review surface already fetches the full run row it displays, so
    this was free; extraction's UI is proposal-centric with no existing
    per-run fetch to thread through, so the identical indicator there needs
    a genuinely new run-lookup query, left as its own smaller follow-up
    rather than rushed in. No dedicated tests, matching established
    precedent for `ai-review.tsx`/`page.tsx`. Full `apps/web` suite,
    repo-wide typecheck, a clean production build, and Biome all verified.
    **Chunk 29 (2026-09-29, AI-01) -- document type suggestion, item 2 of
    Part 8 §2's five required P0 AI tasks (corrected cross-reference: the
    task list lives in §2, not §11 as the ledger previously cited).**
    Investigated per directive §1 first: `classification.ts`'s existing
    deterministic classifier (`classifyDocumentText`) already runs during
    intake and already triggers `buildProposedName`/`proposeDocumentName`
    (satisfying item 3, "safe filename/name suggestion") whenever it reaches
    a confident result -- so this AI task exists ONLY to fill the gap when
    the deterministic system could not (`classifiedType === null` or
    `reviewRequired === true`), never to contradict or second-guess a
    confident deterministic result. New `ai_classification_runs`/
    `document_type_proposals` tables (migration `0080`) -- a deliberately
    SEPARATE table from `ai_extraction_runs`, matching `ocr_runs`'s own
    established precedent, specifically so the classification attempt limit
    (`countAiClassificationAttempts`) stays independent of the extraction
    one, the same reasoning that already justifies `countOcrAttempts`'s own
    separation. `documentClassifications` gained a `source`
    (`DETERMINISTIC`/`AI_APPROVED`) column so an AI-approved row is never
    confused with a deterministic one, for audit/provenance.

    New `AiClassifyPort` (`classify`/`classifyCacheKeyComponents`,
    deliberately NOT sharing `AiExtractionPort`'s own `cacheKeyComponents`
    name -- a single class implementing both could never return two
    different schema versions from one same-named, same-signature method).
    The THREE EXISTING extraction adapter classes
    (`OpenAiExtractionAdapter`/`AnthropicExtractionAdapter`/
    `GeminiExtractionAdapter`) now also `implements AiClassifyPort` --
    literally extending the canonical port/adapters per directive §1, no new
    adapter classes at all. `runClassification`/
    `approveDocumentTypeProposal`/`rejectDocumentTypeProposal` added to
    `ai.ts` (co-located with `runExtraction`/`runOcr` for the identical
    shared-budget-ledger reason that file's own doc comment already gives);
    `totalAiCostUnits`/`documentAiCostUnits`/`maxObservedCostUnits`/
    `countInFlightCalls`/`countInFlightCallsForDocument`/
    `releaseStaleInFlightCalls` all extended with a third arm so the
    platform-wide budget/concurrency ledger covers classification exactly
    the way it already covers extraction and OCR together. Approving a
    proposal reuses the EXACT SAME downstream effects the deterministic path
    already has (`documents.docType`, the naming-proposal trigger) --
    genuinely satisfying item 3 through reuse rather than a second naming
    implementation.

    `resolveAiClassifier` (`apps/web/src/lib/ai.ts`) reuses
    `buildAdapterForConfig` unchanged, its return type widened to
    `AiExtractionPort & AiClassifyPort` rather than duplicating an
    equivalent construction switch. No env-var-only fallback path (unlike
    `resolveAiExtractor`'s own `createAiExtractor()` branch) -- classification
    is a Commercial-V1-native capability with no legacy env-var-configurable
    predecessor to preserve behavior for. `runClassificationAction`/
    `decideClassificationProposalAction` added to `actions.ts`;
    `RunClassificationButton`/`DocumentTypeProposalReview` added to
    `ai-review.tsx`; `documents/page.tsx` shows the trigger/review UI only
    on a genuine deterministic gap with no proposal already pending. No
    cross-provider fallback wiring yet (Part 8 §13) -- deliberately
    deferred, matching AI-09's own precedent of shipping a task's core
    capability before its fallback wiring.

    Still deliberately unstarted at this point: AI-01 items 4 (possible
    inconsistency flag) and 5 (explanation of an already-determined
    deterministic readiness gap) -- both materially separate features, left
    for their own chunks. Full `packages/services` suite: 1101/1101 (13
    new). Full `packages/adapters` targeted suite: 67/67 (18 new). Full
    `apps/web` suite: 215/215 (`ai.test.ts` alone: 63/63, 8 new). Repo-wide
    typecheck, a clean production build (`/app/applicant/[id]/documents`
    route grew 2.56 kB -> 2.81 kB, reflecting the new UI), and Biome all
    verified.
    **Chunk 30 (2026-09-29, AI-01) -- explanation of an already-determined
    deterministic readiness gap, item 5 of Part 8 §2, the last of the four
    task types beyond plain extraction.** Reads `computeReadiness`'s own
    `RequirementResultSummary` (`missions.ts`) plus the underlying
    `packRequirements` row's citation -- never a second determination of
    readiness itself, which stays entirely deterministic; this task only
    ever explains a gap already decided. A new `AiExplainPort`
    (`explain`/`explainCacheKeyComponents`, again a deliberately
    non-colliding method name) -- the same three adapter classes now
    `implements AiExtractionPort, AiClassifyPort, AiExplainPort` on one
    instance, extending the canonical port a third time rather than a third
    parallel system. Scoped to exactly the two RUL-04 states meaning
    "requirement not met" (CRITICAL_GAP, ATTENTION), never
    CONFLICTING/EXPIRING_STALE/UNVERIFIED, which describe a different kind
    of problem outside this task's literal "a gap" wording.

    Genuinely different shape from items 2/3's own `ai_classification_runs`:
    the new `ai_explanation_runs` table has NO applicant/document scoping at
    all -- the input sent to the model (a pack requirement's kind, RUL-04
    state, and citation) is pack-level policy content, identical for every
    mission that hits the same requirement in the same state, never an
    applicant's own document or profile data. That fact does double duty:
    no `AI_EXTRACTION` consent gate applies (there is no personal
    disclosure to consent to, confirmed by a test that calls the export
    with no consent grant in the database at all), and the cache key is
    content-based rather than document-based, so the SAME explanation is
    naturally reused across every mission/applicant hitting the identical
    requirement+state+citation combination -- a test seeds two DIFFERENT
    pack requirement rows with identical content and confirms the adapter
    is invoked only once. `totalAiCostUnits`/`maxObservedCostUnits`/
    `countInFlightCalls`/`releaseStaleInFlightCalls` extended with a fourth
    arm so explanation spend counts against the same shared platform-wide
    ledger every other AI Gateway task already shares; deliberately NOT
    extended into `documentAiCostUnits`/`countInFlightCallsForDocument`,
    since neither concept applies to a task with no document to scope
    against.

    `resolveAiExplainer` (`apps/web/src/lib/ai.ts`) reuses
    `buildAdapterForConfig` unchanged, its return type widened a second
    time to `AiExtractionPort & AiClassifyPort & AiExplainPort`.
    `explainReadinessGapAction` (mission `actions.ts`) never trusts a
    client-supplied state or citation -- it re-derives both from a fresh
    `computeReadiness` call plus the pack requirement's own row on every
    invocation, so the explanation is always grounded in the CURRENT,
    server-verified determination. A new `readiness-gap-explain.tsx`
    (`ExplainGapButton`) wired into the mission page's requirement-row loop,
    shown only for CRITICAL_GAP/ATTENTION rows, displaying the most recent
    explanation already on file (`getLatestExplanationForRequirement`) plus
    a button to generate or refresh one -- no approve/reject workflow,
    since an explanation is read-only advisory text with no consequential
    write of its own (directive's own "No: ... direct consequential DB
    writes by model").

    This closes out all five of Part 8 §2's required P0 AI tasks except
    item 4 (possible inconsistency flag), the one remaining unstarted task
    in AI-01. No cross-provider fallback wiring yet for explanation either
    (Part 8 §13) -- deliberately deferred, matching every other task's own
    precedent of shipping core capability before fallback wiring. Full
    `packages/services` suite: 1109/1109 (8 new). Full `packages/adapters`
    targeted suite: 82/82 (15 new -- adapter-level `explain()` parsing/
    error-mapping tests, not just the service-layer stub coverage). Full
    `apps/web` suite: 230/230 (`ai.test.ts` alone: 70/70, 7 new). Repo-wide
    typecheck, a clean production build (`/app/mission/[id]` route grew
    7.46 kB -> 7.65 kB, reflecting the new UI), and Biome all verified.
    **Chunk 31 (2026-09-29, AI-01) -- possible inconsistency flag, item 4 of
    Part 8 §2, the last remaining P0 AI Gateway task.** Compares one
    document's deterministically-extracted text against the applicant's OWN
    already-confirmed profile facts, looking for genuine apparent
    contradictions -- never a second document, never a re-determination of
    which side (document or profile) is actually correct; a returned flag
    is purely "a human should look," nothing more. A new `AiInconsistencyPort`
    (`checkConsistency`/`inconsistencyCacheKeyComponents`, again a
    deliberately non-colliding method name) -- the same three adapter
    classes now `implements AiExtractionPort, AiClassifyPort, AiExplainPort,
    AiInconsistencyPort` on one instance, extending the canonical port a
    fourth time rather than a fourth parallel system. New
    `ai_inconsistency_runs`/`document_inconsistency_flags` tables, mirroring
    `ai_classification_runs`/`document_type_proposals`'s own
    separate-table-per-task precedent (never a shared table with a
    discriminator column) so its own attempt counter
    (`countAiInconsistencyAttempts`) stays independent of every other
    task's.

    Consent-gated on `AI_EXTRACTION` (the same tier classification already
    uses -- reasoned as not a materially larger disclosure than sending
    document text alone, since the profile facts sent are the applicant's
    own, already on file) and document/applicant-scoped like classification
    -- genuinely different from item 5's explanation task, which has no
    consent gate and no document scoping at all. All 6 platform-wide ledger
    functions (`totalAiCostUnits`/`documentAiCostUnits`/
    `maxObservedCostUnits`/`releaseStaleInFlightCalls`/`countInFlightCalls`/
    `countInFlightCallsForDocument`) extended with a fifth arm, since this
    task -- unlike explanation -- is document-scoped and needs the
    per-document budget/concurrency machinery too.

    A new private `currentTrustedProfileFacts` helper (joins
    `facts`/`fieldDefinitions`/`factVersions`) sends only TRUSTED-status
    facts, and -- critically -- SENSITIVE/RESTRICTED field values are
    excluded by construction, not by an added filter: `factVersions.value`
    (the plaintext column) is structurally only ever populated for
    STANDARD-sensitivity rows in the first place, since a protected field's
    real value lives solely in `valueCiphertext` (packages/services/src/
    profile.ts's own existing encryption discipline) -- filtering on
    non-null `value` therefore excludes every protected field with no
    separate `fieldDefinitions.sensitivity` join needed at all. Proven, not
    just asserted: a dedicated test registers a RESTRICTED-sensitivity
    field, writes it via `editFact` with a real encryption port, and
    asserts both that it never appears in the adapter's received
    `profileFacts` input AND that the raw outbound request JSON never
    contains the secret plaintext value anywhere.

    The cache key breaks from every prior task's own content-hash-only
    convention: `computeInconsistencyCacheKey` folds in a hash of the
    profile-facts snapshot itself, alongside the usual content hash and
    adapter cache-key components, because the correct answer here genuinely
    depends on both inputs -- a result computed against now-corrected facts
    must never be silently re-served once the applicant fixes their
    profile. Proven by a dedicated test (`does NOT serve from cache once
    the profile facts have changed`) that edits a fact between two
    otherwise-identical calls and asserts the adapter's call count goes
    from 1 to 2, never staying at 1 the way every other task's own
    content-only cache key would. Output is a free-text `description` (plus
    numeric `confidence` and an optional `rationale`) rather than a rigid
    `factKey`/`documentValue`/`profileValue` structure -- a genuine
    inconsistency (e.g. a middle name appearing on a document but nowhere
    in the profile) does not always map cleanly onto any single canonical
    field, and forcing a rigid shape would either silently drop real
    findings or invite the model to invent a field mapping that does not
    exist.

    Purely advisory, matching item 5's own framing: `acknowledgeInconsistencyFlag`/
    `dismissInconsistencyFlag` (both routed through a shared private
    `decideInconsistencyFlag` helper) only ever update the flag's own
    `status`/`decidedByAccountId`/`decidedAt` columns -- neither ever
    writes to the Master Profile or the document, proven by a dedicated
    test asserting zero rows are touched in `schema.facts` after an
    acknowledge. `listPendingInconsistencyFlags` gives the applicant-scoped
    review queue, mirroring `listPendingDocumentTypeProposals`'s identical
    shape.

    `resolveAiInconsistencyChecker`/`isInconsistencyConfigured`
    (`apps/web/src/lib/ai.ts`) reuse `buildAdapterForConfig` unchanged, its
    return type widened a third time to `AiExtractionPort & AiClassifyPort
    & AiExplainPort & AiInconsistencyPort`. `runInconsistencyCheckAction`/
    `decideInconsistencyFlagAction` (applicant `actions.ts`) mirror
    `runClassificationAction`/`decideClassificationProposalAction`'s own
    shape exactly. New `RunInconsistencyCheckButton`/
    `InconsistencyFlagReview` (`ai-review.tsx`) wired into the documents
    page's per-document loop alongside the existing extraction/
    classification/OCR triggers, gated on the same `AI_EXTRACTION` consent
    (`data.aiGranted`) classification already uses.

    This closes out all five of Part 8 §2's required P0 AI tasks --
    AI-01 moves to DONE. No cross-provider fallback wiring yet for
    classification/explanation/inconsistency-check (Part 8 §13) --
    deliberately deferred, matching every other task's own precedent of
    shipping core capability before fallback wiring. Full
    `packages/services` suite: `ai.test.ts` alone 93/93 (13 new). Full
    `packages/adapters` targeted suite: 100/100 across the three provider
    test files (18 new -- adapter-level `checkConsistency()` parsing/
    refusal/truncation/auth/cache-key-collision-avoidance tests, not just
    service-layer stub coverage). Full `apps/web` suite: `ai.test.ts` alone
    77/77 (7 new). Repo-wide typecheck and Biome both verified clean; not
    verified in a live browser (sandbox limitation, same as every prior UI
    chunk this session).
    **Chunk 32 (2026-10-03, SEC-07) -- first real CI signal in days, and the
    two genuine defects it surfaced.** The multi-day GitHub Actions outage
    (jobs dying in ~2s with `runner_id: 0`) cleared; a one-time re-run of
    PR #157's CI got a real runner for the first time since 2026-09-28 and
    failed at "Audit production dependencies" (which also skipped lint,
    build, typecheck and test behind it). Two separate problems, both fixed:
    (1) A NEW advisory set (published after Part 1's clean audit) hit
    `undici` via `@vercel/blob`: GHSA-rfgv-xxqx-mfg5 (high), GHSA-3wwx-pv8p-q78v
    (moderate), GHSA-r53p-7pc4-xj5r (low), all fixed at undici >=6.28.1. The
    root `pnpm.overrides` floor (set to >=6.28.0 in Part 1) was raised to
    >=6.28.1 <7.0.0 (keeping the <7 ceiling: `@vercel/blob` declares
    `^6.23.0`); the lockfile diff is exactly undici 6.28.0 -> 6.29.0 and
    nothing else. `pnpm audit --prod`: 0 known vulnerabilities, reproduced
    failing before and passing after. (2) Unformatted `packages/db` files
    that CI's `pnpm run lint` (`biome check .`) would have rejected: the
    `0079`-`0082` drizzle snapshots, `_journal.json`, and `schema.ts`.
    Cause, stated plainly: earlier chunks ran Biome only on the touched
    services/adapters/web TypeScript files and never on `packages/db`'s
    generated JSON or `schema.ts`, and the outage was hiding the gap. Fixed
    with formatting only, proven not to change meaning (the four existing
    JSON files parse to identical objects versus HEAD; `schema.ts` differs by
    one expression collapsed onto one line). Standing rule going forward:
    after any `db:generate`, run Biome over `packages/db/migrations/meta` and
    `schema.ts`, and run repo-wide `biome check .` (what CI runs), not just
    touched files, before every push. Verified locally: repo-wide Biome 511
    files clean, typecheck 7/7, adapters 321 passed (2 pre-existing skips),
    db 29 passed (1 pre-existing skip), production build clean. Confirmed
    on real CI afterwards (run 37097787574, commit b58e4a5): audit, lint,
    build, typecheck and the full test suite all passed, and PR #157 was
    squash-merged to main as b6403df.
    **Chunk 33 (2026-10-03, SEC-02, Part 9 chunk 1) -- rate limits on the
    five unprotected flows, plus the prune they required.** A Part 9 audit
    claimed only 2 of the 7 flows the directive names (login/recovery,
    invitation, upload, sharing, export, AI) were rate-limited. Re-verified
    directly rather than trusted: exactly two call sites existed
    (`sharing.ts` grant creation, `agency.ts` evidence request). Now added,
    all in the service layer (the established pattern), keyed on the
    authenticated actor: organization invitations and client invitations
    (each also with a second, organization-wide bucket, the directive's
    "actor + org" dimensions), upload reservation, account export, agency
    bulk export (actor + organization), and all five AI Gateway tasks through
    ONE shared per-actor bucket so splitting abuse across tasks does not
    multiply the allowance. A new `checkRateLimits` checks buckets in order
    and short-circuits: a refused actor never touches the organization's
    shared bucket, so one abusive admin cannot drain the rest of their
    organization's allowance (proven by test, not assumed).

    Four things found while doing it, each fixed: (1) `rate_limit_buckets`
    had no pruning at all (its only delete was account erasure), tolerable
    with two low-volume limits but not with this many, so a
    `pruneExpiredRateLimitBuckets` and a daily `/api/jobs/process-rate-limit-prune`
    cron (24h retention against a 1h longest window) were added; no schema
    change, so no migration. (2) "Is this email registered?" was answerable
    at any speed, and a limit inside `createOrganizationInvitation` alone did
    not close it: the web action `addMemberAction` looked the account up
    FIRST, before any authorization or limit, then branched (registered:
    added immediately; unregistered: invitation). Even with the limit, once
    an actor's invitation bucket was spent a registered email would still be
    ADDED while an unregistered one was refused, so registration stayed
    answerable (just inverted). The branching now lives in a new service,
    `addMemberByEmail`, which authorizes, then limits, then looks up, with one
    shared allowance and exactly one unit per call whichever branch it takes;
    the action is a thin wrapper. A non-admin gets an identical refusal for a
    registered and an unregistered email, a limited admin gets an identical
    refusal for both and the registered account is NOT silently added, and an
    authorized admin under the limit still learns the outcome (they must know
    whether there is a link to share), now only at the limited rate and with
    an audited side effect. Residual, stated plainly: this bounds the oracle
    for authorized admins, it does not remove it; removing it would change
    the product (for example always handing back a link and creating
    membership only on acceptance), which is a product decision, not a
    hardening one. Related: the organization bucket is keyed on a
    caller-supplied id, so every limited path authorizes BEFORE charging it,
    or anyone could burn another organization's allowance (tested). A
    mutation check (look up before limiting) makes 2 of the 8 new
    `addMemberByEmail` tests fail. (3) The explanation task carried no actor,
    so `RunExplanationInput` now requires `actorAccountId` (its one
    production caller and ten test call sites were updated). (4) The two
    export routes would have reported a rate-limit refusal as
    `403 export failed`, sending users hunting for a permission problem that
    does not exist, so they now return 429. The refusal text uses a
    plain-language label ("invitation", "upload", "export", "AI") and never
    the internal action name, per Part 9 §1; existing callers keep their
    original message byte-for-byte. Authorization, consent and the cheap
    no-op refusals all run BEFORE the limit, so an unauthorized caller or a
    harmless repeat click neither learns anything from nor spends the
    allowance; the cross-provider fallback attempt inside one run is not
    counted a second time (all three proven).

    Test method worth recording: limits are proven by seeding a counter
    exactly at its limit (`rate-limit.test-support.ts`, seeding both the
    current and next window so a window-boundary straddle cannot flake)
    rather than looping hundreds of real calls through the in-memory
    database. A mutation check against the ORIGINAL `invitations.ts` showed
    4 of the 6 new tests failing as they should; the other 2 passed
    vacuously, so both were strengthened to assert the refusal itself.

    **Honestly NOT done, so SEC-02 stays IN_PROGRESS:** site-wide
    Content-Security-Policy is still missing (next Part 9 chunk); login and
    account recovery are hosted by WorkOS, so the app cannot rate-limit them,
    and WorkOS's own brute-force/bot protection settings are UNVERIFIED from
    this repo; no network/IP dimension exists for unauthenticated endpoints,
    deliberately, because a database write per unauthenticated request would
    itself be an amplification vector, so that belongs at the edge (Vercel
    Firewall rules), also unverified here; and every threshold is an
    UNMEASURED pilot default (nothing here is derived from observed
    traffic), to be tuned by Part 9's load work. One deployment note: the new
    cron needs `CRON_SECRET` (already required by the other fifteen) and
    brings `vercel.json` to 16 crons.

    Verified locally: 49 new tests (org invitations 6 plus 8 for
    `addMemberByEmail`, client invitations 5, uploads 5, account export 3,
    bulk export 4, rate-limit module 8, AI Gateway 10). The full
    `@visastack/services` suite was last run in full at 1163 tests across 60
    files, all passing (baseline 1122), BEFORE `addMemberByEmail` and its 8
    tests were added; that run was cut off by a tooling time limit at 47 of
    60 files with no failures, so the 13 unfinished files were run separately
    (13/13 passing, 103 tests) rather than calling the cut-off run green.
    Since then the four test files that touch the refactored invitation code
    were re-run (122/122 passing). Web suite 237/237, repo-wide Biome 513
    files clean, typecheck 7/7, production build clean with the new cron
    route in the manifest (rebuilt after the `addMemberAction` change), web
    suite re-run after it too.

    **Chunk 34 (2026-10-03, SEC-02, Part 9 chunk 2) -- site-wide
    Content-Security-Policy, the browser-security list checked item by item,
    and two defects the checking found.** `apps/web/next.config.mjs` had
    carried a comment promising a CSP "in Phase 6" and shipped none. Now
    every page response in a production build carries one, built per request
    in `apps/web/src/middleware.ts` (policy in `lib/csp.ts`): scripts run only
    with this request's nonce, plus scripts those nonced scripts load
    (`'strict-dynamic'`, which is how the Next runtime loads its chunks and
    which also makes `'self'` useless as a script source in current browsers,
    so a same-origin upload at `/api/blob/[key]` cannot be one); no
    `'unsafe-inline'` or `'unsafe-eval'` for script; everything else same
    origin or none; `frame-ancestors 'none'`; `form-action` limited to self,
    the canonical app origin and WorkOS (a step-up Server Action answers with
    a redirect to WorkOS, which Chromium also checks against `form-action`);
    violations posted to a new `/api/csp-report` that logs one line each, with
    no query string, no script sample (for a Next page that is a slice of the
    render payload, i.e. user data) and identifiers in the path templated out.
    Two optional env vars (`.env.example`): `CSP_MODE=report-only` serves the
    same policy without enforcing it, the rollback if a page is found blocked,
    and `CSP_FORM_ACTION_EXTRA` adds a WorkOS custom AuthKit domain. Applied in
    production builds only, since the dev server needs `'unsafe-eval'`.

    How it was built, and why it is shaped this way. A nonce only works if
    Next sees it on the REQUEST: Next reads it back out of the request's
    policy header and stamps it on the inline scripts it renders, so setting
    the header on the response alone would have left the app's own scripts
    blocked. The installed AuthKit builds its forwarded request headers from
    the request it is handed (`partitionAuthkitHeaders`), so the middleware
    wraps the unchanged `authkitMiddleware`, hands it a copy of the request
    that already carries the policy, and sets the policy on the response. That
    copy is built from the URL and headers with NO body: constructing it from
    the original request consumed the stream a Server Action still needs
    (proven, not assumed: building it the other way makes a test fail).
    Every page is dynamic today (the root layout reads the session, `next
    build` prerenders nothing, checked in the manifest), which a per-request
    nonce requires; a future statically generated page would ship a stale
    nonce and be blocked, noted in `lib/csp.ts`.

    The old matcher listed only the AuthKit routes, but the policy has to ride
    on `/trust` and the not-found page too, and `/trust` must stay AuthKit-free
    so a public page survives a WorkOS outage. So the matcher is now broad and
    `lib/authkit-paths.ts` keeps the AuthKit set exactly where it was. "Exactly"
    was tested against Next's own compilation of the ORIGINAL matcher
    (including the decoded-path retry and the `/_next/data`, `.json`/`.rsc`,
    trailing-slash and `/index` variants Next admits) over 2000+ generated
    paths, both directions; four mutations (drop a route, stop decoding,
    add `/trust`, ignore the `.rsc` stripping below) each fail it. Probing 33
    paths against the old and the new running servers is what found a gap the
    first version of that test could not: Next's adapter strips a trailing
    `.rsc` from the URL before the middleware sees it, so a segment-prefetch
    URL such as `/app.segments/x.segment.rsc` arrives as
    `/app.segments/x.segment`, which the first predicate no longer recognised
    (the old server redirected it to WorkOS, the new one answered 404). The
    predicate now accounts for that and the test feeds it the normalized URL
    the way Next does; after the fix the two servers agree on every probed
    path but one, `/app/%2e%2e/trust`, where the URL parser collapses the dot
    segment before the middleware sees it, so AuthKit no longer redirects what
    is a 404 either way. The predicate also covers a few doubly suffixed
    nonsense paths (`/status.json.rsc`) that the old matcher did not: more
    AuthKit, never less. No probed path reached a protected page without
    AuthKit, and `withAuth()` throws outside the middleware, so a miss would
    fail closed with a 500 rather than serve anything.

    Real-browser verification (Chromium 141, local production build, 27
    Playwright tests, 14 of which drive the browser): the app hydrates, a
    client-side navigation completes without a full page load, and a Server
    Action (the language switch) runs under the policy with no violation on
    `/`, `/status` and the not-found page; every inline script on
    a page carries the nonce from that page's own header, and the nonce differs
    per request; and each attack class is refused: parser-inserted markup
    carrying a script and an inline handler, an inline handler, a `javascript:`
    URL, `eval` and `new Function`, a request to a third-party origin, a
    third-party image, a form post to a third party, and a `<base>` tag.
    Two of my own first-draft browser tests were wrong, not the policy, and
    were rewritten rather than loosened: a script created through the DOM is
    trusted by `'strict-dynamic'` by design (the realistic attack is injected
    markup, which the parser inserts), and `eval` run inside the test
    driver's own call is exempt from the page's rule (it must run from a page
    script, on a timer). To show the spec detects a policy that is served but
    not enforced, the same build was run with `CSP_MODE=report-only`: 15 of
    the 27 tests fail (the header checks, the nonce checks and every
    enforcement check, which assert the browser's `disposition` is `enforce`,
    not merely that something was reported). The existing public specs
    (accessibility, responsive, keyboard, language switch, not-found) pass
    under the policy too, 8 of 8.

    Defects found by doing this. (1) The not-found page's `<Link href="/app">`
    prefetches `/app`, which answers a signed-out visitor with a redirect to
    WorkOS; the browser refuses to follow that off-site from a script request.
    That was already failing before the policy (a CORS failure, logged as
    "Failed to fetch RSC payload"); the policy turned it into a violation and,
    in Playwright, a request that never settles. The landing page and the nav
    already use a plain anchor for exactly this; the not-found page now does
    too. (2) The locale cookie carried no flags: now HttpOnly (nothing in the
    app reads `document.cookie`), SameSite=Lax, Secure in production. (3)
    Author-typed pack links were rendered as `<a href>` with no scheme check at
    all: a requirement's `sourceUrl`, and a route's `officialChannelUrl` (the
    "where to actually apply" button) and `officialReportingUrl` on the public
    trust page. React 19 and the new policy both stop a `javascript:` link from
    running, but a `data:`, `file:` or plain-text value still became a link.
    `packages/services/src/external-url.ts` (`isHttpUrl`, `safeHttpUrl`) now
    rejects anything but an absolute http(s) URL when a pack author saves one,
    and the pages refuse to link a stored value that is not one, which also
    covers rows saved before this check. The trust page's guard is covered by
    a render test (the first TSX test in the web app, hence the one-line
    `esbuild: { jsx: 'automatic' }` in `vitest.config.ts`); the mission page's
    one `sourceHref` is covered by the helper's tests and typecheck only.

    The directive's Part 9 section 6 list, checked item by item (evidence in
    parentheses; "verified" means read in source or exercised, not assumed):
    HTTPS enforcement (HSTS `max-age=63072000; includeSubDomains; preload`
    served on every page, asserted by the browser-security spec; the redirect
    from http itself is Vercel's edge and unverified here). Secure/HttpOnly/
    SameSite cookies (the WorkOS session and PKCE cookies: read in AuthKit's
    `cookie.js`, HttpOnly always, SameSite Lax unless overridden, Secure when
    the redirect URI is https or unset; the locale cookie: fixed above and
    tested). CSRF/origin controls for mutations (every mutation is a Server
    Action except one signed webhook; Next compares the request's `Origin` to
    its host and aborts on mismatch, read in `action-handler.js`, and
    `serverActions.allowedOrigins` is not set, so it is same-origin only; a
    request with NO `Origin` header is not rejected by that check, so the
    protection for such a request is the SameSite=Lax session cookie). Redirect
    allowlist (`/api/session-reauth` accepts only a same-origin relative
    `returnTo`, already unit-tested, and AuthKit's callback takes only the
    pathname and query from `returnTo` and always keeps its own host, read in
    `authkit-callback-route.js`). CSP and frame restrictions (this chunk, plus
    `X-Frame-Options: DENY`). Referrer-Policy, permissions policy, nosniff
    (already served; now asserted per page by the browser-security spec).
    No-store for protected pages (AuthKit's middleware sets `Cache-Control:
    no-store` and `Vary: Cookie` whenever a request carries a session, read in
    `applyCacheSecurityHeaders`; unauthenticated dynamic pages get Next's
    `private, no-cache, no-store`, observed on `/status`) and bytes (all seven
    routes that serve a file set `private, no-store` themselves: blob, both
    exports, the large-export download, the pack manifest, the appointment
    calendar file and the case snapshot download, read in source; only the
    blob route's is asserted by its own test). No PII in query strings
    (every query parameter the app builds was enumerated: `reauth`, `maxAge`,
    `returnTo` as a relative path, `tab`, `format`, `preview_error`,
    `date_error`, `auth_error`, and the signed-blob parameters; none is an
    email, name or document number. The one secret-bearing parameter is the
    invitation `token` in three emailed accept links: a bearer token in a URL
    is inherent to emailed links, mitigated by the Referrer-Policy, and the new
    report endpoint never logs a query string; its expiry and single-use
    behavior were built in Part 4 and not re-verified here). Sanitize
    filenames (stored object keys are `randomUUID()`, never a user name;
    download `Content-Disposition` is built by a tested sanitizer;
    `sanitizeNameComponent` cleans proposed names). Sanitize notes, AI output
    and pack content, no untrusted HTML (there is no `dangerouslySetInnerHTML`,
    `innerHTML` or `document.write` anywhere in `apps/web`, so React's escaping
    covers every one; pack links fixed above). No sensitive localStorage, no
    sensitive service-worker cache (no `localStorage`, `sessionStorage` or
    `serviceWorker` use anywhere in `apps/web`). No third-party session replay
    (no third-party script exists, and the policy now makes adding one fail
    closed).

    **Honestly NOT done or NOT verified, so SEC-02 stays IN_PROGRESS:**
    SIGNED-IN pages were not browser-verified under the policy. The sandbox has
    no WorkOS credentials or database, so `/app/**` cannot render here; the
    evidence for them is a static audit (no frame, object, media, canvas,
    `<style>`, `<script>` or font element in `apps/web`; no client-side
    `fetch`; three `<img>` elements, all for the organization logo, whose URL is
    minted against the canonical origin, which `img-src` and `form-action`
    therefore include; no CSS `url()`), plus the fact that every page shares
    the root layout, the Next runtime and the same header. The safety net is
    deliberate: `CSP_MODE=report-only` for a rollback, and the violation log.
    First thing to do after deploying: sign in on the preview, open a few
    pages and a form, and search the runtime log for `[csp-violation]`. The two
    `/app` redirect tests in `e2e/no-secret-auth.spec.ts` could not run in the
    sandbox (the browser cannot tunnel to `api.workos.com`; the 307 to WorkOS
    itself was confirmed with curl), so CI on the preview is their check, as it
    always was. On Vercel previews the toolbar's own script may still be
    refused (browsers that honor `'strict-dynamic'` ignore the host allowance
    Vercel documents for it); that costs the preview-comments overlay and
    nothing else, and `VERCEL_PREVIEW_FEEDBACK_ENABLED=0` removes it. A
    signed-in user whose session has expired and who clicks a `<Link>` into
    `/app` still gets the router's failed off-site fetch (sign-in completes by
    full navigation, as before), now also one violation line; Chrome reports
    the ORIGINAL same-origin URL as the blocked one for a blocked redirect, so
    that line looks odd (`connect-src`, blocked origin = the app itself).
    `style-src` keeps `'unsafe-inline'`, because React inline style attributes
    are used throughout and a nonce cannot cover an attribute; Trusted Types
    was not attempted; `upgrade-insecure-requests` was left out because HSTS
    and the edge redirect already cover it and it would break a plain-http
    local run. A WorkOS custom AuthKit domain is unknowable from here and must
    be added to `CSP_FORM_ACTION_EXTRA` if one is configured (it only matters
    for a form submitted before the page has hydrated). Login and recovery rate
    limiting, the missing network dimension and the unmeasured thresholds from
    Chunk 33 are unchanged.

    Verified locally: `apps/web` suite 402/402 across 26 files (237 before
    this chunk; new: policy builder 55, middleware 26, AuthKit path parity 28,
    report parsing 24, report endpoint 19, locale cookie 5, trust page render
    8). `@visastack/services` suite 1204/1204 across 61 files, run in full to
    completion this time (1171 before; new: external-url helper 29, pack URL
    validation 4). Mutation checks, each restored byte-for-byte afterwards: the
    middleware tests catch five (no policy on the request, hand AuthKit the
    original request, build the copy from the original request, keep the
    opposite header, no policy on the response); the path parity tests catch
    four; the report endpoint tests catch three (no body cap, no throttle, no
    content-type check) and the cookie tests one; the pack tests catch
    validation switched off, and the trust page tests catch the render guards
    switched off (7 of 8 fail). Repo-wide Biome 528 files clean, typecheck 7/7,
    production build clean (the build still prints the `unpdf` and three
    `@workos-inc/node` Edge Runtime warnings, which a clean CI build from
    before this chunk prints too). Local Playwright: 35/35 on the enforced
    build (browser security 27, public UX 8), and 37 of 39 with
    `no-secret-auth.spec.ts` added, the two failures being the `/app` redirect
    specs that need the sandbox to reach `api.workos.com`. A note for whoever
    reruns it here: this sandbox's Chromium 141 does not match the
    Playwright's expected build, so the run used a throwaway config pointing
    at `/opt/pw-browsers/chromium` with `--no-sandbox`; that file is not
    committed.
independently confirmed findings; the missing PRD file is tracked as Blocker 1 in
`assumptions-and-blockers.md` (now resolved) rather than here, since it blocked the
programme rather than being a product defect.
