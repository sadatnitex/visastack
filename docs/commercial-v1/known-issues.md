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

    **Update to Chunk 34 (2026-10-05).** The "two `/app` redirect specs could only
    run in CI" caveat is now closed: after merge, the Playwright Deploy Smoke
    against the real Vercel preview of that change passed 40 of 40, which
    includes both redirect specs and all 27 browser-security tests. Signed-in
    pages are still NOT browser-verified under the policy.

    **Chunk 35 (2026-10-05, OPS-04, Part 9 chunk 3) -- analytics for the
    fourteen learning areas, privacy-limited by construction.** The directive's
    list of what the pilot must be able to learn was matched against the code.
    `product_events` already existed but carried nine funnel milestones and no
    label, measure or organization, so most areas could not be measured at all.
    The log now holds 19 more event types (28 in total) and the columns
    `organization_id`, `dimension` (one label from a closed list), `metric_value`
    (a non-negative whole number) and `dedupe_key` (migration `0083`). Where
    each area comes from:

    - Case stage: `MISSION_STAGE_CHANGED`, labelled with the state moved to.
    - Intake to ready: `MISSION_READY_REACHED`, seconds from case creation, the
      first arrival at `SUBMISSION_READY` or `READY_TO_EXPORT` only (a case that
      leaves and re-enters ready is not counted twice).
    - Evidence: `EVIDENCE_REQUESTED`, `EVIDENCE_RECEIVED`,
      `EVIDENCE_REWORK_REQUESTED` (labelled replacement, contradiction or
      proposed correction).
    - Overdue tasks: `TASK_OVERDUE`, once per task, however many times the
      deadline sweep revisits it.
    - Detected gaps: `READINESS_GAPS_DETECTED`, recorded when a prepared file is
      captured: the overall readiness state and the number of required items
      unmet, never which ones. This is a measure at capture time, not a
      continuous one.
    - Acknowledgement: `ACKNOWLEDGEMENT_RECORDED` (which of the three
      decisions) and `ACKNOWLEDGEMENT_INVALIDATED` (only when a live one was
      actually voided).
    - Source review: `SOURCE_REVIEWED` (version approved, source unreachable or
      restored, fee stale or confirmed).
    - AI decisions: `AI_PROPOSAL_ACCEPTED`, `_CORRECTED`, `_REJECTED`, labelled
      extraction, classification or inconsistency. A "correction" equal to the
      proposal counts as accepted.
    - Outcome: `OUTCOME_RECORDED`, the decision only.
    - Complaint resolution: `COMPLAINT_RESOLVED`, how it ended and seconds open.
    - Activation: `ACCOUNT_ACTIVATED`, defined as the account's first case
      (traveller or agency), once per account, seconds since sign-up.
    - Agency repeat use: derived, not a separate event: organizations whose
      cases were created in two or more distinct weeks in the last 90 days.
    - Plan usage: `PLAN_CHANGED` (activation, executed downgrade) and
      `PLAN_LIMIT_REACHED` (seats, invitations, cases per period, open cases,
      storage), at most one per organization, limit and UTC day, so it counts
      organizations hitting a cap, not clicks after being refused. This is not
      the usage meters.
    - Cash collection: `CASH_COLLECTED`, written when a payment is recorded
      against an invoice (currency and minor units), never when an invoice is
      issued, so it is cash, not invoiced revenue.

    **Privacy model.** The directive excludes passport numbers, file contents,
    refusal wording and medical narrative. That is enforced twice, not by
    convention: the recorder accepts a `dimension` only from the list its event
    type allows (a pattern for a currency code), and the database independently
    rejects any `dimension` that is not an UPPER_SNAKE token, so a sentence
    cannot be stored even through a coding mistake. A `metric_value` is a
    non-negative whole number. Identifiers are opaque UUIDs, cleared if the
    account or organization is deleted; a once-only event stores a SHA-256 of
    the event type and entity id, not the id. Tests for every hook assert that
    the stored row contains none of the surrounding wording (refusal text,
    reasons, names, document types, payment references, field values). Access:
    platform administrators see aggregates only (new "Learning areas" card on
    the admin page); an account sees its own rows in its account export (events
    with no account, such as cash and plan changes, belong to no person and are
    not in anyone's export). No new route and no client-side tracking exist.

    **Deployment order and tolerance.** Migration `0083` is pending, together
    with `0079` to `0082` from the earlier merged chunk; `db-migrate.yml` is
    manual and human-gated and has NOT been run. Until it runs, analytics never
    break anything: each event is written in a savepoint, so a failed write
    (including "column does not exist") is logged once per process and rolled
    back on its own while the business action commits; the admin card says it is
    waiting for a database update; and the account export falls back to the
    original four columns. Run the migration before relying on any figure.

    **Honestly NOT done or NOT verified.** Nothing was backfilled: figures start
    at the deploy, because history before it cannot be reconstructed. The
    aggregate queries and the admin card were exercised only against PGlite and a
    type-checked, built page, not rendered against the real Neon database or in
    a browser. No retention window is defined for the log (it holds no PII, but a
    policy is a product decision). The thresholds that would make any figure
    "good" or "bad" are not set; the card reports, it does not judge. Definitions
    above (activation, ready, gaps at capture, cash vs invoiced) are the ones
    chosen here and should be confirmed by the product owner before targets are
    set on them. One guard is not independently testable: the check that only a
    resolved or closed complaint records an ending is masked by the allowed-label
    list, so removing it changes nothing observable (the second guard catches it).

    **Production incident found while building this (2026-10-05), and its
    fix.** `/app/admin` returned the generic error page for a platform admin.
    The runtime log (reference 2154584171) showed `relation "ocr_runs" does not
    exist` from the AI cost total. Migration `0078` creates that table; the last
    manual migration run before this was 2026-09-27, so `0078` to `0082` had
    never been applied to production although their code was deployed. With the
    product owner's explicit go-ahead, `db-migrate.yml` was run on `main` at
    `3ee7e76` (run 37286912852, every step green). Migration `0083` is NOT in
    that run (it is not merged yet) and needs another run after this change
    merges. Separately, the admin page no longer fails as a whole when one
    section cannot be read: each data read is wrapped, the section shows empty,
    and a banner names the sections that could not load (permission checks are
    deliberately not wrapped and still fail closed). That is a safety net, not a
    substitute for running migrations before relying on the page.

    Verified locally: `@visastack/services` 1289/1289 across 61 files (1204
    before; 85 new, in the test file of each module that records an event, plus
    export); `apps/web` 411/411 across 28 files (402 before; admin formatting
    helpers 5, tolerant-read helper 4). Mutation checks, each restored
    byte-for-byte: case creation and stage, ready-once, gap count and activation
    label (5 caught); outcome hook removed (caught); acknowledgement hook and
    invalidation guard (caught); evidence hooks (3); overdue once-only and gate
    (2); source review labels (3); complaint ending and metric (2 caught, 1
    equivalent mutant, described above); cash currency and amount (2); plan
    change account and label (2); plan limit label and once-per-day key (3); AI
    corrected-versus-accepted, inconsistency verdict, classification and
    extraction labels (5); export fallback (1). Two mutations survived at
    first and each exposed a weak test, which was tightened and re-run: a
    currency normalisation the fixtures never exercised, and an accept/reject
    swap on inconsistency flags that a set comparison could not see (the
    classification test had the same weakness and was tightened with it). The
    third survivor is the equivalent mutant described above. Repo-wide Biome 531 files clean, typecheck 7/7, production
    build clean with the same `unpdf` and `@workos-inc/node` warnings as before.

    **Update to Chunk 35 (2026-10-05, later the same day).** Migration `0083` was
    applied to production with the owner's explicit go-ahead (manual migrate run
    37294656562, every step green), so the analytics columns exist and recording
    has started. Everything Chunk 35 says about a pending migration is now
    history, except that nothing before this moment was recorded and cannot be
    reconstructed.

    **Chunk 36 (2026-10-05, OPS-03, Part 9 chunk 4) -- operational signals,
    migration drift, and log hygiene.** The directive's monitoring list (Part 9
    section 7: sixteen metrics and alerts; Part 3 section 13: seven signals) was
    re-audited. Before this chunk two events were wired (`job_failure`,
    `abandoned_upload_cleaned`) and nothing could be read in one place. The full
    table, thresholds, log event names and the alert rules still to create are in
    `docs/operations/monitoring.md`. In short:

    - **Operational signals.** The platform-admin page shows 20 signals, each a
      status, a reading and an explanation, computed from tables the product
      already keeps and carrying no identifier or content: intake queue age, job
      failures, scanner availability (scans that reached no verdict), abandoned
      uploads the cleanup sweep should already have removed, object-storage
      failures and stuck deletions, notification backlog, email failure and
      bounce, denied-access spikes against the previous seven days, audit-log
      integrity over the newest 500 events, AI spend, deletion-job failures and
      database migrations. A signal whose own query fails is shown as unreadable;
      it never hides the others. Thresholds are unmeasured pilot defaults that only
      choose a colour.
    - **Honest gaps in the signals.** Availability, latency, error rate and
      connection pressure are platform metrics (Vercel, Neon) and are reported as
      "Not measured" with where to look. Database errors and render failures are
      log events, not counts. Scanner signature age is not exposed by the scanner
      port. The AI circuit breaker the directive lists does not exist in the AI
      gateway (the controls that do exist are the kill switch, the spend ceiling,
      the per-document attempt cap and the cross-provider fallback); it is
      reported as "Not built" beside the failure rate those controls react to.
      Nothing is shown green that is not measured.
    - **Readiness was wrong, and that caused a production outage.**
      `/api/health/ready` tested only that the `accounts` table existed, so it
      reported `ready` while migrations 0078 to 0082 had never been applied, and
      `/app/admin` failed with `relation "ocr_runs" does not exist`. Readiness now
      compares the migrations recorded in `drizzle.__drizzle_migrations` with the
      journal bundled into the running build (the migrator's own rule) and is
      `degraded` while any is pending. Consequence to know about: a deployment
      whose code ships a new migration reads `degraded` between the merge and the
      manual migrate run. That is the intended signal, not a fault.
    - **The public probe no longer leaks configuration.** On a pull request
      preview, a public URL that was classed as development, the readiness body
      listed which secrets were configured (`WORKOS_API_KEY`, `CRON_SECRET` and so
      on) and the provider detail, against the directive's "never expose secret
      presence". Every deployed build now returns the verdict, the deployment mode
      and the capability registry only; the breakdown is on the admin page and
      names missing configuration, never values. Local and test runs keep the
      developer breakdown.
    - **Logs no longer carry query values.** The database layer's error message
      ends with the bound parameters (`Failed query: ... params: <values>`), and
      about 40 server-side calls logged it whole, so a failed notification or
      session query could write an email address or a name into the log
      aggregator. They now go through one sanitiser: the error type, the database
      error code, the statement without its values, up to five call sites and a
      hashed subject reference, as a single `server_error` event; email addresses
      in a message are removed. The analytics recorder's own failure log uses the
      same redaction. Preview render failures, which were silent, now log a
      `render_failure` event carrying the content type only.

    **Honestly NOT done or NOT verified.** No alert is configured in Vercel, Neon
    or an uptime monitor: the rules are written in `monitoring.md`, not created, so
    today an operator learns of a problem by opening the admin page or the log. The
    migration check reads `drizzle.__drizzle_migrations`; it was tested against the
    test database with the real journal and with deleted rows, not against the
    production database, and if its query is refused there readiness reports the
    check as not run rather than failing. The audit-integrity check recomputes
    hashes from stored rows; a metadata value that does not survive storage the
    way it was hashed would warn without any tampering, which is why a hash
    mismatch with intact links is a warning and only a broken link is critical. The
    admin cards were tested against a test database and a built page, not rendered
    against production in a browser. Incident-owner coverage and the per-incident
    runbooks are Part 9 section 11, not this chunk.

    Verified locally: `@visastack/services` 1326/1326 across 64 files (1289 before; 37 new:
    operational signals 26, error sanitiser 8, log-line formatter 2, analytics
    failure redaction 1); `apps/web` 419/419 across 29 files (411 before; 8 new:
    readiness drift and public detail 4, error reporter and render failure 4);
    `@visastack/db` 34 passed and 1 skipped across 4 files (migration drift 5
    new); repo-wide Biome 546 files clean, typecheck 7/7, production build
    clean;
    `@visastack/adapters` 322 passed and 2 skipped across 22 files (console
    observability adapter 1 new). Mutation checks, each
    restored byte-for-byte: migration drift (the pending rule, the never-migrated
    case, swallowing other errors: 3 caught); operational signals (queue due-time
    filter, deletion held versus failed, audit link versus hash, AI failure
    status, email channel filter, email share arithmetic: 6 caught); error
    sanitiser (parameter cut, address removal, stack filter: 3 caught); readiness
    (drift gate, the unchecked case, public detail on a deployed preview: 3
    caught); analytics failure redaction (1 caught). One test failed in a full run
    and was my own: I edited the source it covers while that run was in progress,
    so it ran against the old file; it passed alone, the mutation check proved it
    bites, and the full run was repeated with no edits.

    **Chunk 37 (2026-10-05, UX-01/UX-02/UX-03, Part 9 chunk 5a) -- names, loading
    screens and phone layout.** The first of the visible-experience chunks. The
    directive asks for real navigation, complete critical states and critical
    journeys that work on a narrow phone; this chunk covers the names, the loading
    state and the phone layout. The Agency and Platform areas, Bangla and English
    for the nine flows, form-error association and upload resilience are the next
    chunks and are NOT done.

    - **Names.** The signed-in bar reads Overview, Applicants, Shared with me,
      Alerts, Privacy, Account; an applicant's tabs read Overview, Profile,
      Documents, Cases, Sharing, Evidence, Expiry, History. "Mission" is the stored
      entity's name; it no longer appears in anything a person reads (about forty
      strings in the web app, thirty-seven service error messages, one plan meter
      definition, and the name of the downloaded case snapshot file). Routes, stored
      data and the data-export file names keep the old name on purpose. Messages
      that quoted a stored consent code (`CORE_PROCESSING`, `SHARING`, and the
      others) now use the names the Privacy page shows, and the export download
      errors no longer mention an internal job state. Two tests guard this, and
      each was mutation-checked: one reads every `serviceError` message in
      `packages/services`, the other reads all visible text in `apps/web` with the
      TypeScript parser (JSX text, labels, messages; not identifiers, paths or
      comparisons).
    - **Loading screens.** Everything under `/app` now has a route-level loading
      screen, and each applicant tab has its own so the header and tabs stay put.
      It is an `<output>` (built-in role `status`), with decorative placeholder
      shapes hidden from assistive technology. Checked on a production build with a
      throwaway streaming route, under the real nonce-based Content-Security-Policy:
      the loading screen appears, the content replaces it, no policy violation, the
      accessibility tree reads `status: Loading…`. A redirect thrown inside a page
      still behaves as before because the layouts, which run first, make the same
      sign-in and pilot-access checks outside the loading boundary.
    - **Phone layout: defects found by measuring, not by reading.** Against the real
      stylesheet and a fixture of the signed-in building blocks: (1) `.section` and
      `.hero` reset the side padding that `.container` sets, so every
      `section container` page, including all signed-in pages, ran edge to edge on
      any screen narrower than about 1024px; (2) the public header overflowed the
      screen at 360px and 320px and broke its sign-in button across two lines at
      390px (the existing 390px check passed with 4px to spare); (3) the signed-in
      bar could not fit six links and three buttons, so text overlapped, and at
      every width it stuck at the same offset as the public header and vanished
      behind it when scrolling; (4) long values (an email address, an identifier)
      pushed content off the card; (5) several controls were under 24 by 24 CSS
      pixels (checkboxes 16px, header links 21px, the language switch 17px, the
      banner link 19px); (6) cards lifted on tap; (7) fields under 16px make iOS
      Safari zoom the page; (8) sticky bars could cover a control that took focus.
      All fixed in `globals.css`. The signed-in bar and the public header now wrap
      and scroll away with the page below 900px and 640px; above that they stack.
    - **Permanent checks.** `ux-public.spec.ts` gains 24 cases that load the REAL
      stylesheet and public header from the deployment, put the signed-in building
      blocks in the page with the product's own class names and the labels from
      `lib/navigation.ts`, and check: no sideways scroll, a side margin, every
      navigation link and button on screen, every control at least 24 by 24 CSS
      pixels, the signed-in bar staying visible under the header while scrolling,
      focus not hidden behind the sticky bars, and axe contrast in light and dark
      mode, at 320, 360, 390 and 768 wide plus a 1440 scroll check. Against the
      previous stylesheet 19 of the 24 fail; with only `scroll-padding-top`
      removed the focus case fails (a control stays at 60px under bars that end at
      104px).

    Not verified, stated plainly: the signed-in screens themselves were not opened
    in a browser (no sign-in is possible here), so what was checked is the
    stylesheet against faithful building blocks, not the real pages; Chromium only,
    no real phone and no Safari; no manual keyboard or screen-reader pass; Bangla
    text was not laid out; the landing page copy still contains engineering phrases
    ("provider-agnostic ports", "fail-closed audit") that need a content review
    before public launch. Two of the 64 local smoke cases (the two `/app` redirect
    checks) cannot run here because following the redirect to WorkOS is blocked by
    the sandbox network; they run in CI.

    Verified locally: `@visastack/services` 1330/1330 across 65 files (1326 before;
    4 new); `apps/web` 438/438 across 32 files (419 before; 19 new: navigation 9,
    visible-text scanner 6, loading screen 4); `@visastack/db` 34 passed and 1
    skipped; `@visastack/adapters` 322 passed and 2 skipped; repo-wide Biome clean,
    typecheck 7/7, production build clean (the existing `unpdf` warning only).
    Playwright against the local production build: 62 of 64 pass. One test
    asserted the old consent code (`client-invitations.test.ts`) and was found only
    by the full run, not by searching; it now asserts the new wording.

    **Chunk 38 (2026-10-05, UX-01, Part 9 chunk 5b) -- the Agency and Platform
    areas as real sections.** Chunk 37 named the work; this one splits the two
    long pages the directive's navigation list could not be applied to.

    - **Agency console.** `/app/agency/[orgId]` was one 900-line page that read
      everything (every case with its notes, tasks, decisions and issuer
      confirmations, the roster, every invitation, every evidence request) on every
      visit. It is now a layout (header and section bar) and six pages: Dashboard
      (an at-a-glance card with four counts, the case inbox and search, the
      reassignment queue), Clients (client invitations, request evidence, evidence
      requests), Cases (one workspace per case), Team (members and invitations),
      Usage & billing (the existing plan page, trimmed to content) and Settings
      (review policy, branding, bulk export). Each page loads only its own data
      through `console-data.ts`, whose reads are the old page's, moved unchanged.
      Clients, Team and Settings are administrator work and are left out of the bar
      for a member who is not an administrator; each page still re-checks standing
      and the services still refuse anyone without it. Every agency action now
      refreshes the whole console (`revalidatePath(..., 'layout')`), not one page.
    - **Platform administration.** `/app/admin` was one 1,100-line page. It is now
      a section bar above each page, in the directive's order: Organizations,
      Rules (the pack studio), AI, Operations (the landing page: scorecard,
      signals, readiness detail, learning areas, commercial readiness, failed
      intake jobs, capacity), Privacy (retention policies, legal holds, erasure
      jobs, purge), Audit, then Access (platform roles, pilot sign-in, accounts
      awaiting an identity) and Complaints, which the directive does not name. The
      cards moved unchanged; each page reads only its own figures with the same
      tolerant reads that kept `/app/admin` up when a table was missing, and says
      so in a banner when one could not be read. AI and Complaints show only to an
      administrator who may use them.
    - **A defect fixed on the way.** A case in the agency inbox linked to
      `/app/mission/<id>`, the traveller's own case page, which only the applicant
      who owns the case can open, so an agency member who clicked got "not found".
      It now opens that case's workspace on the Cases tab. The same link style in
      the reassignment queue changed with it.
    - **Found by the new tests.** `nextApproachingDate` returned an internal sort
      field alongside the two it documents (harmless in the old page, wrong as a
      contract); it returns only `label` and `date` now. A two-letter tab ("AI") was
      16px wide, under the 24px target; section tabs now have a 24px minimum.
    - **Tests.** 124 new web tests: render tests for the Dashboard, Cases, Clients,
      Team, Settings, Operations, Organizations, Privacy, Audit and Access pages and
      both layouts (each page called as a function with mocked services, rendered to
      markup), loader tests for the console (the administrator-only reads are not
      even attempted for anyone else; arguments reach the services in the order they
      take them; results are assembled as the pages expect), navigation tests for
      the new tab sets, and tests for the tolerant reader. Mutation checks, each
      restored byte for byte: the administrator gate in a loader, in the Team,
      Clients and Operations pages; the member test; the readiness condition; the
      inbox link; the owner gate on the Access page; the complaints permission in
      the platform layout; the pages' data wiring in Privacy; the agency tab filter
      (11 caught). The browser checks in
      `ux-public.spec.ts` now also cover the two new bars (every tab reachable by
      scrolling on a phone, no sideways scroll on a desktop).

    Not verified, stated plainly: as in chunk 37, the signed-in pages were not
    opened in a browser, so the render tests use mocked services and the layout
    checks use the stylesheet against faithful building blocks; real data through
    the real pages is exercised only by the staging journey, which needs
    credentials and does not yet cover the agency (see the skipped steps in
    `authenticated-workspace.spec.ts`). The Cases section still shows every visible
    case on one page. `/app/admin#admin-...` anchors from before no longer exist
    (nothing in the repository linked to them except one back link, updated).

    Verified locally: `apps/web` 562/562 across 46 files (438 before; 124 new);
    services, db and adapters are untouched by this chunk (last full runs: 1330,
    34 plus 1 skipped, 322 plus 2 skipped); repo-wide Biome clean, typecheck 7/7,
    production build clean (the existing `unpdf` warning only), every new route
    answers a signed-out request with 307 to sign-in. Playwright against the local
    production build: 67 of 69 (the two `/app` redirect cases cannot follow the
    redirect to WorkOS from the sandbox; they run in CI).

    **Correction to chunk 38 (2026-10-05, found 25 minutes after it went live) -- section
    tabs were squeezed over each other on a phone.** Chunk 38 gave `.subnav a` a
    24px `min-width` so the two-letter "AI" tab met the target-size rule. An explicit
    `min-width` replaces the automatic minimum a flex item has, so on a screen too
    narrow for all the tabs each one shrank to 24px and its text spilled over the next:
    "Organizations" was 95px of text in a 24px box. This affected the applicant tabs a
    traveller uses and the agency and platform bars, at 320, 360 and 390px; wider
    screens were fine. The "every tab can be scrolled into view" check passed anyway,
    because squeezed tabs still sit inside the bar. Found by looking at a Bangla
    screenshot, not by a test. Fixed with `flex: none` (a tab keeps the width of its
    own text and the bar scrolls). A new check runs on the deploy smoke: no tab's text
    is wider than its box and no tab overlaps its neighbour. It fails against the
    chunk-38 stylesheet at 320, 360 and 390px (21 tabs squeezed at 320px) and passes
    with the fix. Lesson recorded: a layout
    check that asks "is it on screen" cannot catch text that overflows its own box.

    A second, older defect came out of the same screenshots: in dark mode the red
    "Request account deletion" button (and every `btn-danger`) was white text on
    `#ff6b5e`, a contrast of 2.79:1 against the 4.5:1 AA needs. The lighter red is right
    for red text on a dark page and wrong for a solid fill, the same two-role split
    `--accent-strong` already makes for blue. Solid red buttons now use a deeper red
    (`--danger-strong`, 5.46:1) in both colour schemes; the dark-mode axe check now
    includes a danger button and fails without the fix.

    **Chunk 39 (2026-10-05, owner instructions) -- plain words on the public pages, and
    Bangla deferred.** Two instructions from the owner shaped this chunk.

    - **Plain language.** "No engineering talk to the public unless it is really
      needed." The public home page described the product in architecture terms
      ("Provider-agnostic ports", "immutable, atomically-approved version", "Quarantine,
      scan, normalize, extract, with deterministic passport-MRZ parsing", "Built
      remote-first on Vercel + Neon", "Universal Core v0.0.0"), the status page printed
      raw probe keys and paths (`platform.aiExtraction: unconfigured`,
      `/api/health/live`), and the banner on every page used "synthetic or irreversibly
      redacted". All now say what a person gets or sees (`docs/ux/plain-language.md`).
      The status page names every platform capability in everyday words and says "Not
      set up yet" or "Switched off for now" beside what is not on, so it stays honest;
      a capability with no plain name does not compile, and one with a state it has no
      words for is left out rather than shown as a code. The "English & Bangla" promise
      was removed from the home page because Bangla is only partly there. The footer no
      longer names the hosting and database tools, and the internal label "ScamShield
      Lite" on the trust pages became "Scam awareness". A guard test
      (`lib/plain-language.test.ts`, sharing a scanner with `vocabulary.test.ts`) fails
      if engineering vocabulary, tool names, paths, version numbers, raw state codes or
      em dashes return to the public files; it fails against the old wording (13 of its 16
      rules broke) and passes now.
    - **Bangla deferred.** "Do not do Bangla translation work now; keep it deferred
      until the full product is done with all other features and functions." The
      Bangla foundation and the first flows had been built and checked locally (typed
      per-flow catalogs, review marking and launch gate, account and consent, alerts,
      privacy actions) but were never shipped; they are parked on a local branch and
      nothing of them is in production. The directive's English and Bangla requirement
      (Part 9 section 4) is therefore **not met** and the Part 9 checkpoint cannot say
      PASS for I18N; it is recorded as deferred by the owner, not as done.

    **Found by CI, not by me.** The deployment smoke check (`apps/web/scripts/smoke.mjs`,
    run against every preview and production deployment) looks for the banner's
    label on the home page and failed on the first push, because the label had changed.
    My search for places that depended on the old wording had run from the wrong
    folder with its errors hidden, so it found nothing and I wrongly concluded nothing
    did. The script now looks for the new label, and a test
    (`pilot-banner.test.tsx`) ties the script to the banner's wording so a future
    change cannot turn every deployment red again. Lesson: search from the repository
    root and never hide the search's errors.

    Not verified, stated plainly: the new wording was checked by tests and a layout
    pass on the built pages, not by a person reading it for tone; the signed-in screens
    still carry engineering words (listed in `docs/ux/plain-language.md`); emails were
    not reviewed. The banner's wording differs from the sentence the pilot directive
    quotes (same meaning, everyday words); that is a deliberate owner-driven change.
    **Chunk 40 (2026-10-06, UX-02/UX-03, Part 9 chunk 7) -- accessibility of forms,
    pages and uploads, and an automatic scan that keeps it that way.** Part 9 sections 3
    and 5. What changed, in the order a person meets it:

    - **Every page names itself** (WCAG 2.4.2). Every page showed the same browser-tab
      title. There is now a template ("Documents | VisaStack") and each of the other 41
      pages supplies its own part; the public route page uses the route's own name. The
      two navigation bars that were both called "Primary" are "Site" and "Workspace", the
      pilot notice at the top of every page is a named region ("About this version", it
      sat outside every landmark before) and the language switch says which language its
      label is written in. Guard: `lib/page-titles.test.ts`.
    - **Forms say what happened to everyone** (WCAG 3.3.1, 4.1.3). Each of the 46 files
      holding a form (more than 100 forms and buttons) had its result appear only after
      the action finished, which a screen reader often does not announce, and its submit
      button disabled itself while the action ran, which throws keyboard focus to the top
      of the page and let the Enter key send twice. `components/form-feedback.tsx` gives
      every form a message area that is always in the page (polite for progress and
      success, an alert for failure) and a submit button that stays focusable and refuses
      a second click. Guard: `lib/accessible-forms.test.ts`, which now covers every kind
      of button after it missed one (see below).
    - **A problem points at the input it is about** (WCAG 3.3.1). Where a server action
      knows which field is at fault (add a person, a profile value or date, the file name
      review, the upload) the input is marked invalid, tied to the message and given
      focus. Other actions still describe the problem in the alert without naming a field
      (see "Not done").
    - **Every control has a name** (WCAG 1.3.1, 3.3.2, 4.1.2). Ten controls had only a
      placeholder or nothing; all are named. Guard: `lib/form-labels.test.ts` (a
      placeholder does not count as a name here, although the scan below accepts it).
    - **Upload survives a bad connection** (Part 9 section 3). A request that never got an
      answer used to throw the page behind the error screen. The form now says it could
      not confirm whether the upload finished and sends the person to the document list
      first, so the same file is not uploaded twice because the page went quiet. While
      uploading it says to keep the page open and, after 15 seconds, that it is taking
      longer than usual. The documents page keeps itself up to date while a file is
      scanned and read (quick at first, slower after, about ten minutes in all, nothing
      while the tab is hidden), says so, and gives a plain next step under a file that
      failed, needs attention or was rejected.
    - **An automatic scan of the real markup** (`lib/axe.test-support.ts`). axe-core, with
      the WCAG 2.2 A and AA rules and its best practices, runs inside the ordinary test
      run (jsdom, no browser) over the real markup of: every form and button (129 cases) in
      four states (waiting, working, failed, done), with row-level buttons rendered twice
      in one tree so clashing ids show; the field-at-fault case for every form whose
      action can name a field; and 15 whole public pages and page states in the real
      site shell. It also checks
      what axe reports only as "needs review": a reference to an element that is not in
      the page, an id used twice, a same-page link with no target, and for a whole page
      exactly one main landmark and one top heading. A guard fails if a file with a form,
      or a form it exports, has no case, so a new form cannot ship unscanned. It found
      two real faults, both fixed: the pilot notice was outside every landmark, and the
      last-resort error page had no main area.
    - **Behaviour, run in a DOM** (`lib/form-behaviour.test.tsx`). The real add-person
      form, upload form and status page are rendered and used: focus moves to the field a
      failed action names and the alert holds the reason, the mark clears when the next
      try works, a working button stays focusable and a second click is refused (nothing
      runs after the first one finishes), the "taking longer than usual" and "could not
      confirm" wording appear when they should, and focus stays on "Check now" through
      the status page's own refresh. It shows which element has focus and what a live
      region holds; it does not show how any screen reader voices it.
    - **Proven to go red, not just green.** The scan has its own tests that feed it real
      mistakes, and temporary faults in real code each turned the suite red with a
      message naming the place: a file input with no name, an error message that lost the
      id its field points at, a new form nobody scanned, a submit button that disables
      itself, a status button that disables itself, a form that stops moving focus to the
      field at fault, a button that stops refusing a second click. (The first version of
      the double-click test passed even with the refusal removed, because React queues a
      second submission instead of running it at once; it now checks that nothing runs
      after the first one finishes.)

    **Found by my own scan, not by a person.** The status page's "Check now" button
    disabled itself while a check ran, and the page re-checks by itself every 15 seconds,
    so a keyboard user resting on it lost their place each time. The guard that was meant
    to stop that had only looked at submit buttons, which is why it slipped through; it
    now looks at every button in the pages and the shared components. While the first
    answer was on its way the feature list also said "not available right now"; it now
    says it is checking.

    **Found by CI, not by me.** The first CI run of this change failed in its test step.
    The scan shares one page between tests, axe refuses a second run on a page while one
    is going, and the profile editor (hundreds of fields, scanned in four states) took
    longer than vitest's five second limit on the slower CI machine. That test timed out,
    its scan kept running in the background, and the next 110 tests each failed with
    "Axe is already running". Locally everything passed because this machine is faster.
    Fixed twice over: scans now queue, so one can never start while another is going, and
    the scanning tests carry their own 90 second limit. Proven by reproducing the cascade
    with a 1.5 second limit before the fix, and afterwards by running the suite with a
    200 millisecond limit (the slow tests time out and nothing after them is affected).
    Lesson: a test that takes seconds on a fast machine needs a limit sized for the
    slowest machine that runs it, and state shared between tests has to survive one of
    them timing out. I also noticed the field-at-fault test could pass without checking
    anything if a case named fields that were not on the screen; it now fails in that case.

    **Not done, stated plainly:**
    - No person has used the screens with a keyboard or a screen reader. A scan finds
      structural faults, not whether a task can be finished. Directive Part 9 section 5
      forbids reporting AA compliance from a scanner alone, so **WCAG 2.2 AA is not
      claimed.** A manual pass of the nine critical flows (NVDA or JAWS on Windows,
      VoiceOver on iPhone and Mac, TalkBack on Android) is still owed.
    - Colour contrast and layout are checked in a real browser only on the public pages
      and the layout fixture (`e2e/ux-public.spec.ts`), Chromium only. The signed-in
      screens were never opened in a real browser here, and Safari and Firefox were not
      tried.
    - The signed-in forms are scanned as components, not as whole pages, so how forms
      and headings combine on a full signed-in page (heading order, ids shared by two
      forms on one page) is not scanned. The only repeated id inside one file is in
      different pages' forms and does not clash today.
    - Actions that do not name a field (share with someone, start a case, create an
      organisation and most admin forms) describe the problem in the alert without
      marking one input invalid or moving focus to it; browsers' own required-field
      messages cover the common mistakes first.
    - Zoom to 200 and 400 percent, text spacing and reduced-motion were not checked by
      hand. Bangla is deferred by the owner, so nothing about Bangla accessibility
      (the lang attribute on a language switch is the only part in place) was done.
    - Three deprecation warnings appear when installing the scan's DOM library (jsdom 25:
      a deprecated text-encoding package); it is a development-only dependency and the
      production dependency audit is unaffected.

    **Chunk 41 (2026-10-06, SEC-07) -- the production dependency audit went red on a new
    advisory, and what was done.** The CI run on `main` after #166 merged failed its
    "Audit production dependencies" step (`pnpm audit --prod --audit-level high`) in under a
    minute. Two advisories were open: `source-map-js` (high, event-loop denial of service
    through indexed source-map offsets, vulnerable below 1.2.2, reached through `next` and
    `postcss`) and `sprintf-js` (moderate, denial of service, vulnerable up to 1.1.3, reached
    through `mammoth` and `argparse`). The same dependency set had passed the audit on the
    pull request's own run hours earlier, which points to advisories published in between
    (I did not look up their publication times). Nothing about #166 caused it: it only added
    development-only packages. A new override pins `source-map-js` to `>=1.2.2 <2.0.0` (bounded
    above, because an unbounded override once broke DOCX reading; lint, typecheck, the web
    tests and a production build all pass with it, and the audit gate now passes). `sprintf-js`
    has **no patched version** (1.1.3 is the newest), is only moderate (so it does not fail the
    high-severity gate) and sits behind the DOCX text reader; it is accepted for now and must be
    revisited when a fix exists or `mammoth` changes. Lesson that keeps repeating (known issue
    10, and again on 2026-10-03): this gate can go red with no change of ours, so a green
    pull request does not guarantee a green `main`. The scheduled weekly scan that would
    surface this earlier is not set up (CodeQL and dependency review are skipped on this
    private repository; see the supply-chain work still to do).

independently confirmed findings; the missing PRD file is tracked as Blocker 1 in
`assumptions-and-blockers.md` (now resolved) rather than here, since it blocked the
programme rather than being a product defect.

    **Chunk 42 (2026-10-06, OPS-02, OPS-03, SEC-07, NTF-04, A31) -- incident readiness,
    recovery preparation, release and rollback safety (Part 9 sections 11 to 13).**
    Written: the incident runbooks under `docs/operations/incidents/` (eight scenarios, roles
    table, evidence rules, no 24/7 promise), a rewritten `docs/operations/recovery.md`, and
    `docs/operations/release-and-rollback.md`. Built: `verify:audit-chain` (checks the whole audit
    trail; its exit codes are now tested on a throwaway database: intact gives 0, an edited event
    and a removed event give 1; the two database rules that refuse edits and deletes had to be
    dropped in the test to simulate privileged access); a migration credential preference and a
    main-only, protected migration workflow; and a release record written for every deployment.
    **Corrections found while checking my own earlier text.** (1) The runbook said migrations run
    during every production deploy and that a failure shows in the build log. Both are false:
    migrations run only through the manual DB Migrate workflow; fixed in `runbook.md`.
    (2) The release page said preview isolation was "verified from environment-variable scoping".
    That was never done; the attempt to list the project's environment variables was refused
    (403), so the claim is removed and the owner must check it in the dashboard. (3) SEC-07 said
    VERIFIED because CodeQL and dependency review exist; both are skipped on a private repository,
    so it is now PARTIAL. (4) NTF-04 promised date checks at least hourly; the jobs run once a day.
    **Not verified, said plainly:** `verify:audit-chain` has never run against the real database
    (the production driver needs a hosted database; only the checking logic ran, against a test
    database); the migration workflow changes were read and parsed but the workflow was not run
    and must not be without the owner's go-ahead; no restore or rollback was rehearsed; no
    tabletop with people was held (the desk check in `incidents/tabletop.md` only shows that the
    named controls exist in code). **Owner decisions still open:** appoint the incident owner,
    backup and legal reviewer; fund an independent store for document originals and an escrow for
    the master key; create the Neon migration role, the secret `MIGRATION_DATABASE_URL` and the
    GitHub environment `production-migrations`; confirm the Neon history window; allow a rollback
    rehearsal; check preview secret scoping in the Vercel dashboard.

    **Chunk 43 (2026-10-06, SEC-07, Part 9 s15 and Part 10 s6) -- supply-chain finalization.**
    Built `scripts/supply-chain/` (`checks.mjs`, `scan.mjs`, `checks.test.mjs`, 12 tests): secret
    scan (14 credential shapes; every tracked file plus the added lines of every commit on every
    branch), licence scan (deny list for copyleft and source-available licences, named exceptions
    with reasons), rule-based static analysis (10 patterns, shipped code only), browser bundle
    check (server variable names from `.env.example`, credential shapes, server-only markers and
    source maps in `.next/static`), prompt check (15 templates), test fixture check (163 files),
    preview credential check (workflows, committed environment files, example file, vercel
    config). Wired into the main CI job after the build (full history checkout, `--no-skips`, JSON
    report kept as an artifact) and a new weekly workflow `supply-chain-weekly.yml` (Monday 03:17
    UTC, read-only, no secrets). New page `docs/security/supply-chain.md`; `SECURITY.md`, the
    secret-compromise runbook and the tabletop gap row now say what is true. Guards proved able to
    fail: unit tests plant a bad input per check, and on the real repository a planted `eval`, a
    planted fake key and a planted server variable name in a built browser file turned three
    checks red (exit 1); removed afterwards, clean again. **First real run: 7 executed, 7 passed, 0
    skipped.** It first FAILED the licence scan on a real finding: `@img/sharp-libvips-linux-x64`
    (LGPL-3.0-or-later, via Next.js image optimisation). Judged acceptable (separate, unmodified,
    replaceable shared binary) and recorded as a named exception rather than loosening the rule.
    **Limits:** not CodeQL (no data-flow); the secret scan knows credential shapes only; Vercel
    Preview variable scoping is not verified; Actions pinned by tag; no alert routing for the
    weekly run; the tabletop count of gaps drops from 5 to 4. **Owner decision (does not block):**
    pay for GitHub code scanning or accept the free rule-based checks plus independent review.

    **Chunk 44 (2026-10-06, OPS-01, A33, Part 9 s8-9) -- load and service objectives.**
    Built `packages/load` (private, tested, never deployed): seeded made-up dataset generator, a
    load harness using the application's own database driver (through a loopback WebSocket bridge to
    a local Postgres 16), real migrations, real services, real ClamAV, content limits and text
    extraction, optional network delay between app and database, and a public-page HTTP check.
    Refuses any non-local database. Result and method: `docs/operations/capacity.md`. Headline:
    launch size, 50 sessions plus 5 document jobs, 0 errors, p95 39 ms next door and 234 ms at a
    10 ms round trip; stress (no thinking time) 225 views a second, p95 352 ms; 10-page PDF p95 0.41 s.
    **Two real defects found by measurement and fixed:** (1) `listEvidenceRequestsForOrgDetailed`
    looked up the applicant once per request (639 requests: 1.1 s next door, 27.5 s at a 40 ms
    distance) and now uses one query; (2) `listDocumentsDetailed` ran three queries per document
    (1.3 s p95 at 40 ms for six documents) and now runs three in total (0.30 s). Each has a
    regression test proven red by breaking the real code. **Findings, not fixed:** the pilot's
    built-in scanner rejects every PDF by design ("pdf content safety cannot be established without
    a real malware scanner"), so PDFs release only with ClamAV configured, and production reports
    the scanner as unconfigured; case, client and evidence-request lists are not paginated (fast at
    1,000 rows, 441 KB payload; revisit past about 2,000 cases in one agency); the audited save is
    the screen closest to the 800 ms target when the database is far away (611 ms at 40 ms, one
    person); `/trust` returns a 500 when the database is unreachable. **Harness bugs caught on the
    way (not product bugs):** the in-memory file store handed one buffer to every job and the PDF
    reader empties it, which made 160 of 175 jobs look like "empty file" until fixed; Postgres CPU
    time summed from process counters went negative as connections closed, replaced by whole-machine
    busy share. The supply-chain static check also rightly flagged the harness for running shell
    commands, so it now reads operating-system files directly. **Limits:** see "What these numbers do
    NOT prove" in capacity.md (one machine, plain Postgres, one-signature ClamAV, in-memory files,
    no browser, 60 s runs). **Owner action:** none blocks; the next real test is a rehearsal against a
    Neon branch at launch compute size, and an outside uptime probe on `/api/health/ready`.

### Chunk 45 (2026-10-06): critical states and signed-in accessibility (Part 9 sections 2, 3, 5)

- **What was checked.** Every signed-in and public screen against the seven states (loading,
  empty, error, forbidden, pending, retry, success), written up in `docs/ux/critical-states.md`
  from the code. The product has no autosave and no optimistic updates (searched), so a saved
  state is only ever shown after the server answers.
- **Real defects found and fixed.** (1) `/trust` and `/trust/<route>` showed a crash screen when the
  database was unreachable; they now say the information is not available right now, keep HTTP 200
  and log the cause (decision recorded in the inventory; the trade-off is that a monitor looking only
  at the status code will not see this page fail, so `/api/health/ready` stays the signal). (2) The
  whole-page loading screen had zero top headings (caught by the first whole-page scan of a signed-in
  screen). (3) Document status badges read as approval or as engineering talk: "Clean" in green is now
  "No problems found", "Ready" is "Reviewed and approved", "Structural validation" is "Checking the
  file", "In quarantine" is "Held for safety", "Processing" is "Reading the file" (English only).
- **Tests.** `lib/a11y-signed-in.test.tsx` (19 cases: alerts, shared with me, applicants, account, agency
  list, loading and error screens in the signed-in shell, plus plain-words checks for pending and revoked
  shares), two database-down cases in `lib/a11y-pages.test.tsx`, a heading test for the loading screen,
  and `/trust` at 320, 360 and 390 wide in `e2e/ux-public.spec.ts` (also in the axe list). Proven red by
  removing the loading heading and the database-down handling.
- **Not done, said plainly.** Applicant tabs, case readiness, privacy, agency tabs and administration are
  not whole-page scanned; the assurance wording is not audited on every screen; no real-browser run with a
  dropped connection; signed-in screens never opened in a real browser here. **Owed to a person:** the
  keyboard-only pass and the screen-reader pass (NVDA/JAWS, VoiceOver, TalkBack), Safari and Firefox,
  zoom and text spacing. WCAG 2.2 AA is not claimed; the report line is "automated and keyboard-behaviour
  checks pass; screen-reader pass owed". Bangla deferred by the owner. **Owner action:** none blocks.

### Chunk 46 (2026-10-06): Part 9 checkpoint and Part 10 sections 1 to 4, first pass

- **Part 9 checkpoint: BLOCKED, not failed** (`docs/commercial-v1/part-9-checkpoint.md`). One run on `d3c3902`:
  lint, typecheck, build, dependency audit, all seven supply-chain scans, the load suite and the smoke
  check passed; the unit and service tests passed (2,759 passed, 3 skipped, 0 failed, uncached); browser checks gave 75
  passed, 2 failed (the two known sign-in redirect tests that cannot reach the sign-in provider from the
  sandbox), 21 skipped (staging-only). I18N is reported as deferred by the owner. The block is the list
  of launch blockers in that document, none of which this environment can close.
- **Correction to my own first run.** The first test pass reported success in 30 seconds because the
  build cache served 7 of 8 packages from an earlier run. I re-ran it uncached before writing the
  result down.
- **Real defect found and fixed (Part 10 s2).** The staging end-to-end workflow ran on every successful
  deployment, including pull-request previews, with real identity secrets and the preview's own test
  code checked out. The directive forbids exactly that. It now needs the Production environment, or a
  manual dispatch.
- **Eight cross-account tests now have real bodies** in `apps/web/e2e/authenticated-workspace.spec.ts`:
  three between two travellers (create and revoke before acceptance, narrow view, pause and resume) and
  five for an agency (needs a pre-built staging agency fixture named by four repository variables). They
  are gated on two different identities and skip with a BLOCKED reason otherwise. **They have never been
  run**: selectors were written from reading the forms, not from a live page, and expect to need a
  round of fixes on first execution. A single identity cannot fake the isolation: the gate refuses a
  second identity equal to the first.
- **Journeys J01 to J15: all BLOCKED**, none executed through the real UI (`part-10-journeys.md`). The
  one live check was the public catalog, which loaded but has no published route.
- **Acceptance matrix A01 to A35** (`part-10-acceptance-matrix.md`): 1 PASS (A14), 18 BLOCKED, 16
  NOT_EXECUTED, 0 FAIL. The ledger's A and J tables are updated to match; they had been stale
  (implemented areas still said NOT_STARTED).
- **Section 1 re-read was not done in full** (cost rules); `part-10-reread.md` says exactly what was
  read and records the divergence (one merged change since the last base; PR #77 untouched).
- **Owner decisions:** provision the two staging identities and the agency fixture (PR #77 has the code
  half; a session cannot write repository secrets); appoint the incident owner, backup owner and legal
  reviewer; choose document backup and key escrow; configure ClamAV.

### Chunk 47 (2026-10-06): Part 10 sections 5 to 7 and 11: release-candidate run, scans, A30, A35
- Run on `a27cefb` (production runs the same SHA): install, lint, typecheck, 2,759 tests passed and 3 skipped, build, production audit, 7 of 7 supply-chain scans, 12 of 12 scan self-tests, 75 browser checks passed with the 2 known sandbox-only sign-in failures, smoke 10 of 10, load re-run (p95 39 ms at launch load, 0 errors). Detail: `part-10-security-scans.md`.
- **New finding, reported not fixed:** the full dependency audit lists 3 Critical and 1 High advisories in development tools only (`vitest` below 3.2.6, `tinypool`, `vite`). Never shipped. The production audit is clean at high and above (1 moderate, `sprintf-js` through the DOCX reader, no patched version). The fix is a major upgrade of the test runner and needs its own change. The CI audit for development tools is non-blocking by design, which is why this was not caught earlier.
- Not run and recorded as such: CodeQL (private repository), SSRF (no test exists; nothing fetches a user-supplied address), authenticated browser tests, rule golden suites, live AI, email and scanner runs, staging deploy (no staging exists), PDF timing with a real scanner at this SHA (no ClamAV in the run; all 150 files ended quarantined as designed).
- A30 BLOCKED: no restore performed (no approved Neon branch, no document backup, no key escrow). A35 BLOCKED: no independent report. Neither target was rewritten.
- The secret scan covered the working tree only (shallow clone); CI scans history.

### Chunk 48 (2026-10-06): Part 10 sections 8 to 18: sign-offs, release gate, handover, final verdict
- `part-10-signoffs.md` (rules, provider and privacy, operations, runtime degradation vs eligibility): all blocked on people; no approval invented. Zero launch packs are published and no golden-case suite exists.
- `release-gate.md` rewritten as a real record: 18 attestations, each with evidence, approver, date and revalidation trigger; 0 attested. The runtime readiness flags are stated not to be release evidence.
- `handover-inventory.md`: the "no critical system on one person's account" test FAILS (repository, hosting and the master key).
- `final-report.md`: verdict CODE COMPLETE - COMMERCIAL LAUNCH BLOCKED. No isolated staging exists, so the directive's staging deployment was not done.
- Nothing was merged to main, deployed, enabled or activated by this task. The release-candidate PR is a draft. PR 77 untouched.


### Chunk 49 (2026-10-06): free-stack hardening after the release-candidate report
- Owner designated roles: Incidentman (incident owner), Backupman, Ruleman (rules owner), Reviewman (reviewer), Privacyman, Legalman, Supportman, Inframan, Keyman and Vaultman (key holders), Priceman, Auditman. Recorded in `release-gate.md`. They are designations, not attestations: contact routes, acceptance and qualifications are still owed. No gate row changed to attested.
- Test runner upgraded (vitest 4, vite 6.4.3 or later): audit is now 2 moderate, 0 High, 0 Critical. Full clean run repeated on the branch head: 2,759 passed, 3 skipped, scans 7 of 7, browser 75 passed with the 2 known sandbox failures, smoke 10 of 10.
- An intermediate run failed on a 10 second database-hook timeout under parallel load and on web timeouts caused by running other commands at the same time. Treated as a robustness defect: explicit 60 second limits added for the adapters, db and services packages; run repeated clean.
- **Finding:** `LocalEnvelopeKeyProvider` throws in commercial mode on purpose. The free stack therefore cannot satisfy the key requirement for commercial mode; a real key service is needed (a cheap one exists; confirm current pricing). Stage A (open pilot) is unaffected.
- A scheduled uptime-check workflow was attempted and refused by the session's safety layer, so it was not added. `free-stack-launch-plan.md` records the alternatives.
- Not changed: production still runs `a27cefb`. Nothing was deployed, merged, enabled or activated.

### Chunk 50 (2026-10-06): Neon Auth sign-in, phase 1
- Built behind `IDENTITY_PROVIDER=neon_auth`; WorkOS stays the default and production is unchanged. Details and the phase table: `neon-auth-migration-plan.md`. Web tests rose from 1,018 to 1,046; each new guard was broken once and its test went red.
- **The supply-chain guards caught two real problems the first time the Neon package was added, and neither was waved through.** (1) The package pulled in two AGPL-licensed packages (`@triplit/client`, `ua-parser-js` 2.x) through its optional UI add-on; the licence scan failed. This app never uses that add-on (its server entry does not import it; the production build is the proof), so the add-on is excluded from the install with a bounded override, which removes the AGPL code from the shipped tree entirely: 409 production packages fell back to 237. (2) The production audit failed on a new `sharp` advisory (fixed in 0.35.5) unrelated to Neon; the override is now `>=0.35.5 <1.0.0`.
- Open risks (not closed): the Neon login package is a beta (0.5.0-beta, pinned) and declares Next 16 as its minimum while this app is on 15.5; no live check against a real Neon Auth project was possible (the sandbox cannot reach Neon); a reported session-cookie renewal bug needs a re-test; email verification, password reset and the staff second factor are untested.
- A mistaken `git stash` during this work was undone at once (`git stash pop`, all files restored, tree verified).

### Chunk 51 (2026-10-06): UI and UX upgrade, passes 1 to 3 (frontend only)

- **Scope:** signed-in and public screens only. No API, data, permission, rule or billing change.
- **Shared pieces** (`apps/web/src/components/ui.tsx`): status label with a tick, triangle or cross
  as well as a colour; next-step card; attention list; empty state; disclosure. Helpers:
  `formatTimestampDate`, `formatTimestamp`, `daysUntilDateOnly` (`lib/format-date.ts`), `humanizeCode`
  (`lib/format-code.ts`).
- **Screens changed:** traveller home, applicant overview, expiry, documents, evidence requests (what,
  why, deadline as a status, what happens next), sharing (one plain sentence per grant), shared with me,
  notifications, applicants, cases, history, privacy, agency dashboard, agency list, applicant
  confirmation panel (what is being confirmed, and a notice when the case changed since), upload form,
  public home. Every bare `toLocaleDateString()` and `toLocaleString()` in the app now writes the month as a word.
- **Wording finding fixed:** the upload form said files are "scanned for safety" while production
  reports virus scanning as not configured. It now claims a scan only when one is switched on.
- **Not verified:** signed-in screens were not opened in a browser (sign-in needs the identity provider);
  slow-network behaviour; mobile screenshots of signed-in pages. Admin screens only got the date change.
- **Left alone on purpose:** Bangla and all translation (deferred by the owner).

### Chunk 52 (2026-10-07): visible redesign (frontend only)

- New look through one stylesheet: palette, shapes, type, flat cards, square-ish buttons, a small brand mark. Signed-in sidebar on a laptop or larger, chips on a phone. Report: `docs/ux/ui-upgrade-report.md`.
- New: get-started checklists (traveller home, agency dashboard), case attention strip and jump links, home page example case (made-up details, labelled).
- Browser layout checks updated for the sidebar (`apps/web/e2e/ux-public.spec.ts`): the signed-in copy now has a frame and main column; the keyboard-focus check is against the sticky header only.
- Later in the same change: self-hosted fonts (Inter, Noto Sans Bengali), drawn icons, one page-header component on every page, bottom navigation on phones, agency inbox and admin audit and organizations as responsive tables, a pipeline bar, a two-column case page and applicant overview.
- Not verified: signed-in pages in a live browser (rendered with made-up data and screenshotted instead).

### Chunk 53 (2026-10-07): screen preview with made-up data

- New dev tool `apps/web/preview` (`pnpm --filter @visastack/web preview`): seeds a throwaway in-memory database through the real tables, renders every page in its real layouts for six kinds of account, screenshots at phone and desktop width, and checks each page. Documented in `docs/ux/screen-preview.md`. Not part of the product or the normal test run.
- Fixed from what it found: underlined links inside sentences, wrapping of long status labels, document row overflow on a phone, unstyled branding fields, first-day next step, short-page sidebar, plain sign-in and sign-up forms (now in a card), heavy red buttons on pack sources, plain empty state on the agency Cases page.
- Not rendered: pages that need a one-off link or token (invitations, contributor links, snapshots, pack diffs). Dev dependencies added to the web package: `@electric-sql/pglite`, `drizzle-orm`.

### Chunk 54 (2026-10-09): public beta sign-in on Neon Auth and Resend (phase 2 and recovery)

- Built sign-up with email confirmation, sign-in, forgot and reset password, resend confirmation, password re-check, account linking (`accounts.neon_user_id`, migration 0084 not run), Neon session limits and step-up, rate limits for the auth forms, and the `PUBLIC_BETA_OPEN` switch. Details in `neon-auth-migration-plan.md` (Phase 2 result) and `docs/operations/public-beta-sign-in.md` (setup and deferred register D1 to D13).
- Proved by test and by breaking the code on purpose: an unconfirmed address never links or creates an account; only the exact unconfirmed code leads to the confirmation page; the beta switch is inert under WorkOS; return addresses cannot leave the site.
- Found and fixed while building: capability and readiness checks reported sign-in as unconfigured under Neon because they only looked at WorkOS settings.
- Still not verified: everything against a live Neon Auth project and real email delivery. The first live proof is owner step 7 in the setup page.
- Production unchanged until the owner sets the hosting variables and approves the migration run; the migration must run right after merge because the new code reads the new column.


### Chunk 55 (2026-10-09): home page rebuilt as a story (frontend only)

- Home page now runs in order: hero with a layered made-up case (progress ring, an AI suggestion to approve or reject, a sharing card), the before and after of the document scramble, three steps, a six-tile feature grid, traveller and agency panels, a dark trust band, an honest "where we are and where we are heading" strip, and a closing call to action. All styles are prefixed `land-` in `globals.css`; no signed-in screen is touched; no scripts, packages or images added.
- Every existing guarded sentence is kept (plain-language guard, honesty tests). New tests cover the story order, the before and after, the made-up labels, the aim-not-promise wording and one top heading with eight named sections.
- Checked in a real browser at phone, desktop and dark: no sideways scrolling, no accessibility rule violations. A scroll-reveal effect was tried and removed because it hid cards in screenshots and print.
- Not verified: live deployment; the "heading toward one trusted file across routes and countries" wording is a direction statement for the owner to confirm. The eyebrow still says invite-only; open PR 177 changes that wording and will need a small merge of the two.

### Chunk 56 (2026-10-10): signed-in visitors no longer see "Sign in" on public pages

- Cause: the header, footer and home page asked only the WorkOS session whether someone was signed in. Production signs people in with Neon Auth (chunk 54), so everyone looked signed out: the header and footer said "Sign in" and the home page buttons said "Sign in to get started".
- Fix: one shared check (`apps/web/src/lib/signed-in.ts`) asks the sign-in system the deployment actually uses, and treats a failed read as signed out. Header and footer show "Workspace"; the home page buttons read "Open your workspace".
- Proved by test and by breaking the code on purpose: forcing the home page button back to the sign-in wording turned the new signed-in test red; restoring it turned it green.
- Not verified: live with a real signed-in Neon session (the sandbox has no sign-in). The two failing deploy smoke checks from chunk 55 are a separate matter and not touched here.

### Chunk 57 (2026-10-10): public-beta baseline and selected-session shell wiring

The owner public-beta directive supersedes WorkOS as the target identity provider. At baseline 698442a4124fce7f966aca2bee38b9f0e16bbd98, root navigation and pilot-denial identity still called WorkOS withAuth, while workspace logout called WorkOS signOut even with Neon selected. This patch reads the selected identity port in both read-only surfaces and dispatches workspace logout through signOutCurrentUser. Existing account provisioning, grants, admission flags, identity history and production settings are unchanged. Six new regression tests failed against the original code; focused checks passed 14/14 after repair. Full PR-level verification and remote deployment remain separate evidence in docs/public-beta/TEST-AND-ACCEPTANCE-EVIDENCE.md. No full Neon-only migration, safe legacy-linking recovery, live logout/email or staff MFA claim follows from these caller fixes.

Read-only cloud checks confirm the 0084 migration journal hash and accounts.neon_user_id exist in the bound database. No migration was run. GitHub API and production deployment inspection are blocked by proxy access. Further work and consolidated actions: docs/public-beta/EXECUTION-CHECKPOINT.md.

Final local verification for chunk 57: lint, production build, typecheck and high-severity dependency audit passed; the full workspace suite passed 2851 tests with 2 existing live-clamd checks skipped. Four moderate dependency advisories remain. Built unsigned-in HTTP checks passed 7/7 and existing HTTP security-header checks passed 11/11 without a browser. The actual catalog query also passed read-only through the unbundled pooled driver (1/1), while the built trust page used its safe fallback; built-driver/proxy initialization needs diagnosis. No exact-head CI, live authenticated acceptance or deployed correction is claimed. A supplemental cloud network/startup draft was saved; publication and blocked-check retries remain outstanding.

### Chunk 58 (2026-10-10): Neon deployment checks and built database path

Reconciled current main ecced6a (#180), preserving its shared public-session helper and home-page links. Main's deployed browser checks failed two WorkOS-only expectations despite correct Neon redirects. Smoke and browser checks now require the exact same-origin /auth/sign-in destination, and browser checks also verify raw redirect status and the sign-in heading. A shared URL guard rejects workspace and external destinations; explicit Node checks are wired into CI. A positive/negative synthetic deployment test proves smoke rejects an unavailable catalog when DB readiness reports connected/applied.

The web app directly declares the existing locked Neon and ws versions so its existing Next external-package configuration can resolve them. The rebuilt catalog now renders successfully in cloud, resolving the previous fallback without changing query logic, data, flags or production provider settings. Shared session reads use the selected provider factory with sanitized error reporting. Local lint/build/typecheck/high-severity audit, 1107 web tests, 5 live pooled checks, 16 Node checks, 11 header checks and 11 local smoke checks passed. Exact-head CI and deployed-candidate verification remain separate. Browser installation still needs Google's download redirect host; a supplemental draft is saved, unverified until applied. Full auth migration and authenticated acceptance remain incomplete.


### Chunk 59 (2026-10-10): Provider-aware legacy authentication routes


Continuation (2026-10-10): provider-aware legacy auth routes

Neon deployments now send bare or stale /callback links to same-site /auth/sign-in without exchanging WorkOS codes, forwarding query parameters or writing a legacy cookie. /api/session-reauth sends Neon to /auth/reauth with the shared safe return-path rule. Explicit legacy deployments retain their WorkOS handler. Callback failures use sanitized server logging.

Regression proof: before the repair, 7 of 13 route assertions failed; afterwards all 13 passed. Focused auth verification passed 39 tests. Local lint, web production build, workspace type checking, all 1115 web unit tests, production dependency audit, 81 browser checks and deployment smoke passed. Both changed routes were also checked through the actual production build. The first browser attempt failed because the test server started in the repository root rather than apps/web; after correcting the external runner working directory and confirming readiness, all 81 passed without changing assertions. Full workspace tests and exact-head deployment checks remain required in CI; these local results do not establish production deployment.

Neon capacity: removed only br-damp-dust-a4xtmktw, the unused merged PR #176 preview, after confirming its merged commit is on main, no open work, no children and no active environment reference. Created isolated preview br-jolly-surf-a4zjgej8 for this patch; production and existing Auth endpoints were retained. Preview settings must be scoped to this Git branch after it exists remotely. No production schema changes, activation, secret rotation, emails or real-account acceptance were performed.

PR-01 remains partial: legacy default/dependencies, stronger account continuity, privileged assurance and real SDK renewal/revocation acceptance remain open. This change repairs routing only.


### Chunk 60 (2026-10-10): Recoverable identity verification


2026-10-10 continuation: recoverable identity verification

Verified-email-only legacy binding has been removed from provisionNeonAccount. Existing immutable Neon bindings remain authoritative, including when the verified contact email changes. Unbound legacy accounts and conflicting bindings receive the same generic identity_recovery_required result and a denied identity audit event. No account fields are mutated or duplicate accounts created by this denial. Concurrent legacy claims are refused. The unique-constraint race path uses the same recovery result. New verified identities with no matching account retain transactional creation.

withSession releases any claimed invitation before redirecting to /auth/account-recovery. It does not attribute an invitation, touch account activity or grant a workspace on this path. The public recovery page explains verification and offers sign-out without exposing an account ID or reason for conflict. It performs no linking. Controlled original-identity proof, recovery approval and holder notification are still required before actual legacy relinking; this patch intentionally preserves existing records pending that proof.

Regression proof before implementation: three of seven service cases failed and the session recovery assertion failed. Lint, web build and workspace type checking passed. Full workspace tests, browser checks and smoke verification are running under bounded parallelism; their final results are not claimed here. The initial unrestricted test attempt overloaded four CPU cores and a new dynamic-import test exceeded the default timeout. Its timeout is now explicitly 30 seconds, with the security assertions retained. The first full attempt was stopped, not counted as a pass. Exact-head CI and deployment remain required.

Neon capacity: confirmed merged PR #167 preview claude/lucid-lamport-70jivu had its exact latest head on the merged PR, its merge on main, no open work/children/current environment references, no Auth metadata, and only historical preview deployments without production aliases. Removed br-lingering-cherry-a4ikv6l9 and created br-steep-frost-a4nwvyev for this isolated patch, retaining nine branches. Production and all currently referenced Auth endpoints were preserved. No production migration, relinking, emails, secret rotation or beta activation occurred.

Owner reporting requirements are recorded in CLAUDE.md and DEPLOYMENT-ACTIONS.md: after each deployment, explain what changed for whom and show done, in-progress and remaining public beta actions. PR-01 remains incomplete; privileged assurance, Neon-only selection/dependency cleanup and actual auth/recovery acceptance remain open.

### Chunk 61 (2026-10-10): coordinated PR-02 through PR-05 engineering

One batch implements Resend failure and late-complaint status handling, explicit new-agency Founding Access, independent real-record safety evaluation, and owner original downloads using fresh authentication and revocable authorized delivery. A deliberate owner-guard mutation failed as required, then all five action checks passed after restoration. Earlier focused service failures exposed legacy fixture assumptions following new founding assignment; fixtures distinguish legacy no-plan accounts from newly created organizations, preserving paid billing assertions. Corrected service and full checks remain pending at this checkpoint. Actual redaction, private scanner operation/freshness, managed key recovery/rotation, independent restore, consenting email delivery and authenticated lifecycle acceptance remain unresolved. See docs/public-beta/PR02-05-COORDINATED.md. No production migration, backfill or beta activation was performed.

### Chunk 62 (2026-10-10): explicit browser-security event completion

Coordinated application checks passed 2,870 workspace tests with three existing live-service skips; the separate web run passed 1,123 tests. A read-only pooled transaction against the existing allowed endpoint passed all five regression cases. The new isolated preview was blocked by the cloud network allowlist, not by a demonstrated application defect; the exact host additions are saved for publication. Two real-ClamAV cases remain unverified. The first browser run passed 81/82; injected markup's missing-image error had not produced its CSP handler violation within the test's fixed 500 ms. The check now awaits both real CSP directives with a bounded failure deadline, retaining script/handler non-execution and both directive assertions. Focused corrected check passed; complete browser rerun remains pending here. No application or dependency change accompanies this test correction.

### Chunk 63 (2026-10-10): registration notice and submission safeguards

PR #184 is production verified at exact merge 2c6d7c9ec31f5b10a17df23019d74d1364913407, including all required main/deployment checks and live readiness/anonymous denial; authenticated lifecycle acceptance remains unverified. The next continuation implements mandatory versioned signup notices, a hidden automation trap and purpose-signed expiring single-use forms, with atomic audit acknowledgement before account creation or email. Expiry-window counters protect against midnight/pruning replay. Initial focused and full checks are pending. This is not managed CAPTCHA, verified identity-linked notice acceptance, legal certification or beta activation. Free-first scanner/key/backup selection is deferred by the owner.


### Chunk 64 (2026-10-10): R2 storage and encrypted recovery infrastructure

The owner selected GitHub Actions for full SQL capture after rejecting a persistent Render container. R2 integration keeps the existing private file store as an independent mirror for new objects, with fallback reads and two-boundary erasure. No existing object is migrated or deleted. A bounded same-origin, authenticated API path checks ownership before reading bytes; forms also reject structural and MIME failures before storage. SHA-256 readback prevents equal-sized replacement bytes from passing upload verification. Structural validation is not malware certification and does not open real-data intake or PDF processing without a real scanner.

Native PostgreSQL PGP encryption wraps the existing authenticated envelope before insertion. Parameterized native queries never receive applicant plaintext; a derived passphrase is not stored. A format marker preserves legacy reads and rollback compatibility without schema changes or backfills. The observed Neon PostgreSQL 17.11 instance has pgcrypto enabled. A read-only live probe passed native encryption/decryption, legacy reads after disabling native writes and cross-applicant AAD denial, with no production writes.

The backup runner uses a verified, digest-pinned official PostgreSQL 18 client. SQL stdout is encrypted directly into bounded multipart R2 upload, with no plaintext dump file. A success manifest is written only after pg_dump and upload both succeed. Weekly Vercel verification cannot claim a queued dispatch or capture as a restore. An isolated synthetic pg_dump encryption/restore drill passed tables, functions, sequence state, pgcrypto data and an immutable audit rule. Deliberately removing ownership, MIME and dump-failure guards produced assertion failures; guards were restored.

The GitHub connection returns 403 for repository-secret management. Vercel's production R2 bindings do not populate GitHub. Secure repository Actions backup bindings and an independent escrowed backup key remain prerequisites for live capture. Managed KMS, real malware inspection, old-file backfill and a complete live restore/tombstone drill remain open. Weekly capture does not meet the 15-minute recovery target. Full local/source/deployment checks and signed-in storage acceptance must be reported independently; the evidence above does not certify those.


Continuation: the initial complete local run exposed a cold provider-import timeout in a sign-in capability test. The S3 SDK now loads only when R2 is used; the bounded first-import test budget accounts for shared CI startup without changing its assertions. Focused provider checks passed. Inspection also found Vercel upload verification reading metadata before registration creates it. An internal reserved-quarantine verification method repairs that ordering while normal unregistered-object reads stay refused. Expiring encrypted account exports keep their existing storage path and limits. Full verification is being rerun for these changes; no initial failed run is counted as green.

### Chunk 65 (2026-10-10): private PDF intake worker

The owner requested PDF upload and processing without reopening the abandoned
hand-written PDF safety parser. The new optional github_clamav execution path accepts
PDF admission to private quarantine and reuses the existing intake queue, real
ClamAV adapter, leases, extraction and limits on an isolated private Actions runner.
No scan gate or real-applicant gate is bypassed. Preview dispatch is forbidden and
workflow processing defaults disabled until secure configuration. Live acceptance,
GitHub secret provisioning, dispatch credential setup and scanner capacity remain
open; no production scanner availability or PDF processing success is claimed yet.
Configuration and upgrade procedure: docs/operations/private-pdf-intake.md.

Continuation: the complete PDF source run passed 2,933 workspace tests with three existing provider skips, 1,151 standalone web tests, 84 browser checks and 11 smoke checks. Local real ClamAV clean-PDF and synthetic EICAR rejection controls passed, followed by actual PDF text extraction. The local signature set contains only the synthetic test threat and does not certify production signature coverage. Final worker-only storage changes and guard mutation received additional focused verification. A production read found the native-write setting only in the branch preview; production R2 bucket/list probes still return HTTP 403. Owner-provided GitHub backup secrets are acknowledged but cannot be listed through this connection. Actual live capture and PDF worker activation remain unverified.

Preview diagnosis: the PR connection selected `neondb` while the application selects `visastackdev`; only the isolated preview connection was corrected, without migration or production changes. Production backup capture now checks its expected database name before pg_dump. The owner confirms both backup encryption bindings are configured; actual GitHub secret values remain inaccessible and a live backup has not yet been verified.

### Chunk 66 (2026-10-10): flat public and workspace interface

The approved ten-screen reference is implemented through shared light/dark tokens, responsive authentication, role-filtered navigation, searchable authorized document metadata and sharing organization. The 52-route census, source mapping, accessibility and synthetic browser coverage are documented in docs/uiux. Final lint, build, typecheck and 24 focused tests pass; full local and exact-head source checks remain pending. No authenticated production lifecycle acceptance is inferred from fixtures.

The initial preview rejected the PostCSS lockfile importer because its specifier did not reflect the existing security override. Regenerating the lockfile changed only that specifier; frozen installation now passes. Vercel skipped the lockfile-only commit as unaffected, so an explicit rebuild was requested. This checkpoint is not a merge or deployment success claim.

The preceding native-write deployment is verified on merge 7f9a9fe0ef1b9aef95c38bef9e48939284ec7535. Native production writes require pgcrypto. Fresh path-style R2 bucket/list probes still return 404; an EU endpoint probe was blocked by the cloud proxy and is inconclusive. Existing private storage and the closed real-applicant gate are retained. Live PDF worker activation, backup capture/recovery and signed-in acceptance remain open.

### Chunk 67 (2026-10-11): authoritative HTML and entire-system appearance

The owner corrected the visual authority to the exact original HTML across the entire existing system. All ten original compositions were rendered and inspected before styling changes. The operating-system dark overrides are removed; intentional navy accents remain confined to their designed roles. Desktop geometry, serif hierarchy, sidebar, toolbar, authentication split and mobile navigation are corrected through the shared foundations.

A source navigation guard covers all 52 page routes, including conditional invitation and comparison flows, without exposing them as unrestricted menu destinations. Forty baseline screenshots were captured before correction. Actual React fixtures use synthetic records and do not certify live authenticated acceptance. Final screenshots, complete local verification and exact-head deployment verification are pending at this source checkpoint and are recorded on the release pull request. Backend contracts, native encryption, real-document gates and provider activation remain unchanged.

### Chunk 68 (2026-10-11): preview origins, recovery feedback and configurable R2 region

The PR-188 source checks passed and the exact merge was deployed, but production browser verification failed four desktop appearance comparisons. A bounded live reproduction located nine differing pixels on a rounded header edge after Chromium's native appearance repaint. Reloading under the new preference produces exact equality. The test retains exact pixel equality after complete renders plus its runtime light color-scheme assertion; no checks are skipped or loosened.

Preview-generated links now select Vercel's current branch address, falling back to its exact deployment address, before any copied production setting. The URL used in the content security policy shares the same resolver. The stable branch alias was independently found on an older READY deployment and assigned to the verified revision. The stable preview address is now registered as a verified project domain with gitBranch set to the designated branch. It previously had no branch association. The next Git-triggered preview must prove automatic movement to its exact source SHA; later releases still verify routing instead of assuming READY means correctly routed.

Password recovery has a distinct check-email state, an explicit expandable resend form, a change-address link and clear temporary-failure feedback. Known and unknown addresses retain the same message to protect account privacy. The existing server-side email/address limits remain enforced. No live password email delivery is certified by mock or browser tests.

All R2 document, probe, backup and backup-status clients read R2_REGION with an auto fallback and preserve forcePathStyle. The weekly workflow passes the optional Actions secret through. A fresh production path-style auto-region bucket/list check still returns NoSuchBucket. There is no bucket-lookup cache to clear in these clients. Existing private document storage remains selected; native protected-field writes are already required. No object migration, database migration, role grant or identity reassignment occurs.

A read-only lookup confirms the owner's account is verified and WorkOS-bound, with no Neon binding. A lookup of the matching cluster's Neon Auth database also finds no identity using this email. Platform-role history is empty, and the configured one-time bootstrap includes the owner's email. Existing platform owner, security, compliance, support and quality roles govern the admin surfaces. Ownership verification remains necessary before connecting an existing account to a new identity. Final local and exact-head release evidence belongs on this change's pull request.


### Chunk 69 (2026-10-11): automatic signup confirmation and honest resend failures

The owner reported a new signup receiving no confirmation email. The production Neon Auth branch was matched against production NEON_AUTH_BASE_URL before inspecting settings. Email verification was required by link, but automatic sending on signup was disabled. A supported partial PATCH enabled only send_verification_email_on_sign_up; a fresh read confirmed it and every other authentication setting stayed unchanged. The existing SMTP provider is Resend with the approved sender. This configuration correction is live without a code deployment. Delivery to the reported recipient remains unverified until the address and signup time are identified. No unsolicited test email was sent. The production Resend credential cannot read domain or email-delivery logs (403), and application EMAIL_PROVIDER/RESEND_FROM_ADDRESS bindings are absent, separately from Neon SMTP.

Confirmation resend now distinguishes provider outages, rejected configuration and throttling from a successful request, using neutral unknown-account responses and fixed messages. Unconfirmed sign-in no longer claims a message was sent. Backup failures expose only an exact allowlist of configuration diagnostics, never arbitrary provider errors or credentials. The first live Actions backup failed; full capture and restore remain unverified.

GitHub Actions resumed after the owner restored availability. The deployed smoke passed 11 checks and the exact-production Playwright workflow passed 191 checks. Main CI and new source verification remain pending at this checkpoint. Controlled-pilot and disabled real-applicant intake are retained. No schema migration, restore, existing account rewrite or role grant occurred.


### Chunk 70 (2026-10-11): VisaStack auth email branding and existing-account signup

The owner supplied Resend dashboard evidence that verification emails to ns@brtlcenter.com and salma.ahai24@gmail.com were Delivered. This means recipient mail servers accepted those messages; inbox placement remains unverified. Both auth identities were read-only verified as already confirmed. These messages predate the automatic-signup setting correction, so that configuration observation does not prove these messages were never sent.

The production auth branch was matched to production NEON_AUTH_BASE_URL. The supported branch auth/config PATCH changed only the application name from NeonSadat to VisaStack. Fresh reads confirmed the name, unchanged auth base URL, unchanged email/password configuration and unchanged approved VisaStack SMTP sender. No test mail, account rewrite or role change occurred. New auth communications use the new application name; already delivered messages are unchanged. Actual newly generated branded email acceptance remains unverified.

Signup checks registration through a parameterized SELECT EXISTS in the matching managed auth database, after single-use form and email/IP rate limits. It never writes auth tables or links identities. This is necessary because required-verification providers can return generic success for duplicates. Existing accounts get sign-in and password-reset links; lookup errors produce a temporary-service message. Provider duplicate codes cover concurrent registration errors. Recovery and sign-in failures retain neutral unknown-address responses. Explicit owner instructions authorize disclosure of existing-account status only in guarded signup. Native auth schema compatibility remains a managed-provider dependency; unsupported schemas fail closed without false account results.

Production remains controlled_pilot with real applicant intake disabled. Full capture/restore, scanner worker activation, role lifecycle acceptance and commercial release certification remain incomplete. Verification and exact deployment evidence are recorded outside the checkout and reported separately; no pending check is counted as passed.

The designated active preview branch was separately confirmed and received the same supported application-name update. Fresh reads verified VisaStack with unchanged auth endpoint, sender and email/password settings. Unrelated historical branches were not modified.


### Chunk 71 (2026-10-11): registration fixture scan correction and backup database diagnosis

PR 191 CI rejected credential-free, synthetic Neon endpoint fixtures in signup-account.test.ts. The original local supply-chain scan missed this new test because it was not yet tracked when scanned. Current tracked fixtures now carry precise reviewed line comments: the endpoint names are synthetic, both database resolver and query driver are mocked, and no network or credentials are used. Scanner rules and runtime source remain unchanged. The complete local build, tests and 192 browser checks remain valid for this comment-only correction; the tracked fixture scan and affected checks are repeated before pushing. No failed check is counted as passed.

The authenticated encrypted backup run now reports an exact safe diagnostic: BACKUP_DATABASE_URL does not select the expected application database, visastackdev. Capture and restore remain unverified. The expected-database guard is retained rather than backing up the wrong database. Correcting this repository secret requires secure GitHub Actions settings access; no connection string should be sent in chat.


### Chunk 72 (2026-10-11): compare completed live status renders at the same timestamp

The deployed browser gate rejected the strict light/dark comparison for /status at phone width. That page performs real asynchronous health requests and updates a visible clock, while the comparison previously captured immediately after navigation and reload. The status appearance test now fixes browser Date and waits for completed health responses on both renders. It retains every pixel in the exact image comparison, both widths, actual health requests and the computed color-scheme assertion. No snapshot threshold, mask, skip or application theme change was introduced. Both deployed status comparisons passed after the correction, and deliberately changing actual rendered body colors caused the strict assertion to fail. The full deployed no-secret browser suite and affected checks are rerun before push; pending results are not counted as passed. The failed CI screenshot artifact was inaccessible from this environment, so no inspection of that artifact is claimed.


### Chunk 73 (2026-10-11): complete-render comparison and successful application backup

The first complete deployed browser rerun passed 175 checks and failed 17. Sixteen API-request failures were local EAI_AGAIN errors because the external test runner was not using the managed proxy; its local configuration now uses the inherited proxy and system certificate bundle with TLS verification retained. The remaining strict privacy comparison differed by 29 rounded navigation-button pixels within bounds (1488,103)-(1524,146). Both images were inspected through their pixel data. The visual test now renders the dark OS preference in a fresh browser context instead of reusing native-emulation raster caches across reloads. It preserves the dynamic computed color-scheme assertion, all exact image bytes, all routes and both dimensions. Both privacy and status comparisons passed at desktop and phone widths; an actual rendered color mutation still fails the exact comparison. No production CSS or test threshold changed.

After the owner replaced BACKUP_DATABASE_URL with the unpooled visastackdev connection, Actions run 38116023195 succeeded on production commit bd4cfacef9bde99f0d32961b667e13a15a768592 and printed the authenticated encrypted-upload success marker. Application database capture and R2 publication are verified. Restore verification, key escrow/rotation and scanner worker activation remain incomplete. No restore, schema migration or account rewrite was performed.


### Chunk 74 (2026-10-11): preserve header geometry and stabilize border paint

Further pixel and DOM inspection located the 29-pixel variation on the rounded header border, rather than an action button. Fresh contexts and software/color-profile flags alone did not eliminate it; those experimental flags are not shipped. Applying background-clip: padding-box to the existing white header separates the background fill from the solid border paint. All 14 public route/width comparisons passed in the targeted deployed-style probe. The production stylesheet receives only that paint property: height, width, radius, spacing, color roles and typography remain unchanged. Full verification is rerun against the actual built stylesheet before push; no injected style remains in the committed tests. Strict pixel equality, computed color-scheme checks and negative rendered-color mutation coverage are retained.

An independent read-only R2 probe confirmed the successful run 38116023195 manifest and ciphertext object, with matching stored size of 243098 bytes and restoreVerified false. No backup object was changed or deleted by the probe. Weekly capture remains scheduled for Sunday 06:00 UTC, noon in Dhaka. Recovery acceptance still needs an isolated restore drill and lifecycle/tombstone proof.


### Chunk 75 (2026-10-11): complete verification of the final signup and header fix

All twelve local verification gates passed against the actual final build, including 192 browser checks, strict public light/dark comparisons, workspace and web tests, scanner self-tests, dependency audit and supply-chain checks. No styling injection, image mask or relaxed comparison threshold is included. GitHub exact-commit checks and live deployment verification remain mandatory before release. The successful encrypted backup and independent R2 manifest/object evidence from Chunk 74 remain valid; a complete restore is still unverified.


### Chunk 76 (2026-10-11): isolated database-only restore drill

While PR 191 checks ran, the next recovery step was developed separately: a manual main-only Actions workflow with a private temporary PostgreSQL 18 service and a restricted restore role. It receives existing R2 and backup-encryption credentials but no production database URL, starts no application or delivery worker, and uses only a fixed temporary database connection. Whole-archive SHA-256 and AES-GCM authentication precede SQL execution. Private scratch files are removed; SQL and provider errors are not logged or uploaded. The runner checks required restored tables and a synthetic pgcrypto round trip, while explicitly retaining fullDisasterRecoveryVerified false. Archive size is bounded at 512 MiB for free-runner capacity. Backup completion time is recorded separately from the unavailable v1 snapshot timestamp; no end-to-end RPO claim is inferred.

Fifteen initial focused tests and strict types passed. Actual removals of authentication, ciphertext-hash verification and child-environment isolation were rejected by those tests. A further unsafe-role rejection test was added before repository verification. A real synthetic pg_dump was encrypted and restored through the new runner into an offline local PostgreSQL 18 container. Independent queries confirmed rows, functions, sequences, pgcrypto and immutable audit rules. The owned container, volume and synthetic SQL were removed. The cloud R2 download was mocked for that synthetic drill; no production backup restore is claimed yet. Full repository checks and actual Actions execution remain pending. The complete A30 target remains BLOCKED: document objects, actual key recovery, audit checkpoints, deletion tombstones, revocations and measured end-to-end recovery are incomplete, and weekly capture alone does not meet the unchanged 15-minute RPO.


### Chunk 77 (2026-10-11): restore workflow review and completed local verification

The supply-chain check correctly refused the newly tracked restore workflow until its exact name and restrictions were reviewed. Its reviewed entry retains rejection of unlisted workflows, requires manual dispatch and main-only code with discarded checkout credentials, and allows only the existing R2 and backup-encryption secret names. Explicit tests reject PR/push execution, removed main/checkout guards, a production database URL and unknown credentials. Actual removals of the workflow secret boundary and runtime restricted-role boundary were rejected.

All twelve local verification gates passed for the final implementation, including 16 focused restore tests, all 192 browser checks, workspace/web tests, dependency audit, scanner self-tests and all seven supply-chain checks with none skipped. One intermediate scanner invocation omitted the cloud package-store settings and skipped licence enumeration; the correctly configured repeat verified all seven checks. Existing unrelated workspace test skips remain skips. Only scanner checks and final lint were repeated after the reviewed scanner change; unchanged application build, types and browser results were reused. Actual Actions restore execution remains pending until the workflow reaches main. PR 191 merged as 390845818e9546e9776a1abbcb78ad44bc655d71; its live deployment verification is still running separately.

### Chunk 78 (2026-10-11): PR-06 notification and scheduler continuation

Notification delivery now uses stable opaque Resend idempotency keys and a bounded provider timeout. Missing provider configuration and missing acceptance IDs fail instead of manufacturing sent status. Stored retry diagnostics exclude arbitrary provider/network content. Recipient checks retain the traveller's current ownership even when case events carry agency metadata; agency recipients require active membership and current accepted grants, with assignment checks for non-administrators. A worker cannot overwrite a cancellation or a different worker's lease. Budget-deferred jobs retain their attempts and release only their own leases.

Notification, intake and reminder job endpoints expose unavailable database workers as 503 instead of successful empty queues. Notification batching has an invocation budget. The optional dependency-free Cloudflare Worker retains existing endpoints and daily Vercel fallback while supporting five-minute triggers and hourly reminders. It refuses noncanonical origins, weak secrets and redirects, bounds requests and never exposes provider bodies. Its seven security tests passed; removal of its redirect guard was rejected. Fourteen focused application job tests passed, and focused recipient/grant/lease-race checks passed. Complete repository verification is still required for this implementation.

The external Worker is not deployed: only R2 credentials are available, which do not grant Workers management access. No timing target or free-plan billing compatibility is claimed without actual invocation and current account-limit evidence. Resend's finite idempotency retention is not indefinite exactly-once delivery. Signed delivery-event reconciliation, current backlog indicators and authenticated provider acceptance remain required. Neon Auth emails use separate SMTP configuration. No production job was manually invoked to send a test email, and no new real-data permission, schema migration or paid service was activated.

PR-06 cost review: the private scanner dispatch can start an Actions runner even for an empty queue. The external scheduler therefore leaves intake polling disabled by default, with explicit opt-in after runner-minute and backlog review. Existing upload-driven dispatch and daily fallback remain. Default schedule estimates are 288 invocations and 312 requests per day, not 600; enabled intake polling increases requests and may add substantial runner minutes. This choice retains an explicit intake timing gap instead of silently spending the free runner allowance.


### Chunk 79 (2026-10-11): verified recovery and PR-07/08 continuation

PR 191 deployed as 390845818e9546e9776a1abbcb78ad44bc655d71 with required source/main CI, deployment smoke, domain/readiness and changed signup feedback verified. The external signup probe initially checked before React rendered; a render-wait diagnostic passed on that exact deployment without creating an account or sending email. Subsequent attempts correctly met the existing hourly rate limit. No rate bucket or guard was cleared. Neon Auth branding is configured as VisaStack, but a newly delivered branded email remains untested.

PR 192 deployed as c18bbda2f905105fce269a72b7fc6717d9be837b after required CI and deployment checks passed. Actions run 38128672220 successfully authenticated the stored R2 encrypted backup and restored it only into a private temporary database. Its actual recovery step passed. This closes the narrower database-only restore proof, not complete disaster recovery: document objects, key escrow/rotation, audit checkpoints, tombstones, revocations and measured RPO/RTO remain open. Production data was not restored or rewritten. An interrupted GitHub read was resumed after merge without repeating the merge.

PR-07 continuation records human source reviews on draft requirements under the existing PACK_MANAGE permission and appends an audit event. Official approval requires cited accessible source metadata, a separate reviewer and an observed date; publication rechecks source accessibility and review freshness. Version-dependent source edits, additions and approval use transactional row locks to prevent edits from slipping into an approved manifest. Custom manual checklists retain their existing path. Recording metadata is not independent verification of legal accuracy. No actual reviewed pack or AI privacy/provider integration is claimed.

PR-08 continuation extends the existing protected founder dashboard with measured/configured/unverified provider readings. Missing storage or AI-cost readings do not become zero usage or available headroom. Provider secrets and email addresses are excluded; key presence does not prove key recovery. Backup recovery still requires run evidence, and invoices/current free-plan limits remain unmeasured. The provider-upgrade guide preserves identities, consent, private documents, founding complimentary access and existing adapters. New continuation checks and deployment evidence will be recorded after execution.


PR-09 disclosure review found the privacy notice retained Vercel-only file wording despite R2 deployment. The factual processor correction uses the selected file storage and describes configured R2 archives. Privacy notice version advances to 2026-10-11.1; existing acknowledgement records are not changed. Explicit legal-review, test-only and incomplete-recovery statements remain. AI environment-key readings also avoid equating absent environment configuration with the existing database-managed provider status. Affected build, type, browser, web and notice-service checks are repeated after these bounded corrections; unrelated service results are reused.


### Chunk 80 (2026-10-11): documentation and communications reconciliation

The owner requested refresh of long-standing public and private communications while PR 194 was checking. An inventory reviewed all 128 then-existing Markdown documents and retained six reference/evidence artifacts. Sixty-three documents with earlier provider/domain assumptions receive appended dated operating corrections; historical specifications, targets and evidence are retained. Current repository setup and documentation navigation now lead to the current operating guide and public-beta acceptance. Three proven broken relative links were repaired. The current deployment uses next build; no production migration is authorized or automatically implied by a release. Public readiness is coarse, and detailed provider diagnosis requires protected administration.

The private access dashboard formerly said accounts with no WorkOS ID were awaiting binding and would resolve on next sign-in. That statement is misleading for working Neon accounts. Its read-only report now explains legacy references without claiming a missing current identity or authorizing account transfer; roles, queries and data remain unchanged. The revised existing test failed against the old copy and passed all six tests after correction. Actual application email subjects/body contain no obsolete NeonSadat branding; Neon Auth application branding was already configured as VisaStack, while newly delivered branding remains untested. No external email or message was sent by this refresh.

Staging inspection found no Vercel test-account variables or custom staging environment. The production database binding was identified, but the preview database binding is opaque through the integration API, so isolation and synthetic account fixtures remain unverified. No branch was created, seeded or deleted. PR-09 whole authenticated journeys remain unexecuted; public-data release stays BETA_BLOCKED. The communications register distinguishes current guidance, historical references, configuration and unverified external delivery.

Focused final runbook review additionally identified Vercel-first PDF-intake setup instructions. This eleventh entry point now prominently directs readers to current R2 guidance, bringing dated document corrections to 64. Historical acceptance targets remain. ADR-0014 uses an unused identifier and does not overwrite the existing PDF or email ADRs. Current backend implementation and dependencies are unchanged from the already verified PR 194 implementation; the affected web build/types, all 1,200 web tests, 192 browser tests and smoke passed again. The four unchanged workspace/design/scanner/audit checks retain their recorded prior passing evidence; documentation links and supply-chain checks are verified on the final content.


### 2026-10-12: invitation delivery and account handoff candidate

Confirmed defects: agency team/client creation generated private links but no email notification, and signup/confirmation lost the invitation destination. Production application mail had an API key but no explicit EMAIL_PROVIDER or RESEND_FROM_ADDRESS at inspection. Candidate uses encrypted durable email payloads, dispatch-time invitation checks, existing Resend adapter, copy/native sharing and same-site return paths. Unregistered recipients need no account at notification time. Existing team membership remains immediate for existing accounts; client acceptance remains token-holder with explicit consents and profile selection. Personal sharing still requires an existing account. These policies are not silently changed. Provider callbacks/inbox receipt and actual authenticated desktop/mobile invitation journeys remain unverified. No production migration or sensitive-data activation is part of this candidate.


### 2026-10-12: CF-04 through CF-09 and personal-sharing candidate

The current candidate adds bounded private-worker OCR, checksum/calendar-validated passport expiry, audited rereading of a previously checked file, account-menu management links and reference-layout corrections. Personal sharing can notify an email before registration and creates no active grant until the exact recipient accepts. Its additive migration 0085 is applied only to isolated synthetic staging; production activation remains disabled pending a specifically authorized migration and verification. Actual Neon identities and routes replace fixture-only acceptance, but source checks and successful captures do not close full lifecycle, provider delivery, recovery or privileged-operation acceptance. See ../uiux/CF-04-09-ACCEPTANCE-2026-10-12.md for the current evidence boundary.

## 2026-10-12 CF sharing refresh and scan verification

The private synthetic Neon browser journey passed eleven checks, including exact recipient binding, single use and all three owner access transitions. In-place route refresh had dropped page content; a full request to the committed grant's owner route restores the actual updated list. Protected date placeholders now have explicit display states. Focused guard mutations failed as expected and restored code passed. Supply-chain scanning distinguishes shell-free OCR calls while retaining shell execution refusals; all seven scans and seventeen scanner tests pass. The reference and actual ten desktop screens were compared. Full lifecycle, inbox receipt, isolated production scanner/storage, MFA and recovery remain unaccepted. Production migration 0085 and invitation activation remain unapplied pending specific owner authorization.

## 2026-10-12 current-head browser harness correction

The final 09:01 actual Neon run passed 52 checks without skips or retries. Five separate pre-account checks passed, including exact clipboard copying and invitation-preserving guest signup navigation. CI's fixture bundle failed because its next/navigation adapter did not export the new sharing form's useRouter dependency; the adapter now records fixture refresh requests and the complete browser suite is rerun. This does not substitute for real authenticated acceptance. Migration 0085 was explicitly approved for the production run after verified merge. Source checks and release verification remain gates.

## 2026-10-12 hero spacing and real PDF input correction

All required main checks and deployment smoke workflows for PR 200 passed. The next candidate reduces the hero support cards, preserves their offsets and adds clearance before the navy section. An actual PDF-parser test found that Buffer inputs were refused; the three PDF consumers now normalize to plain Uint8Array without changing stored data. All 376 adapter tests pass with two pre-existing environment-specific skips. A protected main-only verify-synthetic mode is added to the existing scanner workflow for actual R2/private-mirror, official ClamAV and native-PDF checks without opening the production queue or database. Actual execution is pending owner Actions configuration; existing private-intake runs were skipped. API 403 prevents this connection from setting those variables. No scanner acceptance or full CF-09 completion is claimed before that run and the remaining journeys pass.


## Current-documentation reconciliation: 2026-10-12 18:48 Asia/Dhaka

README and essential operations, invitation, product, deployment, owner-action and acceptance entry points now route to docs/public-beta/CURRENT-STATE.md. Earlier dated records are explicitly historical. Live readiness and nonsecret Production flags were checked: Neon Auth, R2, required pgcrypto writes, Resend and personal invitations enabled; malware scanning unconfigured, real applicant data disabled. PR 200 migration/activation and PR 201 deployed hero/PDF correction are distinguished from incomplete CF-09, inbox, MFA and full recovery acceptance. Owner-confirmed Actions setup is not actual scanner proof. PR 201 main CI remains pending at the recorded inspection; both deployment smoke workflows passed. No schema, service, permissions or credentials changed.


## Actual private scanner installation failure and repair, 2026-10-12

PR 201 main CI and both deployment smoke workflows passed. Actual intake workflow run 38253171932 reached fresh official definition setup but failed because Ubuntu lists clamdscan as a suggested package; --no-install-recommends omitted it. Scanner controls and private storage acceptance did not execute. The dependency list now explicitly includes clamdscan, with early executable presence checks. No scan assertion, signature freshness requirement, queue guard, credentials or application policy was relaxed. PR 202 documentation is merged/deployed; required source and deployment smoke checks passed, main CI remains pending at this inspection.


## Interface safety net before the experience upgrade, 2026-10-13

A 17-seat read-only review of the whole interface recommended proving that nothing breaks before any screen is redesigned. This change adds only tooling and guards, with no change to any page, route, action, permission or stored value. A counter test records today's starting point and may only go down: 861 inline style props in 107 files and 19 raw database codes printed as page text in 16 files (the review's earlier 857 and 105 came from a text search; this count reads the code structure). An optional hook copies the pages the existing web tests already render, and a capture tool turns them into desktop and phone screenshots (177 pages, 354 images) using the real stylesheet and the made-up test data, so a screen can be compared before and after without signing in. Three captures from the same input matched exactly. Comparing against a deliberately edited page listed exactly the two changed screens. Adding one inline style made the counter fail with the file named. Checked: lint, web type check, 113 web test files (1,281 tests) with the hook installed and inert, and ten Node tests. Not checked: the full workspace test run (left to the required CI check), signed-in screens on a real sign-in, and pages that have no test of their own, which each get a behaviour test before their first redesign. How to use it: docs/uiux/CHANGE-SAFETY.md.


## Plain words for stored codes and visible long dashes, 2026-10-13

Nineteen places printed a stored database code straight onto a page (for example PASSPORT, CASE_MANAGER, PENDING_VERIFICATION, IN_PROGRESS), and seven files showed a long dash to people. They now show plain words from one list (apps/web/src/lib/labels.ts): stand-alone labels have every word capitalised (Case Manager, Bank Statement, Waiting For Review) and a term inside a sentence is lower-case. Stored values, sorting, permissions and consent are unchanged. The audit log shows the plain event name with the exact code kept as small text underneath, and its Allowed and Denied column is plain too. Seven technical buttons on document review were renamed to what they do. Each label table is typed against the stored values and a test fails if a value has no label. The counter now also counts visible long dashes. Raw codes went from 19 to 0 and long dashes from 7 files to 0; inline styles stay at 861 for a later step. Two team and founder privacy tests were updated to assert the plain words. Before and after screenshots across 177 pages: 22 of 354 changed, all in the audit log, the founder privacy page and shared-with-me. Checked: lint, web type check, 114 web test files (1,292 tests), counter and label guards proven able to fail. Not checked: pages without a test of their own, signed-in screens on a real sign-in, and the full workspace test run.


## Preview deployment blocked, then failing to provision, 2026-10-13

The first push of the safety-net branch was marked Blocked by the hosting provider because the commit was authored with an email the provider could not match to a team member. The commit was re-authored as noreply@anthropic.com and force-pushed on the unmerged branch (nothing else rewritten); the Blocked state cleared. The next preview then failed in about a second with "Resource provisioning failed", before any build started. The likely cause is the database project's branch limit (ten branches at inspection; the owner's rule is a maximum of nine). This is not confirmed on the database side and no branch was deleted. Effect: the two required checks that run after a successful preview deployment ("No-secret Playwright checks" and "No-secret smoke check") are reported as skipped for this branch, while "Lint, Build, Typecheck, Test" runs normally. The owner decides how to treat the skipped checks. Handoff record: docs/uiux/EXPERIENCE-UPGRADE-HANDOFF.md.


## Merge result and corrected finding, 2026-10-13

Pull request 204 (safety net, plain words, handoff record) was squash-merged as 9afdf3c after "Lint, Build, Typecheck, Test" passed on the exact head 88e4a4f. The other two required checks were skipped because the preview deployment failed to provision a database branch; the owner accepted merging on that basis. Production deployment for 9afdf3c reached READY with both aliases, Deploy Smoke and Playwright Deploy Smoke succeeded, and the live readiness page returned ready in controlled pilot mode with the same platform states as before. The push-triggered CI run on main (run 38406342710) had not finished when this was recorded. Not checked: any signed-in screen on a real sign-in.

Correction: the earlier interface review counted 4 loading files and 1 error file against 59 pages as a gap. Those screens are inherited, so every signed-in page already has both. The real weaknesses are that they are identical for every page, that the error screen's promise that nothing entered was lost is stronger than can be proven, and that 27 of 31 empty states offer no next step. Phase 2 is scoped on the corrected reading. The inline style count of 861 comes from reading the code structure; the earlier 857 came from a text search.

The database project's branch limit was read directly: free plan, limit 10, 10 branches present. No branch was deleted.


## Loading, empty and error states made specific, 2026-10-13

Approved by the owner after a visual preview. Presentation only: no page logic, route, save, permission or consent changed. Loading screens now draw the outline of the page that is coming (list, case, dashboard, form) and say what is loading, with a note after eight seconds on a slow connection; eleven routes have their own. Every empty state shows an icon (27 got a fitting one, the rest a folder) and two gained a real action. A new error screen inside the signed-in area (apps/web/src/app/app/error.tsx) should keep the menu on screen, promises only what is true (saved records are safe; anything being typed may need entering again), and offers Try again, Go to your overview and Get help with the reference number; the top-level error screen got the same honest wording. A failed data export now says it could not be made, that nothing was changed and how to get help. Inline styles fell from 861 to 857. Checked locally: 115 web test files (1,298 tests), lint, web type check, route check (59 pages, no dangling link), Node tests, the Next.js production build, and a compare of 384 screenshots where every change was an empty state, the error screen or the new loading shapes. Not checked: the menu staying on the new error screen on a real signed-in page, the failed-export wording in a test, signed-in screens on a real sign-in, and the full workspace run on the server. Not done from the preview, on purpose: a Copy button for the error reference, and turning the small in-panel "No ..." lines into full empty states. Record of the whole day: docs/uiux/EXPERIENCE-UPGRADE-HANDOFF.md section 12.


## Shared sizes and spaces, then phases 4 to 8, 2026-10-13

Approved by the owner after previews. Phase 3: six text sizes named and 14 shared classes carrying exactly the values pages used to write inline; 358 inline styles replaced, counter 857 to 500; 386 of 386 screenshots unchanged, 1,301 web tests, lint, route check and Node tests green. Phases 4 to 8 (presentation only apart from two narrower inputs: profile details in the evidence form come from the profile list, and choosing only some of the profile or documents to share with nothing chosen is now refused instead of sharing everything): two-question case form, grouped case checklist with plain badge words, Take a photo button and no printed upload size, one-sentence sharing cards with an explicit scope choice and an in-page revoke question, agency quick views with counts and a Deadline column, provider rows with a status word and a plain sentence, and a guard test for contrast, tap height and spoken names (proved able to fail). Consent plain names (English): built after the owner answered the adviser brief; the owner's answers are decisions, not legal advice. Checked locally: 121 web test files and 1,327 tests; compare against Phase 3 changed only the admin overview, agency list and sharing page and added the new case form. Not checked: the case page, upload page and sharing form on screen (no page test renders them), the new screens on a real signed-in session, the keyboard pass in a real browser, and the live upload limit. The two No-secret checks skip because the preview cannot provision (database branch limit); no Neon branch was touched.

### 2026-10-13 - Interface upgrade, phases 9 and 10 (front door and entry), first part
Presentation only. Phase 4 to 8 merged first as pull request 209. This part: characterization tests for terms, sign-in, verify-email, forgot-password and the invitation page; four shared motion speeds (press 120ms, state 200ms, arrive 320ms) with a guard test that no raw duration returns and reduced motion stays honoured; the status page opens with one verdict, then what works and what is not switched on, with the check button last; sign-up, confirm-email and invitation pages show a three-step line, the made-up-details notice sits above the fields, and the consent sentence stays beside its unticked box; the invitation page opens with "Opening the link does not accept it."; the home page example cards now work (approve, reject, stop sharing, start again) on made-up details only, and the repeated promise list was removed from the navy band. Correction to the council mockup: the confirm-email page does not receive the typed address, so it shows no masked address and no mail-app button. Held for the owner or the adviser: the Before you start box, privacy at a glance, the WhatsApp link, the agency made-up day, and the invitation sender name. Checked locally: 125 web test files, 1,349 tests; the screenshot compare changed only the status, sign-up, confirm-email, sign-in, forgot-password (phone), invitation and home screens. Not checked: the screens on a real phone, the keyboard pass in a real browser, and the live site (this part is not merged yet).

### 2026-10-14 - Interface upgrade, phase 3c (small text sizes onto the scale)
Presentation only. Every small text size between 9 and 16 pixels now uses one of three sizes already defined: caption (0.75rem), small (0.85rem) or body (1rem). About 400 declarations moved in the style sheet and on pages; the two in-between helper classes for 0.8rem and 0.9rem text were folded into the 0.85rem one. Larger display sizes were left alone. A new test fails if an in-between small size comes back. Checked locally: lint and type check pass; 126 web test files, 1,351 tests; the screenshot compare against the previous main changed 428 screens, all from text size (257 changed height, 241 taller and 16 shorter; the largest phone change is the founder overview, 199 pixels taller on a page about 6,100 pixels long). The founder overview on a phone was viewed after the change and nothing was cut off or overlapping. Not checked: every changed screen by eye, tight spots on a real phone (narrow badges and table columns), and the live site (not merged yet).

### 2026-10-14 - Correction: browser smoke check failed after phases 9 and 10 and 3c
The live browser check (Playwright Deploy Smoke) passed on every merge up to pull request 209 and failed on pull requests 210 and 211. I had checked only the plain Deploy Smoke run and reported those merges as verified; that was incomplete. Causes: (1) pull request 210 retitled the sign-in page "Sign in to your workspace" and two tests look for a heading named exactly "Sign in"; (2) pull request 211 moved one trust-page label from 10 to 12 pixels and a test pins that label to the design reference at 10 pixels. Fix: the sign-in heading is "Sign in" again; that one label stays at 10 pixels and the new size guard skips it by name; two sizes written with an important flag that the first rewrite missed were also moved onto the scale. Checked locally: lint, type check, unit tests, and 192 of 192 browser tests across the public, browser-security and no-secret-auth files against a local server started with IDENTITY_PROVIDER=neon_auth (without that setting the local server uses the older sign-in path and five of those tests fail for reasons unrelated to the change). Lesson for the next person: after every merge read both Deploy Smoke and Playwright Deploy Smoke, and run the browser files locally before pushing a visible change.

### 2026-10-14 - Master Profile gap analysis against the bidesh365 repository (read-only)
Documentation only. The bidesh365 master profile (54 sections) was compared with VisaStack's profile registry (81 fields, 5 packs), document types and case purposes. Registries and document lists were extracted from code with the TypeScript compiler and compared by script; each row was then judged by reading the fields. Result: of 54 bidesh365 sections none is fully covered, 23 are partly covered and 31 have no VisaStack equivalent. bidesh365 documents disagree with its code in several places (the field registry header claims 469 fields in 45 sections but holds 437 in 44; two document lists share only 58 of 193 names; 83 scanner types are folded onto stored types). Full table, port risks and a proposed five-phase order are in docs/product/master-profile-gap-analysis-2026-10-14.md. Nothing was built and nothing in bidesh365 was changed. Not verified: whether bidesh365 runs, what its database holds, what VisaStack's stored country rule packs already name, and the legal wording of any declaration.

## 2026-10-14: Master Profile enrichment, investigation and plan recorded

- Added `docs/product/master-profile-enrichment/` (HANDOFF.md, ARCHITECTURE-FINDINGS.md, IMPLEMENTATION-PLAN.md) and a root `AGENTS.md` so Codex and Claude sessions share one record of what is done, where and why.
- Documentation only. No source, schema, route or stored value changed.
- Not verified: whether bidesh365 runs or what it stores; what stored country rule packs name; reach of fact-level sharing to organisations; AI evaluation behaviour with more keys; legal wording of declarations.
- Next: Phase 1 (catalogue foundations), then pause for the owner.

### 2026-10-14: Master Profile enrichment, Phase 1 (catalogue foundations)

- Added the catalogue in `packages/core/src/catalogue`: 101 purposes in 8 families, 200 document types in 14 groups, 657 new fields in ten layers (54 new repeating records, 8 live records extended), a frozen snapshot of the 81 live fields, protection rules by kind of data, seven proposed sharing categories, lookups, and a generated review report (`docs/product/master-profile-enrichment/CATALOGUE-REPORT.md`) with a drift test.
- Data only. No database change, no route, screen, rule, grant or AI prompt reads it. The live registry (`apps/web/src/lib/profile-fields.ts`) is unchanged and now guarded by `profile-fields-frozen.test.ts`.
- Guards (each proven to fail by breaking the real data 13 ways, then restored): unique and well-formed keys, Title Case labels, protection never below the kind, named national identifiers RESTRICTED, special categories kept out of broad categories, live records extended without a new label or category, alias collisions, unknown supported fields, adviser-only purposes, live document categories and the classifier list agreeing with the catalogue, report drift.
- Findings recorded in `ARCHITECTURE-FINDINGS.md` section 10: unmapped document types are invisible to category grants today, so Phase 2 must review each type before deriving the map; the live refusal record sits in the universal category; the other product folds distinct documents together and stores file links as fields (neither ported).
- Not verified: any rule or legal wording; whether each "proposed" document type name matches what an official body calls it; the exact official names in the labour migration record; how the editor will render 657 more fields (Phase 3); AI extraction behaviour with scoped keys (Phase 2).
- Next: owner sign-off on the lists, then Phase 2 (wiring), which changes behaviour and needs its own preview.

### 2026-10-14: Master Profile enrichment, progressive sections and Other (catalogue v2)

- Owner requirement: keep every field without clutter. Sections are visible but locked; a few common ones are open by default; completion counts only open fields and a newly opened section joins the calculation at once; every choice, section, document group and purpose family keeps an Other option; the Bangladesh tax return acknowledgement slip is a document and has fields.
- Built in `packages/core/src/catalogue` (data and a pure completion function; no database, route or screen change): 82 sections (10 open by default holding 54 live fields, 72 locked: 5 live ones, 9 extra-detail, 58 new), Other text boxes beside every choice, one Other Item record per sharing category, an Other document type per group (215 document types), an Other purpose per family (109 purposes), `TAX_ACKNOWLEDGEMENT_SLIP` with fields, and document field lists for scoping.
- Guards: every field in exactly one section; no section empty or mixed in category or layer; open-by-default sections hold only live fields; every live field claimed once; every choice ends with Other and has its text box; Other Items protected like their category; completion tests including the owner's example (opening a section adds its fields at once). Proved able to fail 11 ways.
- Not built: storage for opened sections and "does not apply" or "none" marks (needs a new table and the owner's go for the migration), the screens, and the wiring of the catalogue into the live registry, document names, sharing categories and AI scoping.
- Not verified: how 801 catalogue fields perform in the editor; AI behaviour with scoped fields on a live model; official names of the proposed documents.

### 2026-10-14: Master Profile enrichment, wiring A (document names and pick-lists)

- Owner confirmed the 54 common live fields as the default-open set.
- Admin boxes for a pack requirement, a document reminder ladder and a retention rule now offer pick-lists from the catalogue and save the canonical key; an unknown name is refused with a hint. `documentTypeLabel` resolves catalogue names and aliases. New entries only: nothing already saved is changed.
- Found: the old admin hint suggested a lower-case document type (`bank_statement`) while scanned documents are stored in upper case (`BANK_STATEMENT`), and matching is exact, so a requirement typed that way would not match. Existing saved requirements, reminder ladders and retention rules have NOT been audited for this; a read-only look at the pilot data would show how many are affected (needs the owner's OK).
- `@visastack/core` marked side-effect free; the pick-lists render on the server so the 801 catalogue fields stay out of browser bundles (checked in the build output).
- Not done: wiring B (AI reads only the fields a document supports), C (new sharing categories), D (registry built from the catalogue), storage for opened sections, screens.

### 2026-10-14, Master Profile: storage for opened sections

- Added migration 0086 (two new tables, no existing data touched) for opened sections and "does not apply" marks, with owner-only, consent-checked, audited writes and inclusion in the data export. Tests: 7 new, owner check and name check proved able to fail.
- Not verified: the migration has not run against production yet (needs the migration workflow with the owner's go-ahead, after this is merged). No screen uses the tables yet.
- Correction to the wiring A note above: the 801 catalogue fields stay out of browser code, but document type names do ship in one browser chunk.

### 2026-10-14, Master Profile: AI scoped per document type and sharing names

- AI reading is limited to the registered fields a document type carries (core `supportedFieldKeys`, services `scopeFieldKeys`). Falls back to the full registered list when no listed field is registered, which is the case for bank statements today. Tests: 6 for the rule, 1 end to end (what the model receives, and that a narrowed reading never reuses an unnarrowed cache entry). Proved able to fail.
- Grants accept the seven new catalogue categories as well as the five live packs (`SHARING_CATEGORIES`). A grant scoped to a new category shows only fields filed under it; unknown names are still refused. 1 new test, proved able to fail.
- Not verified: the offline AI evaluation (needs a real provider key). No real document has been read with the narrowed list.
- Deploy Smoke and Playwright Deploy Smoke fail with 404 on the migration workflow's own deployment record (their target is the job page). The runs against the real site pass. Not fixed.

### 2026-10-14, Master Profile: sections on the profile screen

- The profile screen now shows locked and open sections with a live completion number (one definition on the profile page and the overview), "Other" on choices and sections, "does not apply" and "none" marks, purpose suggestions, and a free item per section. Live labels are Title Case. Grants offer a new category once it holds a saved detail.
- Verified locally: lint, typecheck, the full web suite, new tests for the builder (12), the actions (11), the editor (14) and sharing (3). The two accessibility cases that failed first (controls disabled while saving) were a real defect in the new screen and are fixed, not relaxed.
- Not verified: the screen against a real signed-in session and database; browser checks of the new markup are in the visual fixture only; live Neon sign-in preview behaviour; agencies requesting an added field; protected choices set to Other without text count as answered (their text is not readable for completion).

### 2026-10-14, Master Profile: agency requests, AI fields from the first upload, document type screen

- Agencies can ask for any live or added detail and any catalogue document type; the server refuses an unknown detail and stores a known document type under its standard key. AI readings register the fields a document's type carries before they run, so an added field is offered from the first upload. People can now say what kind of document a file is, including Other with a name; this is owner-only, audited and tells the missions that use the document. Tests: services 8 (type 5, registration 3), web 15 (agency action 5, lists 4, registration 4, page 2) and the accessibility check for the new form. Guards proved able to fail: owner check, Other-only name, registration without overwriting, detail check, no registration for an untyped document.
- Not verified: the new screens with a real signed-in session and database; a real AI reading of a typed document (needs a provider key); the agency form with a real organisation. Agencies see roughly 800 details in one grouped list, which has not been tried on a phone.
- Known limits: a document's type is still chosen by hand or by approving an AI suggestion (no bulk change); the name of an Other document appears on the documents page only.

### 2026-10-14, Operations: smoke workflows and the git branch review

- Deploy Smoke and Playwright Deploy Smoke now skip the migration workflow's own deployment record (environment `production-migrations`, whose address is a job page, not a website), which used to produce a false red run after every production migration. Website deployments (Production and Preview) are unchanged. Takes effect once merged, because these workflows run from the default branch.
- Git branch review (same proof standard as the Neon branches), partly done: 48 remote branches. Proven merged, with the merged pull request's final head equal to the branch tip: `claude/visastack-ui-correctness` (#52), `claude/ai-budget-cache-eval-pr-c2` (#71), `claude/document-trust-simplified-pr-b3r` (#69), `claude/erasure-leasing-recovery-pr-b1` (#66), `claude/exact-sha-ci-e2e-verification-pr-e2` (#75), `claude/integration-cleanup-final-verdict-pr-f1` (#76). Not yet checked: the other branches. Kept on purpose: `claude/document-structural-trust-pr-b3` (#68 was closed unmerged and its description says the history is preserved there), `claude/clever-sagan-nk7n87` (#177 open), `claude/workos-staging-e2e-second-identity` (#77 open), every `wip/` branch (parked work), and the designated working branch. Nothing was deleted: git branches have no capacity limit, and this session may push only to its own branch.
- A content test (does the branch's whole net change already exist in main) cannot prove a branch is merged here: squash merges and later edits make it report "differs" for every branch, so only the pull request record counts as proof.

### 2026-10-14, Master Profile: document kinds and sharing categories

- Every document kind now takes its sharing category from the catalogue (the three original kinds are unchanged and looked up first). A grant already made does not change; the documents of a newly filed kind join only a new grant or an owner-confirmed expansion. Tests: 4 new (original three kept, catalogue kinds mapped by key and alias, unfiled and unknown kinds stay out, every filed category is one a grant can name, new grant covers it, existing grant does not). Proved able to fail (removing the catalogue lookup turned 3 red).
- Not verified: with real documents in production (none are real in the pilot); the screen shows the category only through the existing sharing pages.
- Effect to know: a medical or legal document given a kind will now be included when an owner creates a new grant for that category. That is the purpose of the category, and the owner picks the category and sees the list before confirming, but it is a change in what a new grant covers.


- 2026-10-14, country entry and visa-route reference data (batch 001): 156 countries, 61 routes and 85 requirement lines supplied by the owner are stored as reference data in `packages/core/src/destinations` with their source link and checked-on date. The owner chose to trust them as given. The checker found 24 countries with no stated facts (shown as not yet researched), 16 routes with no requirement lines, template-like route lists and a few unproven fees; none were changed. Not verified: the cited pages (the build sandbox has no internet), and no screen or readiness rule uses the data yet.

- 2026-10-14, document kinds and categories: the Documents filter showed no categories because uploaded files had no kind. The upload form now asks for the kind (optional), the list shows kind and sharing category and counts files with no kind, and the sharing page warns that such files are left out when parts of the profile are chosen. Existing uploads still need their kind set once (or an AI suggestion approved). Not verified live: a signed-in walk-through of the upload form and list on production.

- 2026-10-15, country sheets page check: of 187 cited pages, 126 opened and 61 did not. The 23 Schengen rows were corrected to the exact EU law sentence (Bangladesh is named in Annex I); Benin's quote was replaced with the English wording; the quote checker was fixed for character codes. Rows whose pages do not hold the copied words (Australia, Qatar, Ethiopia, Myanmar, South Africa, Kenya, Kazakhstan, Fiji) are flagged low confidence and needs check, facts unchanged. Not verified: the 61 unreachable pages; Kazakhstan (quote and status disagree) and Fiji (visa-free claim not on its page) need a person to check.

- 2026-10-15, profile areas: the ten areas no longer scroll sideways. They are a side list with progress on a laptop and one Area box on a phone. Rendered and measured in a browser at both widths; not verified on production signed in.

- 2026-10-15, countries screen: signed-in screen listing the 156 countries and their visa types with source, check date and warnings on every fact. Reference only; it does not drive any readiness rule. Rendered and tested here; not verified on production signed in. Data caveats are in the country-intake README (61 unreachable pages, flagged rows, Kazakhstan and Fiji to check first).

- 2026-10-15, countries navigation: the first release put the Countries link only in the top-bar page finder (`PRIMARY_NAV`), not in the sidebar, so it was effectively hidden; a report said otherwise and was wrong. The link is now in the personal and agency sidebars (agency pages added at `/app/agency/[orgId]/countries`). Rendered in a browser; not yet verified signed in on production.
### 2026-10-15, Agency branding: logo and workspace header

- Cause of the broken logo: the logo address pointed at the document download route, which needs a per-file access token that an organisation logo never has, so the browser showed a broken picture. Fixed by a dedicated same-origin route `/api/branding/logo/[orgId]` (signed-in only; the stored file already passed the upload check, a structural image check (real PNG or JPEG, size), before it was saved; no virus scan runs on logos today, and the production health page lists malware scanning as not configured; type checked again on read; `nosniff`, sandbox and same-origin headers). The address carries a short version tag so a replaced logo shows at once.
- The workspace header, the settings preview and the client invitation now share one mark and one brand description (`apps/web/src/lib/agency-brand.ts`): logo on a white tile, or the agency's initials on its accent if there is no logo or it cannot load. The accent colours the top bar, the small label and the tint; text colour is chosen for readability. "Powered by VisaStack" stays on all three.
- Settings: a live preview, eight ready-made accents (all pass the 4.5 to 1 reading check, tested), a colour picker, a typed code with a plain-words reading check, and logo upload, replace and remove.
- Tests: logo route (2), service read path and version tag (new cases in `branding.test.ts`), brand values (7), mark fallback, scope and form (11). The fallback test was shown to fail when the error handler is removed.
- Not verified: a signed-in look on production (this sandbox cannot sign in); the logo route is verified by tests, the route table and rendered screenshots only. No database change.
- Direction for branded documents is in `docs/product/agency-brand-kit-direction.md`.

### 2026-10-15, Country sheets: Kazakhstan and Fiji confirmed; Neon branch cleanup

- The owner confirmed the Kazakhstan row (visa required for an ordinary passport) and the Fiji row (visa free) as correct. Both keep their entry status; the "needs checking" flag is cleared and confidence is recorded as medium (not high: the cited pages still could not be matched word for word by the automated check). Each row's note records the owner confirmation on 2026-10-15. Tests that used Kazakhstan as the flagged example now use Azerbaijan.
- Neon (project NeonSadat, the VisaStack database): deleted the preview branch `preview/public-beta/baseline-and-neon-session-wiring` on the owner's instruction. Proof: its pull request (#181) merged and the git branch tip equals the merged head, no open pull request, no child branch, no Vercel domain bound to it, its last deployments were on 10 October, and nothing was written after its creation (0 audit events and 0 account changes after the fork time). Production, the current preview and two others remain: `main`, `preview/claude/keen-rubin-u4kzvp`, `preview/public-beta/r2-encrypted-recovery` (bound to a verified Vercel domain), `preview/claude/clever-sagan-nk7n87` (open pull request #177). Four branches in total, under the limit. The git branch of the same name was kept because the checkpoint docs name it.
- The owner also said to go ahead with a migration if one is needed. Nothing in this change needs one. A later brand kit (second colour, contact block, document templates) will, and its migration run will be reported before and after.

### 2026-10-24, Programme X WP-A0: audit gaps and items not verified

- Audit record: `docs/upgrades/programme/A0-AUDIT.md`; ledger `docs/upgrades/programme/COVERAGE-LEDGER.csv` (main `84cc84e`). Docs and scripts only; no application code changed.
- Security: `pnpm audit --prod --audit-level high` on main reported a critical Next.js advisory (GHSA-2464-fhr4-w9xw, remote code execution, up to 15.5.27) and a high one (GHSA-p3m5-59mp-jv5r). The lockfile pinned 15.5.25. Fixed on `claude/prog-sec-next-15-5-28` (draft PR, not merged). The version production runs was not verified: the Vercel connector was refused access to the team (403). The same PR raises the undici override to `>=6.29.1 <7.0.0` (via `@vercel/blob`). Zod is split into its own PR on `claude/prog-sec-zod-4-6-6` with a scoped override, `"zod@>=4 <4.6.6": ">=4.6.6 <5"`, which lifts 4.1.11 (via `@vercel/cli-config` and `@vercel/blob`) and 4.3.6 (via `@neondatabase/auth` and `better-auth`) to 4.6.7. Split because sign-up, sign-in, email confirmation, recovery and re-authentication could not be proven on staging from the container (staging addresses refused by the proxy). With all three changes the production audit at high reports 0 critical and 0 high.
- Security merged 24 Oct 2026 on the owner's autonomous-work mandate: #232 (squash `d3af862`) carries Next.js 15.5.28, the undici override and the scoped zod override; all three required checks passed on `57244c9`. #231 closed as superseded. Production served `next 15.5.25` before the merge (read from its public script bundle).
- Preview isolation gap (owner action needed, Vercel): the Neon integration's `POSTGRES_*` variables apply to All Environments, so previews of any branch use the production database (`NeonSadat`, branch `main`, database `visastackdev`). Seen when one preview sign-up attempt at 19:12 wrote 3 rate-limit rows and 1 audit entry (`SIGNUP_NOTICES_ACKNOWLEDGED`) to production; the signup guard refused the account because the preview's Neon Auth and database endpoints differ. Fix: limit `POSTGRES_*` to Production.
- Gaps the audit confirmed in current code: client invitations accept any signed-in holder of the link and their preview shows the agency-typed name and route (`client-invitations.ts`); an unknown effective date is saved as the save time (`profile.ts:320`); the `conflicts` table can only store AI-raised conflicts (`field_proposal_id` NOT NULL); no Prepare again, no cross-case Needs Attention view, no selected-output service, no prior-versus-current view.
- Not verified: the live site (the container's network refused the domain, proxy 403), so every landing measurement is local-lab on a production build of the same commit; auth pages (no Neon Auth configuration locally); signed-in screens (X03 counted from code, X10, X11 and Home load time not measured).
- Test note: `pnpm run test` timed out 3 tests in `apps/web/src/lib/ai.test.ts` (15 s) during the parallel turbo run; the same file passed in the standalone web run. Waiting for CI on the pushed branch before any change. No test was skipped.
- Owner decisions recorded in `docs/upgrades/programme/PROGRAMME.md`: CR13 (Harbor folder exempt from the dash rule), CR14 (Biome ignores the Harbor folder), D12 to D16.

### 2026-10-24, Programme X WP-L1: Harbor landing on the public home page

- Shipped: Harbor C1 hero, sample phone with four notices (two on phones), dark product chapter with four cards, preserved sections restyled in Harbor colour. Claims CL01-CL14 checked against code (ledger rows); CL08 ships the reduced text until WP-V6. D3 header links now go to Product, For agencies, Privacy and control and How it works.
- Two frozen Harbor text colours on the sample phone failed AA (4.29:1 on the tab strip, 3.53:1 on file captions). Raised to `fg-body` and `fg-muted`, labelled A11Y-EXCEPTION. Axe now reports 0 violations on five public pages at 1440 and 390 (local-lab).
- 360x640 fold: the headline wraps to four lines below 380px and the public beta banner is 136px tall on phones after #233, so the primary action sat 21px below the fold. Fixed with a hero spacing tightening below 380px (OWNER-EXTENSION, D4). Follow-up, not in this package: the 136px banner takes a sixth of a phone screen on every public page; a shorter phone layout for the shared banner is worth a separate change.
- Test harness race found and fixed: the workspace pixel test (light versus dark device setting must give identical pixels) mounts its fixture on the home page. With the new landing it failed in about 1 run in 5 (main 0 in 20 with the old landing). Evidence that the race is in the capture, not the product: main also fails 8 in 20 when the fixture mounts on `/status`; the served CSS for the fixture is byte-identical apart from the scoped landing stylesheet; layout is identical to the fraction of a pixel; reverting the header change did not help. Fix: wait for fonts and two painted frames before capture (`e2e/flat-ui-support.ts`). After: 20 in 20 on both carriers and both builds; an injected dark-only style still fails 3 in 3.
- Local verification note: one run was invalid because an orphaned server held port 3100; discarded and rerun with a guard that refuses a busy port and records the served build id.
- Not verified here: the live domain (container proxy), sign-in pages (Neon Auth not reachable from the container; same five Playwright and two smoke checks fail on main here). CI and the live probe after merge are the authority.

### 2026-10-24, Programme X WP-B1: brand assets from the VisaStack design system

- Owner request 24 Oct 2026: take the logo and brand assets from the VisaStack design system artifact, staying within the approved plans. Shipped: the single bolder V tile as an inline drawing (`BrandMark`, header and workspace mark at 28-34px, where the brand rules forbid the sliced mark; path and corner copied from the pack's file), with the reversed pair on the dark sign-in panel set by CSS (matching how that panel already inverted the old mark); unchanged copies of `favicon.ico` (16, 32 and 48 from the pack's PNGs), `icon.svg`, `apple-icon.png`, home-screen icons including the maskable one, a web manifest (`display: browser`, theme `#1D4C98`, background `#F7F9FE`) and the 1200x630 share image (approved wording only). `themeColor` in `layout.tsx` stays with WP-C1, as the pack itself advises.
- Checks: browser tests prove every file is served same-site with the right type and the page links them, and that the header mark is drawn inline in brand colours with no request. First attempt loaded the mark as a background image; the sign-up light versus dark pixel test caught it missing from one capture (it arrived after first paint), so the mark is now inline and paints with the page.
- Design system points that differ from the approved programme (reported to the owner, not acted on): (1) it says the application also uses the system font and never Inter, while D2 and CR03 keep Inter in the app; (2) it names the landing classes `.vs-c1` with bare names (`topnav`, `headline`), while WP-L1 shipped `.c1` with `c1-` prefixes; (3) its "D12" means the real mark in the header, while programme D12 is the neutral Declined label, so the numbers clash; (4) it advises keeping a source's failing contrast pair and flagging it, while WP-L1 raised two frozen pairs to AA because the repo's axe gate requires it (the pack also lists A11Y-EXCEPTION as an allowed label); (5) its application shell (64px top bar, 228px side navigation, 1320px frame) differs from the live shell (256px side navigation, 83px toolbar, asserted by tests) and is marked proposed there; (6) its 761-860px header gap fix belongs to its own landing header, while the live landing uses the shared site header.
- Phone banner (owner decision 25 Oct 2026, closes the WP-L1 follow-up): below 1024px the version banner shows short wording ("Free, at your own risk." for the public beta, "Test version. Made-up details only." for the pilot) next to its label and the "What works today" link; wider screens keep the full sentence naming virus scanning. Measured: 60px at 320, 360 and 390 in both modes (was 136px on a phone), 41px at 700; the full sentence takes 117px at 701, 98px at 768 and 71px at 900, so tablets get the short wording too, and from 1024px the full sentence fits one 44px line. Browser check: at 360px at most 64px with the short wording; at 1440px the full sentence.

### 2026-10-25, Programme X WP-C1: Harbor colour layer

- Shipped: root tokens from teal and paper to Harbor (every value checked against `HARBOR_TOKENS.json`), green tint literals to derived blue tints, the dark sign-in panel to the Harbor chapter colours, the two serif accent words to the heading font, `themeColor` and the agency ink. Map: `docs/upgrades/programme/colour-map.md`. 28 dead classes from the old landing removed (425 lines).
- Proof that only colour changed: every element's box recorded on `/`, `/trust`, `/privacy`, `/terms`, `/status` and the seven workspace screens at 1440 and 390, on the brand build (before) and this build (after). Visible layout identical on 23 of 24 screens; the 24th differs only in the width of the live "Check now" button on `/status`, whose label changes while the health check runs (it differed in the opposite direction at the other width in an earlier run). Zero-size nodes (scripts, streaming placeholders, the route announcer) vary with hydration timing and were excluded.
- Regression caught and fixed before push: axe found Harbor `fg.muted` (`#647386`) on the neutral ground (`#edf1f5`) at 4.26:1 in the sidebar and count chips on six workspace screens. `--text-tertiary` now uses Harbor `state.neutral.fg` (`#596879`), a deviation from the plan's map. After: axe serious and critical violations 0 on all 14 workspace screens. `palette-contrast.test.ts` holds the failing pairs and was shown to fail on the old value.
- Derived values reported to the owner (not in the Harbor package): brand tints 1 to 5, two dark-panel rule colours (white mixed into `bg.chapter`), and a darker danger-button hover `#8d2836`.
- Not verified here: sign-in pages (Neon Auth unreachable from the container); CI runs them against the preview. Chart segment colours (`--seg-*`) remain teal by plan, pending a separate proposal.

### 2026-10-25, Programme X WP-P0: WorkOS retired, Neon Auth only

- Shipped (brief: `docs/upgrades/programme/P0-BRIEF.md`; approved under the owner's autonomous-work mandate): `@workos-inc/authkit-nextjs` removed with every WorkOS branch (middleware, session bridge, session age, step-up, sign-out, identity port, callback and re-auth routes, readiness, commercial sign-in gate, content security policy, admin readiness view). Lockfile change is removals only (62 lines: the WorkOS packages and dependencies only they used).
- Behaviour now: Neon Auth is unconditional. A leftover `IDENTITY_PROVIDER` other than `neon_auth` is refused by `createIdentityPort` and reported by readiness. The public beta opens only with `PUBLIC_BETA_OPEN=true` and Neon Auth configured (https address and a cookie secret of 32 or more characters), so the site never invites sign-ups it cannot serve; production meets both. The old callback address now sends anyone to sign-in. The form-action policy is `'self'` only (sign-in posts to the site's own `/api/auth`).
- Renamed: commercial gate `workosProduction` is now `signInProduction` with attestation `COMMERCIAL_READINESS_ATTEST_NEON_AUTH_PRODUCTION` (the old flag name in `docs/operations/pilot-to-commercial-activation.md` and `docs/roadmap/remaining-commercial-blockers.md` is historical). Admin readiness lists the Neon Auth settings instead of the WorkOS ones.
- Kept exactly: the `workos_user_id` columns and every migration; the services field `workosUserId` and the services function `provisionAccount` that binds it (no WorkOS import; data-aware cleanup is a separate change if ever wanted).
- Tests: WorkOS-only cases removed with the code they exercised; provider-independent behaviour ported to Neon (step-up minting, the exact 5-minute boundary, missing-secret handling, session-age thresholds, return-path guards, sign-in configured fixtures). `authkit-paths.ts` and its test removed; the CSP middleware test now uses the Neon path rule. Web unit tests 1473 of 1473 pass.
- Not changed, follow-up: `.github/workflows/workos-staging-e2e.yml` and `e2e/authenticated-workspace.spec.ts` still describe the WorkOS staging journey; they are skipped by design on this repository and were not removed (no test is deleted to make a build pass). Porting that journey to the Neon staging account is a follow-up.
- Owner follow-up: the `WORKOS_*` and `NEXT_PUBLIC_WORKOS_REDIRECT_URI` variables in Vercel are now unused and can be deleted; the WorkOS application can be archived.
- Not verifiable from the container: email confirmation and recovery mail delivery end to end, and step-up on a real account. CI runs the sign-in checks against the preview, which uses staging Neon Auth.

### 2026-10-25, Programme X WP-V1: client invitations bound to the invited person

- Shipped: a client invitation sent to an email address now opens and accepts only for the signed-in account with that email (letter case and spaces ignored). Anyone else, for example someone given a forwarded link, sees "Use the email address that received this invitation." with no traveller name, route or agency, and nothing is claimed or created; the real recipient can still accept afterwards. The preview no longer returns the name the agency typed. An account already working with the same agency cannot claim an invitation meant for someone else.
- Verified already in place: sharing invitations were bound to the recipient email (`previewSharingInvitation`); single use, expiry, revocation, race safety, rollback on failure and refusal of another person's applicant id (existing tests); tokens stored only as hashes; both invitation pages send no referrer.
- Return path (R01): sign-up and sign-in links on the invitation page return to the accept page, token included; addresses that would leave the site are replaced with `/app`. Live: an unsigned-in visit to the accept page on production redirects to same-site sign-in with that return path (checked 25 Oct 2026).
- Residuals: (1) a client invitation sent to a phone number cannot be bound to a person and stays claimable by whoever holds the link and signs in; owner decision pending on requiring email. (2) The Neon Auth library copies the original query onto the sign-in address, so the token also appears there; it stays on this site and the sign-in page sends only the site name to other sites. (3) Invitation addresses appear in hosting request logs as for any link; tokens are single use, expiring and hashed at rest.
- Not verified here: signed-in acceptance on production (no real accounts used), email confirmation returning to the task end to end (mail delivery not reachable from the container). T02, T05 (partial intake and resume) are WP-V4; T15, T16 (grant revocation, shared device) are WP-V5.
- Security fix from the code scanner on this PR: the email check used on invitations could be made to run very slowly by a crafted address (a pattern whose parts overlap, so checking time grows with the square of the length; 1 second at 40,000 characters). The binding made it run on every preview and accept. Both invitation checks now cap the length at 254 and use a pattern whose parts cannot overlap; a test feeds the hostile input and fails on the old pattern. The sign-in form's check already capped the length first.
- Independent pre-merge review (owner rule of 25 Oct 2026: an Opus review agent reads every diff before merge) found nothing blocking and five weaknesses, all fixed before merge: (1) a contact that looked like an address but failed the check (a trailing dot, a name in angle brackets) was treated like a phone contact and opened to anyone; any contact containing "@" now binds and must match exactly, and malformed addresses are refused when the invitation is created; (2) the agency invite form kept its own copy of the old slow check and could say "Email queued" when none was; the service now reports whether it queued an email and the form shows that; (3) someone else's link could tell whether the invitation was revoked or expired; the recipient check now runs first; (4) refused wrong-account attempts are audited with ids only; (5) tests for each, each proved to fail when its protection is removed. One shared email check (`email-address.ts`) now serves both invitation types.
- Second review pass, minor points also fixed: a refused attempt is recorded once per account, invitation and stage, so refreshing cannot fill the permanent audit log, and a failure to record never changes the refusal; a contact without "@" must be shaped like a phone number (7 to 15 digits), so free text cannot slip through as an unbound contact; the new tests carry explicit time limits.

### 2026-10-25, Programme X WP-V2: dates, change impact and consistency foundation

- Shipped: `consistency.ts`. `classifyDeclarationChange` gives one of the five approved results (Consistent, Legitimate change, Context difference, Needs clarification, Insufficient information) after applying subject, time, currency and before or after tax. `compareFactVersions` compares an exact earlier version of a detail, for example one a case snapshot recorded, with the current one. It is owner only, decrypts protected values through the existing path, gives the same "not available" answer for ids from another person, another detail or nowhere, and audits ids and the result but never a value. An explanation is returned as a recorded assertion and never changes the result.
- Behaviour change: an effective date left blank is now stored as not known instead of the save time, so a later comparison says Insufficient information instead of treating the save time as the date it became true. The one older test that asserted the save-time rule was updated to the new rule (allowlist line added under the autonomous mandate).
- Fixed: marking a document replaced by a newer one (passport renewal) created a task on each case using it but did not move the case revision, so an acknowledgement made with the old document stayed valid. It now moves the revision in the same transaction, which voids that acknowledgement; snapshots stay exact.
- Not built yet, by plan: the prior-versus-current screen and making a difference actionable (WP-V3); blocking only the affected final readiness (T11, WP-V3); agency comparison with explicit scope for both sides (WP-V5); a stored resolution record. Results are computed on demand from exact versions; no table was added (W0-05, D13 not needed yet). There is no before or after tax field yet, so amounts that differ are reported as Insufficient information until a before or after tax detail exists (a catalogue change, held under D14).
- Independent pre-merge review (Opus agent) found nothing blocking and three wrong results, all fixed before merge: (1) a missing currency or tax basis on both sides was treated as the same; it is now not known; (2) the old amount's currency was read at its save time, so the usual amount-then-currency order looked currency-less; it now uses the currency set at save, else the first one entered while that amount was current, or the snapshot time when given; (3) the form still said "if not today" and older rows carry the save time as their date; the wording now says to leave it blank if unsure, and a date within seconds of the save time is read as not known (no stored data changed). Minor points also fixed: an older version passed as the newer one, or a malformed id, gets the usual not available answer; the same number written differently is consistent (not across currencies); two simultaneous supersedes cannot both bump the revision; a test shows a supersede voids a live acknowledgement. Each new guard was proved to fail without its protection.
- Second review pass: all eight confirmed resolved; three follow-ups fixed: identical amounts are no longer called Consistent while the currency is unknown or the tax basis differs; the current amount uses the latest currency, so a later correction counts; the old save-time default rule applies only to rows saved before 26 Oct 2026, so a genuine date is never dropped later. Recorded, not changed: approving an AI suggestion stores no date (not known), since taking one from the document would be a guess.

### 2026-10-25, Programme X WP-X1: case journey view

- Shipped (approved preview: case journey, two states): a Next step card under the stage tracker, built from the first item of the existing attention list in its existing order, with one primary action that goes where that item already pointed (for example "Fix 2 required items: some required items are missing, out of date or do not match"). With nothing needing attention the page shows the existing success badge and no card. A case changed since it was last acknowledged shows the existing notice, with its exact wording, restyled as the approved alert directly under the tracker and holding its own snapshot action ("Take a new snapshot", primary); it is that case's next step, so no card is shown with it.
- Phones: the stage strip shows only the current stage (the page header also names it), so the next step and the alert stay above the bottom bar at 360x640 and 390x664. The sentence about which stages can come next is kept for screen readers but hidden on phones; the move buttons further down show the same choices. Reversible; reported to the owner.
- Unchanged: acknowledgement and changed-case logic, snapshot creation, evidence selection, submission and outcome, permissions, routes, every existing control, and the order of the sections below. A characterization test of the page was written and passing before any edit, and passes unchanged after.
- Independent pre-merge review: first pass one blocker (the card was below the fold at 390px) and three should-fix points (wording that promised a block that does not exist, tests that passed with the feature broken, a status role on a static alert), all fixed; second pass nothing blocking, two phone follow-ups and a missing test, all fixed.
- Owner approved the reminder wording on 25 Oct 2026; it now shows on every case, directly under the next step or alert: "Preparing a file is not the same as submitting it. VisaStack does not submit applications or predict decisions."
- Held out by plan: the list of changed details inside the alert (WP-V3); the request triage summary under the card (WP-V4). Not measured: the live signed-in page (no test account), slow network.
### 2026-10-25, Programme X WP-X2: grant review brief

- Shipped (approved preview): the review step before sharing, and each grant card, describe the grant in plain rows: Who, For, They can, Can see, Can open, Ends on, then "Everything you did not select stays private." The whole profile, every document and no end date show in warning tone while access is live. Paused and pending grants read "They could"; revoked and expired grants read "Ended", without warning tone or the privacy line. New presentational `SelectedScopeSummary` (WP-V5 reuses it) and `describeGrantScope`.
- Each row follows the access rules, not the form's wording: specific documents give no profile details; profile details need "see document details"; opening needs "preview documents" or a download permission, and with details only the row reads "Document details" and says they cannot be opened; with both parts and documents chosen, only chosen documents inside those parts open; on cards, parts cover the documents as at sharing.
- Owner-approved download sentence (25 Oct 2026), shown only with Download selected: "Revoking ends access on VisaStack. It cannot take back copies someone already downloaded." Every grant already ends (30 days by default, 90 at most), so "No end date" never shows on this screen today; the end date is worked out in the browser, in the person's own time zone.
- Unchanged: the server action, pause, resume, revoke, scope expansion, grant lifecycle, services, permissions and defaults. A test proves the posted form fields are identical: it passes on the original form and fails if a field changes. Existing sharing tests unchanged.
- Independent pre-merge review: no blockers; three should-fix points (rows that overstated what is shared, cards for ended grants reading as live, a server and browser date mismatch for Bangladesh viewers) and four minor points, all fixed.
- Second review pass: three more rows that could overstate, fixed: documents show to a recipient only with "Preview documents" (their list checks nothing else), so without it no document shows and chosen ones are named as not visible; a download permission alone no longer counts as opening; a revoked grant says it ended "when you revoked it" instead of its planned date, and a grant past its end date reads as ended even while its stored status is still active. Also: a case grant says nothing from it is shown to them yet (today's behaviour), and the download sentence shows in warning colour.
- Owner decision 25 Oct 2026: the download wording (and the approved download sentence) shows only when Preview documents is also ticked, since without Preview no document shows to the recipient.
- Noted, not changed: the permission label "See document details" also governs profile details; renaming a permission label is outside this package.

### 2026-10-25, Programme X WP-X3: phone context chip and navigation

- Shipped (approved preview): on phones and tablets (below 1024px) the top bar shows who you are acting as, without opening More: initials and first name for a person, the agency's name for an agency, "Platform" for platform operations, "No access" where the current context is not available. Tapping it opens the same list of places you can switch to as the full selector. Read aloud, it starts with the visible words, then the full name and context, without repeating them.
- Behaviour: the list closes on Escape (focus returns to the chip), on a tap anywhere else, and on moving to another page; it sits above the phone search panel. The bottom bar keeps exactly four links and the rest stay in More, none repeated. The account button shows its icon only below 600px, and the Help icon leaves the phone top bar (Help & support stays in the account menu) so the label has room.
- Measured locally in Chromium with the real stylesheet at 320, 360 and 390px: no sideways scroll, menu open or closed; a person's first name shows in full at 320px; a long agency name trims with an ellipsis. At 320px only short names fit in full.
- Unchanged: what any context grants, the full selector in the sidebar and More sheet, routes and permissions. The chip reads the same access list and grants nothing.
- Independent pre-merge review (Opus agent), two passes: the first found the list running off the right edge, a chip that stayed open over other menus, misleading first-word labels for agencies and weak tests; the second found the list under the search panel, labels cut to a few letters, a label that no longer trimmed without initials, and repeated spoken words. All fixed before merge; tests proved to fail when the fixes are removed.
- Not verified: the live signed-in phone bar (the live signed-in check covers it once merged), slow network.

### 2026-10-25, live signed-in check on production

- Shipped (owner request of 25 Oct 2026): `apps/web/e2e/live-signed-in.spec.ts` and `.github/workflows/live-signed-in-check.yml`. After each successful production deployment, and on demand, a browser signs in through the real sign-in page with a dedicated test account the owner created (made-up details only), then checks: the signed-in workspace opens and is not sent back to sign-in; on a 390px phone the top bar shows who you are acting as without opening More and the page does not scroll sideways; the test person's overview, profile, documents, cases and sharing pages open without an error.
- Read-only: it opens pages and menus and creates, edits or shares nothing. The person pages are found from the account's own context list, never from a guessed id; if the account has no person yet, that part is skipped and says so.
- Credential safety: the email and password come only from the repository secrets LIVE_CHECK_EMAIL and LIVE_CHECK_PASSWORD, are never printed, and the check skips cleanly when either is missing. Traces, screenshots and video are off for this file (a trace can record what was typed into the password field), and the workflow uploads no report, so the credentials cannot land in any stored file. Workflow permissions are read-only.
- Review fixes before merge (Opus review agent): one sign-in per run and no automatic retry, because sign-in is limited to 10 attempts per email address per hour and repeated runs could lock the test account out; it always signs in on https://vs.obsidianglobal.studio, never the one-off address a deployment event carries; runs wait for each other instead of cancelling; a run with no secrets says "Skipped" in its summary instead of looking like a pass; each page is also checked for the error screen wording; the timeout allows for a cold database start.
- Supply-chain guard (`scripts/supply-chain/checks.mjs`): the workflow is on the reviewed list of workflows that may read secrets, with enforced rules: it runs only in the `live-check` environment, discards the checkout credential, starts only after a deployment or by hand (never on push, pull request, schedule or workflow_run), uploads no artifact, and may read only the two test account secrets. A test proves each rule fails when broken.
- The job runs in the GitHub environment `live-check`. Owner step (asked 25 Oct 2026): create that environment limited to the main branch, add the two secrets there and delete the repository-level copies, so a run from another branch cannot read them. Until then the environment is created automatically with no rules and the repository secrets still work, so nothing breaks either way.
- Not verified here: the first real run. It needs a production deployment after merge (or a manual run) with the secrets present; its result is reported after merge. Neon Auth sign-in cannot be reached from this container.
### 2026-10-25, client invitations are email only

- Owner decision (25 Oct 2026): a client invitation goes to an email address only. Closes the WP-V1 residual where an invitation sent to a phone number could not be bound to a person and stayed claimable by whoever held the link and signed in.
- Shipped: `createClientInvitation` refuses anything but a valid email address ("Enter the client's email address."); the agency form field is now "Client email address" (an email input) with the hint "Only someone signed in with this email address can accept the invitation." An invitation stored with a phone number before this change binds to nobody: it can no longer be opened or accepted by any account, the person sees "This invitation can no longer be used. Ask the agency to send you a new one by email.", the attempt is audited without personal details, and the invitation is left pending (not spent). The agency's client list marks such an invitation "Cannot be accepted, revoke and invite again by email".
- Production at release: 2 pending client invitations, both to email addresses; none sent to a phone number, so no one is affected by the change.
- Supersedes the client row of `docs/public-beta/CURRENT-STATE.md` ("Client links retain authenticated token-holder acceptance ... Phone contacts use manual link sharing"): client links now accept only the invited email address, like team links.
- Tests: creation refuses phone numbers and malformed addresses and stores nothing; an older phone invitation is refused on preview and acceptance for every account and stays pending with no case created; nothing is queued for email. Both guards were proved to fail when removed. Unchanged: email-bound acceptance (addresses compared trimmed and in lower case, exactly as account emails are stored), the neutral wrong-account message, expiry, revocation and single use.
- Code review before merge (/code-review, max effort; rule of 25 Oct 2026): the agency badge now uses the same address check as creation, so a malformed older address also shows "Cannot be accepted", and an expired invitation shows "Expired"; someone reopening an older phone invitation they already accepted is told it was used, not to ask for a new one (which would have created a second case); a mistyped address says it is not valid; one place works out a refusal's reason, recorded in the audit event as `wrong_recipient` or `phone_invitation`; the message when email sending is not set up on the server says so. Documentation: the IAM-03 ledger row, `docs/public-beta/CURRENT-STATE.md` and `docs/operations/invitation-journeys.md` record the change. Not changed, on purpose: older phone invitations keep their own handling rather than being revoked in production data (there are none today; revoking would be a production data change).

### 2026-10-25, production-only deployments (no branch previews)

- Owner decision (25 Oct 2026): stop branch preview deployments and deploy only to production after all checks, because the Vercel plan allows a limited number of deployments a day. `apps/web/vercel.json` now sets `git.deploymentEnabled` to `{"**": false, "main": true}`: every branch (including names with a slash, such as `claude/...`) is skipped, and main still deploys to production. This also stops the automatic Neon database branch Vercel made for each preview.
- The two required browser checks keep their names and now run on each pull request in `.github/workflows/pr-browser-checks.yml`, against the pull request's own production build started on the CI machine with placeholder settings that reach no real service (`IDENTITY_PROVIDER=neon_auth`, `NEON_AUTH_BASE_URL=https://auth.placeholder.invalid/...`, a random cookie secret made on the runner). No secrets are read. After merge, `deploy-smoke.yml` and `playwright-smoke.yml` still run the same checks against the real production deployment, so the "against the deployed site" rule (master directive section 8A) is kept for every release.
- Checked locally with those settings on a production build of the current main plus the interface sweep: smoke 11 of 11 and Playwright 202 of 202 (ux-public, browser-security, no-secret-auth). The six checks that used to fail locally needed only the sign-in settings to be present, not a reachable sign-in service.
- Not verified here: the first pull request run of the new workflow (this pull request is the first), and Vercel honouring the branch rule (no preview deployment should appear on this pull request or later ones).

### 2026-10-25 false red smoke runs after each production deployment

- Cause: the live signed-in check runs in the GitHub environment `live-check`, which records its own deployment whose address is the job page. Deploy Smoke and Playwright Deploy Smoke ran on that record too and tested a GitHub page: Deploy Smoke run 778 (b0f4b79) failed 1/11 against the job page, Playwright run 778 was cancelled at its time limit; the same happened on cb73410 (runs 771).
- The real production runs for b0f4b79 passed: Deploy Smoke 774, Playwright Deploy Smoke 774, live signed-in check run 8 (1 passed), CI on main green. Production was never affected.
- Fix: both workflows skip deployment records from `live-check`, as they already skip `production-migrations`.

### 2026-10-25, Programme X WP-V3 part 1: task-first first run

- Owner approved the revised first-run screen 3 on 25 Oct 2026 ("approve first run"); D7 and D8 were approved on 24 Oct. WP-V3 ships in three reviewed parts: first run (this), the four-tab shell, then Application Memory and the prior-versus-current view.
- Shipped: someone new (core processing off, no other consent on, no applicant) sees one question per screen. Screen 1, "Allow VisaStack to process your details", shows only the core processing control ("Allow core processing") and says AI reading, sharing and marketing stay off. Screen 2, "Who is this record for?", is the existing applicant form presented as Me, or Someone I manage, which reveals Family member or Minor (guardian) and the authority confirmation; values sent are unchanged. Screen 3, "What do you want to do?", offers Complete a request (only when one is open), Update or find my records, and Skip for now. "Not now" shows the ordinary home with every consent control.
- A return path to a workspace page or an invitation (`/app?next=`) skips screen 3 after screens 1 and 2; anything else (off-site, home itself, API or sign-in pages) is ignored. Someone with consent and an applicant sees the home exactly as before; a returning person with records, or with any other consent still on, never sees first run, so every consent control stays in reach (defect register finding #22).
- Safety details: the name step sits on `/app?welcome=1`, so the refresh after saving shows screen 3 from the server; Continue waits until the page is ready, so a tap before then cannot save a relative as Me.
- Tests: a characterization test of the home page was written and committed before any edit; first-run tests cover exactly one consent control, the return path, skipping, and not showing to set-up users; the existing consent button, form behaviour and form accessibility tests pass unchanged. Guards were proved to fail when broken.
- Independent pre-merge review (Opus agent): one blocker (the existing applicant form started needing the router, breaking two existing tests) and four should-fix points (screen 3 depended on a client step that might not run, an early tap could save the default choice, the return path accepted any same-site page, a returning person could see first run). All fixed before merge.
- Second review pass: confirmed every earlier finding fixed; found that a return path with `..` (for example `/app/../privacy/export`) passed the workspace-only check. The path is now resolved the way a browser resolves it before the check, and encoded dots or slashes are refused; tests cover the bypasses. "Not now" now leads to the task when one was given, so an invited newcomer is not left on the home page.
- Code review (/code-review, high effort; owner rule of 25 Oct 2026): first run is now only for someone new, with no records, no agency or platform role and nothing shared with them, so agency staff and people who only receive shared access are never sent through it; the return path accepts workspace pages only (the public invitation page would have asked a signed-in person to sign in again); the first-run form sends the choice with its own radios (`whoFor`, `managedKind`) and the server works out the relationship, so it works before scripts load and the Continue gate is gone; the per-person reads run only when the home page is shown; a waiting sharing invitation counts as a request to complete; the authority sentence is shared by both applicant forms. `actions.ts` and a new `actions.test.ts` were added to the WP-V3 allowlist for this, with the reason recorded there. Noted, not changed: the existing applicant form's relationship menu has the same before-scripts behaviour as before this package.
- Accessibility review (owner rule of 25 Oct 2026), measured in Chromium with the real stylesheet at 320, 360 and 390px: axe (WCAG 2.0, 2.1 and 2.2 A and AA rules) found 0 violations on all three screens; no sideways scroll; every choice card and link at least 44px tall apart from "See all permissions", a link inside a sentence; one heading per screen; keyboard order follows the screen. Fixed from the review: the authority confirmation now comes after the name, as in the approved preview, and a choice card shows a clear focus outline when reached by keyboard.
- Not done: nothing sends people to `/app?next=` yet (sign-in goes straight to the task page), so invited newcomers keep today's invitation flow; recorded under E01. Not walked live: needs a fresh test account.

### 2026-10-25, Quality window Phase 1: sign-in and scheduler hardening (PR 243, merged)

- Baseline audit in four areas (architecture and backend, frontend, quality system, security against ease of use). Every finding was checked against the code before acting; three were not acted on: the "purpose check always passes" finding is by design (each share is evaluated against its own purpose label, and the suggested change would block legitimate agency access), the account-exists message on the share form needs the owner's invitations decision, and passing the reauthentication proof down to services belongs with the central permission gate.
- Sign-in proxy: the browser may POST only `sign-out` through `/api/auth/*`. Sign-in, sign-up, recovery, reset and confirmation are server actions behind the attempt limits; before this, a script could post to `/api/auth/sign-in/email` directly and skip them. An exact-path allowlist also refuses `..` and encoded tricks (a first deny-list draft missed them; caught by code review before push).
- Scheduled jobs: one shared gate (`apps/web/src/lib/cron-auth.ts`, constant-time comparison, neutral 503 reply) replaces 16 plain comparisons; a guard test fails if any job route checks its credential another way.
- `postcss` override bounded below 9. Two web tests that loaded the jobs module inside a 5 s test now load it once in `beforeAll` (under full-suite load they timed out and leaked into the next test).
- Not verified: whether Neon Auth's own endpoint applies its own attempt limits when called directly, bypassing this app entirely.

### 2026-10-25, Quality window Phase 2: faster CI

- Test databases start from a migrated snapshot. `@visastack/db/testing` provides `createMigratedPglite()`; a Vitest global setup (`packages/db/src/test-global-setup.ts`, registered in the services, adapters and db configs) migrates once per test run and every test database loads that copy (about 0.4 s instead of about 1.5 s; each is still independent). 64 test files switched; tests of the migrations themselves, and six files that migrate once in `beforeAll`, keep migrating by hand.
- Measured locally before the global setup was added: the services suite alone went from 2,441 s to 1,266 s of test time (1,469 tests, all passing).
- CI runs as parallel jobs: lint and audit, build and typecheck, three service test shards, and web plus the other packages. The final job keeps the required check name "Lint · Build · Typecheck · Test" and passes only when every job passed. It runs even when the run is cancelled, so a cancelled or skipped job turns it red: a skipped required check would count as passed. ClamAV is installed only in the job whose live scanner test uses it.
- One `pnpm run test:node` list of repository script self-tests is used by both `pnpm test` and CI. The UI-ratchet and allowed-paths self-tests now run in CI; before, they ran in neither or only locally.
- New tests that need a migrated database should use `createMigratedPglite()`.

### 2026-10-25, Phase 2 faster CI: review on takeover

- The PR was taken over from the parallel session at the owner's request and reviewed again (/code-review high). Fixed: the required summary job now always runs, so a cancelled run turns the check red instead of being skipped (GitHub counts a skipped required check as passed); the last seven service test files that migrated by hand now start from the snapshot; the snapshot builder lives apart from the Vitest-only helper, so the global setup loads no worker code; the migrations folder is written down in one place (`packages/db/src/paths.ts`), used by the migration script, the snapshot and the migration tests; the outcome privacy check also looks for "paragraph" and "Refused under", so a cut-down citation still counts as a leak.

### 2026-10-25, the Sliced V everywhere

- Owner request 25 Oct 2026: the header mark, the favicon and the other marks show the Sliced V, not the single bolder V. The brand pack reserved the sliced mark for 32px and up and used the single V below that (and in the landing header, decision D12); the owner's instruction replaces that choice.
- Shipped: `BrandMark` draws the pack's `visastack-app-icon.svg` (blue tile, white V in slices; reversed on the dark sign-in panel by CSS as before); every placement is at least 32px (phone header, workspace and toolbar marks were 28px); `icon.svg` is the same sliced tile; `favicon.ico` holds 16 and 32 px drawn down from the pack's 512 px sliced icon plus the pack's 48 px file. Home-screen, apple and share images already used the sliced V and are unchanged.
- Trade-off reported to the owner: at 16 px in a browser tab the slices are only a few pixels apart and can read as a solid V on low-density screens.

### 2026-10-25, before or after tax for income amounts

- Shipped (owner decision, 25 Oct 2026): the profile asks, right after annual income, monthly salary and self-employment income, whether the amount is before or after tax ("Before tax" or "After tax"; optional). It never changes the completion figure. It is shared only where the amount itself is shared.
- Comparisons now use it: two amounts known to be on the same basis are compared as amounts; before against after reads Context difference ("One amount is before tax and the other after tax."); unknown stays Insufficient information.
- No live field, data or migration changed. Details in `docs/product/master-profile-enrichment/HANDOFF.md` (session log of 25 Oct 2026).
- Not verified: the signed-in profile screen on production (the live signed-in check opens the profile page but does not fill it in).

### 2026-10-25 tax basis: review follow-up

- /code-review (high) on the tax basis change. Fixed: no way back from a mistaken pick (new choice "Not sure", read as not recorded); the basis was still asked when its amount was marked as not applying; option wording and the `_tax_basis` key link were repeated in three places (now one source in the catalogue); a section's open state now counts any saved answer, as completion does; the two companion lookups run together.
- Kept by design, documented in `valueDeclaredWith`: a correction made while the older amount was still current cannot be told apart from a change made ahead of a new amount, so the older amount keeps the value it was saved with; and a basis first given after a newer amount was saved does not reach the older one, which stays not known. In both cases the comparison says "not recorded" or reports a difference for the person to check; it never assumes two amounts are the same kind.

### 2026-10-25, Title Case for the names of things across the interface

- Owner request 25 Oct 2026: terms use Title Case ("Share & Care"), sentences keep sentence case. About 750 labels changed across headings, card titles, field labels, buttons, tabs, badges, menu items and status label tables, including the English message catalogue and code-to-words helpers (`humanizeCode`, admin analytics labels). Sign-in buttons now read "Sign In"; the live signed-in check, the staging route check and the no-secret sign-in check were updated with them.
- Guard: `title-case.test.ts` scans the interface source for headings, card titles, field labels, label, idle, title and eyebrow props, and both sides of a label choice. It does not cover labels longer than six words or built from variables; those were checked by the one-off sweep.
- Review (/code-review high) fixed half-converted choices, the smoke script fixture, "vs." and a lone capital "A", and found 22 more labels once the guard read both sides of a choice.
- Checks on the final code: web tests, Playwright 202/202 and smoke 11/11 before the last rebase; the rebase onto the first-run and tax basis changes converted their new labels and tests.

### 2026-10-25, documents behind the profile details

- Owner request 25 Oct 2026: a slip or certificate number is not enough; the document itself must be on file, and many must be handed in as originals while scans (such as visa stamps) are enough for others.
- Shipped: each open profile section lists the kinds of document that back its details (from the catalogue's `supports` links), shows "Uploaded" or "Not Uploaded Yet", and links to the upload form with that kind already chosen. 26 more catalogue document types are marked as usually needed in original; the profile and the upload form say so in plain words ("usually"), never as a rule. No database change.
- Checks: master profile view, profile editor and upload form tests cover the list, the counts, the link and the original note; the view test was proved to fail when the original flag is dropped.

### 2026-10-25, schema and migration drift guard, weekly dependency updates
- New test packages/db/src/schema-drift.test.ts (adopted from a reference prototype, brought onto current main): it runs drizzle-kit generate against a throwaway copy of the committed migrations, offline, and fails if a schema change has no migration, if the journal, SQL files and snapshots disagree, or if drizzle.config.ts writes migrations anywhere other than the folder production migrates from (src/paths.ts). It never writes to the real migrations folder and fails closed when drizzle-kit would need an interactive answer.
- Proven able to fail: a table added to the schema without a migration turns the generate check red; pointing drizzle.config.ts "out" elsewhere turns both checks red.
- renovate.json: weekly grouped update PRs (Monday before 06:00 UTC), nothing merges on its own, at most 5 open and 1 new per hour, major upgrades wait for approval on the dependency dashboard, GitHub Actions grouped, pnpm overrides and the Node/pnpm versions never touched, 3-day minimum release age.
- Not active yet: Renovate does nothing until the owner installs the Renovate GitHub app on the repository. Dependabot security alerts are separate and also need the owner to enable them in repository settings.

### 2026-10-25, AI review experience (Phase 1): check what we found

- Owner direction 25 Oct 2026: extracted data must be reviewed and approved before it reaches the profile, in a review people of every background can finish on a phone. `ai.ts` released for this work (HANDOFF note).
- Each document's readings now appear as "Check What We Found": differences with the profile first, then readings to check, then clear ones; plain badges ("Clear", "Please Check", "Sensitive") instead of percentages; the exact words found shown as "Found as"; an unfound quote says so; nothing is saved until accepted.
- A difference with a confirmed value asks "Which is right?": use the document's value (saved with no conflict left), both are right because it changed (saved with the date it changed, history kept), or keep the current value (nothing changes). Without a choice the old behaviour stays (saved as a conflict to check).
- "Accept N Clear Details" saves, in one step, only readings that are confident with every quote found word for word, for an everyday (STANDARD) detail that does not differ from a confirmed value. The server checks every rule again; sensitive details are always decided one at a time.
- Every value read from a document links back to it ("Where This Came From"). Profile entries now say whether a value is protected; a protected value is never shown in a comparison.
- Checks: service tests for both decision paths and the bulk rules (ownership, other person's ids, unfound quote, low confidence, restricted field, difference); review screen tests; accessibility scan case; profile link test.
- Review hardening (same branch): a reading is decided once only (a second accept, skip or bulk save of the same reading is refused or counted as already decided, with nothing written); "Both Are Right, It Changed" needs a real past date and is not offered for a date or place of birth; a reading counts as clear only when its value appears inside a quote found in the document; one address among several (a repeating record) is never saved in bulk; a reading whose value the person edited leaves the bulk count; the comparison with the profile runs on the server with the decryption key, so an equal protected value is not reported as a difference and a sensitive or protected current value is never sent to the page; the outcome of a decision stays on screen after the decided card disappears; a detail with no registered plain name is named from its key. Each new guard was broken on purpose and its test went red.

### 2026-10-25, sign-in checks once per page instead of twice
- Adopted from a reference prototype (already code-reviewed there) and brought onto current main. Within one page render the workspace frame and the page now share one identity read, one run of the account checks (pilot access, invitation claim, provisioning, staff check, session-age limit) and, while they overlap, one database pool. Every new request starts from nothing: the pilot-access check and the session-age limit still run on every request, and a refusal is thrown in every waiting call.
- The "still active" timestamp is written after the response and at most once an hour per account (the same window the database write already enforces). A pending inactivity warning is still cleared before the page is shown.
- Behaviour change: a failed activity write used to show an error page; it is now logged and the page still loads, and the next request tries again because the timestamp is still old.
- New test session-cache-real.test.ts checks, against the React build Next.js actually runs server code with, that cache() remembers nothing outside a page render, so server actions, route handlers and different people never share sign-in state. The prototype's own tests use a stand-in for cache().
- Not verified against live Neon or Vercel until after merge.

### 2026-10-25, central access gate (not yet used by any page)
- Adopted from a reference prototype and finished: packages/services/src/access/ gives requireAccess (who may do what with one applicant, case or document, decided from live data by the existing policy engine), a proof type only it can issue, scopes for scheduled jobs and staff, and a ratchet test. Nothing calls it yet; adoption across the service functions comes in later slices.
- Fixed on top of the prototype review: a "recent identity confirmation" is now a signed, short-lived proof for one account, one action and one record (StepUpProof, made only by verifyStepUp from the existing step-up token), never a yes/no a caller can claim; the gate always uses the real clock, so a caller cannot revive an expired grant by passing an old date; identity, tax and bank documents and, by owner decision today, all 16 medical document types (and any added to the medical category later) need that confirmation before preview or download.
- The ratchet no longer accepts a bare Principal (anyone can name an account id), follows calls into older unchecked functions (including under a renamed import) and wrapped exports, and allows systemPrincipal only in the scheduled job routes. Its list of functions still to move behind the gate grew from 240 to 313: 72 of those added were already reaching applicant data indirectly and are now visible; none was made less safe. The 313th is approveClearProposals from #254, which checks ownership itself like approveProposal.
- Proven able to fail: a new function reaching applicant data through a renamed import, a wrapped export, systemPrincipal used outside the job routes, and removing the restricted-document mark each turned a test red. Forged proofs, copied proofs, a boolean step-up and a caller-chosen clock are compile errors (forgery.test-d.ts).
- Independent review (no blockers) fixes on the same branch: a document whose type is not known yet is treated as restricted (it could be a passport); all identity and civil-status documents (18 types today, such as passports, ID cards, birth, marriage, refugee and gender papers) and joint account statements are restricted; previews and downloads are decided one document at a time, never for a whole person or case; a proof's records are frozen so they cannot be changed after it is issued; a step-up proof runs out with the signed token it came from; an organization grant that also names a person reaches only that person; a claimed contributor request ends when its link expires; ids must be in the lower-case form the database writes. The ratchet no longer accepts the class itself as a gate, requires every overload and wrapped function to take one, fails closed on exports it cannot judge (a class, `export const f = g`, a function returned by a call), and sees module-level table aliases, destructured tables, `schema['table']` and the `db.query` API. Each of these was broken on purpose and its test went red. By owner decision the whole financial group (35 types today: statements, tax, income, loans, cards, property and sponsorship papers) is restricted too.

### 2026-10-25, Check What We Found: design fidelity polish
- From a design check against the mockup mapping docs (screen 06, the selected-document pane): the findings block is a hairline section, not a third nested box; every finding card keeps the same indent, with a 4px warning stripe only on readings to check; Accept no longer stretches to full width beside Skip; spacing on the 4/8/12/16 scale; subtle hairlines between cards; badges use the shared StatusBadge; while "Accept N Clear Details" is saving, each card's buttons refuse clicks (busy, focus kept, not disabled) so nothing is decided twice. A test proves the lock and went red when it was removed.
- Not verified: signed-in visual acceptance of the wallet pane at desktop and phone widths.

### 2026-10-25, document protection switches for platform admins

- Owner request: the restricted-document rule (which documents need a fresh sign-in check before anyone previews or downloads them) can now be switched on and off by a platform admin, based on feedback, instead of changed in the code. Branch claude/document-protection-switches, built on claude/access-gate at a859479. Nothing in the app calls requireAccess yet, so no traveller or agency sees a change until a page uses the gate.
- Defaults unchanged in kind and match the gate branch: the Medical, Identity and Civil, and Financial groups are restricted (Financial by owner decision 2026-10-25, 35 types today), plus the named passport, NID, tax, bank and medical types, and any document whose type is not known yet. No stored switch means the default.
- Data: new table document_protection_settings (migration 0087_document_protection_settings.sql): one row per switch (a document group, a document type, or the single not-sorted-yet rule), with on or off, who changed it, when and an optional reason up to 500 characters. Database checks keep the switch kind, key length and reason length valid. The migration has not been run against any real database.
- Service: packages/services/src/document-protection.ts. Changes need a staff scope for the new platform action DOCUMENT_PROTECTION_MANAGE (mapped to Security Admin, like AI settings; platform owners also qualify), refused if copied, for another action or older than five minutes. Any change that removes protection (turning off, or going back to a standard setting that is off) needs a fresh sign-in check; turning protection on never does. Every change writes a DOCUMENT_PROTECTION_CHANGED audit event with the reason, in the same transaction; a repeat of the current setting writes nothing.
- requireAccess reads the switches inside its own transaction, in a savepoint so a failed read cannot spoil the caller's transaction, and falls back to the built-in defaults if the read fails (never to "nothing is restricted"). A switch on a single document type beats its category. isRestrictedDocumentType stays the pure decision and now takes the effective settings (defaults when none are given).
- Admin page: /app/admin/document-protection, linked from a Document Protection card on Platform Settings shown only to holders of the permission. It lists the not-sorted-yet rule and the 14 document groups, each with its document types behind a disclosure, the current state, the standard setting, who changed it and when, and the reason. Turning protection off asks for confirmation on the page (with an extra warning for documents not sorted yet) and then the same sign-in re-check the other admin pages use.
- Tests: 11 service tests (defaults, overrides, the unknown-type switch, permission refused, step-up required, audit written, invalid switches, the overview, and requireAccess honouring a switched-off category, a switched-on extra type, the unknown-type switch and the read-failure fallback), a Security Admin line in the platform role test, 18 web tests (page gate and plain wording, actions, the confirmation step, the settings card) and two new cases in the form accessibility scan. 14 guards were broken on purpose and each turned a test red.
- Not verified: no browser run, build, full test suite or CI (machine-sharing rules for this session). The re-check sends the admin to sign in again and back to the page, where they confirm the change once more, as on the other admin pages. Open for the owner: whether a reason should be required when turning protection off.

### 2026-10-25, document protection switches: review fixes and a required reason

- Supersedes two lines of the entry above. If the switches cannot be read, requireAccess no longer falls back to the built-in defaults (that would drop protection an admin added): every document, known or not, needs a sign-in check until they can be read, and the failure is written to the server log. The admin page shows "Document protection settings are not available yet. The standard protection rules are in force." instead of an error, for example before the migration has run.
- Owner decision: a reason is required for any change that removes protection (turning a switch off, or going back to a standard setting that is off). The service refuses an empty or blank reason before the sign-in check, the server action refuses it, and the form makes the field required, with a visible "Reason" label and the hint "Say why, without names or document details." Turning protection on keeps the reason optional.
- The reason is kept only in the settings table. The audit event records the switch, the state before and after and whether a sign-in check was used, never the free text.
- The on-page confirmation is now checked on the server for any change that removes protection, judged against the live state, so a reset that removes protection needs it as well as turning off.
- Page wording: a group that is on but has documents switched off one by one says "Asks for a fresh sign-in check, except N documents switched off one by one."; a group that is off but still has protected documents says "N documents in this group are still protected."; a document's last change says "If reset: On/Off", because that depends on its group.
- Accessibility: every reason field has its own name for screen readers ("Reason (optional) for Medical"), focus moves to the reason when a confirmation opens and back to the button that opened it after Cancel.
- Tests: 13 service tests, 25 web tests for the page, actions, form and settings card, and the form accessibility scan. 16 more guards were broken on purpose and each turned a test red.
- Not done, by agreement: refused attempts are not audited; readDocumentProtectionSettings stays exported; the savepoint needs a driver that supports transactions (the neon-http client used by stateless probes does not, and would then restrict everything rather than fail open).

### 2026-10-25, document protection switches: re-review fixes before merge

- Correction to the entry above: when the switches table is missing, the admin page no longer says "The standard protection rules are in force." It says every document needs a fresh sign-in check, which is what actually happens (commit c8a96c9).
- Independent re-review: no blocker, all nine earlier review items confirmed in the code. Fixed from it: a stale page that sends "Use Standard Setting" for a switch that now removes protection gets a plain "Reload the page" message instead of asking for a confirmation it cannot show; the service comment now describes the restrict-everything fallback.
- Full local check found two real faults, both fixed: the migration snapshot and journal were not in the repo's file format, and the service read two schema constants at load time, which crashed every other package whose tests replace the database module (the health check tests and the intake runner tests). The service now keeps plain copies, and a test pins them to the schema.
- Sign-in check: asked only for changes that remove protection; turning protection on needs none (lower friction, same protection).

### 2026-10-25, WP-V3 part 2: four-tab shell

- What changed: a traveller's navigation is now four tabs, Home, Record, Cases and Sharing, with Notifications and Countries under More on a phone. Record is a new hub page (`/app/applicant/[id]/record`) that lists open profile sections and documents in their groups, with search by names, kinds, groups, states and cases, filters (Ready to Use, Needs Attention, Previous Versions, Profile Details, Group) and actions View, Update or Replace, Use in Case and Share. Profile, Documents, Dates & Expiry and History are sections of Record: their pages keep their addresses, show a Record sections bar, and light up the Record tab. The tool "Account Overview" is now "Account and Permissions". Agency and platform navigation are unchanged.
- Honesty rules: a file still being checked, refused, held back by the safety check, expired or replaced is never shown as ready to use and is never offered for a case or for sharing. A replaced document is labelled Previous Version and points at its replacement. "Current Version" is explained on the page as the newest copy saved, not a check that it is genuine. No profile percentage is shown.
- No route removed. One page added. No change to sign-in, consent, sharing rules, services or the database. The hub reads only what the owner's own profile and documents pages already read (`getWalletView`, `listDocumentsDetailed`, `listApplicantProfile`, `getProfileSectionState`, all owner-only).
- Before and after link list: `docs/upgrades/programme/V3-PART2-LINKS.md`.
- Evidence (local, focused, this machine): characterization test of the old navigation committed first and passing on the old code; then the change. Route check 63 pages on origin/main 2ec8f72, 64 after (rebased on e52adb4), no dangling or unreferenced pages; its own test passes. Typecheck of `apps/web` clean. Vitest: 20 files, 464 tests pass (the touched files plus the repo-wide accessibility, Title Case, plain language, page title and form label guards). Allowlist check: 14 files, all inside WP-V3.txt, no long dashes. Each new guard was broken on purpose and went red: dropping a Record section, the Record tab not lit on its sections, Sharing off the bar, a refused file treated as usable, Share offered for an unusable file, the sections bar shown outside Record, Record actions that stop wrapping, the rename reverted, and an unreferenced Record page (route check).
- Not verified here: production build, browser checks at 320 to 390 px (the stylesheet guard checks wrapping and 44px targets only, not real layout), the full test suite, and CI. Playwright fixtures still use the older `applicantTabs` list in `lib/navigation.ts`, which this change does not touch.

### 2026-10-25, WP-V3 part 2: review fixes

- Ready to use now follows the services' own rule, decided on the server: a CLEAN scan and a processing state the services allow to be opened (`isServableProcessingState`, which gates preview and download; AWAITING_REVIEW is the normal finished state). Before this fix the hub required APPROVED, which nothing sets, so no document ever showed as ready. The full Cases rule (`isDocumentVersionUsable`) also excludes bytes being erased; that function is not exported from the services package and this package may not change services, so the hub cannot check erasure. Cases, preview and download still apply the full rule themselves.
- The documents page's extra review signals now keep a copy from reading as ready: a passport with no expiry date, a kind the sorting asked a person to confirm, a new name waiting for a decision. Each shows as a reason on the record.
- States are decided in this order: Cannot Be Used, then Previous Version or Expired, then Still Being Checked, then Needs Your Check, then Expiring Soon or Current Version.
- Share on a document opens the new sharing request with "Only the documents I choose" selected and that one document ticked (a `document` query read by the sharing page and passed to the form, only when it is one of this person's documents). The person still reviews and confirms; server checks are unchanged; `packages/services/src/sharing.ts` is untouched.
- Use in Case on a profile section shows only once the section holds a saved answer.
- Accessibility: the Record filters are a named group (fieldset and legend); each group section is named by its own heading.
- On `/app` only Home is current. Account and Permissions now opens `/app#permissions`, the permissions section of the same page.
- One name for the hub page: the tab is Record; the section link and the heading are All Records.
- Tests added: a test for the Record page (not found for a non-owner before any read; documents could not be loaded; the server rule with realistic states), sharing preselection tests for the page and the form, and a one-current-link test on `/app`. The stylesheet test no longer depends on the block being last. Each new guard was broken on purpose and went red.

### 2026-10-25, WP-V3 part 2: design fidelity fixes

- Record sections now use the product's shared section tabs (`SubNav`, one underlined row that scrolls the current tab into view) instead of a one-off row of pills, which is deleted. They show only on Record pages, above the page heading, as other section tabs do. My Profile keeps its own areas as a side list (a picker on a phone), so no page shows two rows of tabs. The section link now reads My Profile, matching that page's heading.
- The Record filter strip has its own five-cell grid: one hairline between cells, five across on a laptop, two across on a phone with the last cell spanning the row. When documents could not be loaded, the document filters say "Not available right now" instead of counting zero, and the "Nothing matches" notice is left out.
- The controls follow the documents wallet: Category before Search, a visible "N items match" count that is also read out, and pages of twelve.
- Each row's title opens the item; each row has at most one further action: Share for a ready document, Update or Replace for one that is not ready, Open the Current Version for an old copy, Go to Cases (renamed from Use in Case, since it only opens the case list) for a profile section with saved answers.
- New loading outline for the Record. Dividers use the soft hairline; spacing uses the shared spacing scale; group headings use the lead size; tokens only, no raw colours.
- Each new guard was broken on purpose and went red.

### 2026-10-25, WP-V3 part 2: Record groups, empty sections, expiry wording

- Documents were grouped under the sharing pack name ("Universal"). They now sit under the catalogue's document group, named as the matching profile area where there is one (Identity and Civil Status, Travel Documents, Money, Qualifications, Health, People), otherwise by the catalogue group's own plain name; no kind or an unknown kind goes under Other Documents. The mapping is in `apps/web/src/app/app/applicant/[id]/record-groups.ts` and runs on the server, so the catalogue stays out of the browser.
- Empty profile sections no longer crowd documents off page one: outside the Profile Details filter they are named on one quiet line at the end of their group, each a link to that section, and are not counted or paged. Profile Details still lists every open section.
- "Expiry not confirmed" showed on a bank statement. Expiry wording now shows only for kinds whose catalogue entry reads an expiry or validity detail (passport, visa, residence and work permits, insurance, clearances and the like), or when an expiry date was saved. National ID cards are not in that list: their catalogue entry reads no expiry detail.
- The Record section tabs are rendered by the traveller layout above every Record page, the hub included; a layout test now proves it and a sections test covers `/record`. The coordinator's preview rendered the page without the layout, which is why the tabs were missing there.
- Each new guard was broken on purpose and went red.

### 2026-10-25, WP-V3 part 2: owner answers on the Record hub preview

- Passports and the other documents a person travels on (travel documents, emergency travel papers, laissez-passer, residence permits) now sit under Travel Documents, beside the Passport details, instead of under Identity and Civil Status. Only where the Record lists them changed: which documents need a fresh sign-in check still follows the catalogue group, so a passport stays protected.
- Every open profile section on the Record now offers Update Details, which opens that section of the profile. Go to Cases is gone from the Record.
- A document with no kind yet shows Needs Your Check, is never counted as ready to use or offered for sharing on the Record, and its action is Choose the Kind, which opens the document where the kind is chosen.
- Tests: record groups, record hub, record browser and page tests updated; 78 Record tests pass. Owner preview re-rendered with the real page and stylesheet.

### 2026-10-25, AI data plan Phase 2: insights

- Owner decision 25 Oct 2026: go-ahead for Phase 2 as a deterministic first slice with nothing new stored. No table, column, migration, background job or call to any outside reading service was added.
- New page per traveller, "What Your Documents Show" (Document Insights), linked from the Documents page ("See Document Insights"). It shows: Details to Check (a reading waiting for a decision that differs from a confirmed detail, a saved detail with two values, and notes from the document check; it says only that they differ and where, never either value); Expiry Timeline (soonest first, plain time-until wording and the date the Expiry page already shows; replaced documents left out); Readiness by Case (the existing case readiness, unchanged); Originals to Bring (each open case's document requirements of a kind usually handed in as the original, from the catalogue list added for "documents behind the profile details", with On File or an Upload link); Sections Backed by a Document (open profile sections, from the catalogue links, using the same "usable copy" rule as the profile page); and Documents Behind Your Details (which saved details came from which document, from accepted readings).
- Privacy: the summary carries no saved value, no value read from a document and no file name (a file name can carry a person's name). Documents are named by catalogue kind only ("Passport 2 of 3"); a kind not known yet reads "Document Not Yet Sorted". A restricted document (identity, civil status, medical, financial, or unknown kind) is summarised by kind and section: the names of the details it backs are not listed. A protected value is read on the server only to compare it with a reading; without the key the reading is counted as "could not be compared", never reported as a difference.
- Access: getTravellerInsights is the first service to take a proof from the central access gate (requireAccess, VIEW_METADATA). It also refuses a copied proof, a proof for a case or document instead of the traveller, and any proof not issued to the owner, so someone the traveller shared with is refused even when their grant allows viewing (owner-only, like the Documents page). The page shows "not found" to anyone else. The ratchet baseline did not grow.
- Code: packages/services/src/insights.ts (pure computation), insights-read.ts (gated read), apps/web/src/app/app/applicant/[id]/insights/, apps/web/src/lib/insights-wording.ts, an "AI insights Phase 2" block at the end of globals.css.
- Checks (targeted only, machine shared): services insights tests (12, pure), gated read tests on a migrated database (5, including a seeded passport number, date of birth, given name and file name absent from the whole result), access ratchet, services and web typecheck, page tests (5), wording tests (3), documents page link test, web source guards (title case, accessibility, forms, plain language, page titles, type scale, palette, navigation), Biome on changed files. Proven able to fail: the ratchet turned red when the gate type was loosened; the owner-only check, the copied-proof check, the traveller-only check, the "could not be compared" rule, the restricted-document rule, catalogue-only naming, the difference comparison, the page's owner check and the no-value rule (a value placed in a result key) each turned a test red when broken.
- Not verified: full test suite, web build, browser checks (Playwright, smoke), signed-in visual acceptance at desktop and 320px phone width, and /code-review and /security-review, which were not run in this slice.
- Independent review fixes (same branch, no blocker found): a protected value that could not be decrypted is never compared (shared check `isProtectedPlaceholder` in profile.ts), so it is counted as "could not be compared", never as a difference; Originals to Bring now shows each case's own verdict on the requirement (On File only when the case counts it, Out of Date, Missing and so on, named as on the case page), so it never contradicts Readiness by Case; a case whose checklist could not be read says "could not be loaded just now" in both cards, never "No Checklist Yet"; a document the wallet already counts expired reads "Expired today", never "Expires today" or -0 days; by owner decision a difference read from a restricted document names only the profile section, never the detail, and list keys name nothing; replaced documents are not numbered, and readings and check notes waiting on one are left out; the Details to Check tile counts the rows the card lists; the "could not be compared" note links to the Documents page. Each guard was broken on purpose and its test went red (decrypt failure, case verdict, merge order, unavailable readiness, wallet expiry, restricted mismatch, replaced numbering, tile count, note link). Checks: services insights tests (15 pure, 6 database), ratchet, services and web typecheck, web insights, wording and documents tests plus the source guards (98), Biome. Still not verified: full suite, web build, browser checks, signed-in visual acceptance, /code-review and /security-review.
- Re-review fix (same branch): whether a saved conflict may name its detail is now decided by the source document's own kind even after that document was replaced, and a source that is not among the traveller's documents (hidden from the wallet, or none recorded) counts as restricted, so the row names the section only. New test covers a replaced passport, a hidden source and no source; it went red with the old rule and with an unknown source treated as unrestricted.

### 2026-10-25, Title Case and form controls sweep

- Owner request with screenshots: names across the interface were still in sentence case, form fields in the document pane had different sizes, Home ran each permission name into its description, and counts read "1 items need a decision".
- Why the #251 guard missed them: it only read headings, labels and a few props, skipped any name with "not", "has" or "my" in it, and never looked at buttons, links, dropdown options, summary tiles, badges, label tables or titles passed as JSX. `apps/web/src/lib/title-case.test.ts` now reads all of those as name places (only sentences and statements with a verb are left alone, a leading "+ " or trailing arrow is ignored), treats a question heading as a name ("Who Has Access"), and checks every consent name. Run against the code before this change it lists 154 misses; all are fixed at the source, with no allowlist. Breaking one tile label, one button and one consent name turned it red.
- About 185 names changed in total, including the owner's examples (Upload Document, New Visa Case, Active Visa Cases, Documents in Your Wallet, Items Needing Attention, All Documents, Ready to Use, Needs Review, Sharing & Access, Who Has Access, Your Access Summary, Not Set Yet), the six consent names (Let VisaStack Process My Details and the rest, also where sentences quote them), English status names in the message catalogue (No Problems Found, Reviewed and Approved, Pending Acceptance), status page feature names, label tables (Waiting for Review, Needs a Check) and the "+ " text prefix, which is gone everywhere. Sentences, hints, notices and statement headings ("Every visa starts with the same scramble") stay in sentence case. The sharing brief rows ("They can", "Ends on") read as one sentence with their value and are unchanged.
- Form controls: one `--control-height` token (48px: above the 44px target, on the 8px rhythm, a pixel from the reference field height) for text, date and dropdown fields, one radius and padding, and a drawn dropdown arrow in the secondary ink token with room so a long choice never runs under it. The arrow uses two hard-edged gradient strokes, not an image, because the content policy allows no `data:` images. New shared `field-stack`, `field-inline` (a field and its Save button on one line, same height, wrapping cleanly at 320px) and `field-hint`. The document pane's Document Date, Kind of Document and Other type name now use them; per-page inline sizes on fields were removed. All in the marked block at the end of `globals.css`.
- Home permissions: each name and its meaning are separate elements on their own lines. Counts use one helper (`lib/plural.ts`), replacing three copies: "1 item needs" and "2 items need" on the traveller overview and agency dashboard, and "1 active grant" on Sharing (a test that asserted "1 active grants" now asserts the right words).
- Tests: wording assertions updated in unit tests and in the ux-public, no-secret-auth and authenticated-workspace browser specs; new tests for the permission layout, the item count wording (proved red against the old text) and the plural helper. Web unit suite, web typecheck and Biome on changed files pass locally. Browser specs, the build and the live site were not run in this session.
- Follow-up from review: the guard now joins an element's text with each wording its choices can make ("Show {n === 1 ? 'it' : 'them'}" reads "Show it" and "Show them"), and treats card titles (card-title, empty-state titles, next-step and card component titles) as names even with a verb. It found 15 more, now fixed: Show It and Show Them, You Are Up to Date, Nobody Has Access Yet, Selected Document Is Unavailable, Some Sections Could Not Be Loaded and other card titles. Counts: "1 document matches" on Documents and "1 field has conflicting proposed values" on the profile. Both new guard paths were broken on purpose and went red.

### 2026-10-25, WP-V4 agency slice: triage, Do next and follow-up message
- Branch `claude/prog-v4-agency` from main `9b9b8aa`. Scope: WP-V4 items 4 and 5 only (E02 triage, agency Do next, follow-up message, ADR). Owner answers used: option A for all five W0 questions (25 Oct 2026). No database table, migration or permission change.
- Triage: one primary group per item (Missing, Processing, Received or Awaiting Confirmation, Needs Correction or Clarification, Reviewed) mapped from existing request, document, checklist and reviewer-decision statuses, as pure service functions with no database read. Ready for Review is case level and never shown while an item is still missing, sent back or processing, or for a case checked by hand. Each case on the Cases screen now opens with "Where Things Stand". Administrators see requests that name the case; members see the checklist only.
- Do next: the agency dashboard opens with a ranked list built only from what the page already loads: past-due items (oldest due first, including sent-back ones), items waiting for review, cases with overdue tasks (most overdue first), cases with nobody assigned (administrators only). Ties by oldest created, then title. Each item shows owner, reason and one action. Members who are not administrators get overdue tasks only, with no error. Recorded in ADR-0015.
- Follow-up message: past-due items carry a copy-ready message built from the request's own fields, with no ids, links, email addresses, long numbers or long dashes. A risky agency note is left out with a one-line reason. It is shown for review and never sent by the product; Copy Message announces "Copied" in a live region and selects the text when the clipboard is refused.
- Related fixes: a started task past its due date now counts as overdue (same rule as the reminder emails), a request that names a case counts on that case only, and a sent-back request counts as waiting on the traveller. The case list also carries the case open date for stable ordering (one pinned key list in agency.test.ts gained `createdAt`). The Cases page test mock gained the request loader.
- Checks (targeted, local): services typecheck; web typecheck; biome on changed files; agency.test.ts triage block and case-field test (8 pass); access enforcement ratchet (pass, baseline unchanged); all agency route tests (18 files, 138 pass); labels and CSS guard tests pass. Thirteen guards were broken on purpose and each turned its test red, then restored.
- Not verified: full test suite, web build, browser checks and live behaviour (not run on this shared machine); signed-in visual check at desktop and phone widths; timed scorecard X10; R04 presets and item guidance; WP-V4 items 1 to 3.
- Review fixes (same branch, independent review, no security blocker): the waiting-on-traveller count now includes sent-back requests and agrees with the view and Do next; "Nothing is overdue" shows only when Do next is empty; tasks and requests become past due only after their due day ends (the reminder emails still send their first overdue note on the due day, recorded in ADR-0015); a received file's newest version is read through the central access gate (MANAGE per case or traveller, administrators only), so an unsafe, erased or still-checked file is never Received or listed for review; members see "Checklist Complete" instead of Ready for Review; the note check also catches Bangla and full-width digits, numbers split by spaces, slashes, underscores, dots or brackets, codes like A0123 4567, phones like (017) 1234 5678 and spelled-out or full-width email addresses, and all long dash forms become hyphens. One existing dashboard assertion changed from 1 to 2 waiting requests by this decision. 29 guards proven to fail in total; targeted tests only, full suite and browser checks not run.

### 2026-10-25, evening handoff for takeover

- Documentation only. New `docs/upgrades/programme/SESSION-HANDOFF-2026-10-25-evening.md`: merged PRs (#259 to #264), open PR #265, six branches pushed without PRs (account menu, AI naming and sorting, profile photos with migration 0088 awaiting the owner, status page AI state and redacted copy label, visa photo sizes, AI provider data terms and compliance review), owner decisions, parked work (payments, real redaction) and pitfalls. CLAUDE.md section 7 gains four lines pointing at it.

### 2026-10-25, WP-V3 part 3: Application Memory and prior versus current
- What a traveller now sees: when a case changed after they confirmed it, the existing changed-case alert lists what changed since that confirmation (a detail changed, removed or added, a document with a new version, replaced or gone, a case date or setting), by name only, never a value, with Compare beside a changed detail and a link to the full list. A new Application Memory page (Cases page header, and the case Snapshots card) shows every case for the person with what was prepared, confirmed, shared, reported as submitted and decided, oldest first; a confirmation later set aside says so and says the snapshot itself is unchanged; a reported submission says VisaStack does not submit applications. A new Then and Now page shows one detail as a snapshot recorded it beside today: value (hidden for sensitive details), currency and before or after tax for amounts, the date it became true, when it was saved, how it was saved, the note saved with it marked as a statement and not proof, the result in the five approved words, where the review stands, and the next step (fix the detail, then take and confirm a new snapshot).
- How it works: packages/services/src/application-memory.ts (getApplicationMemory, listChangesSinceSnapshot, listChangesSinceConfirmed, compareSnapshotDetail) reads existing snapshots, acknowledgements, case shares, reported submissions and outcomes. Changes are found by exact version id against the snapshot, so a renewal never rewrites what was confirmed. The detail comparison reuses the WP-V2 comparison through a new gated variant, compareAuthorizedFactVersions in consistency.ts, with the snapshot time as the prior side's as-of date. No table, column or migration was added; resolution uses the existing ways: a new version of the detail with its note, and the existing acknowledgement of a new snapshot.
- Access: every new function takes a central access gate proof and is owner only at run time: an agency or person with an active grant that includes MANAGE and VIEW_METADATA still gets refused (tested). The access ratchet baseline did not grow; the older compareFactVersions stays on it unchanged and has no page caller.
- Tests: application-memory.test.ts 7 (timeline distinct kinds and order, change list by version with snapshot byte-for-byte unchanged, legacy snapshot without versions, renewal, later salary with currency and tax basis, unknown date, same-date conflict kept after a note and a later confirmation, foreign and wrong-case ids refused alike, owner only, copied proof refused); consistency 22 and access ratchet unchanged and passing; web: application-memory-labels 6, case page 16 (6 new), memory page 3, then-and-now page 6; title-case, accessibility and form guards pass; route check passes (65 pages).
- Proven able to fail: owner check in the new module, owner check in the gated comparison, snapshot must hold the version, applicant filter on snapshots, unchanged-version test, hidden sensitive values in the service and on the page, the list inside the alert, compare links only with both versions, page refusal when the gate refuses, and a new ungated export caught by the ratchet. Each turned a test red and was restored.
- Not verified: no browser run (machine shared; port 3100 in use), so the alert and both pages are checked at unit level only, not at 320px or 360px in a browser; the full test suite and web build were not run; the Record hub link to Application Memory is left for WP-V3 part 2 (files owned by that branch). The changes list cannot name a change of evidence choice (a selection removed but the item still in the record); the alert says so plainly. An agency comparison with explicit scope for both sides stays with WP-V5. Exporting a historical packet uses the existing snapshot download; no separate manifest export was added.
- Review fixes (same day): the change list now reads today's case through the same rule the snapshot writer uses (one shared helper in missions.ts, snapshot output unchanged; missions and acknowledgement tests pass) and compares both ways, so a new candidate counts as added and a dropped choice reads "no longer used in this case"; replaced, deleted, failed or refused documents, removed details and changed case settings are named; a sensitive detail's note is hidden with its value ("A note was saved"); shares of the whole record are listed once above the cases; events carry their record id and keep a fixed order at equal times; "Entered by hand"; Update This Detail opens the detail's own profile section (the editor follows #section links). Service tests 10, web tests 77 in the touched files; each new guard was broken on purpose and went red. Still not verified in a browser.

### 2026-10-25, Account menu redesign

- Owner feedback: the signed-in account menu was "2/10 visually". It scrolled inside itself (a fixed 65% of the screen height hid Sign Out), showed no avatar or address, left the plan as loose grey text between links, had no icons, uneven row spacing and plain link styling with no hover or focus treatment.
- New component apps/web/src/app/app/account-menu.tsx; the toolbar now only places it. Header: avatar with initials (same rule as the workspace selector) and an optional photoUrl seam that shows an image with empty alt text, full name, the signed-in address (taken from the session the app layout already reads; no new read) and the plan as a chip with a View Plan link (the existing personal plan destination, /app/account). Two labelled groups, Account (Your Account, Manage Travellers, Create or Manage an Agency, Privacy & Consent) and Support (Help & Support, Service Status), each row with a 20px icon from the existing set, 44px tall, full-width hover and an inset focus ring, and aria-current on the current page. Sign Out is last below a hairline, a quiet row that tints only on hover or focus; it is still the existing server action form. Every earlier link and href is kept; View Plan is the only new link.
- Behaviour: still a details/summary disclosure. Escape closes and returns focus to the trigger; Down or Up on the trigger opens on the first or last row; Up, Down, Home and End move between rows and wrap; Tab leaves naturally and closes the menu; a tap outside, choosing a row and a route change close it.
- Layout: the panel sizes to its content (300px wide, 16px radius from the shared scale, one hairline border). It scrolls only on a screen shorter than 640px, limited to the screen less the toolbar. At 760px and below it opens as a bottom sheet with a close button and safe-area padding.
- Not done as briefed, by the standing design contract: no shadow (flat rule: no decorative shadows; a hairline border instead), no separate dark appearance (the contract has none and the flat check forbids automatic dark styling), and no dimmed backdrop behind the phone sheet (translucent surfaces are not allowed). Help & Support uses the same mark as the Help shortcut beside the menu, because the icon set has no question mark. The Sign Out button still reads "Sign out", left to the wording work running in parallel.
- CSS: one block at the end of globals.css marked "/* WP-UI2 account menu: ...". The old menu rules (.record-account nav, .record-menu-heading, .record-menu-plan, .record-menu-identity) were removed after a search showed nothing else used them.
- Tests: new account-menu.test.tsx (14: structure and order, every link kept, no address or plan, photo seam, aria-controls and aria-current, Escape focus return, arrow keys, outside tap, row choice, route change, tab away, phone close, and stylesheet checks: no height limit or inner scroll outside the short-screen and phone rules, any limit is the whole screen less an offset, bottom sheet with safe area, tokens only and flat). The phone-chip test now reads the Help link from the new component. Each new guard went red when the real code was broken (inner scroll at desktop, phone sheet not fixed, a hard-coded colour, Escape, arrow keys, outside tap and route close, a dropped link and aria-current) and green when restored. Toolbar, phone navigation, wording, title case, vocabulary, accessibility, palette, type scale and flat-design checks pass; web typecheck and Biome pass.
- Not verified: full test suite, web build, browser checks (Playwright, smoke), signed-in visual acceptance in a real browser session, the short-screen fallback and the phone sheet on a real device, /code-review and design accessibility review. Visual evidence was captured from a static test render (before and after, desktop and phone) and is not committed.
- Review fixes (same branch): each row group is a named group (role group, labelled by its visible Account or Support label); the signed-in address is passed once as its own prop and is no longer inside the access object sent to the browser (new layout test); the trigger and panel are named "Account Menu" and the hidden duplicate text inside the trigger is gone; arrow keys now search rows inside the panel only. Each new check went red when broken (group role removed, address spread into access, hidden text restored) and green when restored.

### 2026-10-25, AI naming and sorting with approval

- Owner request: "if AI is active, AI should read the document correctly and define/understand its name & category, rename the document and use in appropriate category, save after approval by the user."
- Behaviour change: intake no longer sets a document's kind by itself. A confident rules classification (passport machine-readable lines, bank statement, employment certificate wording) and the suggested name now wait for the owner. Issuer and expiry from a passport's check-digit-verified lines are still filled as before (owner question below). Characterization tests (`packages/services/src/intake-proposals.test.ts`) were written first; only the two assertions about the kind were changed, deliberately, as were the matching ones in `pipeline.test.ts`.
- With AI reading allowed (the person's AI reading consent and processing consent, an active AI provider, the platform kill switch), Read Details from This Document and the kind button also ask the AI what kind of document it is, from the whole document catalogue (215 kinds); any answer outside the catalogue counts as no suggestion. The name is built by the existing naming rules from the kind's plain label and the person's own name, never from text the model wrote, so no document number or date of birth can appear in it. Same provider port and adapter, same budget, attempt cap, cache (keyed by the kind list), rate limit and kill switch; no new provider, secret or setting. A failed or timed-out provider call leaves the rules suggestion as it was.
- The documents page shows one card per document: "We think this is a ...", the suggested name, and where the Record lists it. Accept saves the kind and the name together in one transaction with an audit event (`DOCUMENT_SUGGESTION_ACCEPTED`), through the existing kind and name decide paths; Edit lets the person pick another catalogue kind and change the name, then Save; Skip changes nothing on the document (`DOCUMENT_SUGGESTION_SKIPPED`). The card shows no document content and no model reasoning. Unkinded documents still show Needs Your Check on the Record.
- Storage: existing tables only (`document_classifications`, `document_type_proposals`, `document_name_versions`). No migration.
- Access: both new service functions (`suggestDocumentKind`, `decideDocumentSuggestion`) take the access gate's proof and refuse anyone but the owner; the enforcement ratchet passes with the baseline unchanged.
- An AI reading still narrows to the details of the rules' suggested kind while that kind waits, as it did when intake set the kind by itself.
- Guards broken on purpose and seen red: kind set by intake, AI consent, safety state, catalogue-only kinds, a name from another document, refused kind, ratchet, applicant mismatch in the action, rules narrowing, kind failure hiding the reading.
- Not verified: no browser run, build, full suite or live provider call (machine shared; targeted tests only). The old separate name and kind review cards are no longer on the page but their components remain, to avoid clashing with parallel wording work; remove them in a follow-up.
- Owner question: should issuer and expiry from a passport's machine-readable lines also wait for acceptance? Recommendation: keep filling them, since they are check-digit verified and drive expiry reminders.
- Owner question: the AI suggestion runs when the person asks for an AI reading, not silently on upload. Running it on upload needs a background permission for the upload-triggered job, which the access gate does not allow today.
- Review fixes (2026-10-25): the AI is not asked when the rules are sure of the kind, and for a file of unknown kind it may only suggest kinds that keep the file protected (owner trade-off: travel, education and work kinds are then never AI-suggested, only chosen by hand); a failed reading makes no second provider call; setting the kind by hand closes a waiting AI kind; decisions are refused for an older or unsafe file; names drop C1 controls and text-direction characters; AI kinds always read Please Check; owner confirmed the AI runs only on request and passport issuer and expiry stay automatic.
- Owner decision (2026-10-25): the AI may suggest any catalogue kind for a file of unknown kind, saved only on Accept and always shown as Please Check; when accepting would remove the fresh sign-in check under the live protection settings, the card says so before Accept. The AI is still never asked when the rules are sure of the kind. The offered kind list is part of the AI cache key, an empty list returns no suggestion without a provider call, and a waiting name made for another kind is remade for the kind the person set.

### 2026-10-25, Profile photos

- What people see: Add Photo in the banner of each traveller's My Profile page, and a new Your Photo card on the account page (the photo on the person's own traveller profile; someone who has not added themselves is pointed to Add Yourself). Once a photo is saved the buttons read Replace Photo and Remove Photo. The photo shows in the workspace avatar and the profile avatar; with no photo, or if it cannot load, the initials show exactly as before.
- Choosing a photo opens a square crop step in the page: drag, arrow keys (Shift for bigger steps), the Zoom slider or the plus and minus keys; Escape or Cancel closes it and returns focus to the photo button. Progress and success are read out politely; refusals interrupt. The browser accepts JPEG, PNG, WebP and iPhone photos where it can open them (Safari opens HEIC), checks the 5 MB limit at once, and sends only a 512 x 512 JPEG it drew on a canvas.
- Server path (`packages/services/src/profile-photos.ts`): only the traveller record's owner, proved through the central access gate (`requireAccess` then an owner-only check); JPEG or PNG only, at most 5 MB, file signature must match; the upload is written to quarantine, read back, checked with the same scanner port documents use (the synchronous structural check, as agency logos use, not the ClamAV worker), then decoded and re-encoded with sharp (`packages/adapters/src/photo-reencoder.ts`) into a 512 x 512 JPEG with every piece of metadata dropped, including location. The re-encoded copy is registered in storage_objects (clean bucket, `profile-photo-` key prefix) and the record switched to it in one transaction with a PROFILE_PHOTO_SET audit event that holds no image data, key or hash. 30 photo changes an hour per account.
- Serving (`/api/photos/applicant/[id]`): signed in only, decided by the gate for that one record, owner only, bytes served only if they still match the saved hash; `image/jpeg`, inline, `Cache-Control: private, no-store`, `nosniff`, a sandboxing policy and same-origin only. Refusal, no photo and a malformed id all give the same private 404.
- Who can see a photo: the record's owner only. People and agencies the record is shared with do not, even with a grant covering the whole record: the brief allowed anyone who can already see the name, but the gate on the record does not match "can see the name" (case-only and document-only grants also show the name), so this is owner-only as the brief directed. No share, pack, export or visa photo reads the photo table; a test fails if any other module starts to.
- Removal and replacement delete the row and queue the old bytes for verified erasure (new erasure reason PROFILE_PHOTO_REMOVAL) in the same transaction, and also delete them at once. Account deletion queues photos with the account's other stored objects. Restore reconciliation treats the new reason like account deletion.
- Data change, migration 0088_profile_photos (not run anywhere): `ALTER TYPE erasure_job_reason ADD VALUE 'PROFILE_PHOTO_REMOVAL'` and a new `applicant_photos` table (applicant_id primary key, cascades with the applicant; storage_object_id unique, cascades with the storage object; content_sha256 checked as 64 hex characters; size_bytes checked 1 to 1 MiB; created_at, updated_at). Additive only.
- Dependencies: sharp ^0.35.5 is now a direct dependency of `@visastack/adapters` and `@visastack/web`, within the existing root override; the lockfile changed only in those importer entries and optional flags. It is kept external in `next.config.mjs` like the canvas package.
- Tests: 12 service tests, 4 re-encoder tests (one builds a JPEG with a hand-written EXIF GPS block and proves it is gone, one runs the real scanner and re-encoder through the service), 4 route tests, 8 control tests, 2 account card tests, 4 crop tests, 5 page-loading and avatar tests. The access ratchet passes with an unchanged baseline. Guards broken on purpose and seen red: metadata kept, owner-only check removed, signature check removed, account deletion not queueing the photo, removal not queueing erasure, private cache header changed, gate skipped in the route, keyboard move broken, size check removed.
- Not verified: no build, `next start`, Playwright or full suite run; HEIC in Safari and real phone cropping not tried on a device; the migration has not run on any database. Until it runs in production the photo controls fail with a plain message and every avatar keeps its initials (pages do not break), and the readiness check reports the migration as missing. Photos are not part of the account data export. A replaced photo whose immediate delete fails stays queued for erasure; an interrupted upload can leave a registered quarantine object, findable by its `profile-photo-upload-` prefix.
- Review fixes (same day, owner decisions: one photo per person on their own traveller record; photos go in the data export): the account export now includes the owner's own photos as `photos/<name>.jpg` (only bytes matching the saved hash; this replaces the "not part of the export" note above); before migration 0088 runs, every photo read (account deletion, inside a savepoint; the photo route, 404; page avatars, initials; the export, no photos) answers "no photo" instead of failing, and adding a photo is refused plainly, tested against a database without the table; the browser now opens originals up to 40 MB and checks the 5 MB limit on the cropped photo; workspace avatars read all photo versions in one batched, owner-gated read shared per page render with the account and profile pages; the admin privacy page labels Photo Removal jobs from an exhaustive map; re-encoding is refused after 10 seconds; removal now counts toward the 30-an-hour limit; the crop step adds Move Left, Right, Up and Down buttons and reads out where the photo sits; the orphan-on-crash case above (an interrupted upload leaving a registered `profile-photo-upload-` quarantine object) is unchanged. Each new guard was broken on purpose and went red.

### 2026-10-25, Status page AI state and the redacted copy permission

Owner approved 2026-10-25. Two fixes where the product said something that was not true.

- Redacted copy permission: the sharing form offered "Download Redacted Copies" while the platform `redactedDownload` capability is `disabled` in code (`lib/capabilities.ts`), so a recipient could be granted a permission that does nothing. The page now reads the capability and passes it to `GrantForm`. While it is not available the box is shown switched off and unticked, with a visible "Not available yet" note tied to it through `aria-describedby`; a switched-off box is never sent, so the review summary ("They can ...") never lists it and the download sentences stay hidden. The form treats a missing value as not available. `createGrantAction` refuses `DOWNLOAD_REDACTED` on its own check ("Downloading redacted copies is not available yet."), before any lookup, so a hand-made request cannot grant it. When the capability becomes `available` the form and the action behave exactly as before. The agency side has no equivalent choice: client invitations grant a fixed set without redacted downloads.
- Status page AI state: the public "AI Suggestions from Documents" row came from `AI_ENABLED` plus an environment OpenAI key only, so a database-managed Anthropic or Gemini setting showed "Not Set Up Yet" and an admin emergency disable still showed "Working". `lib/ai.ts` now has one decision, `selectAiExtractionSource`, used by both `resolveAiExtractor` (the run-time call, behaviour unchanged) and the new `resolveAiExtractionAvailability` (no key decrypted). Database settings win once any exist (nothing active reads "Switched Off for Now"; an unusable active setting or no key management reads "Not Set Up Yet"); otherwise the environment path with its `AI_ENABLED` switch decides. `resolvePlatformCapabilities` in `lib/capabilities.ts` fills the live answer into the registry, and `evaluateReadiness` uses it with its own already-connected database client, so `/api/health/ready` and the admin overview agree with what runs. The public body still carries only the state word, never a provider, model or setting. The answer is cached in memory for 60 seconds per server (one shared lookup for concurrent requests); a failed lookup reports "Switched Off for Now", never an error, and is not cached. Saving, activating, rolling back, disabling or revoking in admin AI settings clears that server's cache; other servers catch up within a minute. The synchronous `getPlatformCapabilities().aiExtraction` stays the configuration-only view and now uses the same environment rule as the run-time path (it also respects `AI_PROVIDER`).
- Tests: `lib/capabilities-ai.test.ts` (environment key only, database-configured Anthropic with no environment key, switch off, admin disable, no key management, database unreachable or failing, the 60-second cache, and the public readiness body naming no provider); new cases in `sharing/grant-form.test.tsx` (switched off, unticked, note tied, never sent or listed, missing value is off, available unchanged) and `sharing/actions.test.ts` (crafted request refused, other permissions still shared, available grants as before). Each guard was broken on purpose and the new tests went red (9 failures), then restored. Targeted web tests, the Title Case and vocabulary tests, web typecheck, Biome and the flat design check pass locally. The full suite, the build, browser specs and the live site were not run in this session.
- Review follow-up: the "Not available yet" note now sits outside the checkbox label, so a screen reader reads it once as the description, not again inside the name (test checks the label text is the name alone and the note is outside it). A failed live AI lookup now logs a `capability_lookup_failed` warning (`reportCapabilityLookupFailure` in `lib/server-error.ts`) carrying the capability and the error class only, never the message, provider, key or setting (test feeds a message holding all of those and checks none reach the log). Both guards were broken on purpose and went red, then restored.
- Owner decision 25 Oct 2026, replacing the redacted copy part above: the DOWNLOAD_REDACTED permission stays grantable and is now called "Download Safe Copies" (a processed copy with hidden data removed: visa photo sizes now, redacted documents later; another branch uses it for agency downloads of sized visa photos). The box is no longer switched off and the server action no longer refuses it (`sharing/actions.ts` is back to its earlier behaviour). The box carries the note "Visa photo sizes now; redacted documents later", outside the label and tied to it with `aria-describedby`. The stored key is unchanged. All permission names now come from one table, `PERMISSION_ACTION_LABELS` in `lib/labels.ts`, used by the grant form, the grant summaries on Sharing ("They can ...") and the sharing invitation review page, which used to show the raw-code wording "Download Redacted". The review sentence reads "Safe copies may be downloaded; original downloads are not included." The status page row for redacted downloads is unchanged and still reads switched off. The status page AI work above is unchanged. Tests: rename, note, accessible name, the stored key sent and accepted by the server, and the label table (every permission named, Title Case, no "redact" wording); each guard was broken on purpose and went red (6 failures), then restored.

### 2026-10-25, Visa photo sizes

- Owner request 25 Oct 2026: a traveller uploads one passport-size photo, shares it like any document, and downloads it at the exact size each visa application asks for. The photo is an ordinary document of the Photograph kind (catalogue key PHOTO, aliases PHOTOGRAPH, PASSPORT_PHOTO, VISA_PHOTO): same upload, scan, quarantine, consent and sharing. No table, column or migration was added; nothing derived is stored.
- New "Visa Photo Sizes" section on a ready Photograph document, in the Documents page pane and on a shared record (app/shared/[grantId]) for a person or agency the photo is shared with. It shows advisory checks in plain words (Too dark, Too bright, Low contrast, Looks blurry, Background is not plain, Background is not light, Photo is wider than it is tall, Too small to print at 35 x 45 mm and similar), a size list, a small crop preview with Move Up/Down/Left/Right, Zoom In/Out and Reset Crop buttons and a spoken summary of the position, "Download This Size", and under it "Sized to the published rule (checked <date>, <source title>). Check the current rule before submitting." The checks are deterministic heuristics (brightness, spread, Laplacian variance over the middle of the photo, border strip uniformity); no face detection, no AI, never blocking, never claiming acceptance.
- Sizes (packages/core/src/photo-specs.ts), each with source, publisher and checked date: Schengen 35 x 45 mm (German Embassy Dhaka information sheet), United Kingdom 35 x 45 mm (GOV.UK passport photo rules), United States 2 x 2 inches (travel.state.gov Photo Requirements), Canada 35 x 45 mm (IRCC temporary resident visa photo specifications), China 33 x 48 mm (Embassy of China in Nepal), India 2 x 2 inches (High Commission of India, Dhaka, repo research), Thailand 35 x 45 mm (Royal Thai Embassy, Dhaka, repo research), Saudi Arabia 200 x 200 pixels and 5 to 100 KB (KSA Visa photo page, repo research, marked for recheck). The five not from the repo were read through search results of the official sites on 2026-10-25 because the build environment could not open them; each says so in its note. Unpublished figures are null (no US or India digital upload limits, no Canada or China background rule). Australia was left out: no official page with the size could be tied to a visa form.
- Image work (packages/adapters/src/photo-sizer.ts, sharp loaded on first use): auto-orient, crop to the spec's shape with the person's offset and zoom (validated and clamped), resize to the exact pixels (an exact pixel rule, else 600 DPI when the photo has the detail or the spec's digital minimum needs it, else 300 DPI), fill PNG transparency with white, re-encode as JPEG within the published file size range, all metadata removed, DPI written into the JFIF header only. Bounded: 40 megapixel ceiling, failOn error, sequential read, 10 second timeout. sharp added to @visastack/adapters with the root override's range and to next.config.mjs serverExternalPackages and the server externals.
- Access: two same-origin JSON routes, api/documents/photo-check (PREVIEW) and api/documents/photo-size (DOWNLOAD_REDACTED, attachment, nosniff, no-store, sandbox policy), both through requireAccess with each grant judged against its own purpose. The sized photo is a new rendering, never the stored original, so it uses the permission that governs every non-original download: the owner always, a person or agency only with a grant that includes downloads. A restricted document needs a step-up exactly as for any preview or download (a fresh session gets it with no prompt). Both service functions refuse a copied proof or a proof for another action, a version not yet safe to serve (audited DENIED with its reason), a non-Photograph document, a file that is not JPEG or PNG, and more than 120 requests per person per hour (new PHOTO_SIZE bucket). Each success writes one DOCUMENT_ACCESS event with the size id and output pixels and DPI, never image data. The access ratchet passes with its baseline unchanged.
- Guards proven: each of these was broken on purpose and its test went red, then restored from a copy: spec without a source, spec with a bad checked date, crop not clamped, proof not checked, servability skipped, rate limit skipped, size id not audited, DPI not written, metadata kept, damaged image data tolerated, file size range ignored, wrong permission in the route, inline instead of attachment, origin not checked, no step-up retry, refusal reason leaked to the person, button not in Title Case, source line missing, spoken position missing, section shown on any document kind.
- Checks run: core spec tests (15), adapter sizer tests on made-up images (16), services photo, ratchet and rate-limit tests, web route, component, documents page, Title Case, wording and CSS guard tests, typecheck of core, services, adapters and web, Biome on changed files, check-flat-design.
- Not verified: full test suite, web build (including how webpack treats sharp), next start, Playwright and smoke checks, signed-in visual acceptance at desktop and 320px phone width, real photographs (thresholds were set on made-up images), /code-review and /security-review. A refusal by the access gate itself is not audited (the gate writes nothing), unlike accessDocument's own denials.
- Review fixes (same branch, owner decision option A: DOWNLOAD_REDACTED is the "Download Safe Copies" action, label rename on another branch): the check and its preview now also need the safe-copy permission and run only when the person opens the Visa Photo Sizes disclosure; the shared record shows the section only when the central gate allows a safe copy across all the viewer's grants (or needs only a step-up); checks and sizes have separate rate-limit buckets (PHOTO_CHECK 60 an hour, PHOTO_SIZE 120 an hour); a photo that cannot be decoded is audited DENIED with reason image_unreadable; sharp uses failOn 'warning', its cache is off, and anything other than JPEG or PNG (judged from the bytes) is refused before decoding; a missing photo answers exactly like a refused one; request bodies need a declared length of at most 4 KB; only the Photograph kind and its passport and visa photo names qualify, not PHOTO_ID. Each fix was broken on purpose and its test went red (format check, cache, failOn, unreadable audit, separate buckets, PHOTO_ID, not-found answer, body cap, check permission, step-up eligibility, check on page load, shared page using the grant's own action list).

### 2026-10-25, AI provider switching and data terms

- Scope (owner corrections the same day): provider switching and fallback already existed (draft, activate, roll back, emergency disable, revoke key, one cross-provider fallback); nothing parallel was built. Added: data terms per configuration, one data-terms rule for every AI call, a cache-key fix, the compliance review and the runbook.
- Data terms: new append-only table `ai_provider_config_terms` (plan Free or Paid, may train on inputs Yes, No or Not Known, retention days, region, terms address, date checked, note), newest row per configuration in force, recorded from the draft form or "Record Data Terms" on each card, audited as AI_PROVIDER_TERMS_RECORDED. A "No" needs the terms address (service and database check).
- Rule (packages/services/src/ai-data-terms.ts `decideAiProviderUse`), applied in apps/web/src/lib/ai.ts to the primary and the fallback of all five tasks and to the "is it available" checks, before any key is unlocked. Owner decision: nothing is blocked unless the new platform setting "Only Use AI Providers That Do Not Train on Inputs" is on (table `ai_data_rule_settings`, off by default, security admin plus a fresh sign-in, audited as AI_DATA_RULE_CHANGED with the previous value). When off and real applicant data is on (commercial mode or the real-applicant-data capability), the AI settings page warns about an active or fallback provider that may train, is not known or has no terms. Connection tests and evaluations use made-up text and are not affected.
- Migration 0089_ai_provider_data_terms (two new tables, no change to existing tables) is written and NOT run. Before it runs: terms read as Not Recorded, the setting reads as Off, saving either shows "cannot be saved until the latest database update has been applied", and AI behaves exactly as before. The readiness probe reports pending migrations as not ready, so the migration must run with (or right after) the deploy, with the owner's explicit go-ahead. A failed read (not a missing table) treats the setting as Off, so a passing database error never stops AI (review fix: the free tier is never blocked unless the owner says so).
- Cache keys: proved a real gap with a failing test (an answer cached from one provider was served to another provider using the same model name, for extraction and OCR). Every cache key now includes the provider; all six real adapters report it. Existing cached answers from real adapters stop matching once and are asked again.
- Fallback verified, no change: a fallback to another provider charges only for the answer, records which provider answered, and is not tried when the primary used the document's last allowed attempt (packages/services/src/ai-provider-switching.test.ts).
- Docs: docs/legal/ai-processing-review-2026-10-25.md (engineering compliance review, not legal advice; GDPR, Singapore PDPA, Bangladesh, lawyer checklist), docs/legal/privacy-notice-ai-section-draft.md, docs/operations/runbooks/switch-ai-provider.md, data-terms section appended to docs/public-beta/PROVIDER-COST-REGISTER.md. Bangladesh: which instrument is in force on 25 Oct 2026 is recorded as uncertain (ordinance No. 61 of 2025, amended February 2026; a 2026 Act reported by secondary sources only). Several provider-terms points are marked unverified because the primary pages could not be opened from the build machine.
- Keys: the brief asked for keys in environment variables only, but the existing design stores them encrypted in the database, and the narrowed scope left that unchanged. Owner decision pending.
- Checks (targeted, nice -n 15): services ai-data-terms (23 with the ratchet), ai-provider-switching (4), ai, ai-provider-config, access ratchet without baseline growth; adapters extraction and OCR tests; db tests; web ai tests (81) plus Title Case and vocabulary guards; typecheck of services, adapters, db and web; biome; flat-design, route-navigation and UI ratchet scripts. Guards proved to fail: removing the fallback or primary check, ignoring the setting, treating a read failure as Off, and not recognising a missing table each turned a test red; the cache tests were red before the fix.
- Not verified: full suite, web build, next start, Playwright and smoke, /code-review and /security-review, signed-in look of the AI settings page at desktop and phone width, the migration on a real database.

### 2026-10-26, Session handoff after the side packages

- Merged and live: #265, #267 to #272. Production migrations 0088 (profile photos) and 0089 (AI data terms) run right after their merges by owner approval; 90 migrations applied, both new AI tables empty (the training guard reads as off).
- Post-merge checks for #272: CI, CodeQL, Vercel, Deploy Smoke and the live signed-in check passed. Playwright Deploy Smoke attempt 1 failed one pixel comparison on the documents fixture at 1600px; attempt 2 on the same commit passed. Cause not proven; attempt 1 overlapped the migration run. Details in docs/upgrades/programme/SESSION-HANDOFF-2026-10-25-evening.md section 7.


### 2026-10-26, WP-V4 Needs Attention and Home

- Built (branch claude/prog-v4-home, local commits 9695e66 and 56b3149 on main 067df45, not pushed): one owner-only read projection, `listNeedsAttention` in packages/services/src/attention.ts, taking the central access gate's proof, and a pure `rankAttentionItems` (ADR 0016, owner approval 26 Oct 2026). Sources: evidence requests open or sent back for a fix (declined never shown), open or started tasks on active cases, cases changed since the person confirmed them, current documents inside a reminder window or past expiry, and one suggestions item with a count. Items hold plain words, ids for links and catalogue keys only.
- Home (apps/web/src/app/app/page.tsx): the next step comes from the ranked list (consent still first, first run unchanged), then Needs Attention, My Records, Active Requests and Work, My Next Journey, and Permissions You Control last. A sent-back request now reaches Home (W0 ledger L2). Home reads at most 25 applicants and shows 8 items under the next step, with a count of the rest. `requestItemLabel` moved to apps/web/src/lib/labels.ts so the agency console and Home share it; the reminder sweep's local-date helper is now exported for reuse.
- Due days: past due only once the due day has ended in the task's time zone, else the applicant's; due today is not overdue; a missing date shows as Date Unknown. The agency console still counts request due days in UTC (ADR 0015 section 6), so the two can differ by one day near midnight.
- Checks (targeted, nice -n 15): packages/services attention.test.ts 14 passed; access/enforcement.test.ts, notification-sweep.test.ts and expiry.test.ts 36 passed, ratchet baseline unchanged; apps/web page.test.tsx 24 passed; apps/web src/lib, agency, page and a11y tests 97 files, 1237 tests passed; labels, record-browser, app-nav, first-run and account-menu 61 passed; pnpm run lint exit 0 (Biome, flat design, navigation, UI ratchet); pnpm run typecheck exit 0. Guards proved to fail: dropping the owner check, swapping tiers 1 and 2, and misreading a live confirmation turned 6 attention tests red; an ungated projection turned the enforcement ratchet red; dropping sent-back items from Home turned the Home test red.
- Not verified: full suite, web build, next start, Playwright and smoke, /code-review and /security-review, the signed-in look of Home at desktop and phone width, T13 on staging. Calendar export is not in this slice.

### 2026-10-26, WP-V4 review fixes and the traveller time zone rule

- Owner decision (26 Oct 2026): the traveller's time zone decides when an agency request is past due, on the traveller's Home, the traveller's evidence page and the agency's Do Next list. Done on branch claude/prog-v4-home (local commit 855aeea, not pushed). The agency reads (`listMissionsForOrganization`, `listVisibleMissionsForMember`, `listEvidenceRequestsForOrgDetailed`) now carry the traveller's time zone, used only for due days and never shown; client components get the same props as before. Agency tasks use their own zone, then the traveller's, in the Overdue count, quick view and Do Next row 3; the follow-up message's due line uses the same day. ADR 0015 has a dated amendment; ADR 0016 updated. Task and expiry reminder emails are unchanged and can differ by a day near midnight.
- Review fixes: `lib/labels.ts` no longer imports the server-only `master-profile.ts` (browser components import labels); `requestItemLabel` is back in the agency `do-next.ts`, and Home's heading helper lives in the Home page. Document expiry counts the expiry day in the person's time zone against the widest reminder threshold. Home reads people oldest first, then by id, and says in Needs Attention as well as My Records when some are left out. The traveller's Home shows only unassigned tasks or tasks assigned to the traveller. The projection reads requests and cases directly (no second applicant read, and the agency note is never read). My Next Journey has one heading. Requests on closed or cancelled cases stay out of Home but are still listed on the evidence page.
- Checks (targeted, nice -n 15): services attention, enforcement ratchet, agency, notification-sweep and expiry, 5 files, 117 passed, ratchet baseline unchanged; web src/lib, agency, applicant/[id], Home, nav, first-run and account menu, 128 files, 1529 passed; pnpm run lint exit 0; pnpm run typecheck exit 0. New guards proved to fail: importing master-profile into labels.ts; ignoring the traveller zone in Do Next (Dhaka and Los Angeles cases red); unsorted applicants; counting document expiry in UTC; showing agency-assigned tasks.
- Not verified: full suite, web build, next start, Playwright and smoke, /code-review and /security-review after these fixes, the signed-in look of Home, T13 on staging.

### 2026-10-26, WP-V4 calendar export

- Built (branch claude/prog-v4-calendar, local commit 3aec763 on main 309625c, not pushed): `listCalendarDates` in packages/services/src/attention.ts, owner-only through the gate proof like `listNeedsAttention`. It returns appointments (open or started, active cases, stored wall-clock time and IANA zone), open or started task due days the traveller can act on, open or sent-back request due days not on a closed or cancelled case, and current document expiry days. Undated items are left out. Items hold a key, kind, date and case title only. At most 50 rows per source, earliest first.
- apps/web/src/lib/ics.ts: `buildIcsCalendar` (VERSION 2.0, PRODID, CALSCALE, METHOD:PUBLISH; UID `<kind>-<id>@visastack`; DTSTAMP in UTC; all-day dates with DTEND the next day; appointments with TZID; RFC 5545 escaping; CRLF; folding at 75 UTF-8 octets without splitting a character) and `selectCalendarEvents` (server items only, unknown keys ignored, at most 100 events). `buildIcsForAppointment` is unchanged. Generic titles in labels.ts; " - <case title>" only when the person ticks Add Case Names, with long numbers hidden.
- Page /app/applicant/[id]/calendar (plain GET forms, nothing ticked by default, preview of the exact titles and dates, one-time copy wording, all-day wording) and route /app/applicant/[id]/calendar/download (text/calendar, attachment visastack-dates.ics, private no-store, nosniff; nothing valid chosen redirects back with a message). Links from Home's Needs Attention (one person: a direct link; several: one link per person) and from the Expiry page. Superseded the same day by the review fixes below: the Home link moved to My Records.
- Checks (targeted, nice -n 15): packages/services attention.test.ts and access/enforcement.test.ts, 2 files, 23 passed (5 new), ratchet baseline unchanged; apps/web src/lib, calendar page and route, Home page, 80 files, 1122 passed (13 new ics, 1 new labels, 8 route, 7 page, 2 Home); record-browser, app-nav, first-run, account-menu and components 18 files 140 passed; pnpm run lint exit 0 (Biome, flat design, navigation, UI ratchet); pnpm run typecheck exit 0. Guards proved to fail by breaking real code and restoring from a cp backup: dropping the owner check or the staff-task filter in `listCalendarDates` (2 red); folding at 76 octets or counting UTF-16 units instead of UTF-8 bytes (2 red each); accepting a key the server did not list (7 red); case names on by default (6 red); dropping the owner check in the page loader (2 red); Home linking to the wrong page (2 red).
- Not verified: full suite, web build, next start, Playwright and smoke, /code-review and /security-review, the signed-in look at desktop and phone width, import into Google, Apple and Outlook calendars, T13 on staging.

### 2026-10-26, WP-V4 calendar export: review fixes and the calendar core

- Owner direction (26 Oct 2026): calendar setup "super correct and futuristic". The calendar now lives in `@visastack/core/calendar` (packages/core/src/calendar: model, kinds registry, versioned options with one never-throwing parser, permanent UID scheme, SEQUENCE rule, wall clock to UTC, SHA-256, the one RFC 5545 serializer, and a type-only `CalendarPublisher` port for a future live feed or Google or Microsoft adapters). apps/web/src/lib/ics.ts is a thin mapping; `buildIcsForAppointment` renders through the same serializer. `listCalendarDates` returns neutral items (kind, resource id, date or wall clock and zone, case title, updatedAt). ADR 0016's calendar section describes it all.
- Review fixes: Home's "Add Dates to My Calendar" sits in My Records whenever core processing is on and the person has a record (one person: a button; several: one sentence of name links), so it shows with 0 or 1 waiting items. UIDs are opaque (sha256 of `visastack:v1:<kind>:<id>`, first 32 hex) and the single-appointment file uses the same UID as the dates file; files downloaded before will appear once more on re-import. Calendar reads start 7 days before today in the traveller's zone. Case names are cut by characters, lose bidirectional controls, and are left out when `containsUnsafeDetail` (the agency follow-up check: grouped numbers, any script's digits, links, emails) finds anything. Timed appointments are written in UTC from the stored wall clock and zone (no TZID, valid without VTIMEZONE); an unknown stored zone gives an all-day event. createAppointment, updateAppointment and the agency-side pair refuse a zone that is not a known IANA name, and the serializer strips line breaks and control characters from every value. The download is a same-origin POST (Origin host checked, 403 otherwise); the GET preview stays. One wording, "Add Dates to My Calendar". The preview says the file is made again at download: anything finished since is left out and the rest still downloads.
- New: CLASS:PRIVATE, STATUS, CATEGORIES, SEQUENCE, X-WR-CALNAME "VisaStack Dates", and an optional "Remind Me" (None, On the Day, 1 Day Before, 1 Week Before; all-day reminders at 09:00).
- Checks (targeted, nice -n 15): packages/core src/calendar 2 files 22 passed (golden file, generated-input properties, SHA-256 vectors, UID, SEQUENCE, Dhaka and Los Angeles daylight saving, options parser); packages/services attention and enforcement 26 passed (ratchet baseline unchanged), missions and agency appointment tests 11 passed; apps/web src/lib, calendar page and route, Home 80 files 1129 passed; pnpm run lint exit 0; pnpm run typecheck exit 0 (8 of 8). Guards proved to fail (cp backup, then restored): UID cut to 31 characters (2 red); no line-break cleaning in UID values (1 red); one-pass zone conversion (1 red, Los Angeles hours after each change); any reminder offset allowed (2 red); folding at 76 (2 red); no 7-day lower bound on tasks (1 red); no zone check in createAppointment (1 red); no Origin check (1 red); no unsafe-detail check on case names (2 red); no bidirectional strip (1 red); UTF-16 cut (1 red); Home link back inside Needs Attention (4 red).
- Not verified: full suite, web build, next start, Playwright and smoke, /code-review and /security-review on the new head, import into Google, Apple and Outlook, T13 on staging. The single-appointment route (outside the WP-V4 allowlist) still names its file `appointment-<id>.ics` and does not pass `updatedAt`, so its SEQUENCE is the download time.

### 2026-10-26, WP-V4 calendar export: audit entry and the single-appointment file

- Each calendar file writes one `CALENDAR_EXPORTED` audit entry (count, kinds, source; never dates, titles or case names), matching the account export's `ACCOUNT_EXPORTED`. Fail-closed: no entry, no file. Owner proof only (`recordCalendarExport`, refusing a shared viewer, a copied proof and an empty file).
- The older single-appointment download now goes through the access gate on the case as owner, the shared core (same permanent UID as the dates file, SEQUENCE from the appointment's last change) and a generic file name `visastack-appointment.ics`; it writes the same audit entry. Added to the WP-V4 allowlist under the owner's calendar direction of 26 Oct 2026.
- Tests: services attention and enforcement 29 passed (three new audit tests); web calendar and appointment routes 26 passed (four new download-audit tests, five new single-appointment tests). Guard proved: the dates download with the audit call removed turns two tests red.

### 2026-10-26, WP-V4 calendar export: second review fixes

- Code commits db79072 on top of the WIP commit d90f3e4 (branch claude/prog-v4-calendar, local; the WIP commit was pushed by the coordinator for safety, nothing else pushed, no PR).
- Time zones: a repeated hour is its first occurrence and a skipped hour uses the offset before the change, in every zone (Berlin and Sydney added to Dhaka and Los Angeles); 30 February or 25:00 is refused, not rolled over. Zone names are stored in the runtime's canonical spelling. The refusal reads "enter a time zone name, such as Asia/Dhaka" (the services' lower-case convention, shown as is); the free-text forms are unchanged (the owner form is outside the allowlist; a time zone list on the agency form was not added, to avoid a server and browser list mismatch).
- Options keep the known kinds when some are unknown. `recordCalendarExport` returns `upstream_error` instead of throwing (the service codes have no internal code). The dates file is built before its audit entry, and a file that cannot be built writes none.
- Serializer: CRLF, lone CR, LF, NEL and U+2028/U+2029 are one line break; C1 controls removed; reminders landing on the same moment written once. SEQUENCE epoch moved to 1 Jan 2020 (permanent). A cancelled appointment's single file is STATUS:CANCELLED. Reminder choices are offered None first by an explicit order. The page now says apps that support updates replace earlier dates and others may add them again.
- `CalendarPublisher` is reshaped for per-event sync (`upsert`, `remove`, one outcome per UID); ADR 0016 says a live feed is a read path that does not use it.
- Checks (targeted, nice -n 15): core src/calendar 27 passed; services attention and enforcement 30 passed (ratchet baseline unchanged), missions and agency appointment tests 11 passed; web src/lib, calendar page and route, single-appointment route, Home 81 files 1141 passed; pnpm run lint exit 0; pnpm run typecheck exit 0 (8 of 8). Guards proved to fail (cp backup, restored): latest occurrence chosen (2 red); no wall-clock validation (1); unknown kind widening (2); C1 kept (1); no reminder de-duplication (1); 2026 epoch (1); audit write throwing (1); typed zone case kept (2); file built without the failure guard (1); cancelled appointment as CONFIRMED (2); reminder order from Object.entries (1).
- Not verified: full suite, web build, next start, Playwright and smoke, /code-review and /security-review on this head, import into Google, Apple and Outlook, T13 on staging.
- Third review fix: zone names are saved as typed with their letter case corrected, never swapped for an older name the runtime reports (Node 22 reports Asia/Kolkata as Asia/Calcutta and Europe/Kyiv as Europe/Kiev); a small table keeps current names capitalised when typed in lower case. This replaces "stored in the runtime's canonical spelling" above. Times are unaffected (same zone rules).
- Owner rule (26 Oct 2026): time zones are always saved in their latest official name. One table, `CURRENT_TIME_ZONE_NAMES` in `@visastack/core/calendar` (old IANA names and country aliases to current names, for example Asia/Dacca to Asia/Dhaka, Asia/Calcutta to Asia/Kolkata, Europe/Kiev to Europe/Kyiv, US/Eastern to America/New_York), used by `currentTimeZoneName`, which appointments (owner and agency side) and task due zones go through when saved. This replaces the "kept as typed" rule in the bullet above. A test checks that every current name is known, is not itself renamed, and has the same offsets as its old name every 6 hours through 2026 (it caught Asia/Chongqing, which now resolves to Asia/Shanghai). Core 29 passed; services attention, missions, agency, notification sweep and the ratchet 193 passed. Profile time zones are not edited anywhere in the product today (default Asia/Dhaka), so nothing else saves a zone.

### 2026-10-26, WP-V4 per-case sharing exceptions (foundation for Prepare Again)

- Built (branch claude/prog-v4-case-exclusions on main 309625c, local commits only, not pushed): per-case sharing exceptions for all-cases grants (owner approval 26 Oct 2026, ADR 0017, permission-model law 9). New table `grant_case_exclusions`, migration 0090 (additive; drizzle-kit generated, hand-ordered so the new (id, applicant_id) unique pairs on grants, missions and sharing_invitations exist before the composite foreign keys). Migration 0090 is written and NOT run; the owner pre-approved running it right after the merge.
- One rule: `grantCoversMission` (packages/policy) and its SQL form `grantCoversCaseSql` (packages/services/src/access/grant-scope.ts), proven equal on a grant-by-case matrix. `loadGrantsForPolicy` attaches exceptions through the single mapping `toPolicyGrant`, so requireAccess, orgGrantPermits and every gate built on them deny an excluded case. SQL paths changed: agency case list (and the visible-case list, reassignment queue and Do Next), workspace search, notification recipient check, agency evidence request list. Bulk export uses `toPolicyGrant`. Documents and profile details keep their own grant scope.
- Before migration 0090: a `to_regclass` check makes every read mean "no exceptions" without aborting the surrounding transaction; any other failure throws. `applyCaseSharingAnswers` refuses with upstream_error when there is anyone to exclude, so the caller rolls the new case back.
- Write side (owner only, gate proofs, ratchet baseline unchanged): `listCaseSharingQuestions`, `applyCaseSharingAnswers` (no answer means no, computed at apply time, idempotent, audits GRANT_CASE_EXCLUDED and GRANT_CASE_ALLOWED), `removeCaseException` (Allow This Case, audits GRANT_CASE_EXCLUSION_REMOVED, fresh sign-in only when the grant hands out a step-up action). Accepting a pending all-cases invitation moves its exceptions onto the new grant in the same transaction. Nobody is notified.
- Screens: Sharing shows "Not Shared: <case title>" with Allow This Case (asks in the page first) under each live all-cases grant; Application Memory names who a case is not shared with. Prepare Again itself is a later PR.
- Checks (targeted, nice -n 15): policy 38 passed; services case-exclusion-enforcement 9, grant-scope 8, sharing, sharing-invitations, agency, access (ratchet included, baseline unchanged), tenant-isolation, workspace-search, notifications, application-memory: 12 files, 218 passed; db package 5 files, 36 passed, 1 skipped (live-database test); web sharing, agency, applicant/[id], mission, Title Case, vocabulary and CSS guards passed; pnpm run lint exit 0; pnpm run typecheck exit 0. Guards proved to fail by breaking real code: policy exclusion ignored; SQL fragment ignoring exceptions; presence check always true; composite keys dropped; exceptions not attached in loadGrantsForPolicy; case list, search, notification and evidence-request filters reverted; memory and transparency lists emptied; allowed-id check, owner check, missing-table refusal, step-up rule, invitation carry-over, idempotency and ended-grant check removed; Sharing page live-grant condition and the action's applicant check removed.
- Not verified: full suite, web build, next start, Playwright and smoke, /code-review and /security-review, the signed-in look of the Sharing and Memory pages, the migration on a real database.
- Open, outside this change's file list: backup reconciliation does not replay GRANT_CASE_EXCLUDED after a restore; the account export does not include exceptions; the case page's Self-reviewed note counts an excluded organization as having access.
- Update, same day (owner approval "close all four", local commits 314b866, 3f50732, b702cef, 9d8a40d on top of WIP 27735e9, not pushed beyond that WIP): the four open gaps above are closed. Restore: backup reconciliation replays GRANT_CASE_EXCLUDED and GRANT_CASE_EXCLUSION_REMOVED in chain order, last event per grant-or-invitation and case only (a rerun is a no-op), and fails closed (grant paused or revoked, invitation revoked, audited RECONCILIATION_CASE_EXCEPTION_FAIL_CLOSED, error reported) when an exception cannot be written. Account export: each granted grant carries caseExceptions in the JSON and grants_granted.csv, counted in the manifest; a recipient's export shows nothing about them. Case page: the Self-reviewed note uses grantReachesCase (the shared rule). packages/policy exports grantCoversMission and the equivalence test checks it directly and through authorize().
- Checks (targeted, nice -n 15): policy 38 passed; services 16 files, 274 passed (sharing, invitations, agency, access with the ratchet baseline unchanged, tenant isolation, search, notifications, memory, backup reconciliation 20, export 3, export CSV, lifecycle); web applicant, agency and mission pages with Title Case and vocabulary guards, 54 files, 457 passed; pnpm run lint and pnpm run typecheck exit 0. Guards proved to fail: exclusion or removal events not replayed, last-event dedupe removed, fail-closed close removed, export exceptions filtered out, case page back to counting every active organization grant, grantReachesCase ignoring exceptions, predicate ignoring exceptions, engine not using the predicate.
- Still open: docs/operations/backup-resurrection-reconciliation.md needs the two new event rows (outside the file list); invitation-bound exceptions are not in the account export because invitations are not; full suite, build, browser checks, /code-review and /security-review not run.

### 2026-10-26, WP-V4 per-case sharing exceptions: review fixes finished

- Correction to the entry above that says the work was "not pushed": branch claude/prog-v4-case-exclusions was pushed at the end of that session (head 9b2ecc5, the unverified review-fix WIP), with no pull request.
- Finished on that branch after merging main (8f91b54): every fix in docs/upgrades/programme/WP-V4-CASE-EXCLUSIONS-NEXT.md. One-shot answers with exactly-inserted rows audited; one advisory sharing lock per person on answers, invitation acceptance and all-cases grant and invitation creation; exceptions follow the recipient (carried forward, audited reason carried_forward; Allow This Case clears the same recipient's ended ones); evidence requests and in-app notices about a case need a live grant reaching it, or no live grant at all (history); the case's own organization cannot be excluded; restore fails closed by revoking; uniform not-found for a hidden case; case ids trusted only for their own person; presence check through the search path, "present" remembered per handle; answers with everyone ticked go ahead before migration 0090.
- Sharing page: per-row messages, focus kept with the choice, "Shared Separately" when the same recipient reaches the case another way, and a pending all-cases invitation's exceptions listed read-only. Account export lists invitation-bound exceptions apart. ADR 0017 second amendment, permission-model law 9, restore runbook rows for all four events.
- Proof that the new guards can fail: ten mutations (lock, one-shot, owning organization, live-grant filter, carry-forward, uniform not-found, case belongs to person, present-only memo, revoke on restore, notice filter) each turned its test red; restored.
- Checks so far (targeted, nice -n 15): services 14 files 251 passed before the web fixes; web applicant pages 31 files 288 passed, case exceptions 2 passed. Full check, review and CI follow in this chunk's update.
- Update, same day: an independent security re-review of the finished fixes found no way for a recipient to reach an excluded case, and confirmed three smaller defects, all fixed. (1) Medium: lock order. Recording answers inside the case-creating transaction took the global audit lock before the person's sharing lock, while grant and invitation paths took them the other way round, so two such transactions could deadlock. `createMission` now takes the sharing lock before its first audit write, and the rule is written on `lockCaseSharing`. (2) Low: the agency loaders (assign, write, decisions, requirements, selected evidence) said "forbidden" for a hidden case and "not found" for an unknown one; they now give the same not-found (three older expectations updated from forbidden to not_found, still denials). (3) Low: Allow This Case now clears the same recipient's exceptions on that case on every other grant and invitation, live or ended, each audited, so a later re-share cannot bring the old "no" back. Each new guard was broken once and its test went red.

### 2026-10-26, WP-REF visible reference codes

- Owner decision (26 Oct 2026, docs/upgrades/programme/WP-REF-PLAN.md): every person, case, document and agency request gets a short visible code people can quote, `P-`, `C-`, `D-` or `R-` plus 6 characters (5 random, 1 check), e.g. `C-7K2Q9M`. ADR 0018 records the permanent format. Migration 0091 pre-approved to run right after the merge.
- Built on branch claude/confident-tesla-64gak9 after #278 merged (merged main in, then generated 0091 on top of 0090):
  - Core (packages/core/src/reference-code.ts): Crockford base32, a Damm check over GF(32) seeded with the type letter, strict reading of typed codes, a denylist read through look-alike digits, the reserved `00` start.
  - Registry table `reference_codes` with no foreign key, never deleted, so codes are never reused. Migration 0091 creates it and backfills every existing record with a plpgsql function that computes the same check character; the migration test runs every backfilled code through the TypeScript parser.
  - Assignment inside the four create transactions. Set-based bulk assignment for preview and load data. While the table is missing, creates succeed and no code is shown.
  - Lookup only inside the signed-in workspace search, with the search's own visibility, a separate hourly budget per account (REFERENCE_LOOKUP, 60) and a plain "one character looks wrong" notice for a typed code that fails its check.
  - Codes are shown on: the case header, the documents page, the traveller's request page, the agency case cards, request rows and dashboard, the follow-up message (structured field only), the account export spreadsheets, the agency JSON export (person codes; that export holds people only), and the calendar text (only when case names are chosen; UID unchanged).
- Allowlist note: the plan's file list missed the screens and loaders that draw codes. The WP-REF allowlist adds them, each line with a reason, within the approved design.
- Checks so far (targeted, nice -n 10): core 18; db migration 9; services reference-codes 6, workspace-search 10, attention 29, export-csv and account-export 26; web agency 166, case page 32, documents 22, evidence 2, calendar and ics 46, search route and toolbar 20. Lint and typecheck exit 0. Independent strict and security review, full check, CI and live checks follow in this chunk's update.
- Update, same day: an independent strict and security review found no way to reach a record through a code that the normal search would not reach, and confirmed one Medium and seven Low defects, all fixed. (M1) Words that pass the check by chance ("Germany", "Invoice") were treated as lookups and spent the hourly budget: text now counts as a code only when typed with its letter and a separator or holding a typed digit, and the normal search always runs too, code hit first. (L1) The typo notice now needs the letter, a separator and 6 to 8 characters with a digit, so "D Rahman" and half-typed codes search normally. (L2) A longer code typed bare that starts with a type letter is read both ways (proved never ambiguous). (L3) Migration 0091 is re-runnable after an interrupted run (production applies statements one by one). (L4) The backfill holds new rows back with a SHARE lock, so no record created at the boundary is left without a code. (L5) The code is matched inside each visibility query, so unknown and hidden codes take the same path. (L6) The Copy status stays in the page while empty, so it is announced. (L7) The registry finder is no longer exported. Fourteen mutations, one per guard, each turned a test red.
- Update, same day: #278 merged as 7977817 and migration 0090 ran (91 applied, table present, 0 rows); post-merge CI, Deploy Smoke, Playwright Deploy Smoke and the Live signed-in check passed; readiness ready. #279 first head (b2ad1fc) failed CodeQL with one high alert: a polynomial regular expression in the mistyped-code check on typed search text. Fixed with simple, non-overlapping patterns and a regression test (the old pattern took 12 s on a hostile input; the test went red with it); CI including CodeQL green on 624b86b; merged as dc420be; migration 0091 ran (92 applied; every person 10, case 4 and document 8 has a code; all 22 live codes pass the app's check rule; the temporary function is gone).
- Update, same day: after #279 merged, post-merge CI, Deploy Smoke and Playwright Deploy Smoke passed and readiness was ready. The Live signed-in check run hit its 15-minute job limit while installing the test browser, before any test ran; it was re-run once (allowed for a job that died before its test body) and passed.

### 2026-10-26, Small Commercial V1 plan and WP-V4 Prepare Again

- Owner instruction (26 Oct 2026, "Adaptive Commercial Completion and Expansion Programme"): move the current product to a lean commercial release for 100 to 1,000 users; preserve what works; Programme X continues inside it. Plan and current-state reconciliation: docs/roadmap/SMALL-COMMERCIAL-V1.md. Deferred controls with triggers, and the commercial-minimum list that is never deferred: docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md.
- Reality checks recorded there: private OCR runs only in the scanner worker, which is not accepted, so scanned images get no text on the normal path; AI reading needs two button presses; payments are a stub port; no OAuth server, user API token or connector exists; WP-V5 projection does not exist yet; fact status STALE has no writer; readiness can never report the `github_clamav` scanner as available.
- Prepare Again (v1.2 U02, branch ccr-847e092e-iee1pl): `planPrepareAgain` and `prepareCaseAgain` in packages/services/src/missions.ts, both taking an owner proof on the previous case. The plan uses the newest published version of the previous case's checklist and sorts each requirement into Reusable, Needs Refreshing or Review, or Missing against current records (same eligibility and staleness rules readiness uses). Every current record is listed; only a still-current record the previous case chose starts ticked; nothing in Needs Review is ticked. Create runs in one transaction: sharing lock, re-plan, refuse a changed checklist or any ticked record no longer carriable, the shared case-creating writes (now `insertMissionInTransaction`, also used by `createMission`), the sharing answers for every all-cases recipient (no answer means no), the checklist, then one bulk insert of the ticked selections with one audit record each. Copied: destination, purpose, jurisdiction, service category, manual mode. Never copied: dates, family trip label, owning agency, tasks, notes, appointments, snapshots, letters, acknowledgements, state, outcome, grants.
- Screen: /app/applicant/[id]/missions/prepare-again?from=<case>, linked from the case page ("Prepare Again"). After a refusal the page redraws so a retry sees the new list.
- Usage event CASE_PREPARED_AGAIN (metric: records carried) with its own analytics category and admin label "Cases Prepared Again".
- Review: /code-review (max) found 12 issues, all fixed: hidden fresher records, Needs Review items pre-ticked, a single type match pre-ticked, choices under a replaced checklist counted, first-found problem instead of the worst, per-record round trips under the audit lock, no redraw after a refusal, unread not-applicable count, duplicated date parser, missing STATUS/ledger/known-issues updates, a CodeQL "green" claim (it is skipped on this private repository), and the merge-rule source (now conflict register CR15).
- Proof the guards can fail: removing the checklist filter and skipping the sharing answers each turn tests red.
- Not verified yet: full check, security review, CI, the signed-in look of the new screen on the live site.

### 2026-10-26, Small Commercial V1 architecture freeze

- Owner instruction (26 Oct 2026, architecture session): resolve six questions and leave an exact plan for implementation sessions. Outputs: `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` (packages S1 to S17), `docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md` (commercial-minimum M01 to M17, deferred H01 to H28), ADR 0019 (automatic document reading), ADR 0020 (invoice payments with a cash ledger, SSLCOMMERZ online and verified manual claims), ADR 0021 (AI Context Gateway: read-only remote MCP, VisaStack's own minimal OAuth authorization server with Client ID Metadata Documents and an allowlist, owner-delegated connections, one projection engine shared with WP-V5).
- Verified facts: repository visibility is public (GitHub API), so CodeQL runs; `CLAUDE.md` said private and was corrected. No live credential pattern in the current tree (one Svix documentation example secret in a test, and scanner test fixtures); git history not scanned. One published checklist in production ("UK Visitor1", 2 requirements, not authoritative, review overdue, no cases). Neon Auth's managed service offers no MFA and no OAuth provider.
- Access audit: 313 baseline functions; every web caller checked. Real gaps scheduled as S2: AI reading entry points do not bind a document version to the applicant; two admin reads open to any platform role; the support-grant service has no role check. Step-up: every web caller passing `true` verifies a recent sign-in first. No second factor for staff (S3).
- Prepare Again security review (independent, read-only): no findings.
- External documentation: MCP authorization and Claude connector authentication pages read on 26 Oct 2026; the OpenAI and SSLCOMMERZ documentation hosts did not resolve from the session network, so S11 and S13 must re-read them before building.
- Not verified: anything live; no code shipped this session beyond the Prepare Again branch.
- Update, same day (owner: "payments, AI connector and product now; only security and compliance deferred"): the handoff now runs S1 to S25. New contracts: ADR 0020 Phase 2 (recurring period invoices, reminders, owner-set overdue handling, automatic reactivation, refunds and credits, accounting export, second provider, receipts), ADR 0021 extensions (DCR, original files per ticked document, suggestion tools that only create pending suggestions, drafts and reminders, agency connectors behind a new per-grant `AI_ASSIST` permission), ADR 0022 (real redaction: owner masks, rasterized image-only safe copies). The register's part 2 now holds only security and compliance items (plus the AI destructive-action boundary and the tax engine); infrastructure items moved to part 3 (scaling triggers); moved items listed in part 4. Native mobile apps stay out (26 Oct avoid list); Bangla last on the owner's word.
- Update, same day (owner: "get the manual items ready, do not block functionality in their absence"): `docs/roadmap/OWNER-ACTIONS-SMALL-COMMERCIAL-V1.md` (O1 to O17: what is prepared, the owner's steps, the product's behaviour until each is done) and `docs/legal/2026-10-26-small-commercial-v1-changes-for-counsel.md`. Checked read-only: Neon project on Free (`free_v3`, 0.25 CU maximum, 1 GB per branch, 6-hour history, 10 branches, AWS US East); Vercel team plan not returned by the API (indicators point to Hobby). Full-history secret scan with gitleaks 8.18.4 over 867 commits on all branches: 11 matches, all false positives. Found two more blockers for real data, now packages S26 (real key service; the local master key is refused in commercial mode and its readiness gate is hard-coded false) and S27 (readiness checks: AI gate tied to the old OpenAI path, scanner gate ignoring `github_clamav`, a penetration-test attestation the owner has deferred; plus daily backup). PR #281 CI: "Lint and audit" failed on the UI ratchet (one new inline style in the Prepare Again form); replaced with the shared `field-inline` class; lint, audit and 302 related web tests pass locally.
- Update, same day: #281 merged as 9f93652 with the owner's word. Post-merge: CI, CodeQL, Deploy Smoke, Live signed-in check and Vercel success; Playwright Deploy Smoke attempt 1 was cancelled by its 10-minute job limit during "Install Playwright Chromium" (before any test body ran), attempt 2 passed; readiness ready; `/app/applicant/<id>/missions/prepare-again` redirects signed-out visitors to Sign In with the return path. No migration. The Sonnet session prompt with quality gates is `docs/roadmap/SONNET-SESSION-PROMPT.md`. Recurring note: the browser install step is near the 10-minute limit on deploy smoke runs (also seen after #279); consider caching the browser or raising the limit in a later package.


### 2026-10-26, Small Commercial V1 S2: security minimum (M12, M13, M14)

- Owner instruction (26 Oct 2026): implement every package of the handoff in order, merge and deploy without waiting. S1 (Prepare Again) was already merged as #281. This is S2.
- M12, document reading entry points: `runExtraction`, `runOcr`, `runInconsistencyCheck`, `runClassification`, `renderOcrSourceImage` and `getLatestExtractedText` now prove the file version belongs to the applicant (`documentVersionBelongsToApplicant`, one rule in `document-version-owner.ts`: version to document to applicant). Another person's version, a missing version and a malformed id answer identically (`not_found`). Another person's applicant now also answers `not_found` (it was `forbidden`, which told a stranger the record exists). The ratchet counts `document_version_id` as an owned column; five newly caught functions are baselined (`document-version-owner#documentVersionBelongsToApplicant`, `intake#getLatestExtractedText`, `intake#listScanResults`, `jobs#enqueueIntakeJob`, `jobs#retryFailedJob`) and three leave it (`applicants#listAllApplicants`, `audit#listRecentAuditEvents`, `support-access#createSupportGrant`).
- Cache: reuse of an earlier reading (document details, text reading, inconsistency check, document-kind classification) now stays inside one applicant's own records, so identical text from two people is read afresh.  A classification hit copied the first person's explanation text, so it is included.
- M13, admin reads: `listAllApplicants` and `listRecentAuditEvents` moved to `platform-reads.ts` and take a staff scope for `APPLICANT_DIRECTORY_VIEW` (compliance administrator) and `AUDIT_TRAIL_VIEW` (security administrator), checked live and re-checked inside the service (cast objects, scopes for another action and stale scopes are refused). The Audit and Privacy pages show "Not available for your role" to other platform roles; the owner role passes everything.
- M14, support grants: `createSupportGrant(db, approver, input)` takes a `SUPPORT_GRANT_APPROVE` staff scope (security administrator); the approver account comes from the scope, never from the caller's input.
- Platform tabs and links: Privacy and Audit (tab bar, side navigation, Security page) now show only to the roles that may open them, so no link leads to a refusal. Staff-scope freshness check is one shared function.
- Review: `/code-review` max (10 findings: classification cache, navigation links, missing cache tests, clamp test, allowlist breadth, duplicated scope check and entry-point block, stale M12 to M14 rows; all fixed or recorded) and an independent opus review (7 findings: Privacy page still exposed file names and hold reasons to roles without the directory, now gated whole; cache copying across people, fixed; forbidden versus not found, fixed; limit NaN, fixed; stale comments, fixed; test gaps, closed). Mutations: removing the binding check and the directory check each turn tests red.
- Checks so far: services 1766 tests and web 2071 tests passed before the last review round; the changed areas re-ran green after it. Mutations: removing the three cache filters, the version binding or the directory check turns the new tests red. Migration: none.
- Not verified yet: full check, CI and live checks on the final head (recorded in the STATUS update after merge).

### 2026-10-26, Small Commercial V1 S3: staff authenticator codes (M08)

- Built: authenticator-app codes (RFC 4226 and 6238, tested against the RFC vectors) for every account that holds a platform role; ten single-use backup codes (stored as hashes); the secret encrypted with the application key service and bound to the account and setup; one-time use per 30 second step; five wrong tries in five minutes or twenty in a day lock codes (counted before checking, given back on success); an owner can reset another person's authenticator with a reason (audited); the owner's own reset is a documented manual procedure (docs/operations/staff-second-factor.md). Screen: /app/staff-code (set up with a QR picture drawn inline by a pinned MIT library, `uqr` 0.1.3, no dependencies; type-in key; enter code; manage backup codes). Migration 0092 `staff_second_factors` (re-runnable; the code works before it runs).
- Switch: `STAFF_SECOND_FACTOR=off|required`, default off so deploying locks nobody out; any other value counts as required. Off: a notice on the platform overview and Access pages. Required: every platform page, permission check and staff scope also needs a code proved in this sign-in (`lib/admin.ts`), and the three step-up functions need a code proved in the last five minutes (no new outcome kind, so all 57 callers are covered unedited).
- Review: independent opus review and /code-review max found, and I fixed: pages and actions outside the layout reaching the platform with a password alone (the proof now sits in the shared checks, not the layout), a lockout the owner reset did not clear, an unfinished setup readable by an older session (now bound to the starting sign-in, forgotten after 15 minutes), unbounded lock audit rows (one per window), a backup code being enough to replace the whole set (now also needs a recent password), query-parameter edge cases, rate-limit retention equal to the longest window (now 48 hours), and guard tests (title case, accessibility scan list, inline style ratchet, access baseline +4 entries for the four staff-factor functions).
- Mutations that turn tests red: replay allowed, window widened to two steps, refund removed, step-up gate removed.
- Not verified: live sign-in behaviour (whether Neon Auth returns a session id in production), a scan of the QR picture with a real phone, the migration run. The Access page shows whether codes can be checked before the switch is turned on.

### 2026-10-27, Small Commercial V1 S4: scanner evidence (M05)

- Built: the malware scanning capability now reads proof, not only configuration. Each time the scan runner finishes its storage setup it records that the scanner engine ran (`scanner-evidence.ts`, refreshed at most every six hours, valid 72 hours). The documents page shows scanning as on only while that proof is fresh, so a scanner that quietly stopped no longer reads as working. Runs without the new table or without the runner never block anything; the record is non-fatal. Copy says a check "can take a few minutes".
- Not verified: the proof record on a live run of the scan workflow (it appears after the next scheduled scan).

### 2026-10-27, Small Commercial V1 S26: real key service (M18)

- Built: AWS KMS adapter behind the existing key port (wrap and open with an encryption context of purpose and key version; the recorded key ARN, so switching from an alias to the ARN keeps everything readable; a time limit on every call; error text never carries key material). Data keys gain `wrapping_key_id` (migration 0093, `IF NOT EXISTS`; the code reads and writes correctly before it runs). A re-wrap job (`/api/jobs/rewrap-data-keys`, owner-triggered, safe to repeat, verifies the new wrapping opens before replacing the old one, audited) moves existing data keys without touching any encrypted value. Invitation links sealed before the switch still open while the legacy local key is configured. Readiness: `realKeyManagement` is true only with `KMS_PROVIDER=aws_kms`, key id and region set, no custom endpoint, the local key removed, and a self-test (wrap and open a throwaway key) that has just passed. Own variable names (`KMS_*`) because the host reserves `AWS_*`. Setup script `scripts/ops/aws-kms-setup.sh`, steps in `docs/operations/key-management.md`.
- Review: independent review found, and I fixed: invitations that bypassed the key service, writes failing before the migration, alias-versus-ARN mismatch, the host-reserved variable names, missing call time limits, and self-test hardening.
- Mutations that turn tests red: context binding removed, verify-before-replace removed, endpoint check removed.
- Not verified: any call to real AWS (needs owner action O16), the migration run in production, the re-wrap job against real data.

### 2026-10-27, Small Commercial V1 S10: cash ledger and one recording function

- What changed: new table `invoice_payments` (migration 0094, re-runnable) with an append-only trigger, unique keys on (kind, source_id) and (provider, provider_transaction_id), and an opening-balance backfill marked provider `opening_balance`. New `applyInvoiceCollection` (invoice-ledger.ts) is the single recording function: it locks the invoice row, replays by key, refuses a void invoice, a currency mismatch or more than is outstanding, then writes the ledger row, the invoice total and status, one audit event and the cash event. `recordInvoicePayment` delegates to it and gains optional currency and idempotency key. `getInvoiceLedger` gives platform staff and agency owners and admins a read of one invoice ledger. `voidInvoice` now locks the invoice row. The admin payment form sends the currency and a per-page-render key made on the server.
- Tolerates the table being missing: admin recording behaves as before (no ledger row); other kinds say "not available yet"; the ledger read reports unavailable.
- Evidence: 7 characterization tests (passed on the old code and the new), 40 ledger tests, a migration test (backfill, rerun, append-only, constraints). Mutations to the lock, replay, currency, void, overpayment, amount, trigger, backfill, organization scoping and recorder rules each turned a test red. Code review fixed 10 of 14 findings; security review found nothing at confidence 8 or above.
- Not verified: parallel locking on real Postgres (PGlite runs transactions one at a time); the backfill against production data.
- Owner decision open: the same bank transfer entered twice under different keys is counted twice (ADR 0020 says no idempotency by design for manual entries).

### 2026-10-27, Small Commercial V1 S5: automatic reading, and S6: reading screen states

- No migration. S5: a passport's machine-readable lines become pending field suggestions at intake as a zero-cost run (model version `deterministic:mrz-td3/1`) with no AI call and no AI consent (family name, given name, passport number, nationality, date of birth, sex, expiry, issuing country). Country values are the printed three-letter code at confidence 80, so they are never bulk-accepted; a birth year that would fall in the future moves back a century.
- S5: intake completion queues one reading job per version and reader version (key `<version>:AI_READING:1`) in the same transaction as the move to awaiting review, when the owner has AI reading consent and AI dispatch is allowed. It shares the processing jobs table with intake and is told apart by the key (each worker claims only its own kind). The job runs under `SystemScope<'process-ai-reading'>` (route `/api/jobs/process-ai-reading`, daily backstop `5 3 * * *`; an upload also triggers a pass in-process after intake). At run time it rechecks consent, the kill switch, budget, active provider and the protected-document list; it reads a scan as a picture only when there is no text, then reads details from the best text, skipping AI extraction when suggestions already exist. Deterministic runs are excluded from AI attempts, spend, per-document cost, plan allowance and failure rate. The audit summary `AI_READING_JOB` holds counts only.
- S6: the documents page shows Checking the File, Reading the File, We Found These Details, We Could Not Read This One and Needs Attention; keeps refreshing while a reading is queued (bounded to about ten minutes); names each suggestion's source in plain words; shows one invitation to turn reading on; Read Again is the single retry (the old "Read This File Again" is now "Check the File Again").
- Review: seven confirmed findings fixed (never-read files showing "found nothing", queue-age signal counting waiting readings, a queued reading blocking the check, a reading starting with no time left, an underscore wildcard in a key match, text loaded only to test for non-empty, MRZ and AI suggestions competing). About 21 guards were mutated and each turned a test red.
- Defaults to confirm with the owner: a document with no chosen kind counts as protected, so a scan with no kind is read by AI only when the person presses Read Again or chooses a kind; readings queued while intake runs on the private worker wait for the daily backstop; there is no country-name table yet, so country fields show the printed code.
- Not verified: browser checks and screenshots at phone, tablet and desktop widths (run by the integrator's full check only), any real AI provider (test doubles only).

### 2026-10-27, Small Commercial V1 S8: selected-output engine, and S9: WP-V5 outputs

- No migration. S8: `packages/services/src/selected-output.ts` builds one owner-only projection (`buildSelectedOutput`, `renderAiContext`) with the ADR 0021 section 4 rules; `fieldPolicyOf` in core gives the layer, kind and protection of each field. Unselected layers, replaced values and agency notes and tasks are absent; conflicts are markers; identifiers are masked to the last three characters unless a step-up proof allows full numbers; document text is capped at 20,000 characters and never included for protected types. Output for one case is 3.3 KB against a 68.8 KB account export (about one twentieth).
- S9: Briefs and Summaries page (agency brief, case handover, trip essentials, confirmed-information sheet as text or spreadsheet, AI context preview), a download rebuilt and checked against the previewed fingerprint, an audit entry written before the file is served, the prepared WhatsApp message (a generic line plus a link to sign in, never a document or identifier, never sent automatically), and the first-run choice "Prepare a Brief".
- Review: extra-high code review on S8 (15 findings fixed, including contributor-only documents leaking, agency task text leaking through next actions, unvalidated case kind, prompt-injection guidance for document text) and high on S9 (10 fixed, including number-like spreadsheet cells being altered, line forging through typed newlines, UTC date versus the person's time zone); accessibility and copy reviews applied. About 30 guards were proven by breaking the real code.
- Owner gate (label wording): Agency Brief, Case Handover, Trip Essentials, Confirmed Information Sheet, AI Context; page "Briefs and Summaries"; depth Short, Standard, Everything.
- For S13: full identifier numbers need a step-up proof (action EXPORT_PROFILE, resource = person id); the AI connector must supply or store an equivalent.
- Not verified: browser, print, clipboard and WhatsApp behaviour beyond the automated specs.

### 2026-10-27, Small Commercial V1 S7: WP-V4 close, request screens and colour polish

- No migration, no new table, no permission change; non-admin agency staff still see no evidence requests.
- The traveller request list shows each item in the five groups (Missing, Processing, Received, Needs Correction, Reviewed) from the same rule the agency uses, with plain guidance, the checklist age rule when the request came from a checklist item, and "You sent this on" from the stored answer time. "Received" never reads as "Submitted" on any screen. A request sent back shows its reason (it was never loaded before); an old reason no longer shows beside an answered or accepted request.
- Saving, "Saved at" (server time, shown in the traveller's zone) and "Not saved" with a reason and Try Again, on the response form and the question form. "Saved at" survives the request leaving the waiting list and never shows beside a fresh Send button.
- Item-level questions use the existing shared case notes: a note headed "Question about R-code:" written by `askAboutRequestItem` (owner only, comment proof on the request's case, 500 characters, 5 per request under an advisory lock). The screen says who can read it before sending.
- Colour polish: one colour family per group (`TRIAGE_GROUP_TONES` in labels.ts) on the traveller list, the agency Where Things Stand and the Home request row; one CSS block "WP-V4 request screens", tokens only. The agency Clients list now shows plain names instead of raw codes.
- Review: 9 code review findings (7 fixed, 1 limitation recorded); accessibility and copy reviews applied; security review found nothing; 19 guards were broken on purpose and went red. Browser specs (public, browser security, no-secret sign-in) 202 of 202 and smoke 11 of 11 on the lane's own build.
- Open: a request already marked received whose file was later blocked gives the traveller no resend path (the service only allows resending from open or sent-back; a state change needs an owner decision). No agency notification when a question arrives. No threaded question view on the agency side. Item guidance presets and T13 notification dedup are not done. The signed-in look at desktop and phone width and a screen reader pass are not verified.

### 2026-10-27, deploy browser check: unstable pixel-identity test

- The post-deploy browser check ("authoritative appearance of actual workspace components ... keeps identical pixels under both device appearances") failed on two deploys (after S26: documents at 1600px; after S8 and S9: profile at 390px) and passed on its one allowed re-run each time. The pull request build of the same code passed it both times, and neither change touched the stylesheet or the workspace components. It compares two full screenshots byte for byte against the live deployment right after it goes out. A settle step (repeat each capture until two in a row are identical, then compare light and dark exactly as before) is being added; the comparison itself is not weakened.
- Also fixed: the non-main acceptance process test had a 15 second start-up limit that a loaded machine exceeded; it is now 60 seconds.

### 2026-10-27, Small Commercial V1 S11: SSLCOMMERZ online payment flow (ADR 0020), built, not live

- What: `payment_attempts` table (migration 0096, additive, re-runnable). A payment provider contract plus the SSLCOMMERZ adapter. One settling path (`settlePaymentAttempt`) used by the gateway notification (`/api/payments/sslcommerz/ipn`), the browser return (`/api/payments/sslcommerz/return`), the daily `process-payment-reconciliation` job and invoice refresh. A signed one-hour plain-language result page (`/payments/result`). Money is counted only after a server-to-server gateway check matches the attempt's transaction id, amount, currency, store and risk flag, and is recorded through `applyInvoiceCollection` (kind ONLINE). A mismatch, risky, already-paid or void case is held for review and never added. Failed, cancelled and expired payments change only the attempt; a late success is still recorded (7 days). A gateway outage fails closed (503 so the gateway retries; the daily job covers the rest).
- Switches: everything is off unless `PAYMENT_PROVIDER=sslcommerz` with a store id, store password and `SSLCOMMERZ_MODE` exactly sandbox or live (no default); a half-set configuration fails closed and the capability reports available only then. Runbook: `docs/operations/online-payments.md`.
- Evidence: 53 payment service tests plus ledger, billing, access ratchet and rate-limit suites; adapters 442; db 42 (including the 0096 migration test and schema drift); web 2395; 30 guards broken on purpose and each turned a test red; code review 15 findings fixed or documented; security review found nothing at confidence 8 or above (two lower notes: a holder of a payment's unguessable transaction id can get a one-hour result link that shows the invoice reference and amount; rotating the store password invalidates in-flight result links).
- Not verified: the official SSLCOMMERZ v4 documentation was unreachable, so field names, the signature rule, reply shapes, hosts, whether the validation id is stable, and the required customer fields follow the widely documented integration and must be checked before sandbox use; never run against the real sandbox; real-Postgres row-lock concurrency; CodeQL may flag the mandated MD5 signature; the public privacy notice processors list is left to the owner.
- Owner gates: O6 (sandbox account, credentials, merchant-panel notification address), the migration 0096 run, the live switch.
- Follow-ups: S12 invoices page (start and recent-attempt "Continue"), S18 held-payment resolution tools. A held payment is final until S18.

### 2026-10-27, Interface: collapsible sidebar and account menu fit

- On laptop widths (1024px and up) the left sidebar can be hidden to a slim 72px icon rail with a Hide Menu / Show Menu button (a real button, 44px, with aria-expanded and aria-controls). Rail items show their label on hover and focus (Escape puts it away); the workspace switch and More Tools open as popovers beside the rail, so no destination is lost. The choice is kept per device in a small cookie (`visastack_sidebar`, path /app) so the first paint is right with no flash; without the cookie the sidebar is open. The open sidebar keeps its pinned 256px width and 83px toolbar, and the existing pixel-identity checks pass.
- The account menu now measures its trigger and the screen: it sets a height limit to the room available, opens above a low trigger, aligns to the trigger edge, scrolls inside itself and keeps Sign Out in view. Width is the smaller of 19rem and the screen minus 1.5rem; the vertical rhythm is about 36px tighter and rows stay 44px. At 1366x768 it went from 537px to 501px tall. A full-height menu could not be reproduced at the tested sizes; it always fit but was tall.
- Tested at 1366x768, 1440x900, 1920x1080, 1280x600, 1280x480 and 1024x700 with both sidebar states; 229 browser checks passed; the old fixture modes are pixel-identical at 390, 768, 1024, 1280 and 1600px; nine guards were broken on purpose and went red.
- The workspace pixel-identity test now repeats each capture until two in a row are identical (up to five tries) before comparing light and dark exactly as before. A public-page pixel test (`/privacy` at 1600px) also failed once under four parallel workers and passed on rerun; it is the same family and was left alone.
- Not verified: real signed-in pages (fixture only), real screen readers, touch devices, Safari and Firefox.

### 2026-10-27, Growth G1: homepage promise

- The homepage now promises "A clean file you can stand behind." (owner decision, 27 Oct). Changed: the hero headline and its supporting line ("One private file for your passport and papers. See what is missing, keep every version, and share only the part someone needs."), the search description ("A clean file you can stand behind. Keep your passport and documents in one private profile and share only the part you choose."), the installed-app description, and the share pictures (redrawn with the new headline) with their text. Unchanged: the meta line, the title and "Share the part. Not the whole."
- Ledger rows CL15 to CL17 added; CL01 to CL03 evidence updated. A new public-text guard blocks any claim of approval, acceptance or a guarantee (checked on the homepage, the installed-app description and the trust story; proved red by breaking the headline and the description).
- Checked locally: 58 unit tests, 202 browser checks on a production build; the hero fits at 390, 768 and 1440px.
- For the owner: "file" (headline) and "record" (meta line and app labels) now sit side by side and may be worth aligning. Not verified: share picture preview in chat apps (checked by eye only), live site.

### 2026-10-27, Growth G3: progress ring, success lines, teaching empty states

- No migration, no product event. A flat progress ring ("N of M items ready", with the same words visible and as the text alternative) now sits on the applicant page, the case page summary, the applicant cases list, the Home active-case rows and the agency dashboard readiness cell. The number comes only from the existing readiness calculation; a case with no checklist shows an empty ring and "Pick a checklist to see what is ready" with a link to attach one, never an invented number. The profile-completeness meter stays. The ring never uses approval words (approved, cleared, accepted).
- Success lines now say what happened and, where known, the progress: upload ("{Type} added. It counts toward a checklist once its safety scan finishes."), detail saved, suggestion accepted, document type approved, checklist attached ("Checklist attached. 2 of 9 items ready."), evidence chosen and sent, request sent, invitations, share created ("Shared. They see only what you chose, and only after they accept. You can stop it at any time below."), member added, other item saved. No email address or typed value appears in any line.
- Empty states teach (what the place is for, the next step, why it helps, with a button): documents, cases (person, agency tab, agency dashboard), the active case, shared with me, notifications, evidence requests (traveller and agency), agency clients, Home applicants.
- Review fixes: the profile editor reset its form on the exact text "Saved." (a guard now protects that), a false "No checklist" when readiness merely failed or passed the 25-row cap, ring rounding showing 299 of 300 as full, contradictory copy on the applicant page.
- Checked locally: web tests 2529; ring browser checks at 390 and 1440px; 11 guards broken on purpose and each turned a test red.
- Not verified: a signed-in browser run (fixture only). Home adds up to 6 readiness reads per load and the cases list up to 25 (one read per case; not batched yet).

### 2026-10-27, Growth G2: country first start

- No migration. The signed-out homepage gains a section under the hero, "Pick a country. See what is usually asked.": a country box (the browser's own list); a whole country name fills in its checklist at once, item by item (calm reveal, off under reduced motion), with a visa type select when a country has several, a "This list may not be complete" note under 5 items, and a note that a checklist is not a decision or a promise. The button ("Create Free Account for Japan", or "Sign In to Start With Japan" while sign-up is closed) goes to sign-up with `next=/app?country=JP`. Hidden when signed in. No visitor is tracked.
- First run: a newcomer with no task sees Step 1 of 3 "Where do you want to go?" with the same picker ("Continue With Japan" or "Skip for Now"), then consent (2 of 3, shows "Your Country" with a Change link), then who-is-this-for (3 of 3), then "What do you want to do?" with a first tile "See Your Japan Checklist". People who arrive for a task (an invitation) see the old screens. The country travels only in the address: no cookie, no stored field.
- Event `COUNTRY_CHECKLIST_STARTED` (label: country code from a closed list of the 156 codes, once per account, only for a signed-in confirmation) registered in the types, dimension rules, categories (`country_start`) and the admin scorecard ("Country Checklists Started").
- Review: skip dropping the country, a per-keystroke "no match" announcement (now said once when leaving the box), index-based keys, aliases moved beside the data and tested; accessibility, copy and design reviews each gave one fix. Checked locally: 13 new service tests, web tests 2620, browser checks 238 on a production build including picker checks at 390 and 1440px; 11 guards broken on purpose and each turned a test red.
- Accepted and unchanged: about 12 KB of country data in the home page (about 4 KB compressed); any signed-in account can fire the once-per-account event; step labels follow the URL flag.
- Not verified: signed-in first run in a real browser, the browser's country list on real phones, the event against a real database beyond the test database. The coverage ledger row for the new homepage section is still to add.

### 2026-10-27, Growth G8a: agency invitation page and clients joined (growth loop 1)

- No migration. A client invitation link now opens a public page before any sign-in. For a reviewed agency it names the agency ("{Agency} Invited You", with the agency's logo and accent colour only here), says an administrator invited them, shows "What {Agency} Could Do" (five sentences built from the real access granted on acceptance, plus what it could not do: download original files, export the profile, share records onward, approve changes), "What You Control" (choose the profile, nothing shared until accepted, stop any time, expires in N days on a date) and "A complete checklist, or a file marked ready, is not an approval." An agency not yet reviewed gets "This Agency Is Still Being Reviewed" with no logo, colour or sign-up buttons. Unknown, expired, withdrawn, used or unacceptable links all give one identical "This Invitation Is No Longer Open" page (no enumeration). A lookup failure or rate limit falls back to the old generic page. Team and sharing invitation kinds are unchanged. Lookups are by hashed token and limited per network address; the logo is served from `/api/branding/invitation-logo`.
- Events `CLIENT_INVITE_SENT` (create) and `CLIENT_INVITE_ACCEPTED` (accept; metric: seconds since sent), once per invitation, organization set, no label, recorded in the same transaction through a savepoint so a failure never blocks an invitation; new category `agency_invites`; admin scorecard labels added.
- Agency dashboard: "Clients Joined" and "Joined in the Last 30 Days", computed from invitation records (so it covers past invitations), counted per person on first acceptance, visible to active members, scoped to the organization, no names.
- Review: 14 code review findings (inviter still an admin, counting people not invitations, advice for an already-accepted person, a dead end on a busy lookup, logo moved under /api because the page CSP middleware skips /api, one shared terms table, relative expiry instead of a UTC time, and more); security review found nothing at confidence 8 or higher; 21 guards broken on purpose and each turned a test red.
- Not verified: the open (reviewed agency) state in a real browser (needs a database), the response headers on /api routes on Vercel, the accessibility and copy review skills (the whole-page axe tests cover the new pages). Moving the brand primitives out of the agency console folder was left for later.

### 2026-10-27, Growth G1b: headline legibility

- The owner reported the homepage headline read "Dean file": the "c" and "l" of "clean" touched at a letter-spacing of -0.073em (desktop) and -0.077em (phone) at weight 820. Both rules now use -0.04em at the same weight and size. Checked by eye on a production build from 320 to 1920px: clear gaps in every letter pair, two lines on desktop and tablet, three lines at 360 and 390, four at 320, no overflow.
- A guard test (`headline-spacing-css.test.ts`) fails if the headline letter-spacing becomes tighter than -0.045em (proved red by restoring the old value); the browser check also asserts the rendered spacing.
- Not verified: real Apple and Windows system fonts (the local build falls back to a local font), the live site.

### 2026-10-27, Small Commercial V1 S12: agency invoices, manual payment claims and numbered receipts

- Migration 0097 (re-runnable, additive): enums for the manual claim method and status; tables `manual_payment_claims` (one waiting claim per invoice, decision-shape checks), `billing_receipts` (the proof-of-payment file: one per claim, scanned clean only, pdf, jpeg or png, up to 5 MiB in the table and 4 MB in practice because of the host's upload limit), `payment_receipts` (unique per ledger row and unique per organization and number) and `payment_receipt_counters`; triggers keep receipts and proof files append-only (including truncate) and freeze decided claims; existing ledger rows (not opening balances) get receipts numbered per organization. All code tolerates the tables being missing.
- Agency Invoices page (Usage and Billing, owners and admins): states Open, Payment Started, Payment Reported, Paid and Payment Needs a Check (a held payment outranks Paid). Pay Online and Check Status or Start Another Payment use the S11 flow. "I Paid Another Way" takes a method, a reference and an optional proof file (scanned, organization-only, every read audited).
- Staff review: the admin organization page lists waiting claims; confirm needs a step-up prompt and records through the single recording function (kind manual claim, source the claim), reject needs a reason. A numbered, gap-free receipt per organization is issued inside the same transaction as the ledger row, so it rolls back with it and a replay returns the same receipt.
- Review: 15 code review findings (a PDF cannot pass the structural scanner so the page now asks for a photo; a held payment still offered Pay Online; upload limit 5 MB over the host ceiling so 4 MB; a UTC date maximum; an orphan sweep foreign key crash; one-click Confirm; proof reads audited; form cleared on error) fixed; security review found nothing at confidence 8 or higher; 11 guards broken on purpose and each turned a test red.
- Not verified: true parallel row-locking on a real Postgres (the test database runs transactions one at a time); a real scanner on PDFs; the live gateway. Held online payments have no resolution tool until S18. A recording in the instant between migration statements could fail once and retry.

### 2026-10-27, Interface: account menu made compact

- The owner reported the account menu still filled the screen. Cause: the earlier fix only capped the height at the room that was left (nearly all of a short laptop window), and the menu was about 500px tall with 44px rows, so on a window about 600px tall it ran to the bottom edge with no margin.
- Fix: on laptops and desktops with a precise pointer the rows are 34px (touch and coarse pointers keep 44px; the accessibility minimum for a pointer target is 24px), the header is tighter (32px avatar, name and email on compact lines, plan chip and View Plan on one line), labels and gaps are tighter, and the panel is 17.5rem wide. The menu is now about 375px tall. It is capped at 70 percent of the window height and kept at least 16px from the bottom edge; Sign Out stays pinned and only short windows (under about 560px tall) scroll the rows. All items and links are unchanged.
- Measured (menu height, gap below, share of window): 1280x600 at 100 and 150 percent scaling: 501, 28, 83 percent became 375, 154, 62 percent; 910x554 at 150 percent: 480 (scrolling), 12, 87 percent became 375, 117, 68 percent; 1366x768: 501, 196, 65 percent became 375, 322, 49 percent; 1920x1080: 501, 508, 46 percent became 375, 634, 35 percent; 1280x480: scrolling with Sign Out pinned, 73px gap.
- Checked: 243 browser checks and unit tests pass, including new checks at eight window sizes with the sidebar open and collapsed (gap of at least 16px, height at most 70 percent, 34px rows, no scrolling from 768px up, Sign Out pinned) and a touch case that keeps 44px rows. Guards proven red: removing the share cap and margin, changing the row height.
- Not verified: real Windows scaling and fonts; touch laptops (primary pointer fine, so 34px rows, still above the 24px minimum); at 768px the menu is 49 percent of the window with about 9px of slack, so a font difference in CI could trip the "under half" check; the menu is not re-measured if the pointer type changes while it is open; windows under about 215px tall can still break the 16px margin.

### 2026-10-27, Growth G5: deadline clocks

- No migration, no new events. Home shows a "Coming Up" card ("Dates That Matter"): the next three dates across all of a person's files, soonest first, each with a plain relative time ("Expires in 12 days", "Due tomorrow", "Expires today", "Expired 3 days ago", "Was due yesterday", "Takes place in 25 days") and a tone word with every colour (Overdue, Within a Week, Within a Month, Later). Each person's overview shows a "Deadline Clock" card at the top, and the Expiry page shows the same clock with five dates above its three signals.
- Dates are worked out in the person's own time zone using the Needs Attention rule (not UTC midnight arithmetic). Sources are document expiry, tasks, requests and appointments. The next date ahead always keeps a slot, so old overdue items cannot hide it; dates more than 30 days overdue are not on the clock (they stay on the Expiry page and Needs Attention). A date the system is unsure of (unconfirmed document type, expiry before issue, more than 30 years away, unreadable time zone) is tagged "Check This Date" and worded "..., if the date is right".
- States: no dates gives "No Dates Yet" with a teaching line and an "Add a Document" button; a failed read shows "Dates are unavailable right now. Refresh to try again." (never shown as empty). A person never sees another person's dates; a shared viewer or a copied proof is refused.
- Review: old overdue items filling all three slots, narrow reads when many items share one day, a thrown read taking a page down, a second gate check per person on Home, sequential reads. 27 guards broken on purpose and each turned a test red; 241 browser checks passed on a production build.
- Not verified: live data; the extra query cost on Home for large households (a second set of source queries per person).

### 2026-10-27, Fix: email delivery and sign-in recovery

- Owner report: a password reset link never arrived for one address, and agency invitations showed "An email is queued". Production records (read only) showed: the address had no account in the current sign-in service (its account was made on the earlier sign-in, last used 7 October, and holds a staff role), so a reset request sent nothing by design; the 9 accounts on the current sign-in can reset (their confirmation emails were delivered through the same sender). All 5 invitation emails since 12 October were handed to the mail service within half a second and confirmed delivered within seconds; the screen said "queued" because it wrote that line before sending. One staff-role email sat queued for 10 hours because only the once-a-day run sends it. Document requests to a third person (sponsor, family member) never sent any email.
- Sign-in recovery: a refused sign-in for an older account with no sign-in now records the confirmed sign-in's opaque id in its audit event. Security admins and platform owners get a "Sign-In Recovery" page (Security & Access) listing those accounts for 14 days; after checking with the person they connect it (reason, confirmation, fresh sign-in check, audited `ACCOUNT_SIGN_IN_CONNECTED`). Refused when two different sign-ins tried (counted in the database, no cap, so repeated tries by one cannot hide another), when the account already has a sign-in, or for a staff account unless a platform owner; the audit chain is locked while deciding so no new attempt lands unseen. The account-recovery page now says what to do.
- Email: invitation, team invitation, sharing invitation and the new document-request email are sent while the person waits (only that record's emails, not the oldest backlog), and the screen says "Invitation emailed" or "The email has not gone out yet and VisaStack keeps trying"; never "queued". Evidence decisions, appointments, staff-role changes, plan downgrades and every scheduled reminder run now send at once instead of at the next day's run. A once-a-minute platform-wide pass, started after ordinary signed-in requests, retries waiting emails (the hosting plan allows only daily scheduled runs). Staff (support admin and above) get an "Email Delivery" page: today's counts, emails that did not arrive with a plain reason, emails waiting over 10 minutes, and "Send Again" (a fresh copy with a new send key, so the mail service cannot treat it as the earlier attempt; the failed one is closed; audited `EMAIL_RESEND_REQUESTED`).
- Document requests to a third person now email the link (sealed in the outbox like invitations), are re-checked before sending (open, unexpired, same address) and cancelled when the request is revoked.
- Not verified: inbox placement (delivered means the receiving mail server accepted it; Spam is still possible); the account in question still needs its holder to create a new sign-in with that address, confirm it, and a platform owner to connect it on the new page.

### 2026-10-27, Small Commercial V1 S13: sign-in for AI apps (ADR 0021 section 2)

- VisaStack now runs a small, standard sign-in server so a person can let their own ChatGPT or Claude read chosen parts of their record. It is off unless `AI_CONNECTOR_ENABLED=true`; while off every address below answers 404. Nothing here reads record data yet: the AI context route is S14, the AI Connections list in Sharing is S15, audit counts and telemetry are S16.
- Addresses: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` (and `/mcp`), `/oauth/authorize` (consent screen, signed-in), `/oauth/token`, `/oauth/revoke`, `/oauth/register`. Discovery advertises S256 only, public clients only (`none`), client documents supported, `iss` on every answer, `offline_access`.
- Supported apps (27 Oct 2026, official Claude connector docs; ChatGPT docs host unreachable from this session, values from OpenAI's published pages via search): Claude `https://claude.ai/api/mcp/auth_callback` (and claude.com), Claude Code client document `https://claude.ai/oauth/claude-code-client-metadata` with loopback on any port; ChatGPT `https://chatgpt.com/connector_platform_oauth_redirect` and `https://chatgpt.com/connector/oauth/{id}`, client document `https://chatgpt.com/oauth/client.json`. One constant (`SUPPORTED_AI_APPS`) holds them. Pinned copies of the two stable documents are used only when the live fetch fails (chatgpt.com bot protection is reported to block server fetches).
- Client documents are fetched with strict rules: allowlisted host first, HTTPS, public addresses only, no redirects, 5 s, 64 KiB, JSON only, client_id must equal the URL, cached 24 h. Registration (DCR) accepts public clients with return addresses on a supported app or loopback, 10 an hour per network address, unused registrations expire after 30 days.
- Tokens: 256-bit random, stored only as SHA-256 hashes. Codes single-use for 60 s, bound to app, return address, PKCE challenge and resource; a reused code cuts off what it led to. Access 60 minutes; refresh rotates, reuse cuts off the whole sign-in; nothing outlives the connection. Revocation is immediate. The token store sits with the access gate (`packages/services/src/access/ai-connection.ts`), which the access ratchet treats as the gate itself; creating a connection takes the gate's owner proof.
- Consent screen: the app's name and web address, a warning for apps that run on the person's computer, the record, the eight record parts (two on by default, refusals and health marked sensitive), cases (all current, one, none), list of documents, text read from documents, full document numbers (needs a fresh sign-in check), how long (1 hour to until turned off, default 30 days), and the sentence "This app can read what you choose here. It cannot change anything in VisaStack. You can turn it off at any time."
- Migration 0100 (`ai_connections`, `ai_connection_tokens`, `oauth_clients`; additive, re-runnable). Until it runs, connecting reports "not available yet". Owner pre-approved the run for this session.
- Not verified: a live connection from Claude or ChatGPT (needs the switch on and S14's route); the default DNS check in the fetcher against real hosts.

### 2026-10-27, Interface: stale states and polish (owner list items 8, 9, 11, 12)
- Agency invitations (team and client): the "Invitation ready" line and its private link belong to one invitation. Once that invitation is revoked or accepted, the page no longer lists it and the form drops both, so a dead link is never offered. The forms still submit before the page's scripts load. A new link the page has not listed yet stays visible, so its only copy is never hidden, and "Link copied." never carries over to the next invitation.
- One status line per area: tasks, appointments, people on a case and the selected-evidence panel each show only the latest answer ("Task added." no longer sits beside "Task started."). The line appears beside the button that was pressed (below the list for Start, Done and Cancel; below the form for Add). If two answers arrive together, a problem wins over a success.
- Help: a "Get Help from a Person" card with routes for a case or agency problem, a question for the agency, data and privacy, and something not working (status page first, then Problems and Feedback on the affected case, which reaches VisaStack staff). Keyboard hints name the right key for the device (Ctrl on Windows and Linux).
- Language switch hidden while translation is deferred; every page is English and the language action changes nothing while the switch is off. A saved choice is kept, not deleted, and returns if the switch is turned back on.
- Two home pages: the account-wide page is now called Account Overview in its heading and in the navigation (a tool link in a traveller workspace, the first tab with no traveller), and a traveller's Home tab is current only on that traveller's own page.
- Help shows a support inbox to everyone, including people with no case yet, once SUPPORT_EMAIL is set (a watched address). Unset, no address is shown.
- Not verified: SUPPORT_EMAIL is not set in production yet, so until it is, people with no case have only the status page.

### 2026-10-27, UX-A: case screens (start a case, sidebar, cancel, names)

- No migration, no new events. Start a Case now asks for the country (from the countries the app holds) and the purpose (from the owner-approved list, adviser-only routes left out) with each problem shown beside its field; a new case opens at the top with a welcome note. "Prepare Again" is now "Start a New Case from This One" and "Application Memory" is now "Case History". Cancel Case moved from the stage buttons to a More menu with a confirmation question; the stage tracker no longer lists Cancelled as a next stage and says to use More instead.
- Automatic checklist link: a published catalogue checklist is linked on its own only when exactly one fits the case's country and purpose and is meant for the traveller. A checklist that names nationalities or countries of residence is linked only when the traveller's confirmed profile value (read through the access gate for the new case; unconfirmed readings and protected values are ignored) is on its list; when the value is not known it is never linked, and the person picks. An empty or unset list is read as "not narrowed". The database now reads only checklists whose country and purpose match, newest published version of each.
- Starting a case never ends in an error once the case exists: a failed checklist lookup or link is logged and the new case still opens (pressing Start Case again used to make a second case).
- The welcome note counts only checklists for this case's country and purpose that may cover the traveller, and says "There is no checklist for this route yet" when none fit (it used to count every published checklist).
- Sidebar on a case page: shows the case's own traveller once the case reports it (remembered for the visit), otherwise a neutral case state with no traveller's links; it no longer guesses the previously shown or only traveller.
- Both case forms read dates with one shared check: an impossible date (30 February) or a trip that ends before it starts is refused in the same words; Start a New Case from This One used to drop such a date silently. One shared list of stage names replaces four copies.
- Review: code review findings on checklist applicability, duplicate cases after a failed link, the welcome count, the sidebar guess, the tracker wording, repeated lookups and label maps, and the date reader were fixed with tests; at least two new tests were run against the old code and failed.
- Not verified: live data and a real browser run of the new screens; nationality words other than "Bangladeshi" and the passport code "BGD" are matched only as written (a checklist naming "BD" is not linked for a traveller who typed, say, "Indian"); accent marks outside the common Latin block are compared as written in the database, so such a label is not linked automatically.

### 2026-10-27, UX-A: second review of the case screens

- No migration, no new events, no new dependency. A full table of ISO 3166 country codes (two- and three-letter) is now reference data in `packages/core/src/destinations/country-codes.json`, copied from the published `i18n-iso-countries` 7.14.0 table (MIT); its source is recorded in the file.
- Who a checklist is for: a nationality or residence saved as a passport code (BGD, IND, GBR) is now read as that country. A saved value that names no country ("Indian", "British") now counts as not known instead of as someone else, so a checklist meant only for some nationalities is still offered to pick and is never linked on its own. Only "Bangladeshi" is read as a nationality word, because the profile suggests it.
- Only an authoritative public checklist with no owning agency is linked or counted; an agency's own checklist whose agency was deleted (its owner link is cleared on delete) no longer looks public.
- The database prefilter now drops every non-ASCII character after decomposing, so it can only let too many checklists through; the exact key then decides. A label with any accent mark now matches.
- Welcome note: when a checklist was not linked only because the traveller's nationality or residence is not confirmed, it says so and asks to confirm them on the profile or pick one now. A failed check shows wording that promises nothing; only a case with no country or purpose falls back to the picker. Whether the note shows is decided once, on the server.
- Sidebar on a case page before its traveller is known: the caption is now "Case Workspace", which names no owner.
- Dates: both case forms now stop at a part-typed date (the browser sends such a box empty), say beside it "Enter a full date: day, month and year." and move focus to it. Start a New Case from This One now shows every problem beside its field and focuses the first, as Start a Case does.
- Not verified: a real browser run (the part-typed check is tested with the browser's flag set by hand); nationality words other than "Bangladeshi" still name no country, so those travellers pick their checklist themselves; without the page's scripts a part-typed date is still saved as not given.

### 2026-10-27, UX-B: document upload

- What changed: the upload form takes several files at once (picker, drag and drop, or Take a Photo with the back camera), each sent on its own with its own progress and Try Again; limits are shown before choosing (up to 4 MB per file). iPhone photos (HEIC or HEIF) are converted on the server to a new JPEG before anything is stored; the HEIC bytes are never stored. New documents get an automatic title ("Passport, Nazmus"; "Document, Nazmus, 27 Oct 2026" while the kind is unknown; an Other kind without its own name uses the kind's label, "Other Letter or Statement, Nazmus"), choosing the kind later updates it, and the owner can rename a document. Downloads end in the stored file's extension, counting only known extensions (so "Payslip v1.2026" becomes "Payslip v1.2026.pdf").
- HEIC isolation design: each photo is decoded and encoded in a worker thread of its own (packages/adapters/src/heic-worker.cjs), started for that photo and ended afterwards. The request thread is never blocked by the decoder (which runs synchronously), and one deadline (20 seconds) covers the whole conversion and ends the thread part way through when it passes; ending the thread frees all decoder memory, including after a failure. What bounds memory: the decoder's WebAssembly memory maximum is rewritten before it starts (from 2 GB to 48 MB plus 10 bytes per pixel of the budget, about 450 MB at the 40 megapixel budget; decoding measured at about 7.5 bytes per pixel), so a crafted file can never make the decoder take more than the largest accepted photo would; the declared size must fit the pixel budget before decoding; libheif itself refuses a frame larger than the declared size before decoding it (checked with a made-up file declaring 64 x 48 over a 4096 x 4096 picture); the thread's JavaScript heap is capped (64 MB old space); sharp keeps its own pixel and time limits. A crash, a reached ceiling or an exit without an answer is refused as unreadable, the deadline as too slow, and a thread or decoder that cannot start refuses the photo with a plain message (no fallback that decodes on the request thread). The worker file is kept out of the web bundle and traced into the deployed function with libheif.js and libheif.wasm (checked in the build's trace files).
- Upload space: when the converted copy is larger than the photo sent, the upload's own reservation grows in one step under the same lock and quota rules (growUploadReservation, through the access gate); it is no longer released and reserved again, and the upload rate limit is charged once.
- Names: setDocumentType, proposeDocumentName and renameDocument all lock the document row before working out the next name version. A rename's audit record holds only the version number, the name's length and that it was not automatic (method MANUAL, event DOCUMENT_RENAMED); the name itself is kept only in the document and its name history. Found and left as it was (outside this change): proposeDocumentName's audit record stores the proposed name and decideDocumentName's stores the final name, so system and AI name suggestions already put names (which include the person's first name) into the append-only audit trail; that needs its own decision.
- Licence exception: libheif-js is LGPL-3.0, an exception to the permissive-only rule (scripts/supply-chain/checks.mjs). It is the only HEVC decoder that runs without native code (sharp's prebuilt libvips has no HEVC support), it is used unmodified from npm, only on the server, and loaded at run time from its own files in a separate thread, never bundled, so it stays a separate, replaceable library as the licence asks. heic-decode (ISC, a thin wrapper) is no longer used.
- Not verified: conversion in the deployed function on Vercel (the trace and a local production build were checked, not a live upload); real iPhone photos (tests use made-up files; iPhone photos are tiled grids, whose decoding memory was estimated, not measured); several conversions at once in one function instance (each can take up to the ceiling); a second HEVC parameter set inside the picture data (bounded by the memory ceiling, not exercised); true parallel row locking on a real Postgres (the test database runs transactions one at a time, so the locks are checked by the statements sent).

### 2026-10-28, UX-B: document upload, review fixes

- Downloads and previews of documents whose names hold letters outside plain ASCII (a stroked L as in "Lukasz", Bangla names, a curly apostrophe) failed with a server error, because the plain `filename="..."` part of the download header carried them. That part is now plain ASCII (accents dropped, a few letters spelled out, anything else "_"); the full name still travels in the `filename*` part, which now also escapes the characters that part does not allow.
- A name suggestion waiting for a decision no longer disappears when an automatic title or a rename is written after it: the waiting suggestion is the newest name version still waiting, and the person can still accept or skip it.
- Audit records of name suggestions and decisions now hold only counts and kinds (version number, name length, decision, whether it was edited), like renames. Records written before this change still hold the names they were written with: the audit trail is append-only and is never edited.
- iPhone photo conversion: one at a time per process (others wait inside their own time limit and are refused with the existing "cannot be added right now" message when it passes); the decoder module with its memory ceiling is compiled once per process and each conversion's thread instantiates it with a fresh memory; the decoded image's own size and pixel plane are now checked against the declared size before any pixel is copied (the earlier check compared the buffer with itself and could never fail).
- One rule for what counts as a file extension in stored names, preview names and download names; one shared check for "Other" kinds and one name length limit (both in @visastack/core).
- Upload messages: a file identical to one already stored no longer names that document in the message (the message can reach a log); a converted copy with no room says why in plain words, and the upload record keeps the exact cause.
- Not changed: the next name version number is still worked out by two private helpers (documents.ts and document-naming.ts), because a shared exported one would be an ungated export reading an applicant-owned table, which the access ratchet refuses.
- Not verified: a live download of such a name on the deployed site (checked by building the real response headers in a test); the one-at-a-time limit under real traffic (a second photo waits up to its 20 second limit).
### 2026-10-27, QA-F: real 404s, signed-out page speed, live calendar link

- Missing or refused records answered "200" with a not-found card: a loading screen above every signed-in page made Next send 200 before the record check ran (confirmed on a real Next 15.5 build and in its source). The loading screens now sit in route groups or leaf folders with no record checks (Home in `app/app/(home)`, the shared list in `shared/(list)`, the country list in `countries/(list)`, help, staff code and three invitation pages in their own folders), so the person, case, agency, shared record and country pages answer 404, and a malformed person or case id answers 404 instead of a failed query. `apps/web/src/lib/not-found-status.test.ts` keeps record checks outside loading screens and every other page with one. Still 200: admin organization and pack pages (admin folder), agency country and receipt pages (the agency loading screen), case snapshots (the case loading screen), and the agency list page has no loading screen (the agency folder needs its own route group, left to that package).
- Public pages: per-request by design (nonce security policy, locale cookie, signed-in header). Visitors with no sign-in cookie no longer cost a call to the sign-in service on every page. Functions run in iad1 and the database in aws-us-east-1 (together); a move nearer Bangladesh needs both moved (recommendation in the package report). Not measured.
- Live calendar link (migration `0101_calendar_feeds.sql`, journal idx 99): see ADR 0016, "Live feed".
- Second review (max level, 14 items, all fixed): the panel keeps the last state the server reported; loading screens restored as above; the `webcal:` button removed (some apps open it as plain http); unknown links are refused before the lookup once an address is over its limit and charged only on a miss; a new link resets "Link copied"; a status that cannot be read is logged and shows "could not check" with Stop Sharing, and "not available yet" only for the missing table; malformed ids answer 404; turning a link on or making a new one needs "Let Me Share with Others", and the feed answers 404 while it is off; failed changes are logged without the link; "made on" is shown in the traveller's time zone; the calendar is named with the traveller's first name ("VisaStack Dates, Nusrat"), which the warning says; the presence cache is gone (a missing table is caught on the lookup itself); the page asks the gate once; the feed route checks the shape once and shares the private no-store headers with the download route.
- Not verified: browser checks, the live feed with real calendar apps (refresh timing, first-name display), and production timings.

### 2026-10-27, S14: AI connector tools

- `/mcp` now answers AI apps (ADR 0021 sections 3, 6 and 7), still off unless `AI_CONNECTOR_ENABLED=true` (404 while off; no new setting). Stateless Model Context Protocol over HTTP through the official TypeScript SDK, `@modelcontextprotocol/sdk` pinned at 1.32.1 (published 5 Oct 2026; 1.32.2 is under two weeks old). POST only (GET and DELETE answer 405), JSON answers, no sessions. `zod` 4.6.7 (already in the tree) is now a direct dependency of the services package for the tools' output schemas. `pnpm audit --prod --audit-level high` exits 0.
- No token: 401 with `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource", scope="visastack.identity visastack.travel_documents visastack.document_list offline_access"` (the default choices; the consent screen decides what is shared). A dead, expired, revoked or wrong-resource token: the same with `error="invalid_token"` and a plain `error_description`.
- Limits: 64 KB per request (413); per connection 60 requests a minute and 2,000 a day (new buckets `AI_CONNECTION_MINUTE` and `AI_CONNECTION_DAY`, 429 with Retry-After; a limiter failure answers 503, never lets the call through); each tool answer at most 50 KB, met by leaving whole entries out from the end of the largest list (or shortening one long text by whole characters, marked `truncated`) with a plain notice, never by cutting JSON; a backstop replaces any larger response with a plain error.
- One data path: `withAiConnection` (`packages/services/src/access/with-ai-connection.ts`). Every tool call looks the token up again, re-reads the stored connection (turned off, expired, case removed), asks `requireAccess` again with the `ai_connection` purpose (owner only), then hands the tool a gateway that can only ask the context composer for the connection's own Selection, narrowed further (layers intersected, depth the shallower, a case only if the connection covers it, all-current covers only current cases). `last_used_at` is written at most once a minute (S13's token lookup).
- "Full Document Numbers": the consent screen already required a fresh identity check (S13). At call time `stepUpFromAiConnection` re-reads the connection and makes a one-minute proof for that record only when it is live, has full numbers on and its account still owns the record; without it numbers stay masked. A guard test allows only the gate to call it.
- The five tools, each with a title, plain description, read-only annotations and an output schema, answering with structured content plus the same data as text: `prepare_context` (case_reference, focus, depth), `list_cases`, `get_profile_section`, `list_documents`, `get_document_text`. Anything not shared is refused as a tool error: "Not shared with this AI app. You can change this in VisaStack under Sharing, AI Connections." Protected document kinds (passports, identity, financial, medical) never give text. Errors never carry ids or stack traces.
- Composer change (narrowing only): `documentScope.referenceCodes` limits documents to named references; an empty scope still passes nothing.
- Audit (the part S14 needs; S16 owns the rest): `AI_CONTEXT_SERVED` and `AI_CONTEXT_DENIED` per tool call, method API, with connection, client host, tool, layers returned, case, counts, depth and denial reason. Never values, document text or tokens (tested). Product events are left to S16.
- Guard: `packages/services/src/ai-tools/boundary.test.ts` fails if a tool module brings in a value from anything but its siblings, the gate, `zod` or `@visastack/core` (no database, drizzle, schema or other service, no dynamic import). Proven red by adding a schema import to a tool; the one-case rule proven red by letting the gate accept any case.
- Section K rows covered with synthetic records on PGlite: Case A only with Money off (Case B refused, no money value, agency note or task in any answer of any tool), compact context with provenance, Document List on and Text off refuses document text, expiry and turning off deny the next call, owner losing the record denies, one-case context 2,281 bytes against a 34,884-byte full export.
- Not verified: the real Claude custom connector and ChatGPT developer-mode flows (need production with the switch on and the S13 migration run); behaviour behind Vercel's request limits; the new rate-limit buckets under real traffic.
- Second review (14 items, all fixed; merged origin/main with S13 first, whose `createAiConnection` now needs a fresh identity check proof for full numbers):
  - A tool that fails part-way answers "VisaStack could not prepare this right now. Try again in a moment." (never the error's own text, SQL or ids), is logged on the server with the tool name only, and is still audited as denied (`failed`) in a small transaction of its own.
  - Medical papers need Health and police or court papers need Past Refusals and Declarations, decided from what was shared alone, so `list_documents` gives the same answer whatever the record holds.
  - Without Full Document Numbers, the person's own identifiers (passport, national id and every other identifier field) are masked inside document text too, in the composer, for every tool: found exactly in any letter case and spacing, plus any other text of the same letter-and-digit shape when the stored value has six or more characters with a digit. If a stored identifier cannot be decrypted, no text is given.
  - A focus only chooses which granted sections are shown; what is granted (medical and police papers, legal history, health detail) still follows the connection. Personal Details now starts with name, nationality and date of birth. An empty focus means everything.
  - The audit counts what each answer actually sent (after the size limit); a too-large answer is denied `too_large` (also when the route's backstop withholds it); all-current connections record the case mode, not a case; text from a group that is not shared is `document_not_shared`.
  - Tokens not shaped like VisaStack access tokens are refused before any database work; the body is read and bounded before the database is opened; failed sign-ins are counted per network address (`AI_MCP_AUTH_FAIL_IP`, 300 an hour, charged only on failure, 429 above it).
  - Every call re-checks pilot access with the same rule signed-in pages use, and records account activity at most once a day. That rule admits every existing account, so the refusal is proven with a refusing rule; it bites only if the rule changes.
  - 429 says which limit was reached ("in one minute" or "for today") with Retry-After to the end of that window (UTC midnight for the daily one). Errors carry the same no-store headers as the sign-in endpoints.
  - The tool guard now walks subfolders and resolves each import from the file itself. Document-only answers read no profile values; answers that do not show the basics do not decrypt them; tools reshape the context object directly (`aiContextObject`).
### 2026-10-28, QA-E: accessibility names, touch targets, phone sign-up, staff banner

- Icon-only names (item 13): a source scan (`apps/web/src/lib/icon-only-names.test.ts`) finds every link, button and summary whose only content is a drawing and fails when one has no `aria-label`, `aria-labelledby` or `title`; none were missing. The signed-in frame is rendered in five states (traveller page with the full sidebar and the slim rail, agency page on a phone, platform page on a laptop and a phone) and scanned with axe plus a name check (`apps/web/src/app/app/staff-mode.test.tsx`). Browser scans added to `e2e/ux-public.spec.ts`: every UI fixture mode (overview, profile, documents, case, sharing, agency, admin, shell and the new staff mode) at 390px and 1440px, failing on serious or critical violations and on any unnamed visible control.
- Touch targets and text size (item 14), one block at the end of `globals.css` (`/* WP-QAE`): on a coarse pointer every link, button, summary, field and tab that stands on its own is at least 44px each way (links inside a sentence follow the WCAG inline exception; screen-reader-only helpers, the skip link and hidden file pickers are left alone); a precise pointer is untouched, so the 34px account menu rows stay. A `<small>` inside caption text can no longer drop to 10px. Phones get 16px reading text (card body text, notices, page descriptions, the staff banner) and 16px fields (no zoom on tap). Raised to 12px: the trust page label (was 10px, now 12px on the same 12px line so nothing moves; its end-to-end pin is updated), and the landing's availability line, figure caption and feature labels (marked `A11Y-EXCEPTION`, line heights kept). The words inside the landing's drawing of a phone stay at the drawing's scale (listed in `text-floor.test.ts`). Guards: `text-floor.test.ts`, and a browser check that measures every target and every piece of text on four signed-in screens and the sign-up and sign-in pages at 390px with a coarse pointer.
- Phone sign-up (item 17): the "I'm a Traveller / I'm an Agency" choice is gone. It was guidance only: the server never read `usageIntent`, it granted no role, and agencies start from the account menu after sign-in (one line now says agencies use the same account). Kept, per the product contract: the name (now marked optional; it is the only place the account name is set), email, password, the signed one-time form, the hidden trap field, rate limits, the unticked terms and privacy acknowledgement, the own-risk notice before the fields, the note that the acknowledgement turns on no marketing, AI or agency sharing, and the email confirmation step. The notice about this version now shows in full on a visitor's first page only: a small first-party cookie (`visastack_notice=seen`, whole site, half a year, SameSite=Lax, Secure on https, written with try/catch) is read by the root layout, so later pages arrive without it and nothing flashes; it also folds away on the next page within the same visit, and Hide This Notice puts it away at once (focus moves to the next control). The same words stay on What Works Today under About This Version, linked from the footer of every public page. This applies to every notice mode (public beta, private pilot, test build); signed-in people already never saw it.
- Staff banner (item 18): every platform page (`/app/admin`) shows a Staff Mode strip under the toolbar ("You are using platform tools. What you change here can affect other people's accounts.", with Leave Staff Mode to the Account Overview). On platform pages the workspace switcher lists no traveller names (one Account Overview link instead), the toolbar has no traveller search and no personal plan badge, the account menu shows no personal plan, and the sidebar footer says Staff Mode instead of "You Control Access". Traveller and agency pages are unchanged. The unavailable-platform title is now Title Case.
- Not verified: the new browser checks (written to wait on elements and on the notice cookie, not on time; run by the lead), real phones and tablets (touch sizes measured only in an emulated coarse pointer), and screen readers. Leftover: the `.signup-context` rules in an earlier `globals.css` block now style nothing (earlier blocks are not edited).
### 2026-10-28, QA-E review fixes (ten items)

- The notice about this version now never disappears: after the first page (or Hide This Notice) every page keeps a slim one-line label with the version name and What Works Today, a 44px row on touch screens. Once folded it stays folded for the visit, even back on the first page. The Hide button's room comes from one variable (32px precise, 44px touch) and one unconditional padding rule, checked by `apps/web/src/lib/version-notice-css.test.ts`. This replaces the entry above where it says the notice folds away to nothing.
- Touch targets: the blanket `!important` floor is gone. The 44px floor on a coarse pointer is a weightless `:where()` rule, so components that size themselves keep their rules; the toolbar plan pill and the brand colour choices keep their drawn size with a 44px hit-area overlay; the older toolbar's 40px icon links take 44px on touch. The browser check now hit-tests a 44px square around any control drawn smaller, and a touch-laptop case (1280px) covers the plan pill.
- Phone text: only the shared base sizes are restated (notices, app card body text), so component notes, the sign-up notes and the `u-fs-` utilities keep their sizes; fields are `max(16px, 1em)` with no `!important`. `<h5>`, `<h6>`, `<sub>` and `<sup>` get the same 12px floor as `<small>` (the profile's `h5` headings were 11.3px).
- Staff pages: Ctrl or Cmd and K is left to the browser; the traveller and agency sidebars are exactly as before. The icon-name guard no longer counts an empty `alt` or an `aria-hidden` child as a name. The unused sign-up choice styles are removed.
- Checked locally with the stylesheet and the real fixture components in headless Chromium (coarse and precise pointer, 360 to 1440px), outside the Playwright suite: no target, text, field or axe finding on the screens the browser checks cover. Not verified: the Playwright run itself, real devices and screen readers.

### 2026-10-28, Tooling: the local full check guards its port, its server and its code
- Three wasted local runs had the same shape: a leftover server held the check port so the new one failed to start and the browser steps tested an old build; a restart killed a check while the caller kept waiting; a helper edited files or main was merged in the middle of a run.
- scripts/agent/full-check.sh now stops a leftover Next server on its port (anything else there aborts the run), runs the browser and smoke steps only when the server answering serves the build the run just made (its build id is in the page), always stops its server on exit, records the commit and working tree at the start and end and marks the run STALE if they differ, and can resume from a step (FROM=build).
- Proved: an unrelated program on the port aborts the run with a plain line; a leftover Next server on the port is stopped and the run continues.

### 2026-10-28, Tooling: the port guard reads the kernel's table
- The first port guard used lsof, which in the agent container did not see a detached `next-server` (its command line names no port, and stopping `next start` leaves it running under init). The guard now reads the LISTEN row for the port from /proc/net/tcp and finds the process holding that socket, so such a leftover is found and stopped; any other program on the port still aborts the run.
- Proved with a detached stand-in named next-server (stopped, run continues) and an unrelated program (run aborts).

### 2026-10-28, UX-G: invitation page redesign

- `/invitation` (client, team and sharing links) now opens on a hero: the agency's mark and name with "Powered by VisaStack" (reviewed client invitations only), the heading, a one-line promise ("Acme Visas wants to work on your visa case with you."), the expiry as a badge ("Expires 3 Nov 2026, 6 Days Left": UTC day, time left rounded down), the main buttons, and one quiet line: "Opening this link accepts nothing. You decide after you review."
- Main buttons: "Create an Account to Review" and "Sign In" for a signed-out visitor; "Review Your Invitation" when a session is found, with a quiet "Not you? Sign In with the Invited Email Address" form that signs out and goes to sign-in with this invitation as the return address (`switchInvitationAccountAction` in `app/invitation/actions.ts`; the address is rebuilt from the kind and a well-formed link only; `signOutCurrentUser` now takes an optional destination). A failed session read counts as signed out, so "Already signed in? Review Your Invitation" stays in the help block. `isSignedIn` is wrapped in React `cache()`, so the layout and the page share one read per request, and the page reads it alongside the client invitation lookup. Acceptance is unchanged: it still happens only on the signed-in accept pages.
- One table of accept pages per kind (`app/invitation/accept-paths.ts`) gives the sign-in return address, every review link and the switch action.
- Steps are one ordered list on one line from 320px ("Sign In, Review, Decide", `aria-label="What Happens Next"`, `aria-current="step"` on Sign In, or on Review with Sign In marked done when signed in). Account creation is named on the hero button and in "Create an account or sign in with the email address that received this invitation." New class `invitation-steps`; the sign-up page keeps `auth-steps`. Compact step sizes start at 400px and the connectors can shrink to nothing.
- Permissions are two lists (side by side above 640px, stacked on phones): "They Could" with a tick per item and "They Could Not" with a cross per item, closing with "Each of these would need a separate choice from you." `clientInvitationTerms` now also returns `withheld` (one item each, from the same pass as the `agencyCannot` sentence used by the signed-in accept page). `describeInvitationExpiry` (no production use left) is replaced by `invitationExpiryBadge`; the unused `.invitation-terms-list` CSS is removed.
- "You Stay in Control" (profile choice, nothing shared until you accept, stop sharing any time), "Before You Start" (which email to use, already signed in, password reset), then the not-an-approval note last. Team, sharing and the client fallback keep their own facts under "What to Expect" and the 7-day expiry note.
- Incomplete, closed and not-yet-reviewed links share one shape: title, one sentence, at most one action (Go to the Home Page; Sign In), and a quiet line. The closed page still reads the same for every closed link.
- Phones (640px and below): once the hero buttons are no longer fully in view below the sticky site header (root margin from the header's real offset and height, read once), a copy is pinned to the bottom (`StickyInvitationActions`; hairline top border, no shadow, safe-area padding). Exactly one copy is usable at a time: the other is `inert` (the hero copy is also hidden while the pinned one is in use). Focus moves to the same button in the other copy when either hides, including when the screen grows past 640px. Without scripts only the hero buttons exist. Body padding and scroll padding keep the pinned copy off the last lines and off keyboard focus (`body:has(...)`). CSS block `/* WP-UXG invitation page` at the end of globals.css.
- Tests: page and public-page tests (every fact per kind, the not-an-approval line, no email or person data in the page, signed-in routing and the switch form per kind, session read in parallel, one-line steps), switch action tests, sticky copy tests (header margin, partly visible, one usable copy, focus both ways, breakpoint change, wide screens, no observer), terms helper tests. Playwright (`ux-public.spec.ts`: team and sharing at 390px for the first screen, 44px targets, axe and the pinned copy; 320, 360 and 390px for one-line steps and no sideways scroll) is written but not run here.
- Not verified: real browser rendering, contrast in context, screen reader reading, the reviewed client invitation in a browser (needs a database), the switch-account sign-out against the real sign-in service, and the pinned copy on a real phone with a home indicator.

### 2026-10-27, S14: AI connector tools

- `/mcp` now answers AI apps (ADR 0021 sections 3, 6 and 7), still off unless `AI_CONNECTOR_ENABLED=true` (404 while off; no new setting). Stateless Model Context Protocol over HTTP through the official TypeScript SDK, `@modelcontextprotocol/sdk` pinned at 1.32.1 (published 5 Oct 2026; 1.32.2 is under two weeks old). POST only (GET and DELETE answer 405), JSON answers, no sessions. `zod` 4.6.7 (already in the tree) is now a direct dependency of the services package for the tools' output schemas. `pnpm audit --prod --audit-level high` exits 0.
- No token: 401 with `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource", scope="visastack.identity visastack.travel_documents visastack.document_list offline_access"` (the default choices; the consent screen decides what is shared). A dead, expired, revoked or wrong-resource token: the same with `error="invalid_token"` and a plain `error_description`.
- Limits: 64 KB per request (413); per connection 60 requests a minute and 2,000 a day (new buckets `AI_CONNECTION_MINUTE` and `AI_CONNECTION_DAY`, 429 with Retry-After; a limiter failure answers 503, never lets the call through); each tool answer at most 50 KB, met by leaving whole entries out from the end of the largest list (or shortening one long text by whole characters, marked `truncated`) with a plain notice, never by cutting JSON; a backstop replaces any larger response with a plain error.
- One data path: `withAiConnection` (`packages/services/src/access/with-ai-connection.ts`). Every tool call looks the token up again, re-reads the stored connection (turned off, expired, case removed), asks `requireAccess` again with the `ai_connection` purpose (owner only), then hands the tool a gateway that can only ask the context composer for the connection's own Selection, narrowed further (layers intersected, depth the shallower, a case only if the connection covers it, all-current covers only current cases). `last_used_at` is written at most once a minute (S13's token lookup).
- "Full Document Numbers": the consent screen already required a fresh identity check (S13). At call time `stepUpFromAiConnection` re-reads the connection and makes a one-minute proof for that record only when it is live, has full numbers on and its account still owns the record; without it numbers stay masked. A guard test allows only the gate to call it.
- The five tools, each with a title, plain description, read-only annotations and an output schema, answering with structured content plus the same data as text: `prepare_context` (case_reference, focus, depth), `list_cases`, `get_profile_section`, `list_documents`, `get_document_text`. Anything not shared is refused as a tool error: "Not shared with this AI app. You can change this in VisaStack under Sharing, AI Connections." Protected document kinds (passports, identity, financial, medical) never give text. Errors never carry ids or stack traces.
- Composer change (narrowing only): `documentScope.referenceCodes` limits documents to named references; an empty scope still passes nothing.
- Audit (the part S14 needs; S16 owns the rest): `AI_CONTEXT_SERVED` and `AI_CONTEXT_DENIED` per tool call, method API, with connection, client host, tool, layers returned, case, counts, depth and denial reason. Never values, document text or tokens (tested). Product events are left to S16.
- Guard: `packages/services/src/ai-tools/boundary.test.ts` fails if a tool module brings in a value from anything but its siblings, the gate, `zod` or `@visastack/core` (no database, drizzle, schema or other service, no dynamic import). Proven red by adding a schema import to a tool; the one-case rule proven red by letting the gate accept any case.
- Section K rows covered with synthetic records on PGlite: Case A only with Money off (Case B refused, no money value, agency note or task in any answer of any tool), compact context with provenance, Document List on and Text off refuses document text, expiry and turning off deny the next call, owner losing the record denies, one-case context 2,281 bytes against a 34,884-byte full export.
- Not verified: the real Claude custom connector and ChatGPT developer-mode flows (need production with the switch on and the S13 migration run); behaviour behind Vercel's request limits; the new rate-limit buckets under real traffic.
- Second review (14 items, all fixed; merged origin/main with S13 first, whose `createAiConnection` now needs a fresh identity check proof for full numbers):
  - A tool that fails part-way answers "VisaStack could not prepare this right now. Try again in a moment." (never the error's own text, SQL or ids), is logged on the server with the tool name only, and is still audited as denied (`failed`) in a small transaction of its own.
  - Medical papers need Health and police or court papers need Past Refusals and Declarations, decided from what was shared alone, so `list_documents` gives the same answer whatever the record holds.
  - Without Full Document Numbers, the person's own identifiers (passport, national id and every other identifier field) are masked inside document text too, in the composer, for every tool: found exactly in any letter case and spacing, plus any other text of the same letter-and-digit shape when the stored value has six or more characters with a digit. If a stored identifier cannot be decrypted, no text is given.
  - A focus only chooses which granted sections are shown; what is granted (medical and police papers, legal history, health detail) still follows the connection. Personal Details now starts with name, nationality and date of birth. An empty focus means everything.
  - The audit counts what each answer actually sent (after the size limit); a too-large answer is denied `too_large` (also when the route's backstop withholds it); all-current connections record the case mode, not a case; text from a group that is not shared is `document_not_shared`.
  - Tokens not shaped like VisaStack access tokens are refused before any database work; the body is read and bounded before the database is opened; failed sign-ins are counted per network address (`AI_MCP_AUTH_FAIL_IP`, 300 an hour, charged only on failure, 429 above it).
  - Every call re-checks pilot access with the same rule signed-in pages use, and records account activity at most once a day. That rule admits every existing account, so the refusal is proven with a refusing rule; it bites only if the rule changes.
  - 429 says which limit was reached ("in one minute" or "for today") with Retry-After to the end of that window (UTC midnight for the daily one). Errors carry the same no-store headers as the sign-in endpoints.
  - The tool guard now walks subfolders and resolves each import from the file itself. Document-only answers read no profile values; answers that do not show the basics do not decrypt them; tools reshape the context object directly (`aiContextObject`).

### 2026-10-28, S15: AI Connections screens

- Sharing page, new card "AI Connections" (ADR 0021 section 3): each live, finished AI connection of the record with the app name and its web address, Connected date, Can Read (the consent screen's own labels, in its order, built from the stored choices), Cases (All Current Cases, Only <case>, No Cases, or "No Cases. The chosen case was removed."), Full Document Numbers Yes or No, Ends (date and time, or Until You Turn It Off), Last Used (or Not Used Yet), and Change Access and Turn Off. A short "Recently Turned Off" disclosure lists connections that were turned off or ran out in the last 30 days (at most ten). A consent the app never finished is not listed: it can read nothing.
- Shown while `AI_CONNECTOR_ENABLED=true`; while it is off the card appears only if a connection is still live, with Turn Off only (no Change Access, and the change action refuses). With the switch on and nothing connected it says so in one line; if the tables are missing it says the list cannot be shown, never "nothing connected".
- Services (`packages/services/src/access/ai-connection-manage.ts`): `listAiConnections`, `getAiConnection`, `turnOffAiConnection`, `changeAiConnection`, each taking the gate's `AuthorizedApplicant<'VIEW_METADATA'>` and refusing anything but `applicant_owner` (as `createAiConnection`); a connection of another record or account is "not found". Turn Off sets `revoked_at` (reason "turned off by owner") and revokes every token of the connection in one transaction, audited `AI_CONNECTION_REVOKED` with ids and the reason kind only; a second Turn Off is a quiet success with no second event. Change Access rewrites scopes, case mode, case, full numbers and the end, audited `AI_CONNECTION_CHANGED` with kinds only (layers, case mode, full numbers on or off, duration choice). Both take effect on the app's next request (proven through `withAiConnection` and `resolveAiAccessToken`).
- Decision, where Change Access lives: a closed disclosure in each connection's row on the Sharing page, holding the consent screen's own fields, not a page of its own. A record page below the Sharing loading screen would answer 200 instead of 404 (the `not-found-status` guard refuses it); the record itself still answers 404 from its layout.
- Decision, How Long on Change Access: "Keep the Current End" is the default; any other choice counts from the moment of the change, so the owner can shorten or lengthen it (the owner is the authority over their own connection and could reconnect for the same result). Shortening applies at once because every call checks the stored end.
- Turning Full Document Numbers on in Change Access needs the same fresh identity check as consent (StepUpProof for EXPORT_PROFILE on that record, via `establishStepUpProof`, returning to the Sharing page with that row's form open and the same choices after sign-in; the person presses Save Changes again). Keeping it on or turning it off needs none.
- Consent screen against ADR 0021 section 5: the choices now come from one shared component (`apps/web/src/components/ai-access-choices.tsx`) used by both screens. Gaps fixed: a `case` query value naming one of the record's current cases is now the default case ("one case if opened from a case, else all current"), kept through the record picker; a stale or unknown case value falls back to All Current Cases so one option is always selected; a field the server names as wrong is marked invalid and focused.
- Words: no engineering terms in visible text (tested); Title Case names; turning off is confirmed inside the page with the consequence stated. Accessibility review and UX copy review done on the code: focus moves into the Turn Off question and back, invalid fields are focused, 44px targets, flat design (WP-S15 CSS block). Copy tightened (Turn Off consequence, ended and identity-check messages, Save Changes).
- Not verified: browser checks and a real AI app turned off or changed on the deployed site (needs the switch on and the S13 migration run); screen reader behaviour beyond the automated scan.
- Done (second commit): restoring a backup now re-applies AI connection changes the way it re-applies revoked grants (`reconcileRestoredBranch`, `packages/services/src/backup-reconciliation.ts`), from the audit chain of the pre-incident branch after the restore point, in the same chain order and with the same `RECONCILIATION_<event>` audit on the restored branch. `AI_CONNECTION_REVOKED`: the connection is turned off again and every token revoked, in one transaction. `AI_CONNECTION_CHANGED`: the connection is narrowed to what both branches allow (parts, cases, full numbers, the earlier end), never widened; when that end has passed its tokens are revoked too. A connection whose own end passed stays off without replay (the restored branch keeps the end and every use checks it). Six PGlite tests (turned off after the backup, before it, narrowed with a passed end, never widened, own end passed, restored branch without the tables); proven red by disabling the turn-off and token rules. New report counters `aiConnectionsRevoked` and `aiConnectionsNarrowed`. Design table updated in `docs/operations/backup-resurrection-reconciliation.md`.
- Still open: tokens an AI app revokes itself (RFC 7009 revocation) and sign-ins cut off by refresh-token reuse write no audit event, so a restore could bring those sign-ins back for as long as their connection stays live (turning the connection off still ends them).
- Review fixes (12 items, all fixed): the live list and the recently ended list are each filtered and limited in the database (live capped at 50 with the full count, and a plain "And N more" line; an older live connection is never pushed out by newer ended ones); access and refresh tokens keep their own lives (60 minutes, and 30 days with rotation) instead of being cut to the connection's end, because every use checks the stored end, so a lengthened connection keeps working past its old end and a shortened one stops at the new end; the manage services read the real clock only (no caller-chosen time); Turn Off on a connection that already ran out is a quiet success with nothing rewritten or audited; the card still shows "Turned off" while the switch is off and nothing is left; Change Access keeps the submitted choices after a refused save (React resets forms after an action); a problem with the case choice marks every radio and the group and focuses the chosen radio (the shared focus helper now handles radio groups, so the consent screen benefits too); one parser (`parseAiAccessChoices`) reads the choices for both consent and Change Access; the Sharing page reads AI connections in parallel with its other reads; Change Access tries the change first and starts the identity check only when the service asks for it. Backup restore: a replayed turn-off keeps the original time and the owner's reason; one case against all current cases keeps the case only while it is not closed or cancelled on the restored branch.

### 2026-10-28, UX-H: visual alignment pass
- Checked the ten areas changed on 27 and 28 October at 1600x1000 and 390x844 (public pages also at 360): Profile Essentials First, History and Dates and Expiry empty states, Start a Case and the new-case note, the case More menu, cancel question and stage note, document upload and rename, agency team and client invitations, case tasks and appointments, Help, the calendar subscription card, the public invitation page (team and sharing), the version notice, the staff mode banner and the phone sign-up. Signed-in screens were drawn from the real components with made-up props in a throwaway fixture outside the repository; public pages came from a local production build. This is visual evidence only, not signed-in acceptance.
- Fixed: a button row class (`action-row`) that had no rule, so Copy Link and Share Link touched (the invitation page fixes were dropped at the merge, because UX-G had already rebuilt that page); a doubled rule between Essentials First details and a narrow phone layout from a box inside a card; the date disclosure under each profile detail was a 16px tap target on phones; empty-list text ran to 160 characters a line on wide screens; the More menu's link was underlined while Cancel Case was not, and the cancel question's two buttons wrapped; task rows put their buttons left on one row and right on the next, and both Add forms were ragged (fields at three widths); a long uploaded file name pushed its size to a line of its own, and per-file results were 14px on phones; the invitation result line sat against its button; the calendar result line sat above the button middle and its note touched the buttons; Help's four guide cards sat three and one; Leave Staff Mode sat under the lock on phones; the phone bar cut Account Overview and All Travellers short (now Overview and Travellers on the bar; the full name stays the accessible name, and a new test keeps every short word part of its link's spoken name, so Organizations stays as it is); Add Member and Invite Client were secondary buttons as the only action of their forms.
- CSS is one block at the end of globals.css ("WP-UXH visual pass"); markup changes are class names in five components and the calendar page; the case task rows lost their inline styles to the same block. No behaviour or data changed; the only visible wording change is the two shorter phone bar words. Review (high) found 10 items, all fixed: the More menu width now applies above 640px only; the Help two-by-two grid applies from 701px and only to exactly four cards; the calendar and notice spacing use opt-in classes (calendar-feed-actions, calendar-feed-note, notice-stack) instead of overriding shared rules; the Add forms pick their full-width fields by class, and both time zone fields span the row; the staff banner offset applies only below 480px, where the link wraps; the action row matches the cta-row gap. The phone-bar test was seen red on the Agencies label before the fix, and it also caught an older label already on main: Add a Traveller showed as Add Traveller, which is not part of its spoken name; it now shows Traveller.
- Not changed, for the owner: the stage note under the case tracker uses engineering words ("workflow", "existing actions"); Route Rules on Dates and Expiry shows the requirement's raw key (for example bank_statement); Start a Case says "Check the answers marked below" from below the button; an uploaded file shows "Added as ..." and "Added." twice; "Notifications" is still cut short on the account phone bar below about 400px; the sign-up consent line stays at the 12px caption size chosen in #311; the task due time zone is still a typed box while appointments use the list.

### 2026-10-28, S16: AI access audit and telemetry

- Product events (ADR 0021 section 7), written beside the audit records in the same transaction and before them (so the audit chain's lock is held only for the audit insert): `AI_CONNECTOR_CONNECTED` when the app finishes connecting (the code exchange that first activates the connection; a consent the app never finishes records nothing), with the case mode as label (`NONE`, `ONE`, `ALL_CURRENT`) and the number of granted sections; `AI_CONTEXT_REQUESTED` (label: the tool) and `AI_CONTEXT_DENIED` (label: the denial reason code); `AI_CONNECTOR_REVOKED` when the person turns a connection off on the Sharing page (no label; number: seconds the connection lived; a second Turn Off records nothing). Connected and revoked are once per connection. The product event table can only hold an account id, a closed-list label and a whole number; the labels are derived from the connector's own lists of case modes, tool names and denial reasons, so a new value cannot be dropped silently.
- Deviation for owner awareness: `AI_CONTEXT_REQUESTED` and `AI_CONTEXT_DENIED` are recorded once per connection, per UTC day and per label, not once per call (only a hash of that key is stored). Per-call rows would make the admin scorecard and analytics, which scan the whole event log, grow with AI traffic. They now read as "connection days with answers" and "connection days with refusals". Every call is still counted from the audit records (`AI_CONTEXT_SERVED`, `AI_CONTEXT_DENIED`), which is what the staff card shows. One nuance: an answer the route withholds as too large marks both an answered day and a refused day.
- Security fix from review: the route takes the tool name for a withheld answer from the app's request unchecked. A 60 KB made-up tool name holding a passport number could reach the audit records, which cannot be erased. Now every AI audit record and product event names a tool only from the five known names, or `unknown`. The tool list's type requires each tool's name to be one of those five, and a test pins the two lists equal.
- Withheld answers: the gate records the call as served before the route's final size check. When the route then withholds it, the denial is marked `withheld`. The staff card counts it as refused only (answered calls subtract withheld ones), so the trail still says what the gate released and that the app never got it.
- Best effort: `recordProductEvent` writes in a savepoint and never throws. Proven by renaming the product events table: the call is still answered, the audit rows are written, Turn Off still works, and the failure is logged once without any value or token.
- Last used: `last_used_at` was already written at most once a minute (a guarded update); now proven directly (no write at 59 seconds, a write at 60).
- Readiness: new capability `aiConnector`, `disabled` unless `AI_CONNECTOR_ENABLED` is exactly `true`, then `available`, whatever the deployment mode. The public status page names it "AI App Connections" (Switched Off for Now while off). Added to the core list, the web registry and the status name table; the registry count test is now 21.
- Staff count: a card "AI App Connections" on the AI Settings page (security admins): active connections, connections turned off, and requests answered and refused over the service's own window (7 days; the label is built from it), plus one line saying whether AI apps can connect on this site. Totals only, no per-person data. "Not available yet" when the connection tables are missing; "could not be read right now" when the read fails or is refused. The page mints one staff scope as its access check and reads everything in parallel. Service `getAiConnectionCounts` (`packages/services/src/ai-connection-counts.ts`) takes a fresh `StaffScope<'AI_SETTINGS_MANAGE'>` and refuses anything else. No baseline entries added.
- Acceptance test (`packages/services/src/ai-connector-telemetry.test.ts`, 13 tests, PGlite): drives consent, code exchange, answered calls (one that really returns the passport number, one that really returns the document text), a refused call, a withheld answer, a withheld answer whose tool name is 60 KB of made-up text holding the passport number, a failed call, refresh, sign-in revocation, Change Access and Turn Off, with made-up sentinels (a passport number, a task text, a document text, the authorization code, the code verifier, the access and refresh tokens). None appears in any stored AI audit row or AI product event, or in anything written to the console (every console method spied). Also tested:
  - audit metadata keys per event type, and tool names only from the known list;
  - each product event on its path, nothing at consent alone, once per day per label, and again the next day;
  - staff counts (a withheld answer counted as refused only, the 7-day window, zeros on an empty platform, the missing-table fallback, a real failure still thrown);
  - non-staff, another action's scope, a forged scope and a stale scope are refused.
- Web tests: card wording, the two fallbacks and the window label (6 tests); the capability switch in the registry and in the readiness response.
- Proven red:
  - Putting the access token into the served-call audit metadata failed the sentinel and metadata-key tests.
  - Logging the tool's answer to the console and dropping the tool label failed the console, product-event-path and failure tests.
  - Recording the app's tool name unchecked again failed the sentinel test on the passport number.
  - Counting withheld answers as answered failed the staff count test.
  - Each was restored from a copy and is green again.
- Not verified:
  - No live connector run (no real Claude or ChatGPT connection on the deployed site).
  - Correction, verified 28 Oct 2026: the owner has already set `AI_CONNECTOR_ENABLED=true` in production (the authorization server metadata answers there), so after this merge the status page will show AI App Connections as available. No real AI app connection has been run end to end yet.
  - The staff card has not been checked in a browser.
  - Tokens an AI app revokes itself still write no audit event (unchanged from S15).
- PR browser check on #317 (head 54061efc) failed twice on the GitHub runner, never locally (30 of 30 repeats): after the footer link "About This Version" the status page showed the feature list instead of that section on a 360x640 phone. Root cause in the page, not the test: the status page loads its feature list after the browser has already jumped to the linked section, and the list then pushes the section down; the new "AI App Connections" row pushed it fully off a phone screen. Fix: once the first answer is on the page, the status page brings the linked section back into view, once (status-client.tsx). New test status-client.test.tsx, seen red with the fix removed and green with it restored.
- Same run, open and not caused by this change: "account menu opens above a trigger that sits low" failed once and passed on its retry (menu bottom 1131 against a trigger at 704). S16 touches no menu code or styles; recorded with the earlier intermittent pixel test as open and unproven.
### 2026-10-28, CCD-0 and CCD-1: Calm Core With Depths, foundation and Account screen
- Built: the shared Glance, Browse, Everything switch (`components/depth-switch.tsx`, `components/depth.tsx`), the `vs_depth` cookie (level words per screen family, nothing else), anchor and `?depth=` reveal, the no-script fallback, the heading check, and the nothing-lost parity harness (`lib/ccd`). The Account screen is the first converted screen. Decisions and mechanism: ADR 0023. Ledger: `docs/uiux/ccd/PARITY-LEDGER.md`.
- Finding for the owner (D1, rules R1 and R2): the Needs Attention service reads each case's id, title, state and creation time and each document's expiry day only. It does not read case travel dates, deadlines or which documents a case uses, so "expired and used by an active case is Past Due" and "expires before the case ends is Due Soon" cannot be built without new reads. Per the decision, ADR 0016 stands unchanged and R1 and R2 are not built. Needs the owner's go-ahead if wanted.
- Finding (D4): the agency "Pending Requests" tile counts a status that does not exist (SUBMITTED) and leaves out RECEIVED and UNDER_REVIEW. ADR 0015 point 5 defines "waiting on the traveller" as Open or Needs Replacement, which the planned fix keeps; only the tile widens. No conflict. Built in CCD-6.
- Finding (D3): neither `docs/public-beta/PRODUCT-CONTRACT.md` nor `vocabulary.test.ts` requires the word "applicant" in user-facing text, so the traveller rename needs no exception.
- Account screen: heading is now "Your Account" with the email under it. The Sign Out card moved first (Glance); photo, language and privacy are Browse; WhatsApp and the other areas you can open are Everything. Each keeps its own condition. Parity test: three states, nothing missing but the approved heading change.
- Guards seen failing with the real code broken: removing the Privacy link (parity), disabling the reveal (3 tests), a wrong level word (2 tests), not writing the cookie (1 test). Restored, all pass.
- Separate fix in the same pull request: the AI connector now declares the VisaStack logo (`icon.svg` and a 512 pixel PNG at the production address) in its server details. The root site `obsidianglobal.studio` belongs to a different Vercel project (bidesh365); VisaStack only owns `vs.obsidianglobal.studio`. If a connector list still shows the old picture after this, it is taking the picture from that root site, which was not touched. Not verified live: what the connector list shows after deploy.
- New words live in `apps/web/src/lib/ccd/depth-words.ts`, not the shared message catalog, because that catalog's test demands a Bangla line for every English line and Bangla work is deferred. Translation later means changing that one file.
- Not done: signed-in look at phone and desktop widths (needs a real sign-in); the phone search entry (shell change); screens 02 to 15.

### 2026-10-28, CCD-2 slice 2a: Home
- Home is converted: heading "Welcome back, {first name}" (name taken from the record the person keeps for themselves; "Welcome back" when none), the next step at Glance with a "{n} more things are waiting" line, the working view at Browse, My Next Journey and Permissions You Control at Everything. A link to `#permissions` (the consent step) raises the level first.
- Finding: Home already ranks through the Needs Attention service, so decision D1 changes only the traveller overview (slice 2b). The nav and page title still say "Account Overview" until slice 2b renames them to "Home" together with the traveller page, so they never disagree.
- Parity: six Home states captured from main before the edit (`baseline/home.json`); the only approved change is the heading. Guards seen failing with the real page broken: a removed calendar link (4 tests), a wrong level word (6 tests).
- Not built: "Every Page" list; shorter or slimmer Next Step variants. Not verified live: the signed-in Home at phone and desktop widths.
- Review (high) fixes: Permissions You Control stays at every level while core processing is off (it is then the required next step), the same in-page link now works on every click (not only when the address changes), and the approved heading check names the expected wording per state. Known limit for the owner: the first name is the first word of the name the person typed for their own record, so a name entered in passport order ("HOSSAIN Karim") or with a title ("Dr Karim") greets with that word; a separate given-name field would need an extra read.

### 2026-10-28, CCD-2 slice 2b: a traveller's own page and one ranking for "what next"
- The traveller's page is now headed with the traveller's full name (eyebrow "Home"), uses the three levels, and takes its next step from the same Needs Attention ranking as Account Home (decision D1), read through the central gate as the owner, with Home's wording (for example "Bank Statement" and "Reply to Request"). If the ranking cannot be read, the page falls back to its own request and suggestion checks. Flagged documents and the profile steps still follow when the ranking has nothing. When nothing is waiting and the profile is complete the next step reads "Nothing Needs You Right Now" with Continue Case as the one primary button.
- One primary button per screen state: the header's Start a Case and the case card's Continue Case are now secondary. A new test caught the case card's button as a second primary before the fix.
- Open question for the owner (naming): decision D3 names the account page "Home", but every traveller's tab is also called "Home", and an earlier owner decision (list item 11) kept the account page as "Account Overview" so the two are never confused. The page heading is "Welcome back, {first name}" and the menus still say "Account Overview". Recommendation: keep "Account Overview" in menus.
- Parity: five traveller states captured from main before the edit (`baseline/traveller.json`); five approved changes (heading, button name, three request next-step wordings). Guards seen failing: ranking ignored (1 test), two primary buttons (1 test).
- Not built: the "Every Page for this traveller" list. Not verified live: the signed-in traveller page at phone and desktop widths.
- Review (high) fixes on slice 2b: the page no longer says "Nothing Needs You Right Now" when a read failed or the ranking could not be read (it says "Start or Review a Case" instead, next to the existing "some records could not be loaded" notice); the ranking read starts beside the other reads; Home and the traveller page share one gate helper (`lib/owner-gate.ts`); the sidebar is hidden as a whole at Glance so no empty landmark remains; the browser tab title is "Traveller Home" so it differs from Account Overview.
- Known limit for the owner: a flagged document is not part of the Needs Attention ranking, so a low-urgency top item (for example a document that expires in months) is shown as the next step ahead of "Check a Flagged Document". The flagged document still shows in Needs Your Attention and in the count card at Browse. Adding flagged documents to the ranking would be a service change for a later package.

### 2026-10-28, D4: one definition of which evidence requests are pending
- Agency Overview "Pending Requests" now counts every request not yet closed (open, sent back, received, under review). Administrators see a second line "{n} waiting on travellers, {m} waiting on you" ("a traveller" for one). Before, it counted a status that does not exist (SUBMITTED) and left out received and under review.
- The two groups are defined once in `packages/services/src/evidence-request-groups.ts` and used by the tile, the Waiting on Traveller view, the Attention tile, Do Next and the traveller's own due labels. Every database status is classified in a typed table, so adding a status stops the build until someone decides who it waits on (seen failing with one status removed).
- Wording: "waiting on an applicant" became "waiting on a traveller" on the agency Overview (decision D3); the Attention tile says "Waiting on the Traveller".
- Unchanged and noted for the owner: the tile counts requests on every case the dashboard loaded, including closed ones, as it did before; Do Next leaves closed cases out. Narrowing the tile to open cases would change the number again and is the owner's call.
- Built in an isolated copy by a helper and reviewed (high): dead guard removed, sent-back check made direct, plural fixed, two leftover copies of the traveller list now read the shared one.

### 2026-10-28, CCD-3 slice 3a: Documents and the upload rules (D5)
- Documents uses the three levels: tiles, notices and the reading offer at Glance; the list, search and the selected document with all its details, preview, download and forms at Browse; the upload form at Everything. A link that picks one document (`?document=`, used by All Records, My Profile and the photo tools) opens the page at Browse at least, so it never lands hidden; nothing is saved by that. A filter tile tapped at Glance opens the list, and the switch follows any such change.
- The level a person or a link chose now survives the page's own refresh while a file is being checked: the scope keeps its first rendered level and only the switch, tiles and links change it.
- Headings: "Documents" is the page's one h1 (eyebrow "Record", retiring "Your Private Wallet"); "Selected Document" and the reading offer card are h2s; the photo checks heading is an h3. Sizes kept.
- D5: the size the form prints was already the server's real per-file limit (the smaller of the quota and the 4 MB one request carries, so 4 MB, not the 20 MB quota default the plan assumed). New, in the owner's words: while PDF files are refused, the limits line above the file picker ends "PDF files can be added only while our virus scan is switched on.", and a picked PDF is refused with the same sentence plus "Add a photo or scan of each page as a JPG or PNG instead." Other refused kinds do not mention PDF.
- Review (max) found 14 items; all fixed except: the plan's Glance list of the documents that need review is not built (Glance shows the counts; the tile opens the list); the panel's per-document forms stay at Browse rather than Everything, because hiding preview and download broke selection links and the staging upload journey; the reading offer keeps its own primary button beside Upload Document (two primaries while the offer shows).
- Guards seen failing: a tile that does not open the list, a switch that does not follow, a scope that follows a refresh, a document link with no raise.
- Not verified live: the signed-in Documents page at phone and desktop widths.

### 2026-10-28, CCD-3 slice 3b: My Profile, Dates & Expiry, All Records and History
- My Profile: identity, completion and "You Decide What Becomes a Fact" at Glance; the editor at Browse; Profile Health and Latest Changes at Everything. The editor's area list and field forms stay together at Browse (they are one component; splitting them is a later change).
- Dates & Expiry: the Deadline Clock at Glance, each document's own expiry at Browse, route rules and issuer confirmations at Everything. Named "Dates & Expiry" everywhere it was "Expiry & Freshness", "Expiry Centre", "Document Expiry Centre" or "Open Expiry Centre" (the admin pack page keeps its staff label).
- All Records and History: naming and one h1 only ("History" was "Fact History"; eyebrow "Record").
- Parity: three profile states and four expiry states captured from main before the edit; approved changes are heading levels and names only.
- Not verified live: these signed-in pages at phone and desktop widths.
- Review (high) fixes: All Records group titles are h2 so the page never skips from h1 to h3; route rules and issuer confirmations stay at Browse so stale or undated evidence is never hidden by default; the conflicting-values warning moved to Glance; Documents, My Profile and Dates & Expiry each remember their own level; the heading sizes now use the existing rules (no new size); the tab titles read "My Profile" and "Dates & Expiry"; "Check Document Expiry" became "Dates & Expiry"; one helper builds each screen's switch sentences.

### 2026-10-28, CCD-4: Cases and the Case page
- Cases: "Cases" is the one h1 with the traveller's name as the eyebrow; a Glance line names the case being worked on; the list ("All Cases") is at Browse; the Start a Case form (details open) and Prepare a Brief and Case History are at Everything. The staging journey now opens the form through its anchor.
- Case: the next step, the changed-case alert, the welcome note, the honesty line and the progress summary at Glance; stages, chips, section links, the checklist, Case Details, Requirement Pack and Advance the Case at Browse; evidence, tasks, appointments, letters, notes, submission and outcome, problems and feedback, snapshots and itinerary at Everything. Every anchor raises the level first. One primary button per state. "Evidence Progress" and the cancel question are h2s at the same size.
- Planned by a read-only planning helper; built and reviewed here. Parity: four Cases and four Case states captured from main before the edit, with stubbed panels counted.
- Left for the naming pass (CCD-7): "Visa Cases" in the menu, "Active Visa Cases" and "Start a Visa Case" on the traveller page.
- Not verified live: the signed-in pages at phone and desktop widths.
- Review (max) found 12 items; fixed: every Start a Case link in the app (Home, the traveller page, Insights) now carries #start-case and the form shows at Browse while there is no case; tasks, appointments, letters, contributors and notes sit at Browse because notifications and request replies send people to the case for them (and the request reply link now goes to #notes); the section links show at every level; the Cases Glance line says when cases could not be loaded; the changed-case alert links to Snapshots; the side column hides as a whole at Glance; the parity guard now counts repeated items and the Cases baseline was recaptured from main with stubbed parts counted; the Case level test fails when an anchor is missing; the open-case rule is shared; the new CSS sits in the appended block. Left as is, for the owner: after "Got It" closes the welcome note, the checklist picker stays secondary until the page reloads.
- Known limit: the service-built links for an appointment notification and an open task still open the case without an anchor; their sections are at Browse, so on a phone at Glance a person taps a section link once.

### 2026-10-28, CCD-5 slice 5a: Notifications and Privacy & Consent
- Notifications: unread at Glance, the ten most recent read at Browse, older read ones (up to the 50 the page already loads) at Everything. With nothing unread, Glance says "Nothing unread in your latest notifications." (the page lists the latest 50, so it never claims more than it shows) and the list starts at Browse. Named "Notifications" (D3), retiring "Alerts" and "Updates on Your Cases" on this page; the route is unchanged.
- Privacy & Consent: the three rights as rows and the two export downloads at Glance; what an export holds and Consent History at Browse; large exports, account deletion and a new link to Permissions You Control on Home at Everything. A deletion already scheduled keeps its card at Glance so cancelling it is never hidden (guard seen failing). Named "Privacy & Consent" (D3), retiring "Your Data Rights"; "Download Export (CSV/ZIP)" title case.
- Parity: three notification states and two privacy states captured from main before the edit; approved changes are names only.
- The menu entry still reads "Alerts" where the shell names this page; the menu naming pass is CCD-7.
- Not verified live: these signed-in pages at phone and desktop widths.

### 2026-10-28, CCD-5 slice 5b: Evidence Requests and Sharing
- Evidence Requests: what is waiting, with its reply form, why it is needed and any reason it was sent back, at Glance; dates, checklist notes, references, guidance, questions and requests already answered at Browse; asking the agency at Everything. Named "Evidence Requests" (D3), the page's one h1. A failed read now says so at every level instead of showing the "no requests" empty state.
- Sharing: who can reach the record now (live or paused), with Pause, Resume and Revoke and the revoke warning, at Glance; what each person can see, access waiting to be accepted or ended, and the Access Log at Browse; invitations and the Grant Access form at Everything. The form opens at Browse while nobody has access and at Glance when the person came from Share on a document. AI connections stay at Glance. Named "Sharing" (D3), the page's one h1.
- Parity: five evidence states and three sharing states captured from main before the edit; approved changes are the two page headings and the evidence failure state.
- Guards seen failing: a pending grant shown at Glance, a waiting request hidden at Glance, Pause and Revoke wrapped in a Browse block, a sent file that could not be used hidden at Glance, the sent-form block not kept in view.
- Review (max) fixes: invitations not yet accepted are at Browse (not Everything) and counted at Glance; a sent file that could not be used shows at Glance with its guidance and the question box; after a form is sent, the depth switch keeps the block the person used on screen when the refreshed page moves it deeper (an answered request, the first share), so the "Saved" line and the share confirmation are seen; the Sharing level sentences follow where the form really is; the tab title is "Evidence Requests"; level tests read the real on-screen level (a block around an element counts); the staging sharing journey opens the form by its anchor.
- Not verified live: these signed-in pages at phone and desktop widths.

### 2026-10-28, CCD-7 first part: the dark Next Step banner
- Owner asked why the black banner of the mockups was missing: it had not been built. The Next Step on Home, the traveller page and the Case page now uses the dark chapter colour already in the product (the sign-in page panel), full at Glance and shorter at Browse and Everything, with a white focus ring on the dark surface. Style only; no markup, link or level change.
- Checked: rendered at Glance, Browse, auto on desktop and phone, print and high contrast in a browser from the real stylesheet; contrast 10.9:1 for the reason text, 17.4:1 for the title, 15.6:1 for the button; flat-design, UI ratchet, type scale and text floor guards pass.
- Review (high) fixes: the urgent and settled coloured edge is kept; print and high contrast keep the banner readable and outlined; the button hover is visible; title sizes come from the type scale; one set of rules for both banners through variables on the scope.
- Not built: the single-line pill at Everything (it would hide the reason sentence). Not verified live: the signed-in pages themselves.

### 2026-10-28, CCD-7: the Next Step banner in the brand ink
- Owner: the banner must use the brand colour of the page headings ("Welcome back, {name}"). It used the darker sign-in navy (#0b1a30); it now uses the heading ink (--text, #13243d), so it is the same colour as the headings. Reason text keeps the chapter's light text (9.8:1), title and button 15.6:1. Style only.

### 2026-10-28, owner request: a time zone picker where a time zone is typed
- The traveller's Tasks form had a free-text time zone box. It now uses the same time zone list as Appointments (grouped by region, this device's zone chosen first, optional). The zone is saved only together with a due date, and the action refuses a name that is not a real time zone (a hand-made request could otherwise store any text). Both tested; guard seen failing.
- No other free-text time zone field exists (every form searched). The agency's Tasks form keeps no time zone on purpose: a task's own zone can tell where a traveller lives, and an existing test keeps it out of the agency's browser.

### 2026-10-28, owner request: logs that keep their height and can be filtered
- The Sharing Access Log and the platform Audit page grew the page with every new event. Both now show their entries in one box of fixed height that scrolls inside (keyboard focusable, named for screen readers), under a search and filters: What Happened, Who (when entries name someone), Allowed or Blocked, and a period (24 hours, 7 days, 30 days). "Showing N of M" and Clear Filters say what is filtered.
- Each page now reads the newest 300 entries instead of 100 (Access Log) or 50 (Audit), filtered in the browser; nothing new is read or stored. The summary says how far back the loaded entries go, so a period filter never seems to cover more than was loaded. A filter whose value leaves the list after a refresh stops filtering. One shared component (components/activity-log.tsx), tested; the Audit page keeps its "Denied" wording and neutral "Allowed".
- Review (high) fixes folded in: the repeated count in each card's intro removed (approved parity change), the unused exact-code component removed.
- Not changed: the agency Case Activity page (a short list of case notes, not an audit log).

### 2026-10-28, owner request: emails that people are glad to receive
- Every email went out as one plain sentence and a bare link. All of them now share one design (packages/services/src/email-design.ts), sent as HTML with the same words as plain text: the brand ink header with the VisaStack mark, a heading that says what happened in plain words, the specific fact, why it matters, one clear button, what happens next, the address as a fallback link, and a footer that says the reader stays in control and which address it was sent to.
- Words for all 21 kinds of email the product sends (tested to cover each one, Title Case buttons, no long dashes, no engineering words, never an accepted document called a visa decision); anything new still gets the full design led by its subject.
- Safe by construction: every piece of text is escaped (a name or a case title can never become markup), the button only ever leads to the product's own address, and the one image is the VisaStack mark from the product's own address, the same file for everyone (no tracking pixel, no link wrapping, no remote fonts). Guard seen failing. The email words are keyed by every kind of email, so a new kind without words does not compile. Each email uses a new provider key, so a retry of an attempt made before this change is not refused.
- Task reminders now say the due day on the task's own calendar ("is due on 22 Jun 2026", "is due today, 15 Jun 2026", "was due on ..."), never the task's own words; the email heading follows the stored timing, so the due day itself is no longer called past (guard seen failing). Evidence request emails stay neutral on purpose (an existing rule: no document type or message by email).
- Not changed: sign-in and account emails sent by the sign-in provider (configured in that provider, outside this code).
- Security review: no findings. One setting to keep: click and open tracking must stay off for the sending domain in the email provider, or it would rewrite the links (invitation links carry a one-time token) through the provider's own address.

### 2026-10-28, a test that failed when a slow run crossed the hour
- The evidence request limit test failed once in a slow local run (the service tests took 22 minutes instead of 2, with a leftover process loading the machine). Root cause: the limit counts in fixed clock-hour windows, and the test's 51 requests straddled 18:00, so the count started again in the new window. Reproduced by placing half the requests either side of the hour. The limit itself is correct (fixed windows by design); the test now holds the clock still in the middle of the next hour.

### 2026-10-28, CCD-6 slice 6a: Agency Overview on three levels, and the agency heading
- Agency Overview: the four numbers and the first Do Next item at Glance, with "N more need you"; the rest of Do Next, the pipeline, the case list, Evidence Requests and Your Team at Browse; search, the reassignment queue, case activity, setup, clients joined and attention details at Everything. A search, stage or quick view shows its list at Glance.
- Every agency page: the agency's name as the eyebrow and the page's name as the one h1 (D3); "Invite a Client". Plan & Usage keeps its own h1.
- Parity: five states captured from main with the heading; approved changes are the h1 and the invite button name. Guard seen failing (every Do Next item at Glance).
- Review (high) fixes: no page has two h1s (Countries and Case Activity keep their own; Case Activity's header became that h1); unfinished setup stays in view at every level; the pipeline joins a requested list at Glance; the search sentence sits with the search form; the switch's Glance sentence names a requested list; plural words from the shared helper; the page name lookup reads only its own names.
- Not verified live: the signed-in agency pages at phone and desktop widths.

### 2026-10-28, CCD-6 slice 6b: Agency Cases on three levels
- Agency Cases: every case row (title, traveller, reference) at Glance with a line saying what needs this person on that case, counted on the server: open tasks assigned to them, sent items waiting for review (checklist items only for people assigned to the case, who alone can record a decision; request replies for administrators), and for an administrator a case nobody looks after; nothing for closed, cancelled or submitted cases, as Agency Overview; Where Things Stand and Assigned at Browse; Tasks, Appointments, Notes, Decisions and Issuer Confirmations at Everything. "Issuer confirmations (EVI-05)" is now "Issuer Confirmations", the name the traveller's Dates & Expiry page already uses.
- Links to a case from Agency Overview, Case Activity and the header search (a full-path link to the same page) open Everything, so the whole case shows. The row asks for that only for links; a form sent inside a case keeps the level the person chose (both seen failing when broken).
- Parity: four states captured from main at 5a8f4370; the approved change is the confirmations label. Level guards seen failing (Tasks ungated, the Needs you line shown at every level).
- Not verified live: the signed-in agency pages at phone and desktop widths.
- Review (high) fixes: the line no longer counts reviews an unassigned administrator cannot record, ignores closed cases and names an unowned case; a member's line is proven never to use requests (seen failing when requests reached members); each working section has its own anchor, so a sent form keeps its section in view.

### 2026-10-28, CCD-7 slice 7a: one name per thing, finished
- "Traveller" replaces "applicant" in visible text across Home, All Travellers, the traveller pages, the case page and the agency pages (for example "Add a Traveller", "No Travellers Yet", "See All Travellers", "Awaiting Traveller", "Traveller has not confirmed yet"). Routes, stored values and code names keep "applicant"; staff screens are unchanged. The landing page's pilot notice keeps "applicant" (public copy, owned by the landing package).
- The page finder (Ctrl+K) now uses the menu's names: Account Overview, All Travellers, Notifications, Privacy & Consent, Your Account. The traveller page tile reads "Active Cases" and its empty state "Start a Case"; no screen says "Visa Cases" any more. The tab title of the people page is "All Travellers".
- Parity: one approved rule lists every exact phrase that changed (approved-changes.ts, TRAVELLER_WORDS); anything else missing still fails.
- Staging-only spec apps/web/e2e/authenticated-workspace.spec.ts (skipped by design): its add-person button match now accepts "Add Traveller"; it still clicks a link named "Applicants" that the signed-in shell no longer shows, which needs a staging run to update truthfully.
- Review (high) fixes: a phone menu browser test now looks for "Privacy & Consent"; ten more visible "applicant" phrases (case confirmation badge, agency Clients and Settings, case stage note, All Travellers, Home permissions, Privacy deletion and export) are renamed; the parity rule lists only the eight screens whose wording changed.
- Allowlist: WP-CCD7.txt was a seed; the files this naming pass edits were added under owner decision D3 ("apply everywhere user-facing"), as earlier CCD slices did. Recorded here for the owner to see.

### 2026-10-28, WP-C2: surfaces and edges that separate (owner contrast map)
- The signed-in app passed text contrast but read as one pale sheet. Sidebar, card edges, control edges, the current-page marker, the depth switch's pressed level, the progress ring track and the two lower text tiers now separate by tone and edges only; status words are darker. No shadow, gradient, layout, copy or behaviour change. Values and the contrast budget: docs/uiux/CONTRAST-AND-SURFACES.md; token record: docs/upgrades/programme/colour-map.md (WP-C2).
- Landing "How it works": the ghost step numerals (1.05:1) are removed; the "Step N" line keeps the order.
- Guards: palette-contrast.test.ts "surfaces stay separable" and the new surface-css.test.ts; each new guard was seen failing with the stylesheet broken (literal colour on cards, wrong button edge, wrong bar colour, a shadow or the wrong edge on the pressed level, faded placeholder, the numeral back, the old ring track).
- Screens: 17 pairs at 1440x900 and 390x844 from the test pages with the real stylesheet; every pair keeps its exact page size, colour and edge differences only. The phone bottom bar shows no pill or bar; the collapsed rail's bar clears the icon.
- Not verified: the live signed-in pages after merge (needs a signed-in run), hover, pressed and disabled states, the platform admin console.
- Branch: the owner's prompt named claude/prog-c2-surface-contrast; the work is there so the session branch stays free for CCD. Merge waits for the owner's word.

### 2026-10-28, CCD-7 slice 7b: it feels like the product already knows them
- Anticipate: an evidence reply chooses an item only when exactly one finished item fits, and says so ("This is the only one that fits, so it is already chosen. Check it, then send."); with several, nothing is chosen until the person picks ("Choose which one to send."). It never sends without the button. A case's Next Step names the case and the first item to fix ("Fix 2 required items for {case}", "First to fix: Bank Statement.").
- Quiet closure: revoking, pausing and resuming access, and withdrawing an invitation, now end on a calm line the reloaded Sharing page shows ("Access revoked. They lose it on their next request."). The page shows only these fixed words for a known address word, never text from the address. The emailed share invitation is two sentences; accepting all clear details says what they are now used for.
- Calm all-clear: Home and a traveller's page add one real fact when nothing is waiting, the soonest document date still ahead that the system is sure of ("Karim Hossain's Passport is valid until 14 Jan 2027."); no fact is shown when none is certain.
- Reduced motion now also stops the disclosure arrow (pseudo-elements).
- Audited and already in place: level changes are announced to screen readers; the depth switch and Next Step buttons are at least 44 pixels; sent evidence, single suggestions and new shares already end on specific lines.
- Guards seen failing when broken: the reply form choosing the first of several, the case Next Step without the item, a doubted date in the all-clear, address text on Sharing, the old reduced-motion selector.
- Review (high) fixes: the Sharing line is read out once the page runs, then leaves the address, so a reload, Back or the next change never shows a stale one; a failed withdrawal now says so in fixed words; the reply form's hint follows what is chosen now; a long case title wraps; the emailed invitation keeps "Spam or Promotions"; the all-clear fact uses only a date more than a month away and names the person only when the account has several; one and several accepted details share their words. Security review: no findings.
- Not changed: the staging-only spec apps/web/e2e/authenticated-workspace.spec.ts checks pause and revoke by the row's words, which the new lines also contain; it should wait for the reloaded status, at the next staging run.
- Not verified live: the signed-in screens at phone, tablet and laptop widths.

### 2026-10-28, CCD-7 closed: phone, tablet and laptop widths
- Every page the web tests render (824 pages, signed-in shell, agency, public and auth screens) was loaded with the real stylesheet at 390, 768 and 1280 pixels wide. None scrolls sideways at any width. The check was proved by adding one 1500-pixel block to a copy of a page: it was caught at all three widths, and the unchanged page stayed clean.
- With 7a and 7b live, Calm Core With Depths is complete: all fifteen screens have the switch, one name per thing is in place, and the section 6 behaviours are built.
- Not verified: the signed-in pages on the live site (needs a signed-in run); hover, pressed and disabled states.

### 2026-10-29, S27: commercial-readiness reconciliation and daily backup
- AI gate: `productionOpenAiProject` is replaced by the provider-neutral `productionAiProvider`. It passes when AI dispatch is off (AI settings saved but none active, or a fresh install whose environment does not turn AI on), or when the active AI configuration has a usable key (stored, not revoked) and recorded provider data terms and, when a fallback would really be used (the same eligibility the gateway's `resolveFallbackExtractor` checks: it exists, is another provider the app can call, has an approved data policy and a usable key), that fallback's terms are recorded too. A fallback the gateway would treat as absent receives nothing and does not fail the gate. An unmet gate names what is missing ("The fallback AI provider has no recorded data terms."). The environment-only OpenAI path no longer passes. The facts come from `loadAiProviderReadiness` (packages/services/src/ai-provider-readiness.ts): plain reads that work on the readiness probe's stateless client, selecting only flags (the key's stored length, never the key); a missing table reads as unreadable and fails closed. The unused `createAiExtractor` was removed; its tests now cover the environment switch it wrapped.
- How the facts are read: `apps/web/src/lib/readiness.ts` starts the read as soon as the database is known to be usable, alongside the migration, storage and key service checks, and passes the scan runner proof on to the capability lookup instead of querying twice. `apps/web/src/lib/readiness-signals.ts` shares one read between overlapping evaluations on the same database handle (readiness reuses one stateless client per connection string; a caller with its own handle or clock gets its own read) and remembers the answer for five minutes for the synchronous checks (unknown fails closed). A generation counter discards any read that was still running when the answer was forgotten (AI settings change, or an evaluation with no usable database, which also clears the remembered answer).
- Scanner gate: `realMalwareScanner` did not accept `github_clamav`. It now does, only on the production deployment (the only place intake dispatches), with the dispatch token set and the runner's verification record under 72 hours old (S4's `loadScannerEvidence`). Under that provider the small uploads checked on the spot use the structural checker, so they are now made safe another way: agency logos and photo proofs of payment are re-encoded on the server (`SharpImageSanitizer`, packages/adapters/src/photo-reencoder.ts, using the existing sharp dependency, no new package) and only the re-encoded copy is stored under its real type. The upload limits people see are unchanged; the cleaned copy has its own cap (logos 4 MiB, proofs 8 MiB) and tries a palette PNG for paletted sources, then PNG, then a high-quality JPEG when there is no transparency, and only then refuses with "too large after cleaning". Both re-encoders share one decode, deadline and sharp-timeout helper; profile photos already were re-encoded; PDF proofs are refused by the structural checker. One shared `isClamAvConfigured()` (apps/web/src/lib/env.ts) now serves the scanner factory, the capability registry and the gate.
- Owner deferral: `COMMERCIAL_READINESS_DEFER_<GATE>=<register id>` counts only for the allowlisted `externalPenetrationTest` with exactly `H01`; it then passes and shows "Deferred by Owner (H01)" on the admin page and in the internal report. Any other value or gate shows "Deferral Not Accepted" and changes nothing; the value never appears in output. The admin page uses one `gateStatus` helper (word and colour) and counts deferrals once.
- Attestations: `COMMERCIAL_READINESS_ATTESTATIONS` is the single source; each gate looks its attestation up by gate key. The pentest evidence now points at `docs/security/external-penetration-test.md` (new, the H01 evidence location, stating no test has run). The runbook table matches and a test keeps them equal.
- Backup: capture runs daily at 05:17 UTC; the Vercel freshness check runs daily at 11:07 UTC (an existing cron changed from weekly, none added) and accepts only a capture under 24 hours old, so one failed capture fails the check the same day and asks for a fallback run. It uses the same manifest parser as pruning, which refuses completion times more than 10 minutes in the future, and one shared R2 client setup. A new step after each capture prints the storage total (warning above 8 GB) and applies the retention rules (packages/adapters/src/backup-retention.ts): every archive for 35 days, the newest archive in each of the 12 fixed calendar weeks up to that line, never the newest 7 verified, orphan archives (with any manifest file) and manifests without an archive only after 2 days, nothing when captures look stalled, and a stop on any partial listing. A 200-day simulation of daily capture and daily prune settles at 36 dailies plus 11 or 12 weeklies, the oldest at most about 119 days. It deletes only when the repository variable `BACKUP_PRUNE` is exactly `on`. **Owner action: set `BACKUP_PRUNE=on` in the repository Actions variables (and confirm the R2 credential may delete) to start pruning; until then archives, and erased data inside them, are kept indefinitely; once it is on, for at most about 119 days.** Privacy data map and backup runbook updated to say this.
- Tests: services 8 files, 173 passed (fallback eligibility matching the gateway, logo and photo-proof re-encoding, "too large after cleaning"); adapters 4 files, 49 passed (retention plan, 200-day daily simulation, calendar weeks, orphan and stray manifests, future completion times, partial listings, report-only guards, 24-hour window, palette PNG kept small, opaque PNG to JPEG fallback, sanitizer deadline); web 214 files, 2340 passed (AI gate, scanner production rule, status helper, signal race and per-handle sharing, admin page and readiness output without seeded secret values). Lint, typecheck, supply-chain scan and its tests clean.
- Break-to-red proofs, each restored from a cp backup and green again: the old now-relative week buckets turned the 200-day simulation red (1 weekly instead of 11 or 12); dropping the palette attempt, the partial-listing guard, the orphan-manifest deletion, the future-time refusal, the fallback key check and the per-handle sharing check each turned its test red; earlier, ignoring the fallback, dropping the production check, remembering stale reads, keeping 0 instead of the newest 7, deleting unless "off", storing the uploaded logo bytes, the allowlist and the exact register id.
- Not verified: the daily capture, the daily check and the prune step have not run; no owner deferral and no `BACKUP_PRUNE` are set; re-encoding has not been tried on the live site.

### 2026-10-29, S23: real redaction (safe copies)
- What: the record owner can hide parts of a PDF or photo with black boxes and share a safe copy (ADR 0022 and its 29 Oct amendment, deviations 1 to 7). Table `redaction_masks` (migration 0102, journal idx 100, re-runnable; also adds the erasure reason `SAFE_COPY_REMOVAL`): one row per page with its boxes, a mask revision shared by all pages, and the page's stored drawing (a private derived file registered in `storage_objects`, with type, size and page size). Owner only (MANAGE and PREVIEW proofs, restricted step-up on page images), latest usable version only, page count checked against the file. Saving starts a new revision ("Preparing"); the editor then prepares each page once through `api/documents/safe-copy-prepare` (drawn at 1240 px, boxes painted solid black before encoding, metadata stripped, stored); the copy is ready only when every page has a drawing for the current revision. A download (`api/documents/safe-copy`, DOWNLOAD_REDACTED) only puts stored drawings together into the hand-written image-only PDF (or the one PNG), checks each stored hash, keeps the 4 MB cap and streams. Every save or removal queues the old drawings for verified erasure in the same transaction and deletes them at once after commit; erasure of the file, account deletion and backup reconciliation queue drawings too. Audit holds counts only. Suggestions: the PDF's own text positions, the passport band, the owner's own identity numbers (decrypted in memory through the profile's reader), and, on financial kinds, valid IBANs (country, length, mod-97) or digits on a line labelled Account, A/C, Acct, IBAN or Card, never dates, phone numbers or amounts; 30 a page at most. The old redacted download paths are closed. Readiness `redactedDownload` is available wherever stored files are, and every safe copy route and screen follows it.
- Review fixes (code review max, 15 findings, all fixed): (1) page images are drawn on a canvas from the fetched bytes, no blob image address (proved under the production policy with the review script: a blob image is blocked, the canvas path draws); (2) every page is released after drawing or reading; (3) a page taller than 4960 px is drawn smaller, under one pixel is refused; (4, 5) prepare once and store (deviation 7), with each call's time counted from when its drawing starts and "This page took too long to prepare. Try again."; (6) review pages load one at a time, each with Try Again; (7) unsaved boxes are kept for the tab (positions only) and Confirm It Is You returns to the section; (8) Save Safe Copy waits until every page shows; (9) box clamping always gives boxes the server accepts (the review's 216 failing cases now 0); (10) narrower account suggestions; (11) removal needs only the version; (12) the shared record reads the state without an identity check and asks for one only for a ready copy, and shows "Safe Copy Not Available for This File"; (13) capability gating; (14) one state read and parallel access checks on the shared record; (15) one shared document-access helper for photos and safe copies (`document-access.ts`), and identity numbers read through `revealFactVersionValue`. Also: the schema is no longer read while the services module loads.
- Measured locally (synthetic A4 scans, review script adapted to per-page preparing): about 3.0 s a page, 8 pages 24.2 s and 20 pages 61.0 s in total with every call well inside 30 s, downloads 2 to 3 ms, output 2.06 MB and 2.49 MB, peak memory growth about 130 MB. Before: one download drew everything, 27 s for 8 pages and 66 s for 20.
- Tests: services 12 files, 250 passed (redaction 27: prepare, resume, revisions, erasure of old drawings, removal without drawing, stored page tampering, too slow, missing table, owner only, recipient, batch states, limits, suggestions with the review's dates, phone, amount and sentence examples; reconciliation 5; access ratchet green, baseline unchanged); adapters 39 files, 501 passed (renderer 14: no text, metadata, attachments, forms, notes, scripts or marker in the output; solid black pixels; page caps; time limit from start; assembly refusals); core 14 files, 153 (clamp cases); db 13 files, 46 (migration 0102 and drift); web 261 files, 2838 in src/lib (parity included), src/components, src/app/app/applicant, src/app/app/shared, src/app/api and src/app/status (editor keyboard, canvas, drafts, review retry, preparing, removal, capability; six route tests; shared record offers). Lint and typecheck clean.
- Break-to-red proofs, each restored from a cp backup and green again: (a) serving the source bytes, and keeping JPEG application segments, turned the no-metadata test red; (b) removing the record-owner check turned the owner-only test red; (c) falling back to an older version's boxes turned the no-carry-over test red; (d) serving while still preparing, and skipping the erasure of old drawings, each turned their tests red; (e) the old clamp turned the clamp test red; (f) dropping the account label rule and the tall-page cap each turned their tests red.
- Not verified: no timing or memory on Vercel; migration 0102 is not applied, so production reads Not Prepared Yet everywhere until the owner's word; no real document tested; the erasure worker has not run against stored drawings outside tests; the full Next build and Playwright were left to the lead's guarded check.
- Third review round (29 Oct; code review high, 10 findings, and accessibility review, 7 findings, all fixed): (1) preparing never throws: an unreadable answer, a refused page or a lost connection all end with "Your boxes are saved. Preparing stopped at page N of M." and Continue Preparing, and a save that did go through is never reported as not saved; (2) each drawing is registered and named on its mask row (`pending_storage_object_id`, new FK and index in 0102) in one transaction before its bytes are written, so removal, a new save, a new version, account deletion and the next preparing step of that page all queue it for erasure; (3) backup reconciliation compares drawings, and registers and queues a pre-incident drawing the restored rows lack; (4) adding a version removes the older versions' boxes and queues their drawings in the same transaction; (5, 9) the editor holds at most 3 decoded pages (least recently shown let go first), lets every page go when it closes, after saving and when another version opens, ignores a page arriving for an earlier opening, and review draws pages as they scroll into view (saving asks that every page was shown once); (6) IBANs are read to their country's exact length ("BE68 5390 0754 7034 EUR"), and only real date shapes with a valid day and month count as dates ("A/C 1234-56-7890" is an account number); (7) preparing parses the file once per page (page count fixed at save, checked by the renderer), and downloads read up to 4 drawings at once; (8) the line around a piece of text is found from one sorted index per page, and only for pieces holding 8 or more digits; (10) 0102 upgrades a table made by its earlier draft. Accessibility: focus moves to each step's heading (edit, review, preparing), to the state line when ready and to the main action when the editor closes; outlines over the page are fixed dark lines on a white halo (suggested boxes, the selected or focused ring, a box being drawn), at least 3:1 on white paper and on a black box in both themes; "Showing page N of M" is announced; boxes have short names with one visible keyboard hint; a page that fails is announced with the button that shows it again; every listed box has a Select button (44 px) that moves focus to the Selected Box controls; Escape stops a box being drawn and lets go of the selected box.
- Measured (review script `prepare-compare.ts`, synthetic A4 scans, 20 pages): counting pages cost 18 ms a page on average (162 ms at most), so one parse less per page saves about that; drawing a page is still about 4.6 s a page (before 4627 ms, after 4619 ms mean, 3966 to 5503 ms) on this machine, every page well inside its 30 s.
- Third round tests: services 139 files, 2508 passed (redaction 32, reconciliation 33 with the new drawing case, access ratchet green with the baseline unchanged: the shared erasure helpers stay module-local); adapters renderer 15; core 153; db 47 passed and 1 skipped (the live-database test), with 0102 applied over its earlier draft and run twice; web 260 files, 2836 passed (editor 19). Break-to-red, each restored from a cp backup: not naming the drawing on its row first (4 tests red), counting a restored row without a drawing as matching (red), not removing older versions' boxes (red), dropping one upgrade statement from 0102 (red), and in the editor dropping the version check, the release on close and the decoded-page limit (red).

### 2026-10-29, S23 live follow-up: safe copy page drawing fails in production; readiness log noise

- Owner test on production (a 1.8 MB PNG, one page): opening the Safe Copy editor succeeded (page counted), but drawing the page failed every time with reason `render_unreadable` (audit events at 08:08 to 08:09 UTC). The renderer's own error text was discarded, so the cause could not be read; it does not reproduce locally (canvas decode and JPEG encode work on Node 22; production runs Node 24).
- Root cause (found by the owner's own browser reproduction): the preview route answered `501 redacted rendition not available: image preview render failed: Cannot find module '@napi-rs/canvas'`. `@napi-rs/canvas` and `libheif-js` were declared only by `@visastack/adapters`, while `next.config.mjs` marks them external (loaded from the web app's node_modules at run time). In this pnpm workspace they are not reachable from `apps/web`, so the deployed functions could not load them: image and PDF previews, Safe Copy page drawing and, most likely, HEIC conversion failed in production. `sharp`, declared by the web app too, worked. This was not caught because no deploy smoke check renders a preview.
- Fix: both packages are now direct dependencies of `@visastack/web` (same versions). New guard `apps/web/src/lib/server-external-packages.test.ts`: every package in `serverExternalPackages` (except the canvas platform builds, which come as its optional dependencies) must be a direct dependency of the web app; seen red with the two removed, green with the fix.
- The preview route no longer returns the renderer's detail text (server paths, library versions) to the browser: a 501 says "This file cannot be previewed here." (test). The Safe Copy service logs `[safe-copy] <step> failed: <reason>` (reason code only, never the renderer detail, matching the existing render-failure rule).
- Also fixed: `loadAiDataRuleSetting` read the AI data setting inside a transaction, which the readiness probe's HTTP database client refuses ("No transactions support in neon-http driver"), so every readiness call logged an error and read the setting as off. It now checks the table with `to_regclass` and reads without a transaction. New test with a transaction-refusing client, seen red with the old code and green with the fix.

### 2026-10-29, live fixes after #340: Safe Copy storage keys; confirmation page asks for the address again

- Safe Copy: after #340 the editor drew pages and saved boxes, but preparing each page failed (owner retry, about 09:26 to 09:27 UTC). Server log: `invalid opaque object key` from the R2 adapter's `putObject`. The stored safe-copy pages used keys `safe-copy/<uuid>`; every storage adapter accepts only opaque keys (`^[A-Za-z0-9_-]{1,128}$`). The tests' fake storage accepted any key, so this was not caught. Fix: keys are `safe-copy-<uuid>`; the opaque-key rule is now written once as `OPAQUE_OBJECT_KEY` / `isOpaqueObjectKey` in `packages/services/src/storage.ts`, and the Safe Copy tests' fake storage enforces it (14 tests went red with the old slash key, green with the fix).
- Sign-up: the owner reported that someone did not receive the confirmation link and that, after "check your inbox", the page shows an email box to type the address again. Evidence (read-only, 29 Oct): the only sign-up that day (09:31:23 UTC) was confirmed 30 seconds later, no account is unconfirmed, and Neon Auth sends through Resend SMTP from `noreply@vs.obsidianglobal.studio` with confirmation required. So the email was delivered; the reported "no link" person has no account (their sign-up never completed, or it was the same person). The page itself was the defect: it did not know the address it had just sent to. Fix: after sign-up (and after a sign-in that needs confirmation, and after a resend), the address is remembered for 30 minutes in a signed, httpOnly cookie scoped to `/auth` (`apps/web/src/lib/pending-confirmation.ts`, key derived from the sign-in cookie secret). The page then says "We sent a confirmation link to s•••@domain", offers Send the Link Again with one tap (no typing), and keeps another address behind "Use a Different Email". A forged or expired cookie is ignored and the page asks for the address as before. Rate limits are unchanged. Tests: signing, tampering, expiry, masking, cookie options, the actions (remember, one-tap resend, typed address wins, forged cookie sends nothing) and the page.
- Open: no deploy smoke check renders a document preview or prepares a Safe Copy, so both production failures today were found by the owner. A signed-in deploy check that opens one preview is the follow-up.

### 2026-10-29, S17: recurring invoices, reminders, overdue handling, reactivation

- What: ADR 0020 Phase 2 (amendment of 29 Oct, decisions 1 to 9, plus two safer rules). A daily job `process-billing-cycle` (06:15 UTC, cron 21; `billing-cycle.ts`) (A) makes one invoice per agency per plan period, only for the period running now and never one that started before migration 0103 ran (`billing_settings.invoicing_starts_at`), ref `INV-<8 hex of the organization id>-<YYYYMMDD in Bangladesh>`; (B) queues reminders to owners and admins 3 days before, on, and 3 and 7 days after the due date, each stage once, only the stage reached; (C) only when the owner switches it on, moves Active to Grace and then Suspended by days after the due date, and always returns a status VisaStack set to Active once nothing is overdue. `applyInvoiceCollection` ends a VisaStack Grace or Suspended in the same transaction when a new recording leaves nothing overdue (`reactivated` on the outcome) and cancels a paid invoice's queued reminders; voiding cancels them too. A status a person set is never changed: not lifted when paid, a person's Grace is never escalated, and a person's Active covers invoices already overdue at that moment. Billing notices (`INVOICE_ISSUED`, `INVOICE_REMINDER`, `BILLING_STATUS_CHANGED`) go to owners and admins, checked again at send time, and carry the invoice ref and due day, never an amount. Billing Rules page `/app/admin/billing` (platform owner only, new action `BILLING_SETTINGS_MANAGE` held by no other role, fresh sign-in check, audited), with a count of agencies switching on would move today and a confirmation box. The admin organization page labels automatic history rows "VisaStack (automatic)". Runbook: `docs/operations/billing-cycle.md`.
- Migration 0103 (journal idx 101, snapshot `meta/0101_snapshot.json`): `billing_status_cause` enum, `billing_settings` (one row, standard values), `billing_status_history.actor_account_id` nullable plus `cause` (default MANUAL) and a check that a row with no person has cause NONPAYMENT and a reason starting `system:`, partial unique index `invoices_org_plan_period_unique` (not VOID), `invoices_open_due_idx`, `billing_status_history_latest_idx`. Re-runnable statement by statement (tested twice on a database built to 0102). Before 0103 every existing billing action works (history written and read through the original columns), the job reports `available: false`, Billing Rules says not available. Before running it, the duplicate check in the runbook must return no rows.
- Tests: services 17 files, 457 passed (new `billing-cycle.test.ts` 24: no duplicate on reruns and two runs at once, no back-billing, overlap with a hand-made invoice, who is not billed, work limit, reminders each stage once with daily reruns, skipped days, paid invoice, send-time role check, off changes nothing even with day counts saved, Grace at 7 and Suspended at 30, straight to Suspended, reactivation on full payment online and by admin, rollback undoes both, a person's suspension and Grace never changed, traveller documents, cases and the agency's granted read identical before and after suspension, guard that only billing, entitlement enforcement and the billing run read billing accounts, the pre-0103 database); db 4 files, 29 passed (new migration test 2, drift test green); web 250 files, 2631 passed (route 3, Billing Rules action 5 and page 3, settings card 1). Lint and typecheck green; access ratchet green with the baseline unchanged (reactivation's audit and notice writes are module-private in `invoice-ledger.ts`).
- Existing tests changed in setup only: `billing.test.ts` (list order) and `agency-invoices.test.ts` (receipts) opened two invoices for the same plan and period start, which is now refused; they now use distinct periods, assertions unchanged, and the list test also asserts the refusal. `email-design.test.ts` lists the three new email kinds. Pinning tests added first (phase 0).
- Break-to-red proofs, each restored from a cp backup and green again: (1) removing both the overlap check and the unique index made a rerun create a second invoice (removing only one layer stays green: each alone prevents it); (2) dropping the cause check in reactivation, and separately in the daily run's return to Active, lifted a person's suspension; (3) dropping the "nothing overdue" check reactivated on a partial payment; (4) ignoring the On/Off switch moved an agency while off (this first stayed green because the test had no day counts saved; the test now saves them).
- Deviations from the approved plan, both the safer option: the job never escalates a Grace a person set, and a person's Active covers invoices already overdue (the plan said Grace to Suspended from any Grace); reactivation's audit and notice writes live privately in `invoice-ledger.ts` rather than an exported helper (the access ratchet). Account export is covered by the read-only guard, not run before and after.
- Owner decision needed before switching automatic handling on (O13, ADR amendment point 7): while an agency is Suspended, a traveller who shares records with it cannot add new files (`checkStorageEntitlement`, unchanged by S17). Nothing is hidden or deleted.
- Not verified: migration 0103 not applied anywhere but in-memory databases; no real agency on a priced plan; concurrency only on PGlite, not Postgres; the 21st cron is assumed to fit the plan; emails not sent through the real provider; no screen check in a browser (build, start and Playwright left to the lead's guarded check); `/code-review` and `/security-review` not run by this helper.
- Round 3 (re-review, 9 items, and accessibility review, A1 to A7, all fixed): a payment always locks the agency's billing account (after the invoice, before any audit record) and decides from the locked status; invoice creation, by hand and by the run, is serialised per agency on that row (lock, then overlap check, then insert); reminders leave out agencies with no active owner or admin (logged once per run); the run's order is returns to Active, invoices, moves, reminders; Grace starts at 1 (validation, form, and the 0103 check `between 1 and 365`, edited in place because 0103 has run nowhere real); one standing mapper; a preview is shown politely in an `<output>`, focus moves to its box, and only a save with the box unticked is an error; organization history shows status names and plain reasons ("Invoice INV-x unpaid 14 days after its due date", "Paid in full", "No unpaid invoices", unknown ones as "Changed automatically by VisaStack"); day counts always carry their unit; the house fieldset and check styles; every pre-existing docs line restored, with updates appended.
- Round 3 tests: services 18 files, 473 passed (billing cycle 38); db 4 files, 29 passed; web 252 files, 2639 passed (billing history wording 3, Billing Rules form 3 with accessibility scans, action 7). Lint, typecheck and the em dash sweep green.
- Round 3 break-to-red proofs, each restored from a cp backup and green again: (1) reading the status before taking the lock turned the lock-order guard red (a race cannot be shown on PGlite, which runs one transaction at a time, so this one is a source-order guard); (2) the overlap check moved before the lock turned the same guard red, for the same reason; (3) keeping contactless agencies in the reminder candidates starved the reachable one under a limit of 1; (4) moves before invoices left a newly suspended agency without the invoice for the period that began that day; (5) Grace 0 accepted by the app turned the action test red, and by the database (`between 0`) turned the migration test red.
- Round 2 (code review max, 15 findings, plus 2 from the security review, all fixed): (1) a late invoice's due day is counted from the later of the period start and the moment it is made, so it is never born overdue (test: paid back to Active, the next period's late invoice keeps the agency Active); (2) admin invoices whose period overlaps a live one for the same plan are refused by the same overlap rule the run uses (`invoicePeriodOverlaps`), index kept as a second layer; (3) one lock order, invoice then billing account then audit chain: a payment locks the account only when it is Grace or Suspended, before its first audit record; checked by a source-order guard test because PGlite runs one transaction at a time; (4) Billing Rules saves a switch-on, or new day counts while on, only after a preview of exactly those values is confirmed, every reply keeps the typed values, and the box appears only next to a preview; (5) overdue means from the Bangladesh day after the due day everywhere (`isOverdue`); (6) run-made due dates are stored as UTC midnight of the Bangladesh day, so notices and pages agree (the admin page now formats due dates the same way); (7) each failure is logged once with step, organization and invoice; (8) returns to Active run first and each step has its own work limit; (9) a change by hand locks the account inside its transaction; (10) "due today" only on the due day; (11) the three billing kinds named on Email Delivery; (12) only written reminders count, and an agency without an owner or admin is logged once (`withoutContacts`); (13) one implementation of a VisaStack status change, private to `invoice-ledger.ts`, reached by the run through `applyOverdueStatusChange` with its job scope (ratchet baseline unchanged); (14) the cause column is read directly once migration 0103 is confirmed; (15) "cause column exists" is cached per handle (only a yes); (16) reading the rules and the preview take the owner's staff scope; (17) in-app billing notices, which were still listed for someone whose Owner or Admin role was removed, are now filtered at read time (list and unread count) by the send-time rule.
- Round 2 tests: services 18 files, 471 passed (billing cycle 36, 12 new); db 4 files, 29 passed; web 251 files, 2635 passed (Billing Rules action 7, form 2, page 3). Existing fixtures in `billing.test.ts`, `invoice-ledger.test.ts`, `agency-invoices.test.ts`, `payments.test.ts` and `billing-payment-characterization.test.ts` now open each invoice for its own 30-day period (overlaps are refused); assertions unchanged. Lint, typecheck and the em dash sweep green.
- Round 2 break-to-red proofs, each restored from a cp backup and green again: (1) due from the period start turned the late-invoice test red; (2) matching the exact period start only let the midnight admin invoice through; (4) accepting a ticked box without the previewed values saved blind Grace 0 / Suspend 1; (5) overdue by the exact instant moved an agency on its due day with Grace 0; (8) one shared budget left the return to Active undone; (9) reading the status outside the transaction let two changes at once both start from Active.

### 2026-10-30, S18: refunds, credits and accounting export

- What: ADR 0020 Phase 2 "Refunds and overpayments" and "Accounting export" (amendment of 30 Oct, decisions D1 to D6 and eight safer rules). `packages/services/src/refunds.ts`: `requestRefund` (transaction 1 writes the request REQUESTED under the source's lock, the gateway is called after the commit, transaction 2 writes SUBMITTED with the gateway's refund reference or FAILED on a clear refusal; an unclear answer stays REQUESTED and still counts against the limit), `retryRefund` (same refund id) and `cancelRefund` (only REQUESTED), `reconcileRefunds` inside the daily `process-payment-reconciliation` job and `checkRefundsNow` (Check Now), which confirm a refund and write the one negative REFUND ledger row through the new `applyInvoiceRefund` in `invoice-ledger.ts` (collected total and status recalculated, latest collected date and reference unchanged), `recordManualRefund` (a refund made outside VisaStack, confirmed with its ledger row in one transaction), `applyHeldPaymentCredit` (Apply to Next Invoice: one CREDIT row per held payment, keyed on the held payment and its own gateway key, the smaller of what is left and the invoice balance; S17 reactivation applies) and `getOrganizationRefundWork` for the admin page. `ledger-export.ts`: `exportLedgerMonth` (Bangladesh month by row creation time, 15 allowlisted columns, every cell quoted, formula characters after leading spaces defused with an apostrophe, exact unsigned amounts with IN or OUT, 20,000-row cap, audited). Refunded invoices are left out of overdue judgement and reminders (`invoiceNotRefundedSql` in `billing-standing.ts`, used by `overdueInvoices` and both reminder queries), their reminders are cancelled, and paying online or reporting a payment on them is refused. Payment attempt status `REFUNDED` is final in `settlePaymentAttempt`. `SslcommerzPaymentPort` gains `refund` and `queryRefund` (`RefundingPaymentPort`, `isRefundingPaymentPort`), the fake gateway models refunds. New platform actions `BILLING_REFUND_MANAGE` and `BILLING_LEDGER_EXPORT` (platform owner only). Notices `INVOICE_REFUNDED` and `INVOICE_CREDIT_APPLIED` go to agency owners and admins only (the S17 send-time and read-time checks), name the invoice and never an amount; email copy and Email Delivery labels added. Screens: the admin organization page's new "Refunds and Credits" card (Payments Needing a Check with Apply to Next Invoice, Refund and Record a Refund Made Outside VisaStack; Payments That Can Be Refunded; Refunds with Check Now, Send Again and Cancel This Refund), the Billing Rules page's "Accounting File" card with Download Ledger CSV (route `/app/admin/billing/ledger`, step-up, `private, no-store`, attachment), and the agency invoice card (Refunded, Partly Refunded, a Refunded fact, "Credit from an earlier payment", no Pay button or report form on a refunded invoice). VOCABULARY.md rows for Refund, Credit and Accounting File. Runbook `docs/operations/refunds-and-ledger-export.md`.
- Migration 0104 (journal idx 102, snapshot `meta/0102_snapshot.json`): `payment_attempt_status` gains `REFUNDED` (own statement), types `refund_status` and `refund_method`, table `refund_requests` (one source, amount, currency, reason, manual shape, sent-has-reference, confirmed-time and failed-code checks, unique idempotency key and unique provider refund reference), its guard trigger (no delete or truncate; money, source, method, key and requester fixed; final rows frozen; a gateway reference never replaced), and indexes `refund_requests_open_idx`, `refund_requests_payment_idx`, `refund_requests_attempt_idx`, `invoice_payments_created_idx`. Re-runnable statement by statement. Pre-check (must be 0): `select count(*) from invoice_payments where kind in ('REFUND', 'CREDIT')`. Runs only on the owner's word (O8).
- Separate fix, `/auth/reauth` production error: the root layout's signed-in check reached Neon Auth's session refresh, which tries to set a cookie while the page is drawn, and Next refuses. `/auth/reauth` is now a signed-in page for the request filter (`identity-selection.ts`), so its session cookie is renewed before the page is drawn and a visitor without a session goes to sign in (`next=` brings them back; the sign-in page itself stays public, so there is no loop). `isSignedIn` reads Next's read-only cookies refusal (by Next's fixed wording, directly or as a cause) as signed out without reporting it; every other failure is still reported. `session.ts`, the recency check and the `/app` filter are unchanged.
- Tests: services, every file: 141 files, 2569 passed (new `refunds.test.ts` 19: pure limits; refund limit with a request still on its way and after a cancel; two refunds for the same money at once, one through; no ledger row while REQUESTED, FAILED, SUBMITTED or processing, exactly one after the gateway confirms, none added by the daily job or Check Now again, retry with the same id; gateway cancellation is Not Completed; a repeated send is never sent twice; a payment typed in by hand refunds only outside VisaStack, recorded once, never in the future; refunded invoices out of overdue, payment and reports, shown as Refunded and Partly Refunded; notices to owners and admins naming the invoice, never an amount; held money credited once to the invoice due first, never also counted online, the rest refunded and the held payment closed as RECORDED; held money refunded in full closes as REFUNDED, no open invoice says so; mismatched held money never credited or sent to the gateway; a credit ends a suspension VisaStack set and never one a person set; owner only, step-up, forged scope and SUPPORT_ADMIN refused, another agency's money looks missing; CSV cells, quotes, newlines, every trigger character with and without leading spaces; 31 Oct 18:00 UTC is November; column allowlist, no traveller name or passport number; before 0104 not available, nothing crashes, the CSV still works; the lock order); db, every file: 15 files, 51 passed, 1 skipped as on main (new `refunds-credits-migration.test.ts` 2: twice on the database as production has it, the attempt status, every check and the guard trigger); adapters `payment.test.ts` 29 passed (4 new: exact "1500.00", `refund_trans_id` and `refe_id` sent, the same id again names the same refund, clear refusal versus unclear answer, refunded only for that refund with the Bangladesh time read, the store password never in a failure or the hook); core 15 files, 154 passed; web (`src/lib`, `src/app/app/admin`, `src/app/app/agency`, `src/app/api`, `src/app/auth`, `src/components`, `src/middleware*`) 258 files, 2711 passed (new: refund actions 6, ledger route 3, Billing Rules page 1, invoice card 2, invoice screens 1, signed-in 2, and the six refund forms in the accessibility scan). `pnpm run lint`, `rm -rf apps/web/.next && pnpm run typecheck` and `pnpm --filter @visastack/web build` green; the em dash sweep prints 0.
- Existing tests changed in setup only, assertions unchanged: the ledger truncate tests in `invoice-ledger.test.ts` and `invoice-payments-migration.test.ts` now also list `refund_requests` (it references the ledger, as `payment_receipts` already did); the "before 0096" test in `payments.test.ts` drops `refund_requests` before `payment_attempts`; the Billing Rules page test passes `{}` as page props; `email-design.test.ts` and `invoice-screens.test.ts` list the new email kinds and invoice states; the invoice card fixture has the two new view fields; `identity-selection.test.ts` lists `/auth/reauth` as signed-in and more `/auth` pages as public.
- Break-to-red proofs, each restored from a cp backup and green again: (1) dropping the in-flight statuses from the refund limit (only CONFIRMED counted) let a second refund above what was left through; (2) writing the REFUND ledger row at submission turned the "no ledger row until the gateway confirms" test red; (3) keying the credit on a fresh source with no gateway key and skipping the existing-credit check let two credits through (the test needs both layers gone, because the code check and the database keys each stop it alone); (4) removing the refund exclusion from `overdueInvoices` made the refunded invoices overdue again; (5) removing the formula prefix turned both CSV tests red; (6) removing the read-only cookies handling reported the error again, and removing `/auth/reauth` from the protected list turned the identity test red.
- Not verified: every SSLCOMMERZ refund detail (parameters, `refund_trans_id` idempotency, the meaning and timing of `cancelled`, partial-refund limits, sandbox behaviour), taken from search summaries because the documentation site was unreachable, and tested only against the fake gateway; live refund calls need a registered fixed outbound address (O18); Neon Auth's middleware behaviour on `/auth/reauth` (cookie renewal, the sign-in redirect) is reasoned from the code and unit tests, not seen in a browser or in production; concurrency is proved on PGlite (one transaction at a time), not on Neon; nothing has run in production; Playwright and smoke not run in this session (the lead runs the full guarded check).
- Deviations from the approved plan, each the safer option: refunds of held money write no ledger row (it was never counted; a negative row would make the invoice total wrong and could break the `0 <= collected` check), they close the held payment instead; only verified held money (already paid, cancelled invoice, risk flag, with a gateway payment id) can be credited or refunded through the gateway, mismatched held money only recorded as refunded outside VisaStack; one credit per held payment (the ledger's unique key), the remainder only refundable; the gateway is sent a fixed remark naming the invoice, never the reason staff typed; reminder cancellation for a refunded invoice runs in `refunds.ts` rather than inside `applyInvoiceRefund`, so the ledger function stays outside the access ratchet (baseline unchanged); `refund_requests` keeps its foreign keys to the ledger and attempts (two existing tests' setup changed, see above) rather than dropping them; staff screens say "the payment gateway's merchant panel" rather than naming the provider.
- Owner decisions: O8 word for 0104 ("migrate S18"); new O18 (fixed outbound addresses, a relay, or manual refunds only); D1 noted (platform owner only; a billing staff role later if wanted); D4 automatic credits from the billing run deferred.
- Round 2 (30 Oct, after the max code review and the security and accessibility review; security found nothing high or medium). Fixed: (1) **Send Again never frees the limit**: a "failed" answer to a resend keeps the request REQUESTED and counted, marked `retry_refused`, audited once, and staff are told to check the merchant panel; only a refusal on the first send is definite, and only when the reply is `APIConnect` DONE, `status` failed and no `refund_ref_id` (the adapter now treats a "failed" that names a refund as unclear). (2) **It Went Through** (`confirmUnsentRefund`: the panel's reference and day, confirmed with the one REFUND row in one transaction, step-up) and **It Did Not Go Through** (cancel) on every refund waiting to send; screen copy and runbook say the same. (3) Every action refreshes the page once it ran, whatever the answer; every reply carries a fresh idempotency key and, once a request was written, an empty form; a replay is worded by the earlier row's real status. (4) D2 inside `applyInvoiceCollection`: money on an invoice with any REFUND row is refused (`refunded_invoice`), so an online payment is held (`invoice_refunded`, verified) and a typed-in or reported one is shown why; one rule `invoiceHasRefundSql` behind `invoiceHasRefund` and `invoiceNotRefundedSql`. (5) The payment port is never made unguarded (`apps/web/src/lib/refund-gateway.ts`: configuration checked first, errors caught and reported, the page shows a plain line). (6) The agency card decides "refunded" from `refundedMinorUnits`, so a held payment cannot bring back the claim form; refunded invoices say Kept After Refunds and show no due date. (7) Switch `PAYMENT_REFUNDS_VIA_GATEWAY` (exactly "true", default off): while off only Record a Refund Made Outside VisaStack is offered, with one sentence; documented in the runbook, `current-platform.md` and O18. (8) The job route reads a crashed or all-unanswered refund check as 503; payments and refunds stop starting gateway calls after 40 seconds in total and report `leftForLater`. (9) A confirmed refund the ledger refuses keeps SUBMITTED with reason code `ledger_refused` (allowed by the guard trigger and checks on an open row), `last_checked_at`, one `INVOICE_REFUND_NEEDS_CHECK` audit, Needs a Check on the card, and such rows are asked about last. (10) A refund day may not be before the payment's Bangladesh day (or the request day for It Went Through), nor in the future. (11) The CSV starts with a UTF-8 byte-order mark. (12) Check Now says how many could not be asked, with plural-aware wording. (13) The admin card lists at most 25 payments that can still give something back, newest first, says so when there are more, and draws each form (and its key) only when its disclosure is opened. (14) One `agencyCode` helper in `billing-standing.ts` for invoice references and the CSV. Accessibility: typed values come back with every reply and the fields are drawn again from them; a card-level polite output reports every result and focus moves to the refund's new line (or the output) after the page is drawn again, even when the row with the form is gone; the amount starts empty with a formatted hint; It Did Not Go Through focuses and links its error; the month field has a hint and the refusal is linked and focused; the card is Monthly Accounting File with Download Accounting File (CSV); recorded refunds show the day refunded and the day recorded; disclosure titles name the invoice. VOCABULARY.md rows appended.
- Round 2 tests: services, every file: 141 files, 2576 passed (`refunds.test.ts` 26, 7 new: resend refusal keeps the amount blocked; It Went Through once, with reference and day, never before the request day or in the future, step-up; an online payment on a refunded invoice is held and a hand recording refused; needs-a-check is durable, audited once and never starves the batch; a manual refund day never before the payment day; at most 25 listed, newest first, with `more`; the time budget stops new gateway calls and counts what is left; plus the byte-order mark); db 15 files, 51 passed, 1 skipped as on main; adapters 29; core 154; web dirs 260 files, 2730 passed (new `refund-gateway.test.ts` 4, `refund-panel.test.tsx` 5, refund actions 10, invoice card 15, job route 6, Billing Rules page, and the It Went Through and It Did Not Go Through forms in the accessibility scan). Lint, `rm -rf apps/web/.next && pnpm run typecheck` and `pnpm --filter @visastack/web build` green; the em dash sweep prints 0.
- Round 2 break-to-red proofs, each restored from a cp backup and green again: (1) letting a resend refusal through to FAILED turned the "keeps the amount blocked" test red; (2) skipping the ledger write in It Went Through turned its test red; (4) skipping the refund check in `applyInvoiceCollection` counted the late online payment and turned the "holds an online payment" test red; (5) making the payment port without the configuration check and without the catch turned two `refund-gateway.test.ts` tests red; (6) deciding "refunded" from the state brought back the report form and turned the new invoice card test red; (7) ignoring the switch turned the "off unless exactly true" test red.
- Round 2 notes: the job route does not read "refunds not available yet" (before 0104) as a failure, so the daily payment check stays green until the owner runs 0104; the lazy disclosures keep the form props in the page data but draw no form and make no key until opened; refund forms need script (they report to the card), as the rest of the admin page's buttons do.
- Round 3 (30 Oct, re-review of round 2). Fixed: (1) one panel refund is counted once: a refund reference is checked (trimmed, any case) against the agency's gateway refund references and the references of refunds recorded outside VisaStack in It Went Through, the manual record, the gateway's answer to a send (left waiting) and the daily confirmation (`duplicate_reference`, Needs a Check, not counted), refused as "That refund reference is already recorded for another refund."; (2) the card-level output and focus now also report a result that is not a success but belongs to a refund line (a full-amount refund not confirmed), with the form keeping only plain form problems; (3) every move to SUBMITTED or CONFIRMED clears the reason code, Send Again is refused on the server after a refused resend, and a resend takes a 30-second lease on the request under its lock so a double click reaches the gateway once (the first send's unclear outcome no longer touches that lease); (4) payments get 25 seconds and refunds 15 of their own; a refund check that ran out of time before asking about any refund is logged and answers 503; (5) the lists are worked out in SQL, one page of 25 each, newest first, with Older Payments, Newer Payments and Find Payments by Invoice Reference, and the note names the list that was cut; (6) It Went Through needs the amount the panel shows and refuses a different one with the plain instruction; (7) a unique violation (23505) in It Went Through or the manual record reads as the plain refusal; (8) staff recording a payment on a refunded invoice get their own message; (9) the budget constants sit above `triggerPaymentReconciliation`'s comment; (10) the actions use the exported `RETRY_REFUSED_CODE`, and the page builds the payment port once (`refundPorts`).
- Round 3 tests: services, every file: 141 files, 2581 passed (`refunds.test.ts` 31, 5 new: one panel refund counted once in either order and on the gateway's confirmation; It Went Through refuses a different panel amount; Send Again refused after a refused resend, a double click sends once, the mark cleared on confirmation; a unique violation reads as the plain refusal; a slow gateway leaves refunds for the next run; the paging test now reaches payments 26 and 27 and finds one by invoice reference); db 15 files, 51 passed, 1 skipped as on main; adapters 29; core 154; web dirs 261 files, 2733 passed (new `refund-feedback.behaviour.test.tsx` 2: a full-amount unconfirmed refund and a held refund recorded in full are still reported and focused after their row is gone; panel paging, `refundPorts`, the job route's out-of-time 503). Lint, typecheck after `rm -rf apps/web/.next`, `pnpm --filter @visastack/web build` green; the em dash sweep prints 0.
- Round 3 break-to-red proofs, each restored from a cp backup and green again: (1) the reference check answering "not taken" turned the "never lets one panel refund reach the ledger twice" test red; (3) not refusing a resend after a refused one turned the Send Again test red (a first attempt at this break did not apply because of indentation and was redone); (6) accepting any panel amount turned the It Went Through amount test red.

### 2026-10-30, S21: AI connector suggestion tools

Built locally on branch s21-wip (from main aaa29e34). Not merged, not live. ADR 0021 amendment of 30 Oct 2026; operations note `docs/operations/ai-suggestion-tools.md`.

- **What was built:**
  - Three suggestion tools beside the five read tools: `suggest_profile_update` (one profile detail, about the profile itself or about one listed document), `save_draft` (title and plain text, optionally for one case) and `add_reminder` (a task with a due date on one of the person's own open cases).
  - They work only while the person has ticked "Suggest Changes" for that connection and the platform owner has turned on "AI App Suggestions" in the new Admin, Settings, AI Features page (off by default).
  - Every write goes through the AI gate's separate write gateway: a second `PROPOSE_EDIT` proof from the access gate (owner only, `ai_connection` purpose), the person's processing consent, the field rules (granted section only; never RESTRICTED, special-category or biometric details; a document number only with Full Document Numbers; one refusal message for all of them), and the daily limits, charged last inside a savepoint.
  - Suggestions are zero-cost connector runs with one pending proposal, labelled "Suggested by <app> (<address>)". They are kept out of AI counts, spend, attempt limits, "accept all clear details" and the reading stage, and they never stop the automatic reading of a file. Approving one saves it as confirmed by the person, entered by hand, with no source document.
  - Drafts are on the Sharing page ("Drafts from AI Apps": Show, Copy, Delete). Profile suggestions are on My Profile ("Suggestions from AI Apps"). Reminders show "Added by <app>" on the case and are private to the person.
  - The reusable AI feature framework: registry in core, `platform_ai_feature_settings`, `getAiFeatureState` (admin switch, migration present, FREE tier entitlement, smaller limit wins).
- **Migration:** 0105_ai_suggestions (journal idx 103, snapshot 0103):
  - three new tables (`ai_drafts`, `ai_task_origins`, `platform_ai_feature_settings`);
  - a document becomes optional on a suggestion and its run only for connector runs (a CHECK on runs, a trigger on suggestions);
  - no existing table gains a column.
  - It is re-runnable and was tested twice on the previous head. Code tolerates it missing: the tools say "not available yet", the consent box is shown turned off, the AI Features page says not available yet.
- **Owner decisions (30 Oct 2026), recorded in the owner actions file:**
  - 15 writes a day per person across all their apps and all three tools, and 15 per connection. This replaces the plan's 20 per connection and 50 per account.
  - Tools for person-requested changes only ("Use only when the person explicitly asks for this change." in every tool description and the server instruction; audit `requestedBy: person_via_app`).
  - AI-added reminders are private to the person. This replaces the plan's "agencies see AI-added reminders on shared cases".
  - AI App Suggestions is off until the owner turns it on.
- **Deviations, and why:**
  - A reminder always needs a case: ADR's "or record" form is not built, because tasks belong to a case.
  - The private mark on reminders lives in `ai_task_origins` beside `mission_tasks`, not in a column on it. A column would be listed by every existing Drizzle read and write of tasks, which would fail before the migration. A column pointing at the connection would also lose the mark when the connection is removed.
  - Drafts live in `ai_drafts`, not `generated_outputs`. A draft is not a grounded output.
  - `save_draft` takes a title instead of the ADR's `kind`.
  - Raising `RATE_LIMITS` alone does not raise the limit: the plan tier's 15 binds. The break-to-red proof therefore targets the plan limit.
- **Tests (final run):**
  - lint: green after formatting fixes;
  - typecheck: green;
  - core: all green;
  - db: migration, schema drift and status, all green;
  - services: 29 files, 651 tests. The only failure was the reconciliation test's pre-0100 simulation, which now also drops the two S21 tables that reference AI connections; it is green on rerun. A further 6 export, signals and retention files, 91 tests, are green.
  - web: 341 files, 3456 tests. The only failure was the reading-source label list, now naming the fourth source; it is green on rerun.
  - `pnpm --filter @visastack/web build` succeeded.
  - New tests include `suggestion-tools.test.ts` (21, end to end through the real gate), `tool-guard.test.ts`, `ai-feature-settings.test.ts`, `ai-suggestions.test.ts`, the migration test, an automatic-reading test, and web tests for the AI Features page and action, Drafts from AI Apps, Suggestions from AI Apps, "Added by", the consent box turned off and on, and tools/list and the server instruction.
- **Break-to-red proofs.** Each was restored from a cp backup and is green again:
  1. writing a fact in the suggestion writer turned "no fact until the person approves" red;
  2. dropping the layer checks turned the refused-details test red;
  3. raising the FREE tier's limit turned both daily-limit tests red;
  4. caching the connection's scope in the gate turned "stops on the very next call after Change Access" red;
  5. registering add_reminder with destructiveHint true turned the guard red;
  6. ignoring the admin switch turned both switch tests red;
  7. letting an app's suggestion count as a reading turned the automatic-reading test red;
  8. showing AI reminders to agencies turned the tenant test red;
  9. removing the bulk-accept exclusion turned the bulk test red (after the test was made to look clear);
  10. removing the trigger from the migration turned the migration test red.
- **Not verified:**
  - real Claude and ChatGPT behaviour (their confirmation before a non-read-only call, and how long they keep an older tool list);
  - next start and Playwright (the lead runs those);
  - production, which waits for O8 and the owner's switch.
- **Follow-ups:**
  - Drafts are not in the account export yet. Mission tasks and AI connections are not either.
  - A draft the person deleted after a backup point comes back if that backup is restored, until reconciliation replays draft deletions.
  - An output the person makes themselves can list their own open tasks, including AI reminders, as it does for any task.
  - S28 wires the other AI features into the framework.

Round 2, 30 Oct 2026 (max code review, security review and accessibility review at a9dddf8e):

- **Security S1 fixed:** a crafted link could pre-tick Suggest Changes while the feature was off, with no way to untick it. Now:
  - the consent screen never pre-ticks it from a link, and nothing hidden carries it;
  - the service stores `suggest_changes` on a new connection only while AI App Suggestions works for the person;
  - on Change Access a stored choice stays and can be unticked, but while the feature is off it can never be ticked on.
- **Code review items:**
  1. A catalogue detail nobody has saved yet is registered when first suggested, as the profile editor does.
  2. Home and the traveller overview count an AI app's profile suggestions apart, linking to My Profile.
  3. My Profile decrypts protected values before comparing.
  4. Consent wording and the server instruction now say reminders are added at once (with their usual notices).
  5. Lock order:
     - Before: a reminder appended its case-history audit record (audit chain lock) before the limit rows were charged, while drafts and suggestions charged the rows first. Two concurrent writes from one person could therefore deadlock.
     - Now: every write takes the connection's limit row, then the account's limit row, then the audit chain.
     - A static guard checks the order.
  6. Insights no longer show an app's claim as read from a file. The full list of readers of suggestions and runs is in ADR 0021's amendment.
  7. An empty optional reference counts as none.
  8. A waiting identical suggestion is found before the limit check.
  9. The account export includes tasks, AI task origins, drafts and AI connections, and lists no new gaps.
  10. Deleting the last draft keeps the section ("No drafts from AI apps.", confirmation read out at the heading).
  11. The Change Access sentence follows the live box.
  12. My Profile filters app suggestions in the database.
  13. The migration is probed once per call, with a positive result cached per database handle.
  - Cleanups:
    - the finished case states are shared;
    - there is one hidden-character filter, in core;
    - agency task reads go through one condition, with a guard listing every module that uses `mission_tasks`.
- **Accessibility and wording:**
  - My Profile keeps decisions in a polite message and moves focus to the section heading.
  - Draft text is a named, focusable region.
  - Copying again is announced again.
  - Copy failure says "Choose Show Draft, select the text and copy it."
  - The admin box reads "On for Everyone", and typed values come back after the fresh sign-in check with "Your change was not saved yet."
  - "Added by" shows the app's name and web address.
- **Owner decisions recorded:**
  - Drafts stay after a case's retention purge.
  - Known issue: a restore from backup brings back drafts the person deleted after the backup point, until reconciliation replays draft deletions (not built).
- **Break-to-red proofs this round** (each restored from a cp backup):
  - (S1) restoring the hidden input turned both consent-box tests red;
  - (2) counting profile suggestions as readings turned the Home test red;
  - (5) appending the audit record before the charge turned the lock-order guard red;
  - (6) dropping the insights filter turned the insights test red;
  - (8) checking the limit before the waiting suggestion turned the resend test red.

Round 3, 30 Oct 2026 (re-review of a9dddf8e..9a60875e, 10 items):

1. **Security:** Change Access read Suggest Changes from the address after its sign-in check. Now it starts from the stored scope only, the address never carries it, and the box is enabled only when stored or when the feature works. Test: a crafted `choice_suggest=1` link ticks nothing (section and page level).
2. Two concurrent first suggestions of a new detail could fail on the registry's unique key. `registerFieldDefinition` now inserts with "do nothing on conflict" and reads the winning row. Test: a row inserted between the check and the insert.
3. The cheap read-only limit check is back, after the waiting-duplicate check and before listing documents or resolving a case. The atomic charge stays last. Test: an app at its cap sends no query to `documents`, `document_versions` or `missions`; the resend test stays green.
4. **Security:** formula injection in the account CSV. New pure helper `csvCell` in `@visastack/core` for every cell, headers included. Test: a draft title `=HYPERLINK(...)` and other formula cells across every table. Since merging main (S18, d62b880c), the ledger CSV's `ledgerCsvCell` uses the same helper.
5. **Security:** AI Features retry values came from the address. Now a signed, httpOnly, account-bound, 15-minute cookie scoped to `/app/admin/ai` (key derived from `NEON_AUTH_COOKIE_SECRET` with a fixed label), cleared on a successful save. Tests: a crafted link shows nothing; a valid cookie restores; another account's, a forged or an expired cookie shows nothing; a save clears it.
6. The agency task guard now scans every folder of `packages/services/src` and finds the table by identifier (import, rename, destructuring, local name, element access, relational query, raw SQL). `export-csv.ts` is listed: it names `mission_tasks.csv` and reads nothing.
7. `getAiFeatureState` lost its `ready` option; the per-handle cache makes the second probe free.
8. The `READY` cache sits above the documented `aiSuggestionsAvailable`, with the cache behaviour in the comment.
9. The account export reads all of a person's tasks in one query and their origins in one more.
10. One registry shape for every writer: `fieldRegistryInput` / `savableFieldDefinition` in `@visastack/core/catalogue`, used by services, `field-registry.ts`, `master-profile.ts` and the two profile save actions.

- **Break-to-red proofs this round** (each restored from a cp backup):
  - (1) reading the link's choice again turned the crafted-link test red;
  - (2) dropping "do nothing on conflict" failed the race test with a duplicate-key error;
  - (3) removing the cheap check turned the "no expensive work" test red;
  - (4) the old quoting-only escape turned the `=HYPERLINK` test red;
  - (5) dropping the account check and the clear on save turned three tests red;
  - (6) an unfiltered read in `access/` turned the guard red, both unlisted and listed as agency-facing.

Merge with main after S18 (d62b880c), 30 Oct 2026:

- S18 took migration number 0104 (`0104_refunds_credits`, journal idx 102). S21's migration is now `0105_ai_suggestions` (journal idx 103, `meta/0103_snapshot.json`, prevId = S18's 0102 snapshot id, fresh id, generated by drizzle-kit from the merged schema). A second `drizzle-kit generate` finds no schema changes. Every S21 reference to 0104 now says 0105; S18's references are unchanged.
- Docs conflicts were resolved by taking main's file and appending S21's own blocks. `AI_FEATURES_MANAGE` and S18's `BILLING_REFUND_MANAGE` and `BILLING_LEDGER_EXPORT` are all kept.
- O8 for the owner is now migration 0105, to run after S18's 0104.
- Verification after the merge, run once as one job: lint (green after formatting the two generated migration meta files), typecheck after removing apps/web/.next, core, db, adapters, services (146 files, 2641 tests), web (367 files, 3689 tests), `pnpm --filter @visastack/web build`, and the em dash sweep against origin/main (0) all passed. Not run here: next start and Playwright.

### 2026-10-30, S30: billing screens polish and downloadable documents

- Built on branch `s30-wip` from main `d62b880c`, merged with main `6f270a97` (S21). No migration, no new environment variable. Not merged, not live.
- Downloadable Invoice and Receipt: one A4 PDF each, made on demand and never stored (`packages/services/src/billing-documents.ts` builds the words, `packages/adapters/src/billing-document-pdf.ts` draws them with pdf-lib 1.17.1 and @pdf-lib/fontkit 1.1.1, Inter embedded). Routes `/app/agency/{orgId}/plan/invoices/{invoiceId}/pdf`, `/app/agency/{orgId}/plan/invoices/receipts/{receiptId}/pdf` (agency owners and admins) and `/app/admin/organizations/{orgId}/invoices/{invoiceId}/pdf` (platform owner); every refusal is the same 404. Runbook: `docs/operations/billing-documents.md`.
- Screens: Payment Received centred with "BDT 2,500.00"; Grace and Suspended notice on Plan and Usage, Invoices and the agency home (members get a short version); the scheduled plan change on the agency Plan page; Overdue and Due Today markers; no Pay Online while a payment report waits; plain meter names; one money format (`formatMoney`) and one billing date style (`formatBillingDate`, "8 Nov 2026") from @visastack/core; Grace and Open as the names; admin amounts typed as "2,500.00"; status choices in plain labels; title case for End Subscription, Cancel Downgrade, Cancel Invoice; the phone tab "Organizations" shows whole; a compact agency header on phones.
- Refusals: plan and billing refusals carry `reason` (`billing_suspended`, `limit_reached`) with a plain next step; a traveller adding a file is told only "Adding files to this record is paused right now. Try again later or contact your agency." The substring match for suspended billing in the upload action is gone; the substring matches for the traveller, account and platform storage limits (uploads.ts) remain, out of scope.
- Emails: every billing notice opens with the agency's name; title-case in-app titles; the 7-day overdue reminder has its own subject, heading and, when automatic handling is on, the day adding would pause; each status change has its own email heading. Still no amount in any email.
- Money: plans refuse a price whose currency is not a real ISO 4217 code and store codes in capitals; `formatPrice` (visa fees) never throws; services' `formatAmountForCurrency` and `currencyDecimals` now use the core module. Left as they are (not billing): the visa fee helpers in `apps/web/src/app/app/admin/packs`, the costs line on the admin overview (`lib/analytics-format.ts`), and the strict gateway text parser `parseDecimalToMinorUnits`.
- Organizations have no reference code of their own; the documents show the existing short Agency Code (first 8 hex of the id, as on invoice references and the accounting file).
- Round 2 proofs (each restored from a cp backup and green again): returning the raw seat refusal to an invitee, dropping the movable and counted checks from `automaticSuspensionDay`, letting the notice ignore who set the status, dropping the minus one day from `formatBillingPeriod`, and reading a typed payment in BDT instead of the stored invoice currency each turned their test red.
- Round 2 PDF loading: the PDF routes' own files stay about 12.4 KB; pdf-lib (403 KB), fontkit (146 KB) and the fonts (84 KB) now sit in separate chunks loaded only when a document is drawn, and the largest shared server chunks dropped from about 2.48 MB and 2.36 MB to about 1.60 MB.
- Proofs (each restored from a cp backup and green again): removing the reader check in `getInvoiceDocument` turned "refuses a member, a stranger, another agency and an unknown id alike" red; dropping the typed reason from the suspended seat refusal turned "blocks addMembership once billing is suspended" red.
- Verification: lint, typecheck (after removing apps/web/.next), core 184, db 53 (1 skipped), adapters 512 (2 skipped), services 2655, web 3708, `pnpm --filter @visastack/web build`, `pnpm audit --prod --audit-level high` (exit 0; 4 moderate, all dev tooling: esbuild, vite, @vitest/mocker) and the em dash sweep (0) passed.
- Verification, round 2: lint, typecheck (after removing apps/web/.next), core 185, db 53 (1 skipped), adapters 514 (2 skipped), services 2661, web 3715, `pnpm --filter @visastack/web build`, `pnpm audit --prod --audit-level high` (exit 0; 4 moderate, all dev tooling: esbuild, vite, @vitest/mocker) and the em dash sweep (0) passed.
- Verification, round 3: lint, typecheck (after removing apps/web/.next), core 186, db 53 (1 skipped), adapters 515 (2 skipped), web 3722, `pnpm --filter @visastack/web build`, `pnpm audit --prod --audit-level high` (exit 0; 4 moderate, all dev tooling) and the em dash sweep (0) passed. Services first failed one test: the recorded-payment characterization test pinned the overpayment refusal without the new typed reason; its expectation now includes `reason: 'amount_over_balance'` with the same words, and the full services suite was run again: 2666 passed.
- Round 2 (30 Oct, after the code, security and accessibility reviews): an invitee accepting an invitation is told only "This agency cannot add new team members right now. Ask the person who invited you to contact VisaStack."; agency staff adding a file get "Adding files to this record is paused right now. Try again later." (no "contact your agency"); the 7-day reminder warns about a pause only when the run itself would make it (`automaticSuspensionDay`, built from the run's own `movableAutomatically` and `countedAutomatically`) and gives the real day count; the Grace and Suspended notice never claims an unpaid invoice when a person set the status or nothing is owed, shows Pay Invoice only while an invoice is owed, and has an h2 title (`getAgencyBillingNotice`); periods show their last day; Billed To lines wrap; PDF links have no `download` attribute; the Payment Reported note promises online payment only when it would be offered; one day rule (`daysPastDue` and `titleDate` use core); `parseAmountForCurrency` reads "2,500.00"; recorded payments are read in the stored invoice's currency (`amountText`), never a form field; the receipt join binds the invoice's agency; the PDF download addresses keep the strict document policy in the middleware; billing dates in the platform screens, toasts and the plan-change notice use the core formatter; one support address helper; admin amount fields point to their error and take focus.
- Round 3 (30 Oct): every stored invoice period end is now exclusive (the day after the last day), the same as the daily run's. The platform's Create Invoice form asks for the "Last Day of the Period" and the service stores the next Bangladesh day as UTC midnight, so a period reads back exactly as typed. The one admin-made invoice already in the pilot was saved with its typed last day as the end, so it now shows a period one day short; this is made-up pilot data and no data migration is run for it.
- Round 3: the Grace and Suspended notice uses the same overdue rule as the daily run. When VisaStack set the status for an unpaid invoice and nothing is overdue any more, the notice reads "Thank you, your payment is in. Your agency returns to Active at the next daily check." with no Pay Invoice. The pause day in the 7-day reminder now counts from the oldest overdue invoice the automatic handling counts, and is not shown when that day has already passed.
- Round 3: typed amounts for refunds, It Went Through and I Paid Another Way are read by the services in the stored payment's or invoice's own currency; the hidden currency fields are gone, so a changed form cannot pick the decimals. The forms only check the shape first (the platform's Record Payment does this before asking to confirm the session). Refusals carry typed reasons (`amount_invalid`, `amount_over_balance`, `currency_mismatch`, `currency_invalid`) that the forms map to the amount or currency field, marked invalid and focused, instead of comparing message text.
- Round 3: agency staff whose storage limit is reached are told "Your agency's storage is full. Remove files that are no longer needed, or ask VisaStack about a larger plan."; the paused-billing wording stays separate. A failed font load is no longer cached, so the next document request tries again.
- Round 3 downloads: the document policy is now `default-src 'none'; sandbox allow-downloads`. A throwaway Playwright script outside the repo served a receipt PDF with the final headers from a tiny local server and clicked a plain link: with `allow-downloads` and without it, Chromium 153 (headless) fired the download event and saved `VisaStack-Receipt-R-000041.pdf` starting with `%PDF-`. `chromium.launch()` with no options could not start (Playwright 1.61.1 looks for a headless shell build that is not installed here), so the check used the installed Chromium at /opt/pw-browsers/chromium with `--no-sandbox`.
- Round 3 proof (restored from a cp backup and green again): dropping the extra day in `periodEndAfterLastDay` turned "stores a typed last day as an exclusive end, so the period reads back as typed" red.
- Not verified: the PDFs in a real browser download on Vercel, next start and Playwright, the emails in real mail clients.

### 2026-10-30, OPS-1: lighter live checks and Render fallback

- Cause: on 30 Oct 2026 Vercel paused production (project prj_RZcDRy1odwehHuDqsiGwvVGC0epe, every request 402 DEPLOYMENT_DISABLED until 29 Nov 2026) for going over the Hobby plan's "Fluid Active CPU" fair-use limit; as reported to this package, the notice comes with a three-times allowance for 30 days. Most of the CPU came from our own post-merge workflows: in about 1.5 days, 29 Playwright Deploy Smoke runs (310 browser tests each), 28 Deploy Smoke runs and 10 live signed-in checks. While paused, none of the 21 Vercel scheduled jobs run.
- Built, light live checks: `playwright-smoke.yml` runs only the 8 tests tagged `@live` against production (home, sign-in, `/app` redirect, CSP on `/`, security headers on `/`, a real 404, readiness, phone-width layout). Pull requests still run all 310 tests (`pr-browser-checks.yml`, unchanged). The smoke and browser checks have no concurrency group, so every deployment keeps its own result and release record; the live signed-in check has no schedule and cancels only an older run of the same event kind. Check names unchanged. Guard: `scripts/live-checks.test.mjs`.
- Measured load per production deployment (counting proxy in front of the production image, locally): `@live` 33 app requests plus 70 static files, against 1,245 app requests plus 2,603 static files for the full 310 tests before; `scripts/smoke.mjs` 8 app requests (11 checks). The extra skipped Deploy Smoke run per deployment is Vercel's earlier pending status and never reaches the site.
- Built, Render fallback (off until the owner switches it on): `apps/web/Dockerfile` (Node 22 bookworm, standalone output only with `NEXT_OUTPUT=standalone`, sets `HOSTING_PLATFORM=render`), `.github/workflows/render-image.yml` (manual, main only; self-test and smoke on the image before publishing to GHCR), `.github/workflows/render-cron.yml` (the 21 jobs on the same schedules, gated on `CRON_HOST=render` and main, with a duplicate guard that skips every job when a live, unpaused Vercel serves `PUBLIC_SITE_URL`), `apps/web/src/lib/hosting.ts` (one production-site rule; the Render marker wins over a copied `VERCEL_ENV`; on Render a missing `NEXT_PUBLIC_APP_URL` makes readiness not ready with a plain reason). On Render, rate limits use only the last `x-forwarded-for` value and never `x-real-ip` or `cf-connecting-ip`; no value means one shared bucket. Runbook: `docs/operations/render-fallback.md`. Vercel behaviour is unchanged.
- Proofs: removing `--grep @live`, tagging two more describe blocks, adding a concurrency group to deploy-smoke, dropping the event name from the live check group, and changing one vercel.json schedule each turned the matching guard red (restored from cp backups). Making the client address trust headers off Render turned its test red. Image under a 512 MB limit: native self-test (sharp, canvas, HEIC decoder) passed, smoke 11/11, the 8 `@live` tests and the full 310 tests passed, about 171 MB in use idle. A build context check with a test `apps/web/.env.local` and `packages/db/.env` included only `.env.example`. The cron scripts were run against the image: right secret 200, wrong secret 403, unreachable 000 and a red run, duplicate guard skipping when an `x-vercel-id` header was present and running when absent.
- Not verified: no Render service exists yet; render.com could not be opened from the build machine, so Render facts come from search excerpts of its docs; that the free plan accepts a prebuilt image; that the last `x-forwarded-for` value on Render is the visitor's own (runbook step 7 checks it once); a real sign-in, upload, virus scan and job run on Render; whether Vercel Blob keeps working while the project is paused; the workflows have not run on GitHub.

### 2026-10-30, S20: AI connector original files

- **What was built (branch `s20-wip`, local, not merged, not live).** ADR 0021's "Original documents" extension: the read-only tool `get_document_file`, "Original Files" on the consent screen and Change Access (one row per document, Share This File, Safe Copy by default or Original), and the AI feature switch "AI App Original Files", off by default, 30 files a day per person. Decision record: ADR 0021, amendment of 30 Oct 2026 (S20).
- **Migration 0106 `ai_connection_documents`** (journal idx 104, `meta/0104_snapshot.json`): one row per ticked document and connection, `SAFE_COPY` or `ORIGINAL`, both links cascading, a trigger refusing another record's document. Re-runnable statement by statement (tested twice on the previous head); the SQL never names its own number, so renumbering to 0107 is mechanical. Until it runs nothing can be ticked and the tool answers "not available yet". Waits for the owner's word (owner action O8-S20).
- **Deviations from the handoff and ADR text.** (1) A child table instead of `document_ids` and `document_variants` columns: every AI call selects the whole `ai_connections` row, so new columns would fail before the migration. (2) 3 MB instead of 10 MB (decision O1): the route reads the whole answer and a hosted response is limited to about 4.5 MB; the 10 MB target is deferred until a streamed answer is verified on the host. (3) Protected types are never given, not even as a Safe Copy (O2). (4) A Safe Copy that is not ready yet stays the selectable default with a "Prepare a Safe Copy on the document's page" note, instead of being disabled as the plan said, so the screen never steers a person to the Original; the server defaults to a Safe Copy either way and never gives the original in its place.
- **Security properties, each with a test:** an unticked document, one ticked only by the same person's other app, and another person's document all get the same refusal; a crafted choice of another record's document is dropped and the trigger refuses it in the database; a passport stored earlier and a type an admin restricts after ticking are refused on the next call without reading storage; an Original over the limit is refused before a byte is read; an Original needs a fresh sign-in check to be chosen, and a one-minute standing proof only the gate can make; a stale Safe Copy after a new version is refused and neither version's original is read; a latest version still being scanned, a hash mismatch and a non PDF, PNG or JPEG file are refused; Turn Off gives 401 and unticking refuses the next call; the switch off refuses, keeps what was ticked and adds nothing new; only files given count against the daily limit; a too-large Safe Copy leaves no allowed access record and no count. The audit records `fileServed`, the way, the document id, the size and the type, never contents, file name, hash or key (the whole audit table is searched for the base64, the file's text, the stored name and the key).
- **Ticked files across the sign-in check** travel in a signed, httpOnly, 15-minute cookie bound to the account, record and form, scoped to the one page; never in the address (a test checks the return address carries none).
- **Break-to-red proofs** (each restored from a cp backup): dropping the connection filter, skipping the restricted-type check, removing the size pre-check, adding the file to the audit metadata, caching the ticked documents, flipping the default to Original, and falling back to the original when the Safe Copy is not ready each turned their test red. The first proof stayed green at first (the record filter still held for other people), so the test now also covers a document ticked only by the same person's second app, and then went red.
- **Not verified:** how Claude and ChatGPT handle an embedded PDF or image resource; the 3 MB limit, memory and a Neon storage read inside 10 s on the host; production, which waits for migration 0106 and the owner's switch. The Safe Copy hourly limit (30) is shared with the person's own downloads.
- **Review round 2 (30 Oct 2026).** Code review (10), security (1 low) and accessibility (1 major, 4 minor) findings fixed:
  - the saved file choice is always the latest, an empty one included; it is bound to the exact consent request and cleared on Allow and Do Not Allow;
  - clean versions being normalised or read again stay listed;
  - a refused Safe Copy no longer uses the hourly Safe Copy limit, which has its own answer;
  - file settings are built only for the file tool;
  - documents queued for erasure are hidden, refused when stored and answered as not chosen;
  - the access record says `ai_file`;
  - the larger limit is chosen by tool kind;
  - choices are written in one statement;
  - the migration's owner action is O8-S20;
  - originals without a recorded hash or size are never read;
  - disabled file controls are described by the off sentence, the two ways open only once a file is ticked, file errors mark each box, the not-ready note is linked from the box, and one sentence names both checks.
  - Break-to-red: saving only non-empty choices, ignoring the request binding, charging before readiness, and dropping the gate's erasure check each turned their test red, restored from cp backups.
- **Review round 3 (30 Oct 2026).** 10 items fixed:
  - a refused Safe Copy keeps its DENIED access record, written after the savepoint is undone;
  - the hourly Safe Copy limit is counted only for a ready copy, for downloads and AI apps alike;
  - a version still being read answers "not ready", and versions needing the person are not listed;
  - erasure uses the product's own rule plus queued jobs (held or failed jobs without a deletion attempt leave the file in place), and the per-document check refuses another record's document;
  - the two ways work without scripts;
  - missing storage settings answer "not available" without a server error;
  - actionable refusals come before a sign-in check;
  - comments sit above their own functions.
  - Break-to-red: dropping the outer DENIED record, listing NEEDS_ATTENTION, and counting before readiness each turned their test red, restored from cp backups.

### 2026-10-30, Anthropic 5.5 and editable AI drafts

Owner report: an Anthropic configuration on `claude-opus-5-5` failed Test Connection with `tool_choice: type "tool" and "any" are not supported for this model`, and the 13-case evaluation errored on every case (recall 0, "prompt injection NOT resisted" only because nothing ran). An earlier attempt used the display name "Claude 5.5" as the model and got a 404.

- Cause: both Anthropic adapters forced a tool call to get structured answers. Claude Opus 5.5, Claude Sonnet 5.5 and Claude Fable 5.1 refuse forced tool calls. `claude-opus-4-8` still accepted them, which is why it worked.
- Fix: JSON outputs (`output_config.format` with a closed `json_schema`) for all five reading tasks, sent and read by `anthropic-messages.ts`. Thinking blocks are skipped; a refusal, an empty answer, a cut-off answer and a non-JSON answer each fail closed as before. `max_tokens` is 16,000 because thinking counts against it. The saved reasoning effort is now sent to models that take it and is part of the cache key (OCR gained an optional `reasoningEffort` key part, so existing OCR keys are unchanged). Enum values are matched without regard to case. Prompt versions moved to `2026-10-30-v1`, so earlier cached readings are not reused for the new instructions.
- Guard: a test sends every task on Opus 5.5, Sonnet 5.5, Fable 5.1 and Opus 4.8 and fails if any request carries `tool_choice` or `tools`; restoring the forced call turned it red.
- AI Settings: drafts can be edited and deleted; other versions are copied with Edit as New Draft. Review findings fixed before push: deleting the last saved configuration is refused (it would re-enable the environment OpenAI path); Revoke Key revokes copies of the same key; a new key clears that draft's terms; a draft that a version which has run falls back to, or whose key was revoked, is not edited in place; the copy path takes the configuration lock; the forms no longer receive key ciphertext. Break-to-red proofs: removing the last-configuration check and skipping the copy sweep each turned their test red.
- Known limit, not changed: the adapters' 60-second timeout stays (the reading job route allows 60 seconds). A long document at high effort on a model that always thinks could time out; Anthropic still bills a call the app abandons. Lower effort is the dial.
- Not verified here: a live call to Anthropic (no key in this environment). The owner's Test Connection and Run Evaluation on a 5.5 model are the live check.
- CodeQL on the pull request (one high alert, "password hash with insufficient computational effort", `packages/db/src/audit.ts:31`): the delete audit record carried the masked key fingerprint, and the audit chain hashes every record's metadata. The record now holds only the provider and model; the test pins that exact metadata. CI on the commit before the fix: every required check passed.
- Accessibility review follow-up: each card's Test Connection, Run Evaluation, Activate, Revoke Key and Delete Draft buttons now name their configuration in the accessible name (`SubmitButton` label), and the Edit and Record Data Terms disclosures carry it as screen-reader text.

### 2026-10-30, AI Settings: model list

Owner request after #348: a model dropdown so a display name ("Claude 5.5") cannot be saved again.

- The Model field is a list per provider (`apps/web/src/lib/ai-models.ts`): Anthropic's current IDs from its models table (Claude Opus 5.5 first, recommended), and for OpenAI and Gemini only the IDs this platform already runs, so no ID is guessed. "Other Model ID" takes any other exact ID, so a new model needs no code change. A saved model that is not listed opens on "Other" with its ID filled in. Changing the provider on the create form restarts the list.
- The service refuses a model that is not an exact model ID (letters, digits and `. _ : @ -`, no spaces or slashes, at most 100 characters) on create and edit, with a plain message. Existing rows are not touched.
- Guards: every listed ID must pass the same rule and be unique per provider, and every configurable provider must have a list; adding a display name to the list turned that test red. Picker states (listed, unlisted) are covered by render and accessibility tests.
- Code review (high) before push, 8 findings, all fixed: React resets a form after every save, and the controlled provider and model lists did not follow the reset, so after a refused save the form could show one provider and send another model; both forms now resynchronise on reset (a jsdom test resets the form and checks what is shown is what is sent; removing the resync turned both cases red). The model rule is now provider-aware and lives once, in `packages/services/src/ai-model-id.ts` (another provider's family such as `claude-` under Gemini is refused; `:` and `@` are refused for Gemini, whose request path carries the ID); the browser pattern was dropped in favour of the server's plain message; the list test checks every listed ID against the service rule itself; the test fixture is shared (`ai-config-view.test-support.ts`).

### 2026-10-30, S29: plans admin, entitlement resolver, test payments

- Built on local branch `s29-wip` (not merged, not live), from S20's final tree merged with main, then merged with origin/main after S20's squash (`c6bb8817`, identical tree). Audit PAYMENTS-AUDIT-2026-10-30 items M1, M2, M5, S2, S3 (payment mode only), S4 (no new helpers), S6.
- Migration 0107 `plans_entitlements` (journal idx 105, snapshot `meta/0105_snapshot.json`): plan audience and the lifted-limits flag, `plan_entitlements` copied from the plan columns, `plan_prices` (append-only) from today's prices, TEST/LIVE on online payments and ledger rows. Re-runnable statement by statement; needs its own word, O8-S29, after the merge. Pre-migration checks are in `docs/operations/plans-and-entitlements.md`.
- One resolver (`packages/services/src/entitlements.ts`) for the four capacity checks, Plan and Usage and the AI feature plan limits; order override, lifted limits, suspended, plan. S30 refusal codes and sentences unchanged (now pinned exactly in `entitlements.test.ts`). Founding Access is the `bypass_limits` flag; `hasFoundingAccess` is gone.
- Plans page `/app/admin/plans` (owner only, `PLANS_MANAGE`): create, edit limits, AI features and price, retire; fresh sign-in check for every save; typed values kept in a signed cookie; a new price is confirmed first and applies from each agency's next billing period (the daily run bills each period at the price in effect when it started). Linked from Admin > Settings (not added to the sidebar, like Billing Rules and AI Features, so the sidebar characterization stays as it is).
- Test payments: owner-only start in test mode (typed reason `test_mode_owner_only`), mode copied to ledger rows from their source, Test Payment labels on the invoice card, receipts, PDFs and refund panel, left out of the Monthly Accounting File with a count on its card, an open payment from the other mode closed as expired (`mode_changed`), refunds never cross modes (`test_payment_live_gateway`). Billing Rules, the status page ("Test Payments Only") and the platform overview show the mode.
- Owner decision O13 (30 Oct): an agency's suspension no longer blocks a traveller's own uploads; the agency's own team stays paused. The S17 test that pinned the old behaviour was changed to the new decision (traveller allowed, staff refused with the typed reason); ADR 0020 records it.
- Launch switches read by one `switchOn` (trimmed "true"); `PAYMENT_REFUNDS_VIA_GATEWAY=" true"` now counts as on (its test changed to say so). Launch-switch table appended to `docs/operations/current-platform.md`.
- Test fixture changes, none weakening: fixtures that write online payments or ledger rows state a mode; two "before migration 0103/0104" fixtures and one helper stopped using whole-table selects; billing-cycle fixtures record their plan price in the price history; the 0094 migration test re-runs 0094's own statements before 0107 (its top-up insert names no mode, so it cannot run on a ledger that already requires one; production never re-runs 0094); the callback test starts its sandbox payment as the platform owner.
- Break-to-red, each restored from a cp backup: resolver order (override and lifted limits swapped; lifted limits and suspended swapped), backfill equality (invitations copied from the wrong column), strict ledger guard left permissive, price at the current period instead of the period start, test rows kept in the accounting file, owner-only test mode removed, S30 seat sentence changed, traveller upload blocked again on suspension (O13), a plain select on online payments (column guard), mode-change expiry removed, refund mode guard removed. All went red.
- Not verified: the Plans page and the test-payment flow in a browser (no next start or Playwright in this package); SSLCOMMERZ sandbox itself (O6); the migration on a production copy. Not built: traveller subscriptions, AI allowance enforcement (S28), the provider registry (S19 step 0). A plan price typed into `plans` by SQL after 0107 is not billed (the runbook says to use the Plans page).
- Round 2 (30 Oct 2026, after the max code review, the security review and the accessibility review), fixed on `s29-wip`:
  - Switches: every switch that existed before S29 keeps exactly its earlier reading (exact `true`, or trimmed for `AI_CONNECTOR_ENABLED`); the round 1 change to `switchOn` is reverted and `launch-switch-parsing.test.ts` pins each. The round 1 docs line saying one rule reads them all is corrected by appended lines.
  - Founding Access counts as free with no price; clearing its price is refused on the Plans page and in `updatePlan`.
  - Retire waits for scheduled plan changes to the plan (the preview says how many); a refused scheduled downgrade is reported through `reportServerError`.
  - A live payment open while the gateway is in test mode is left open and unasked (round 1 would have expired it, so a late success could no longer be recorded); only test payments close on a mode change.
  - One gateway mode rule (`gatewayServesMode`) for settlement, refund request, retry, check and the refund panel; a sent refund of the other mode is marked Needs a Check (`mode_changed`) once, never asked about.
  - The refund backfill in 0107 also reads the held payment's mode (edited in place; 0107 has run nowhere real), and before 0107 a ledger row's mode is read exactly as 0107 writes it (`ledgerModeSql`, also covering databases without online payments or refunds yet).
  - Team Members and Invitations follows Team Members; AI features on need a daily limit from 1; agencies get "not applicable" for AI features, so Plan and Usage shows no AI section for them.
  - A person's upload to their own record is never stopped by a suspension, even when they work in that agency.
  - `resolveEntitlements` is no longer exported from the services index (a test holds it); the 0107 probe is remembered per database for the process (a yes only).
  - One signed retry-cookie helper for AI Features, AI file choices and the Plans page, with its own tests; one pending-invitation counter; the Plans page reads in a fixed number of queries and a save reads only that plan's price; "Travellers" counts accounts with no active agency place.
  - Accessibility: a polite line and focus on the card heading after a retire; Pay Online only in live mode or for the platform owner, otherwise the test-mode sentence linked to the payment actions; no limits shown for Traveller Free; confirmation steps are fieldsets with legends; the AI daily limit is a text field with a linked, focused error; a limit typed for a feature that is off is refused; the price step shows the old and new price; Storage messages in MB; "1 day"; "test entries"; focus on the "not saved yet" notice after the sign-in check; Complimentary said once.
  - Break-to-red, restored from cp backups: Founding Access free rule, live attempt left open, the switch parsing guard, the own-record upload rule. All went red.
  - Requirements ledger rows appended for COM-01, COM-02, COM-03.
- S29 round 3 (30 Oct 2026), re-review of round 2:
  - A sent refund already marked Needs a Check (ledger refused, duplicate reference) keeps its mark and is not recorded again when the gateway's mode changes.
  - While the gateway is in test mode, live payments take no room in the payment check and are not counted as still waiting; closed live payments are looked at only by the live gateway. A live payment is still never closed because the mode changed.
  - The "has the plans update run" answer is kept per database connection and shared with its transactions, so a settlement asks nothing more after the first answer; the refund panel's three reads run side by side again.
  - Recovery runbook: after any restore to a point before a migration, redeploy the app so running copies forget which tables exist (also noted at the cache in code).
  - Founding Access with a price above 0 gets the same words as an empty price: enter 0 and its currency.
  - The Plans page writes Storage only when the typed MB differs from the rounded MB it showed, so saving other fields never moves a limit that is not a whole number of MB.
  - The daily downgrade run keeps going when one downgrade throws, reports it and counts it (the job reply now says how many failed).
  - "Travellers" on the Plans page counts every account, agency members included, since each uses the traveller plan for its own record.
  - The own-record lookup on upload runs only when an agency suspension is in play.
  - Break-to-red, restored from cp backups: kept mark, live payments in the check, probe count (0 after warm-up), Storage rounding, downgrade error, Founding Access words, traveller count. All went red.

### 2026-10-30, readable admin layouts, phase 1: AI Settings and Platform Overview

Owner report: long, plain, full-width fields and read-outs are hard to follow (label on the far left, value on the far right of a wide card; forms of one input per line).

- New opt-in styles, block `WP-UX-DENSE` at the end of `apps/web/src/app/globals.css`: `.rows-grid` turns a `.rows` read-out into tiles with each label right above its value (two columns on a phone, more on wider screens); `.form-section` and `.form-grid` turn a long form into titled groups whose fields sit in columns; `.action-bar` holds a card's actions with revoke and delete at the far end; `.field-static` shows a value that cannot change on a form. Existing classes keep their behaviour and pages opt in; the one exception is the Platform Overview scorecard, whose own two-column grid rules were removed because the tiles replace them.
- AI Settings: each configuration is one card (`config-card.tsx`) with its facts in tiles and one action bar; the page is grouped into Active Setup, Drafts, New Setup (folded unless nothing is configured), Data Rules and AI App Connections, and Earlier Versions (folded). The settings form is grouped into Model, Access, Spending Limits (rare limits folded), Fallback, and data terms (folded on a new draft). Field names, ids and actions are unchanged; wording lost engineering references.
- Platform Overview: the Product Scorecard, Operational Signals, Platform Readiness Detail, Learning Areas and Commercial Readiness read-outs use the tiles; the providers rail is wider and each provider reads as name and status, then its reading. Failed jobs stay a list (each has its own action).
- Checks: the web tests (lib, admin, components: 2,430) passed after the change, including the accessibility and title-case guards. Looked at with the page's own captured markup at desktop and phone widths.
- Phase 2 (after owner review): organisations, plans, packs, billing, privacy and access admin pages, then the profile editor, case and agency pages that share the same pattern.

### 2026-10-30, S19 step 0: payment provider registry

- Built on local branch `s19s0-wip` (not merged, not live) from S29's final tree (`4c4f2063`). No migration. ADR 0020 amendment "S19 step 0"; runbook "Adding a Payment Provider" in `docs/operations/online-payments.md`; switch table appended to `docs/operations/current-platform.md`; owner actions and handoff section M note appended.
- Registry `apps/web/src/lib/payment-providers.ts` (`PAYMENT_PROVIDERS`, SSLCOMMERZ only, O14): name, ISO currencies, refunds, setting and secret names, callback folder, mode (no default), configured, port, callback reader. `PAYMENT_PROVIDERS` (ordered, trimmed, exact names, `none` adds nothing, unknown names unused and refused by readiness) with the `PAYMENT_PROVIDER` fallback read exactly as before. `configuredPaymentProviders` is the one answer for the status page, the platform overview (one "Online Payments: <Name>" row per entry, plus the "AI App Access" On/Off row for S28), Billing Rules, the Invoices page, callbacks, the daily check and refunds; `paymentMode()`, `isPaymentProviderConfigured()`, `createPaymentPort()` and `readSslcommerzConfig()` stay in providers.ts as readings of it.
- Services take `PaymentPortResolver` (ports.ts, built by `paymentPortResolver` in payment-resolver.ts): start by the invoice's stored currency (typed `currency_not_offered`, sentence from the registry, exactly today's with SSLCOMMERZ alone); reconcile, Check Status, the page's check, refund request, Send Again, the refund check and Check Now all by the payment's or refund's own provider; a payment or sent refund of a provider no longer configured is counted (`providerNotConfigured`) and never asked about, closed or expired. `settlePaymentAttempt` keeps the route's port and its provider match. Held payments awaiting review are now counted across every provider. `getOrganizationRefundWork` takes `gateways` (provider and mode each) instead of one provider and mode.
- Routes `/api/payments/[provider]/ipn` and `/return` replace the fixed SSLCOMMERZ folder (same addresses); unknown provider 404 before anything is read; known but unconfigured keeps 503 and the general result page. Result links: `PAYMENT_RESULT_SIGNING_SECRET` (32 characters or more) or a key from `NEON_AUTH_COOKIE_SECRET`, label v2; old store-password links (v1) accepted until expiry (O2: remove in a later package, 7 days or more after this is live). `withoutPaymentSecrets` scrubs every registry secret and the signing secret.
- Invoices page: per-currency offers from the registry (`pay`, or `testing` for anyone but the platform owner while only a test-mode provider takes the currency), replacing the fixed BDT constant on the card.
- Deviations: `PAYMENT_REFUNDS_VIA_GATEWAY` keeps its exact-`true` reading (the S29 pin forbids `switchOn` in refund-gateway.ts), not `switchOn` as the plan said. `refundCheckPort`/`refundSendPort` keep their names and now return the resolver. A half-set provider is now quietly off at the callback (503) instead of a thrown and logged configuration error; the platform overview shows it as "Chosen; settings incomplete".
- Tests: registry contract (ISO currencies, callback folder and routes, secrets listed, scrubbed and in .env.example, refunds flag), exact SSLCOMMERZ addresses, list parsing table, unknown provider 404, cross-provider IPN refused as unknown with a genuine signature, legacy link verifies, no secret and no cookie secret gives no link, a fake second provider in USD end to end (start, reconcile, refund, refund check, removed provider counted and left), one-answer table across the status page, overview, providers.ts and offers, resolver unit tests, overview rows. Existing tests changed only to pass the provider set (`onePort(port)`), the provider in callback calls, the new signing secret, and `gateways` for refund work; none weakened. The S18 "gateway that cannot refund is ignored" case moved from refund-gateway.test.ts to payment-providers.test.ts.
- Break-to-red, each restored from a cp backup: entry without secrets; password not listed as a secret; callback segment renamed; unknown provider not refused; cross-provider provider check dropped; legacy link no longer accepted; store password still signing; capabilities disagreeing; start on the first provider whatever the currency; currency check under the lock skipped; every provider's payments asked of one gateway; removed provider's payments not counted; refund through the first gateway; reconcile only the first provider. All went red.
- `invoice-ledger.ts` unchanged. Not verified: a browser run of the Invoices page and the platform overview; the SSLCOMMERZ sandbox (O6); `/code-review` and `/security-review` not run in this helper package (lead's step).

### 2026-10-30, S19 step 0 round 2: review fixes

Fixes from the max code review and the security and accessibility review of `4c4f2063..cffdf4b9`. Committed on local branch `s19s0-wip` as `301ce811`; not merged, not live. Main had not moved (`70370f22`). No migration.

- **Incomplete provider alarm.** A chosen provider with missing or invalid settings now:
  - fails readiness, naming the provider and each missing setting (never a value);
  - fails the daily payment check: reported through `reportServerError`, `incompleteProviders` in the answer, cron route 503, other providers still asked;
  - is reported once per callback request (IPN 503; browser goes to the general page).

  `PAYMENT_PROVIDERS` set to nothing usable (such as `,`) fails readiness. Building the ports can no longer throw, so the tests that made `paymentPorts` throw were removed or rewritten.
- **Stranded work.** Open payments and sent refunds whose provider is not configured are counted (`providerNotConfigured`) by the daily payment and refund checks, Check Now and Check Status, also with no provider on. The payer gets a plain sentence, and the card offers neither Pay Online nor Start Another Payment. `startOnlinePayment` refuses another payment for that invoice even on purpose (typed `provider_not_configured`). Staff Check Now names the waiting refunds.
- **Time budget.** Each provider gets an equal share of what is left (`providerShareDeadline`, payment-resolver.ts), for payments and for refunds.
- **Mixed modes.** `overallPaymentMode` is LIVE only when every provider is live, otherwise TEST or MIXED. For MIXED:
  - capability: limited;
  - Billing Rules and the status page: Partly Live, naming the test-only currencies in plain words.

  The single-provider S29 words are unchanged.
- **Refunds.** `requestRefund` refuses a payment whose own provider is not configured or cannot refund before any mode check (`provider_not_configured`, `REFUND_PROVIDER_OFF`). Send Again uses the same refusal.
- **Result links.** Decision O2 is closed: the store-password key is removed, since no such link ever existed in production. The cookie secret has a 32-character minimum. Cookie-signed links still verify after `PAYMENT_RESULT_SIGNING_SECRET` is set. A short `PAYMENT_RESULT_SIGNING_SECRET` fails readiness, naming only the setting.
- **Other.**
  - `readSslcommerzConfig`, `SslcommerzConfig`, `isPaymentProviderConfigured` and `createPaymentPort` are deleted (no production caller).
  - The contract test checks that each entry's key equals its port's `provider`.
  - The overview row is "Online Payments" (with several providers: "Online Payments in <currency>"). The provider name is in the detail; currency names come from `currencyWords` and `currencyListWords` in payment-resolver.ts; the refund wording now says "once sending refunds from VisaStack is switched on".
- **Break-to-red.** 23 proofs, each restored from a cp backup, and all went red:
  - readiness: incomplete provider; empty list;
  - daily check report; cron 503; IPN report;
  - stranded payments and refunds with none on;
  - Check Status sentence; card; service refusal; Check Now sentence;
  - fair share for payments; fair share for refunds;
  - overall mode; Billing Rules; status page;
  - refund before the mode check;
  - store-password key; cookie minimum; cookie link after the switch; short secret;
  - key equals port provider; overview label.
- **Verification on `301ce811`.** All passed:

  | Check | Result |
  |---|---|
  | lint | pass |
  | typecheck (after `rm -rf apps/web/.next`) | pass |
  | core | 188 |
  | policy | 38 |
  | db | 55, 1 skipped (existing) |
  | adapters | 525, 2 skipped (existing) |
  | services | 2747 |
  | web | 3864 |
  | web build (`NODE_OPTIONS=--max-old-space-size=3072`) | pass |
  | `pnpm audit --prod --audit-level high` | pass |
  | em dash sweep | 0 |

- **Not verified.**
  - A browser run of the Invoices card, Billing Rules and the status page.
  - The SSLCOMMERZ sandbox (O6).
  - The status page's note is read when the page is built: it is not marked dynamic, like its version notice, so a payment setting change shows there after a redeploy.
  - `/code-review` and `/security-review` were not rerun in this helper round.

### 2026-10-30, S19 step 0 round 3: merge of main and re-review fixes

- **Merge.** `0665963f` merges origin/main `ed38503c` (S29 #349, squash) and #350 into `s19s0-wip`. S29 files take main's final round-3 version, with this branch's S19 changes replayed on top; docs keep main's text with this branch's entries after it. S29 round 3 is intact:
  - `markModeChanged` keeps earlier marks;
  - the reconcile queries skip other-mode attempts, now inside the per-provider query;
  - the per-connection schema cache;
  - `executeDueDowngrades` per-item catch.
  The S29 round 3 tests that passed a single port now pass `onePort(port)`.
- **Fixes, `7c7bb9a0`:**
  - **Stranded payment, one definition.** `isStrandedAttempt` counts only a REDIRECTED or EXPIRED attempt within `LATE_SUCCESS_WINDOW_MS` whose provider is not configured. CREATED and older attempts never block, and the daily check still counts them. `strandedPayment` comes from it on `AgencyInvoiceView` (new required `configuredProviders` input) and on Check Status; `startOnlinePayment` uses it too.
  - **Refunds.** `REFUND_PROVIDER_OFF` is given only when the provider is not configured. A configured provider that cannot refund gets the earlier "refund it another way" refusal. The refund services now get every configured provider, and `refundsOnly` is removed.
  - **Callback reports.** At most once per provider per 10 minutes per instance; the answer stays 503.
  - **No provider and no table.** The daily check is a quiet run (`configured: false`, nothing stranded).
  - **Check Now.** The answer when every refund was unreachable also names the stranded refunds.
  - **Tidying.** Doc comments fixed, `readSslcommerz` without the redundant clause, `PAYMENT_PROVIDER_KEYS` in the overview, the `isNull` branch for the NOT NULL attempts provider column removed.
  - **Runbook.** Change `PAYMENT_RESULT_SIGNING_SECRET` only when no payment is in progress. The result-link key itself is unchanged, by decision.
- **Break-to-red.** 7 proofs, all red, each restored from a cp backup: late window; CREATED; list definition; report throttle; off vs cannot refund; quiet run; unreachable plus stranded. The agreement test covers six attempt cases across the list, Check Status and start.
- **Verification on `7c7bb9a0`.** All passed:

  | Check | Result |
  |---|---|
  | lint | pass |
  | typecheck (after `rm -rf apps/web/.next`) | pass |
  | core | 188 |
  | policy | 38 |
  | db | 55, 1 skipped (existing) |
  | adapters | 525, 2 skipped (existing) |
  | services | 2754 |
  | web | 3873 |
  | build (3072 MB) | pass |
  | audit high | pass |
  | em dash sweep against origin/main | 0 |

- **Not verified.** A browser run; the SSLCOMMERZ sandbox (O6). Review helpers were not rerun in this round.

### 2026-10-30, S19 step 0 round 4: narrower stranded rule, registry refund guard

- **Fixes, `8ff3737e`:**
  - **Stranded, narrowed.** Only a LIVE, REDIRECTED attempt within `LATE_SUCCESS_WINDOW_MS` whose provider is not configured blocks a new payment. TEST, EXPIRED and CREATED attempts never block, and the daily check still counts them.
    - `hasStrandedAttempt` is one indexed probe (id only, `limit 1`).
    - Check Status asks for it (`withStranded`); the page-load refresh runs no extra query.
    - `listAgencyInvoices` takes the services' resolver (`payments`), and the Invoices page builds one resolver for both.
  - **Registry refund guard.** A refund port needs the entry's `supportsRefunds` and `isRefundingPaymentPort`: an entry without `supportsRefunds` hands on a payments-only port. The admin refund panel's gateway list (`refundGatewayViews`, and so `servedBy`) has refunding providers only. Round 3's rule is kept: a configured provider that cannot refund gets "refund it another way", and `REFUND_PROVIDER_OFF` is only for a provider that is not configured.
  - **Own provider first.** `requestRefund` and `retryRefund` check the payment's own provider before the "no refunding gateway" answer, so with SSLCOMMERZ off staff get `REFUND_PROVIDER_OFF`.
- **Merge `ffa69d4e`.** origin/main `cd2e8153` (#351). Only known-issues conflicted: main's entry first, this branch's after it.
- **Break-to-red.** 7 proofs, all red, each restored from a cp backup: TEST never blocks; EXPIRED never blocks; registry guard; admin view refunding only; own provider first; one resolver; opt-in.
- **Verification on `ffa69d4e`.** All passed:

  | Check | Result |
  |---|---|
  | lint | pass |
  | typecheck (after `rm -rf apps/web/.next`) | pass |
  | core | 188 |
  | policy | 38 |
  | db | 55, 1 skipped (existing) |
  | adapters | 525, 2 skipped (existing) |
  | services | 2755 |
  | web | 3875 |
  | build (3072 MB) | pass |
  | audit high | pass |
  | em dash sweep | 0 |

  No timeouts; nothing was rerun.
- **Not verified.** A browser run; the SSLCOMMERZ sandbox (O6).
