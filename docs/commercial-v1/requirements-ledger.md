# Commercial V1 Requirements Ledger

Governing PRD: `docs/product/commercial-v1-prd-2026-09-16.md` (hash-verified, see
`assumptions-and-blockers.md`). PRD section numbers below refer to that document.

Status: every ID the directive requires (Part 1 Section 6) is listed so none gets silently
dropped. Classification and status reflect what is independently verifiable from actual
repository code as of this commit, not the PRD's own audit table alone; where this session
read the code directly, the note says so. No row is marked VERIFIED; that only happens with
linked test evidence in a later part. "(confirmed)" means this session read the actual
implementation. "(reported)" means the classification rests on the PRD's own audit table or
`remaining-commercial-blockers.md`, not yet independently re-read this session.

Columns: ID, PRD §, Classification (REUSE / REPAIR / EXTEND / REPLACE / KEEP DISABLED / NEW),
Status, Notes.

## Identity and access management (IAM) — PRD §4
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| IAM-01 | §4 | REPAIR (confirmed) | BLOCKED | Account/identity, staff MFA. Confirmed this session, live against production WorkOS: MFA is enforced nowhere (`mfaEnabled: "Off"` at the IdP; no code-level check in `withSession`). Full detail in `threat-model.md`. Blocked on a product-owner decision in `assumptions-and-blockers.md` (universal MFA vs finding/building a role-scoped mechanism); the live setting was deliberately not changed without authorization. |
| IAM-02 | §4 | REUSE (confirmed) | IN_PROGRESS | Organisation onboarding, approval wording, last-owner protection. `organizations.ts` confirmed real and now fully test-covered (17 new tests, `organizations.test.ts`): creation lands `PENDING_VERIFICATION`, review is independent and step-up-gated (self-verification by a member of the org is refused), suspension, membership add/deactivate, and, the PRD's specific last-owner concern, `setMembershipActive` refuses to deactivate the sole active OWNER, proven under real concurrency (two owners racing to deactivate each other via `Promise.all` never reaches zero active owners). Cross-tenant IDOR (a membership ID from a different org) and OWNER-vs-ADMIN authority boundaries also confirmed enforced. Remaining for EXTEND: PRD's exact approval-wording/UX text not yet audited (Part 9 scope). |
| IAM-03 | §4 | NEW/EXTEND | NOT_STARTED | Minimal pending client invitation without account claiming; no enumeration. Not yet located this session. |
| IAM-04 | §4 | EXTEND | NOT_STARTED | Guardian/subject relationship, explicit authority. Not yet located this session. |

## Traveller profile and evidence (PRO, EVI) — PRD §5
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| PRO-01 | §5 | EXTEND | NOT_STARTED | Master Profile sections. Fact/field registry confirmed (`packages/services/src/profile.ts`); specific section coverage (passports, sponsor, financial, etc) not yet audited field-by-field. |
| PRO-02 | §5 | REUSE (confirmed) | NOT_STARTED | Facts and revisions. `editFact` in `profile.ts` confirmed: append-only `factVersions`, atomic approval re-pointing `facts.currentVersionId`, full history via `listFactHistory`, repeating records via `repeatingRecordKey`. Matches PRD's immutable-version model closely. Conflict-as-review-task and multi-repeating-instance-without-overwrite still need explicit verification against PRO-02's exact wording. |
| EVI-01 | §5 | REPAIR (implemented, partial) | IN_PROGRESS | Intake limits. `maxUploadBytes` corrected from a prior-engagement 10 MB default to the PRD's explicit "20 MiB per original" (`packages/services/src/quotas.ts`). PDF/JPEG/PNG type enforcement confirmed real (server-side, at scan time, not just client `accept`). Page-count and megapixel limits ("50 PDF pages, 40 megapixels per image") are now real (this chunk): `ContentLimitsPort`/`BuiltinContentLimitsChecker` runs in the intake pipeline's NORMALIZING step, after the scan confirms CLEAN, reading PDF page count via `unpdf` and image dimensions via a few fixed header bytes (never a full decode), routing an over-limit document to NEEDS_ATTENTION with a clear reason. Password-protected PDFs are also now genuinely rejected at this same point, with the PRD's own "clear request for an unlocked copy" wording, the first point in the pipeline that can actually tell, closing the "unreachable" gap this row previously tracked for `text-extraction.ts`'s own dormant detection (that code path remains separately unreachable; this is new, independent detection, not a fix to it). Both limits are env-overridable (`QUOTA_MAX_PDF_PAGES`/`QUOTA_MAX_IMAGE_MEGAPIXELS`), matching EVI-01's own "initial configurable limits" wording. Remaining, confirmed missing: batch-count (no "10 files per user batch" concept exists anywhere, including client-side; deliberately not invented this chunk without a clearer spec for what a "batch" is server-side); `documentVersions.pages` still goes unwritten even for an in-limit PDF (the check confirms a limit, never persists the count, which is EVI-03's "store page count as metadata" concern, not this row's). |
| EVI-02 | §5 | REPAIR (implemented, partial) | IN_PROGRESS | Safe pipeline, real malware engine, safe preview rendition. `ClamAvScanner` (`packages/adapters/src/clamav-scanner.ts`) is a real `MalwareScannerPort` backed by an actual ClamAV daemon over its native `INSTREAM` protocol, wired through the existing provider registry (`MALWARE_SCANNER_PROVIDER=clamav`), with `commercial-readiness.ts`'s `realMalwareScanner` gate now a live check of the same configuration rather than a hardcoded `false`. Live-verified against a real running `clamd`, both locally and confirmed in the actual GitHub Actions CI job logs (real `freshclam`-fetched official signatures, not just the sandbox's EICAR-only fallback): genuine EICAR detection and clean-file pass-through, not a mock (`clamav-scanner.test.ts`'s live-only describe block, CI-wired to run the same way). Structural pre-checks (magic bytes, DOCX validation, deny-list) reused from `BasicSafetyScanner` via an extracted `structuralCheck` function, now shared rather than duplicated. Every file type reaches the real engine when configured, not just PDF. "Create a safe preview rendition" is now real too: `PreviewRendererPort`/`BuiltinPreviewRenderer` (`packages/services/src/preview-rendering.ts`, `packages/adapters/src/preview-renderer.ts`) rasterizes PDF page 1 and re-encodes PNG/JPEG via `unpdf`+`@napi-rs/canvas`, extracts DOCX to plain text via `mammoth`, and normalizes plain text/markdown, closing the "originals are explicit downloads, never an untrusted inline PDF shortcut" clause end to end (see EVI-06 below and AD-06 for full detail). Honest gap against this exact PRD line: the rendition is produced on demand, in the same process, at preview-request time, not precomputed "in an isolated worker" at ingest time; AD-06 records why (no persisted-derivative storage path exists yet on the Vercel Blob backend without a new `storage_objects` row per rendition, and this codebase's existing "worker" is Postgres-native job processing in the same runtime, not literal process isolation, so moving the same trusted libraries there would not add a genuine security boundary either). Remaining: signature-freshness enforcement (24h max, implemented and unit-tested) has never been exercised against a real freshclam-managed database in this sandbox (network-policy-blocked here; CI's own real fetch is now separately confirmed, see above); "bounded parsing" and "isolated worker" deployment (a separately-hosted/sidecar clamd, not literally this dev container) is an infrastructure/hosting decision this session cannot provision, tracked as open. `BasicSafetyScanner` remains the default when no real scanner is configured, so this is REPAIR, not REPLACE. |
| EVI-03 | §5 | TBD | NOT_STARTED | Metadata/versions, review states, duplicate detection. Confirmed this session (via Explore agent inventory): `issuer`, `documentDate`, `expiresAt`, and `docType` columns exist on `documents` but are never written by the real upload path (dead columns). No duplicate-detection query exists despite `sha256`/`contentHash` being computed and stored. No PENDING/ACCEPTED/REPLACEMENT_REQUIRED/IRRELEVANT/DISPUTED review-state enum exists. Not yet built this session. |
| EVI-04 | §5 | TBD | NOT_STARTED | Wallet and reuse. Confirmed this session: no document-level current/expiring/expired/superseded concept exists (a similar concept exists for Master Profile facts, a distinct entity). Not yet built this session. |
| EVI-05 | §5 | TBD | NOT_STARTED | Assurance labels (E0-E3). Not yet read this session. |
| EVI-06 | §5 | REPAIR (implemented, partial) | IN_PROGRESS | Preview and download. TTL corrected to the PRD's explicit 60-second maximum (`DEFAULT_ACCESS_TTL_SECONDS`, was 300). Redemption-time recheck implemented: a second signed token (`packages/services/src/document-access-token.ts`), minted alongside the existing storage-generic blob token, carries enough context for `/api/blob/[key]/route.ts` to call `recheckDocumentAccess` and replay the original authorization decision against LIVE database state (fresh membership, fresh grants, fresh document servability) before serving bytes. Proven, not assumed: 11 new integration tests cover a grant revoked between mint and redemption, a membership deactivated between mint and redemption, and a document version erased between mint and redemption, each correctly killing an otherwise-still-valid, unexpired token. Safe preview rendering now real (this chunk): the `'redacted'` variant, previously a hardcoded 501, now renders a genuine active-content-stripped derivative via `PreviewRendererPort` (see EVI-02, AD-06). A real bug this closed at the same time, not previously tracked as its own item: an earlier build served the applicant owner the raw original inline on preview (reasoning the owner is already authorized), which the PRD's explicit "originals are explicit downloads, never an untrusted inline PDF shortcut" rules out regardless of ownership; `accessDocument` now always requests `redacted` for preview, owner included, proven by an updated integration test (`documents.test.ts`). `support_admin` document access, previously structurally unreachable regardless of any support grant, is now wired (this chunk): `accessDocument`/`recheckDocumentAccess` merge in the actor's active `support_grants` via `loadSupportGrantsForPolicy` when, and only when, the actor is `support_admin`, closing known-issues.md item 23. Proven, not assumed: a support_admin actor with no grant remains denied at both mint and redemption (default-deny, unchanged); a support_admin actor with a real, approved, action-matching support grant now succeeds at both, and a support grant covering only `PREVIEW` still correctly refuses `DOWNLOAD_ORIGINAL` (`documents.test.ts`). Remaining, confirmed and tracked, not silently dropped: step-up re-verification at redemption is carried forward from the mint-time token value rather than independently re-derived from a live session (AD-05). |

## Agency cases and collaboration (CAS) — PRD §6
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| CAS-01 | §6 | REUSE/EXTEND (confirmed) | NOT_STARTED | Case creation. `createMission` in `missions.ts` confirmed: applicant, title, destination, purpose, consent check, audit. Missing per PRD: jurisdiction/consular context, service category, agency owner, assigned manager, target deadline, explicit traveller grant binding at creation. Manual-route mode for unsupported destinations not yet located. |
| CAS-02 | §6 | TBD | NOT_STARTED | Case workspace, authorised search only. Not yet read this session. |
| CAS-03 | §6 | REUSE/EXTEND (confirmed) | NOT_STARTED | Evidence requests. `requestEvidence`/`respondEvidence` in `agency.ts` confirmed, with real grant-permission checks (`orgGrantPermits`) and rate limiting. States are `OPEN`/`FULFILLED`/`DECLINED`, not the PRD's `OPEN, RECEIVED, UNDER_REVIEW, ACCEPTED, NEEDS_REPLACEMENT, CANCELLED`; needs state-model extension, and upload-vs-acceptance distinction (A11) needs verification. |
| CAS-04 | §6 | TBD | NOT_STARTED | Tasks and appointments. `missionTasks` confirmed to exist (`createTask`/`decideTask`/`listTasks` in `missions.ts`) but only has `description`, `assigneeAccountId`, `status` (OPEN/DONE/CANCELLED); no due date, timezone, priority, or appointment fields yet, matching the PRD audit's "tasks exist, but current task rows lack due-date fields" finding. EXTEND needed. |
| CAS-05 | §6 | EXTEND (confirmed) | NOT_STARTED | Notes visibility. Confirmed this session (see `known-issues.md` item 7): `missionNotes` has no visibility field and no author-organisation ID; read access is gated only by whether the reading org currently holds a COMMENT/MANAGE grant on the mission, with no separation between what different orgs with sequential grants could see. This is the PRD's flagged CAS-05/A10 gap exactly. |
| CAS-06 | §6 | EXTEND (confirmed) | NOT_STARTED | Review. `recordMissionDecision`/`listMissionDecisions` in `missions.ts` confirmed: ACCEPTED/REJECTED outcome, reason, assignment+grant gated. No "reviewer must differ from preparer" organisation setting found yet; no self-review label for independent travellers found yet. |
| CAS-07 | §6/§10 | REPAIR (confirmed) | NOT_STARTED | Case state machine. `missions.ts` `TRANSITIONS` confirmed as the legacy states the PRD names for additive migration (DRAFT/IN_PROGRESS/READY_FOR_REVIEW/UNDER_REVIEW/READY_TO_EXPORT/LOCKED/CLOSED/CANCELLED). None of the new canonical states (INTAKE, AWAITING_APPLICANT, SUBMISSION_READY, SUBMITTED) exist. Overlaps TRU-03/TRU-04, planned for Part 7. |
| CAS-08 | §6 | NEW | NOT_STARTED | Contributor request. Not yet located this session; likely does not exist given PRD's own phrasing ("reuses invitation and grant services"). |

## Sharing and consent (SHR) — PRD §7
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| SHR-01 | §7 | REUSE (confirmed, partial) | NOT_STARTED | Grant lifecycle. `schema.grants` confirmed in active use (`agency.ts` references `status`, `startAt`, `expiryAt`, `acceptedAt`, `categories`, `missionId`, `documentIds`, `recipientOrganizationId`, `purpose`, `actions`) and is the real authorization substrate for `orgGrantPermits`. Full lifecycle state coverage (PENDING_ACCEPTANCE/ACTIVE/PAUSED/REVOKED/EXPIRED) and default/maximum duration enforcement not yet independently verified. |
| SHR-02 | §7 | TBD | NOT_STARTED | Enforcement, revalidation at export/download. `bulkExport` in `agency.ts` confirmed to re-authorize per applicant at export time (good sign for SHR-02's "revalidate every item" requirement) but full SHR-02 scope not yet audited. |
| SHR-03 | §7 | TBD | NOT_STARTED | Control and disclosure, revocation semantics. Not yet fully audited. |
| SHR-04 | §7 | TBD | NOT_STARTED | Consent separation (AI/sharing/marketing/issuer). `hasConsent(db, ownerAccountId, 'CORE_PROCESSING')` confirmed as an existing consent check pattern in `profile.ts`/`missions.ts`; full consent-type coverage not yet audited. |

## Expiry deadlines and notifications (NTF) — PRD §8
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| NTF-01 | §8 | TBD | NOT_STARTED | Expiry centre, intrinsic vs staleness distinction. Not yet read this session. |
| NTF-02 | §8 | TBD | NOT_STARTED | Event notifications, neutral email content. Not yet read this session. |
| NTF-03 | §8 | REPLACE (confirmed) | NOT_STARTED | Real email adapter. `packages/adapters/src/email.ts` confirmed: `NullEmailPort.send` only calls `console.warn` with the recipient and subject in the log line, never sends. That log line itself also needs removing per SEC-02/PRV ("remove recipient and subject logging") once a real adapter replaces it. |
| NTF-04 | §8 | TBD | NOT_STARTED | Timing, timezone, DST safety. Not yet read this session. |

## Requirements and readiness (RUL) — PRD §9
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| RUL-01 | §9 | REUSE (confirmed, partial) | NOT_STARTED | Coverage/pack architecture. `packVersions`, `packRequirements`, `listRequirements` confirmed in active use by `missions.ts` (attach, readiness, snapshot). Full Pack/PackVersion authoring workflow not yet read. |
| RUL-02 | §9 | TBD | NOT_STARTED | Rule record fields (source, freshness, review dates, reviewer distinct from author). Not yet read this session; `packRequirements` as used by `missions.ts` exposes only `kind`, `fieldKey`/`docType`, `citation`, `optional` so far, none of PRD's freshness/reviewer metadata observed yet at this call site. |
| RUL-03 | §9 | TBD | NOT_STARTED | Typed rule AST, UNKNOWN semantics. Not yet read this session. |
| RUL-04 | §9 | REUSE (confirmed, partial) | NOT_STARTED | Result model. `computeReadiness` in `missions.ts` confirmed: completeness-only (`ready: requiredCount > 0 && satisfiedRequired === requiredCount`), never an approval probability, matches PRD's "readiness is pure completeness" principle. The PRD's richer per-requirement result enum (SATISFIED/ATTENTION/CRITICAL_GAP/UNVERIFIED/CONFLICTING/EXPIRING_STALE/NOT_APPLICABLE) is not yet present; current model is boolean `satisfied` per requirement. EXTEND needed. |
| RUL-05 | §9 | TBD | NOT_STARTED | Source maintenance workflow. Not yet read this session. |
| RUL-06 | §9 | TBD | NOT_STARTED | Public Trust Lite. Not yet read this session. |

## Applicant Truth Check and case state (TRU) — PRD §10
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| TRU-01 | §10 | REPAIR (confirmed) | NOT_STARTED | Final disclosure/snapshot scope. Confirmed this session (`known-issues.md` item 6): `snapshotMission` loads every fact and every document for the whole applicant, not the mission's selected evidence, and includes all of it unconditionally in `content`. Direct match to the PRD's own audited finding. Must become selected-evidence-only. |
| TRU-02 | §10 | NEW (confirmed) | NOT_STARTED | Acknowledgement. Confirmed missing: no acknowledgement entity, table, or service function found in `missions.ts`. Needs a new immutable record type per PRD's exact field list. |
| TRU-03 | §10 | REPAIR | NOT_STARTED | Atomic validity / material revision. No monotonic case material revision counter found yet in the schema areas read so far; `missionSnapshots.version` exists but is a snapshot-count version, not the PRD's separate material-revision concept gating acknowledgement staleness. Needs design in Part 7. |
| TRU-04 | §10 | NEW | NOT_STARTED | Snapshot vs sent file, submission report. Not yet located; likely does not exist (no `submission` concept found in `missions.ts` reads so far). |

## AI that the owner can manage (AI) — PRD §11
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| AI-01 | §11 | EXTEND (confirmed) | NOT_STARTED | Delivered tasks. Only extraction (`AiExtractionPort`/`OpenAiExtractionAdapter`) confirmed; document-type suggestion, naming suggestion, inconsistency flag, and gap explanation as distinct AI tasks not yet located as separate task types. |
| AI-02 | §11 | NEW | NOT_STARTED | Admin configuration journey (provider/model/key/test/activate/rollback UI). Not yet located; `ai.ts`'s `createAiExtractor` reads static env vars only, no admin-managed versioned configuration observed. |
| AI-03 | §11 | REPLACE (confirmed) | NOT_STARTED | Gateway contract, three providers. `ai.ts` confirmed: `if (provider && provider !== 'openai') return undefined; // only the OpenAI adapter exists so far.` Only `OpenAiExtractionAdapter` implements `AiExtractionPort`. Gemini and Anthropic adapters do not exist yet. Must extend the existing port, not replace the architecture. |
| AI-04 | §11 | REUSE (confirmed, partial) | NOT_STARTED | Evidence grounding. `openai-extraction.ts` confirmed to require verbatim `evidenceSnippet` per proposal via its system prompt and structured-output schema, and `profile.ts`'s approval path is a separate, explicit human action (`editFact` with `method: 'DOCUMENT'`). Deterministic snippet-exists-in-source verification not yet confirmed as independently enforced (currently relies on the model's own instruction-following). |
| AI-05 | §11 | NEW | NOT_STARTED | OCR/scanned documents. Not yet located; `openai-extraction.ts` sends only pre-extracted text, no vision/OCR path observed. |
| AI-06 | §11 | REUSE (confirmed) | NOT_STARTED | Data boundary. `openai-extraction.ts` confirmed to send only deterministically-extracted, size-capped text plus the field-key registry, never raw file bytes (comment: "for privacy minimization"). Good existing foundation; multi-provider/multi-tenant boundary re-verification needed once Gemini/Anthropic adapters exist. |
| AI-07 | §11 | NEW | NOT_STARTED | Credential/endpoint hardening (KMS-backed secret storage, SSRF denial list). `openai-extraction.ts` takes a plain `apiKey` string in adapter options; no KMS/secret-store reference or endpoint-allowlist mechanism observed yet. |
| AI-08 | §11 | REPAIR (confirmed) | NOT_STARTED | Cost control. `ai.ts` confirmed: `APPROX_USD_PER_MILLION_TOKENS = 10`, a single blended constant across all models, documented in its own comment as "NOT a billing source of truth." No per-model/per-unit-type price versioning found. Budget envs (`AI_PILOT_MONTHLY_HARD_LIMIT_USD`, `AI_PER_DOCUMENT_LIMIT_USD`, etc) exist and are a reasonable foundation to extend. |
| AI-09 | §11 | TBD | NOT_STARTED | Failure/fallback. Not yet read this session (likely in `packages/services/src/ai.ts`, not yet opened). |
| AI-10 | §11 | NEW | NOT_STARTED | Evaluation (50+ doc sets, precision/coverage targets per provider). No evaluation harness found yet. |

## Commercial controls and operational admin (COM, ADM) — PRD §12
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| COM-01 | §12 | NEW | NOT_STARTED | Plans/entitlements as data. Not yet located; no plan/entitlement schema observed in files read so far. |
| COM-02 | §12 | REUSE (confirmed) | IN_PROGRESS | Quota enforcement. `reserveUpload` (`packages/services/src/uploads.ts`) confirmed atomic via a fixed-key `pg_advisory_xact_lock`, tested for the "in-flight reservation counts before commit" TOCTOU gap. `maxUploadBytes` corrected to the PRD's 20 MiB (EVI-01). Concurrency is proven via sequential simulation, not a genuine `Promise.all` race (PGlite serializes transactions), a documented, pre-existing test-infrastructure limitation, not a new gap. Abandoned-reservation reconciliation exists (24h). |
| COM-03 | §12 | NEW | NOT_STARTED | Manual billing (TRIAL/ACTIVE/GRACE/SUSPENDED/CLOSED). Not yet located. |
| COM-04 | §12 | NEW | NOT_STARTED | Agency branding. Not yet located. |
| ADM-01 | §12 | TBD | NOT_STARTED | Admin workspace. Not yet read this session. |

## Architecture and data contract (ARC) — PRD §13
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| ARC-01 | §13 | REUSE (confirmed) | NOT_STARTED | Relational integrity. `profile.ts`/`missions.ts`/`agency.ts` confirmed to use Drizzle with typed schema references, transactions (`db.transaction`), and explicit ownership/grant checks before any mutation; client-supplied IDs are consistently treated as lookup inputs re-verified against ownership/grants, not bare authorization. Constraint-level (FK/unique/check) coverage in `schema.ts` not yet exhaustively audited. |
| ARC-02 | §13 | REUSE (confirmed) | NOT_STARTED | Mission as Case, no competing table. Confirmed: `schema.missions` is the actual entity `missions.ts` operates on; no separate `Case` table found or implied anywhere read this session. |
| ARC-03 | §13 | REUSE (confirmed) | IN_PROGRESS | Durable jobs/outbox. `processingJobs` and `erasureJobs` (`packages/db/src/schema.ts`) confirmed as a real, tested durable-job pattern: fencing-token leases, at-least-once-safe retry with backoff, idempotency keys, `deletionAttemptedAt` written before the external call rather than after specifically to avoid an ambiguous retry window. A strong template to reuse for Part 2's support-grant expiry sweeps rather than building new job infrastructure. |
| ARC-04 | §13 | REUSE (confirmed) | IN_PROGRESS | Data migrations. `docs/governance/integration-and-cleanup-directive.md` confirmed to mandate additive-only migrations and forbid rewriting applied ones; 28 migrations already applied (`packages/db/migrations/0000`-`0027`), all forward-only by inspection of the directory. This part adds new additive migrations for SEC-03/SEC-06 on top, never editing an existing one. |

## Security requirements (SEC) — PRD §14
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| SEC-01 | §14 | REUSE (confirmed, partial) | IN_PROGRESS | Authorisation default-deny. `profile.ts`/`missions.ts`/`agency.ts` confirmed to route every mutation through `authorize()` (`@visastack/policy`) or explicit ownership/grant checks, with denials audited (`FACT_EDIT_DENIED`, `MISSION_NOTE_DENIED`). Strong existing foundation; see `asvs-l2-map.md` V8. PRD's explicit "every binary-delivery endpoint" clause (Part 3): `/api/blob/[key]` now independently re-runs authorization at redemption, not just at mint (see EVI-06). Full endpoint-by-endpoint coverage (lists, counts, jobs, cached results) not yet exhaustively audited; DB runtime-vs-migration credential separation not yet checked. |
| SEC-02 | §14 | TBD | NOT_STARTED | Transport/browser hardening (CSP, headers, rate limits). Rate limiting confirmed to exist and be used (`checkRateLimit`/`RATE_LIMITS.EVIDENCE_REQUEST` in `agency.ts`); broader header/CSP coverage deferred to Part 9 per the directive's own sequencing. |
| SEC-03 | §14 | REPAIR (implemented, partial scope) | IN_PROGRESS | Encryption and keys. `KeyManagementPort` + envelope-key architecture (AES-256-GCM, random nonce, AAD binding subject/record/field/version, wrapped-key-only persistence) built and wired into `profile.ts`'s fact read/write path, with `LocalEnvelopeKeyProvider` as an explicitly non-commercial dev/test adapter. 22+7 new tests passing (round-trip, tamper/AAD-mismatch rejection, fail-closed with no port, cross-port isolation). Full detail: `architecture-decisions.md` AD-01. Remaining, explicitly not yet done: AI proposals/OCR/snapshots/exports/cache are not protected (belong to Parts 7/8); no historical plaintext backfill; live KMS adapter/verification BLOCKED (no vendor account). |
| SEC-04 | §14 | REUSE (confirmed) + NEW (checkpoint, implemented) | IN_PROGRESS | Audit. `appendAuditEvent` confirmed used consistently and atomically across every write path read this session. Append-only enforced at the DB level, confirmed by reading the actual migration: `CREATE RULE "audit_events_no_update" ... DO INSTEAD NOTHING` and the matching `_no_delete` rule (`packages/db/migrations/0000_superb_blazing_skull.sql`). This is real, not just a README claim. Periodic signed checkpoint/anchor capability now built: `audit-checkpoints.ts` (`createAuditCheckpoint`/`verifyCheckpointSignature`/`verifyCheckpointAgainstChain`/`eventsInCheckpointRange`), HMAC-SHA256 over `(fromSeq, toSeq, chainHeadHash)` with a caller-supplied secret never read from the environment inside the service function itself, `audit_checkpoints` table append-only at the DB level via the same RULE pattern. 9 new tests passing, including a genuine tamper-detection test that disables the `audit_events_no_update` RULE to simulate a party who bypassed it (a plain UPDATE against the live RULE is correctly a no-op, proven by the adjacent append-only test): `verifyCheckpointAgainstChain` correctly fails while `verifyCheckpointSignature` still passes, showing why both checks are required together. Remaining, explicitly not yet done: no scheduled/periodic caller wired up (operational wiring, later part); no true external anchor outside this database (see the file's own header comment for the exact boundary of what this proves). |
| SEC-05 | §14 | REPAIR (implemented, partial scope) | IN_PROGRESS | File/export boundary, real malware scanning. Real-engine requirement closed: see EVI-02 for full detail (`ClamAvScanner`, live-verified against a real daemon, CI-wired). Remaining SEC-05 scope not yet touched this chunk: decompression/page-count/pixel/memory/CPU/time guards on the scanner path itself (ClamAV's own `MaxScanSize`/`MaxFileSize`/`MaxRecursion` config provides real limits, but this session has not audited the exact deployed values against the directive's numbers); ZIP-entry safe-naming for exports (distinct from the existing DOCX-upload zip-bomb check); export size/streaming/24h-artifact-lifetime. Tracked for a later Part 3 chunk. |
| SEC-06 | §14 | NEW (implemented) | IN_PROGRESS | Privilege and support grants (60-minute max, reasoned, approved). `support_grants` table with DB-enforced max-duration and no-self-approval check constraints; `createSupportGrant`/`revokeSupportGrant`/`loadSupportGrantsForPolicy` reuse the existing tested policy-engine grant evaluation rather than a parallel path. 11 new tests passing, including proof the DB constraints hold even bypassing the service layer. Its actual wiring into document access (`accessDocument`/`recheckDocumentAccess`, `documents.ts`) landed in a later Part 3 chunk (see EVI-06); this grant is correctly issued/approved/revoked either way, and now is also genuinely consumable. Full detail: `architecture-decisions.md` AD-02. Remaining: no admin UI calls these functions yet (Part 5/9 scope, ADM-01). |
| SEC-07 | §14 | REUSE (confirmed) | VERIFIED | Supply-chain hardening. `SECURITY.md` confirms CodeQL and dependency-review workflows exist. This session's own `pnpm audit --prod` run (Part 1) found and fixed 13 real vulnerabilities (2 critical); now 0 known vulnerabilities, confirmed by a clean re-run, not assumed. Evidence: `docs/commercial-v1/test-evidence.md`. |

## Privacy retention and exit (PRV) — PRD §15
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| PRV-01 | §15 | NEW | NOT_STARTED | Data map (legal entity, controller/processor, subprocessors). Not yet located; this is a documentation/legal-review deliverable more than code. |
| PRV-02 | §15 | TBD | NOT_STARTED | Retention defaults by class. Not yet read this session. README/`docs/operations/recovery.md` confirm retention/erasure is described as complete by the prior engagement (`retentionDeletionWorkflow` gate hardcoded `true`); class-specific defaults not yet independently audited. |
| PRV-03 | §15 | REUSE (reported) | NOT_STARTED | Erasure. `commercial-readiness.ts` gate `retentionDeletionWorkflow` confirmed hardcoded `true` with comment "genuinely complete, not aspirational" (PR 4). Not yet independently re-read this session beyond that gate file. |
| PRV-04 | §15 | TBD | NOT_STARTED | Portability/offboarding, backup tombstone replay. Not yet read this session. |

## Experience and accessible delivery (UX) — PRD §16
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| UX-01 | §16 | TBD | NOT_STARTED | Navigation IA. Not yet read this session. |
| UX-02 | §16 | TBD | NOT_STARTED | Critical-screen states. Not yet read this session. |
| UX-03 | §16 | REUSE (reported, partial) | NOT_STARTED | Language/accessibility. README confirms `packages/i18n` (English/Bangla message catalog) exists. WCAG 2.2 AA coverage not yet audited. |

## Reliability and operating evidence (OPS) — PRD §17
| ID | PRD § | Classification | Status | Notes |
|---|---|---|---|---|
| OPS-01 | §17 | TBD | NOT_STARTED | Service objectives, load envelope. Not yet read this session. |
| OPS-02 | §17 | REPAIR (confirmed) | NOT_STARTED | Recovery. `docs/operations/recovery.md` read this session: it states RPO <=5 min / RTO <=60 min, which the PRD Section 17 explicitly supersedes with a single stricter-but-more-conservative V1 target (RPO <=15 min, RTO <=4h) "until a stricter target is demonstrated." The doc's drill procedure (Neon PITR to a new branch, `verifyAuditChain`, row-count spot check) is a reasonable starting design but has not been executed against the new target, and does not yet cover encryption keys, deletion tombstones, or revocation replay as PRD §17 requires. Needs reconciliation, not a rewrite from scratch. |
| OPS-03 | §17 | TBD | NOT_STARTED | Monitoring/incidents. `/api/health/live`, `/api/health/ready` confirmed to exist per README; alerting/incident-owner coverage not yet audited. |
| OPS-04 | §17 | NEW | NOT_STARTED | Analytics. Not yet located this session. |

## Customer journeys (J01-J15) — PRD §18
| ID | Status | Notes |
|---|---|---|
| J01 | NOT_STARTED | Independent traveller |
| J02 | NOT_STARTED | Agency onboarding |
| J03 | NOT_STARTED | Agency invites traveller |
| J04 | NOT_STARTED | Repeat case |
| J05 | NOT_STARTED | Expiry replacement |
| J06 | NOT_STARTED | Sharing |
| J07 | NOT_STARTED | Agency preparation/readiness |
| J08 | NOT_STARTED | Applicant truth |
| J09 | NOT_STARTED | Outcome/feedback |
| J10 | NOT_STARTED | Change agency |
| J11 | NOT_STARTED | Family/sponsor contributor |
| J12 | NOT_STARTED | Owner operations |
| J13 | NOT_STARTED | Public trust |
| J14 | NOT_STARTED | Export/exit |
| J15 | NOT_STARTED | AI admin provider change |

## Acceptance tests (A01-A35) — PRD §19
| ID | Status | Principal requirements | Notes |
|---|---|---|---|
| A01 | NOT_STARTED | IAM-01, SEC-01 | Identity/MFA |
| A02 | NOT_STARTED | IAM-01, SHR-02 | Revocation |
| A03 | NOT_STARTED | IAM-02, SEC-01 | Tenant boundaries |
| A04 | NOT_STARTED | SHR-01, SHR-02 | Grant precision |
| A05 | NOT_STARTED | IAM-03, CAS-08 | Invitation |
| A06 | NOT_STARTED | EVI-01, EVI-02 | Upload threats |
| A07 | NOT_STARTED | EVI-02, COM-02 | Upload integrity |
| A08 | NOT_STARTED | EVI-06, SEC-05 | Safe delivery |
| A09 | NOT_STARTED | PRO-02 | Profile history |
| A10 | NOT_STARTED | CAS-05 | Private notes |
| A11 | NOT_STARTED | CAS-03, CAS-04 | Requests/tasks |
| A12 | NOT_STARTED | RUL-01 to RUL-05 | Rules regression |
| A13 | NOT_STARTED | CAS-01, RUL-04 | Manual route |
| A14 | NOT_STARTED | TRU-01 | Snapshot minimisation |
| A15 | NOT_STARTED | TRU-02, TRU-03 | Acknowledgement |
| A16 | NOT_STARTED | TRU-03, TRU-04 | Post-approval change |
| A17 | NOT_STARTED | NTF-01 to NTF-04 | Alerts |
| A18 | NOT_STARTED | NTF-03 | Email provider |
| A19 | NOT_STARTED | AI-01 to AI-03 | AI providers |
| A20 | NOT_STARTED | AI-04, AI-05, AI-10 | AI quality |
| A21 | NOT_STARTED | AI-06 | AI privacy |
| A22 | NOT_STARTED | AI-07 | AI endpoints |
| A23 | NOT_STARTED | AI-08, AI-09 | AI resilience |
| A24 | NOT_STARTED | AI-08 | AI concurrency |
| A25 | NOT_STARTED | SEC-03 | Encryption |
| A26 | NOT_STARTED | SEC-04 | Audit |
| A27 | NOT_STARTED | ADM-01, SEC-06 | Privilege |
| A28 | NOT_STARTED | COM-01 to COM-04 | Commerce |
| A29 | NOT_STARTED | PRV-01 to PRV-04 | Privacy |
| A30 | NOT_STARTED | OPS-02 | Recovery |
| A31 | NOT_STARTED | ARC-04, SEC-07 | Deployment |
| A32 | NOT_STARTED | UX-01 to UX-03 | UX/language |
| A33 | NOT_STARTED | OPS-01 | Capacity |
| A34 | NOT_STARTED | RUL-06 | Public trust |
| A35 | NOT_STARTED | SEC-01 to SEC-07 | Independent review. Per PRD §22/directive Part 10 §7: this session cannot self-certify independent review. Can only ever reach BLOCKED or reflect an externally-sourced report. |

## Capability inventory summary (Part 1 Section 10)

Counting only rows with a grounded (non-TBD) classification as of this commit:

- REUSE: 10 (PRO-02, CAS-01 partial, CAS-03 partial, RUL-01 partial, RUL-04 partial, AI-04
  partial, AI-06, ARC-01, ARC-02, ARC-04 partial, SEC-01 partial, SEC-04 partial, SEC-07
  partial, UX-03 partial — note some of these are REUSE-leaning EXTEND; see individual rows)
- REPAIR: 7 (EVI-02, TRU-01, TRU-03, AI-08, SEC-03, OPS-02, plus SEC-05/EVI-02 counted once)
- EXTEND: 8 (IAM-01, CAS-01, CAS-04, CAS-05, CAS-06, AI-01, RUL-04, PRO-01)
- REPLACE: 3 (NTF-03, AI-03, SEC-05)
- KEEP DISABLED: 0 identified yet
- NEW: 10 (TRU-02, TRU-04, AI-02, AI-05, AI-07, AI-10, COM-01, COM-03, COM-04, PRV-01, OPS-04,
  CAS-08 — 12 actually, see rows)
- TBD (not yet classified): the remainder; roughly half of all 75 P0 rows, concentrated in
  domains not yet opened this session (EVI-01/03/04/05/06 detail, most of NTF, most of RUL,
  SHR detail, most of COM, ADM-01, ARC-03, SEC-02/06, PRV-02/04, UX-01/02, OPS-01/03).

These counts are approximate and will tighten as each part actually opens the relevant code;
they are reported here to satisfy Part 1's capability-inventory requirement with real
evidence rather than to claim a false precision the current read-depth does not support.
