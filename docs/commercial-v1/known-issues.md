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
independently confirmed findings; the missing PRD file is tracked as Blocker 1 in
`assumptions-and-blockers.md` (now resolved) rather than here, since it blocked the
programme rather than being a product defect.
