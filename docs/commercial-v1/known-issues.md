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
