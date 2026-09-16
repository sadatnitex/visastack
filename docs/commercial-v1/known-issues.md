# Commercial V1 Known Issues

Carried forward from `docs/roadmap/remaining-commercial-blockers.md` (prior engagement, still
accurate as of this session's baseline check) plus anything found during this programme. Each
item gets its own requirements-ledger row once classified against the new directive.

## Carried forward, still open

1. Real malware scanner not implemented. `commercial-readiness.ts` gate `realMalwareScanner`
   is hardcoded `false`. The current scanner (`BasicSafetyScanner`) is structural/magic-byte
   validation only, by design (ADR-0011), not antivirus. Directive Part 3 requires a real
   scanning engine (isolated ClamAV worker or an approved private scanning service).
2. 8 cross-account E2E tests in `apps/web/e2e/authenticated-workspace.spec.ts` are
   unconditionally `test.skip(true, reason)` with empty bodies. They need real journey
   implementations against a second synthetic WorkOS identity. Directive Part 10 Section 2
   closes this; PR #77 provisioned the identity and the CI wiring but not the test bodies.
3. Preview-deployment builds fail (`BUILD_FAILED`, terminal in under 2 seconds, no build
   logs) while production deployments of the same commit succeed. Root cause hypothesized
   (likely `DATABASE_URL` not scoped to the Preview environment in Vercel, or a Hobby-tier
   build-concurrency ceiling) but not confirmed; no session so far has had Vercel dashboard
   access to confirm. Does not block this programme's own verification (which runs locally
   and against production post-merge) but does block reviewers from getting live PR preview
   URLs.
4. `pnpm audit --dev` reports 6 findings (1 critical, 1 high, 4 moderate), all rooted in
   `vitest@2.1.9` / `vite@6.4.x` / `esbuild`, none shipped in the production bundle.
   `pnpm audit --prod` is reported clean by the prior engagement; this session re-runs its own
   audit rather than relying solely on that claim (see `test-evidence.md`). Fixing the dev
   findings requires a major `vitest` version bump across the monorepo, deliberately deferred
   by the prior engagement as out of scope for its own PR.
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
7. Mission notes (`packages/services/src/agency.ts`, `addNote`/`listNotes`) are confirmed
   this session to carry no visibility classification and no author-organisation ID at all;
   read access is gated only by whether the reading organisation currently holds a grant
   permitting `COMMENT` or `MANAGE` on the mission. There is no AGENCY_INTERNAL /
   TRAVELLER_SHARED distinction yet, and no way to keep one agency's notes from a second
   agency that later acquires its own grant on the same mission.
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

16. (Part 2) `packages/services/src/organizations.ts` — real, security-critical logic (last
    active owner protection against concurrent deactivation, cross-tenant IDOR prevention on
    membership IDs, independent step-up-gated organisation review with no self-verification)
    — had zero test coverage before this session, confirmed by absence of an
    `organizations.test.ts` file. Closed this Part 2 chunk with 17 new tests, including a
    genuine concurrency test (`Promise.all` racing two owners deactivating each other) rather
    than a single-threaded approximation. See `requirements-ledger.md` IAM-02.
17. (Part 2) The SEC-04 periodic signed checkpoint capability's own tamper-detection test
    initially passed for the wrong reason: it issued a raw `UPDATE audit_events SET hash = ...`
    expecting the row to actually change, but `audit_events`' pre-existing append-only RULE
    (`audit_events_no_update`, migration 0000) silently absorbs a plain UPDATE
    (`DO INSTEAD NOTHING`) exactly as designed — so the first version of the test was validating
    nothing. Caught by this session before committing (not by a later report): the fix makes the
    test explicitly `ALTER TABLE audit_events DISABLE RULE audit_events_no_update` before
    tampering and re-enable it after, actually reproducing "a party who bypassed the append-only
    protection," which is the exact scenario a checkpoint exists to detect. General lesson for
    this programme, same shape as item 11: a test against an append-only-by-RULE table must
    explicitly defeat the RULE to simulate the threat it claims to test, or it silently tests
    nothing.

Items 1 through 4, 5 through 9, and 14/15 above are carried forward or upgraded to
independently confirmed findings; the missing PRD file is tracked as Blocker 1 in
`assumptions-and-blockers.md` (now resolved) rather than here, since it blocked the
programme rather than being a product defect.
