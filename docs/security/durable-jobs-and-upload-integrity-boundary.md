# Durable Jobs and Upload Integrity Boundary

Authority: master recovery directive §5 ("DB-backed jobs for low pilot
volume"), §7 "PR 6". Companion to
[tenant-isolation-matrix.md](./tenant-isolation-matrix.md),
[document-trust-boundary.md](./document-trust-boundary.md),
[erasure-and-retention-boundary.md](./erasure-and-retention-boundary.md), and
[identity-and-step-up-boundary.md](./identity-and-step-up-boundary.md)'s same
pattern — this is the concrete control-to-test map for job leasing/
uniqueness, processing idempotency, upload consistency, and free-tier/pilot
controls, maintained as jobs/upload/quota-relevant code changes.

## Job leases

A claim is a time-bound lease, not a permanent hand-off — a crashed worker's
job becomes claimable again automatically, with no separate admin action or
cron required.

| Control | Enforcement | Verified by |
|---|---|---|
| Two workers can never process the same job at once | `claimJobs` (`packages/services/src/jobs.ts`) selects due jobs `FOR UPDATE SKIP LOCKED`, so a concurrent claimer skips rows already held rather than blocking or double-claiming | `jobs.test.ts` → "respects the limit, leaving extra due jobs for the next call" |
| A crashed worker's claimed job is reclaimed automatically | Every `claimJobs` call first reclaims any `CLAIMED` job whose `leaseExpiresAt` (5-minute TTL) has passed — back to `PENDING`, lease cleared — in the *same* transaction that then claims new due work, so a reclaimed row is instantly re-claimable | `jobs.test.ts` → "reclaims a stale lease (worker crashed after claiming) and processes the job on the next call" |
| A worker that outlives its own lease can never stomp on whoever claimed the job next | `completeJob`/`failJob` are compare-and-set: `WHERE status = 'CLAIMED' AND lease_owner = <this invocation>`. A write that matches zero rows (lease lost) is treated as "do nothing further," never an error | `jobs.test.ts` → "a lease reclaimed while the original claimer is still genuinely running protects against a double-completion (CAS)" (deferred-promise pattern: the first worker's scan is paused mid-flight while a reclaim-and-complete happens underneath it, then resumed) |
| A failure retries with backoff, then parks visibly rather than looping or vanishing | Exponential backoff (30s, 60s, 120s, 240s, ...) up to `maxAttempts`, then `FAILED` with a categorized `errorCode` and the raw `lastError` text (admin-only), surfaced on `/app/admin` with a retry action | `jobs.test.ts` → "retries a failing job with backoff, then parks it at FAILED once attempts are exhausted"; "lists exhausted jobs with document context, and lets an admin retry one"; "records a categorized, safe error code derived from the stage that failed — never the raw error text as the category" |
| A `CLAIMED` job that predates the lease columns entirely (no backfill migration) is still eventually reclaimed, but never prematurely (finding #21, post-programme defect register, PR-C1) | `lease_expires_at < now()` alone never matches `NULL` under SQL's three-valued logic, permanently stranding a pre-migration row. `claimJobs`' reclaim predicate now also matches `lease_expires_at IS NULL AND claimed_at` older than one full lease duration — gated on `claimedAt` age, not a bare `IS NULL`, so a job whose own (pre-migration) worker might still be genuinely mid-flight isn't reclaimed too eagerly. Mirrors `erasure.ts`'s already-proven identical fix (Codex review, PR-B1) exactly | `jobs.test.ts` → "reclaims a CLAIMED job with no lease at all once its claim is old enough"; "does NOT reclaim a lease-less CLAIMED job whose claim is still recent" |

## Job and processing uniqueness

| Control | Enforcement | Verified by |
|---|---|---|
| Enqueuing the same document version twice never creates a duplicate job | `idempotencyKey` = `` `${documentVersionId}:${jobType}:${processingVersion}` `` is a unique column; `enqueueIntakeJob` upserts on it (`onConflictDoUpdate` with a no-op `updatedAt` touch — the only Drizzle upsert form that reliably returns the existing row via `.returning()`) | `jobs.test.ts` → "is genuinely idempotent (master directive §7 'PR 6') — enqueuing the same document version twice returns the same row, never a duplicate" |
| A document version's own state transition can't be double-applied by two workers racing past the job layer | `commitTransition` (`packages/services/src/intake.ts`) is itself compare-and-set — `WHERE id = version.id AND processing_status = version.processingStatus` — and returns `undefined` (never throws) on a lost race; callers reload fresh state and return early. This is the second, deeper layer of protection, for the narrow case where a lease-holder is still genuinely (not crashed) running when another worker reclaims and fully completes the same document version | Exercised as part of `jobs.test.ts`'s CAS test above, which drives a real `processIntake` call through a paused scanner while a second claim-and-complete happens underneath it |
| A worker whose lease was reclaimed mid-step can't persist its own scan-result/extraction-result/classification/naming-proposal side effects alongside the new lease-holder's genuinely authoritative ones (finding #19, post-programme defect register, PR-C1) | `commitTransition`'s CAS above only protects `processingStatus` itself — it does nothing for the writes a step performs BEFORE that final transition. `processIntake` now accepts optional `fencing: {jobId, leaseOwner}` (threaded from `runIntakeWorker`'s own claim); a new `stillHoldsLease` helper (a CAS no-op `UPDATE` on `processingJobs`, not a plain `SELECT`, so the check is itself atomic against a concurrent reclaim) is called immediately after each of the two slow external calls that can span a reclaim (`scanner.scan()`, `extractor.extract()`) — before any of that step's writes — and a lost lease stops the pipeline immediately, performing none of them. Mirrors `erasure.ts`'s identical fencing discipline around its own slow external call (`blobStore.deleteObject`) | `jobs.test.ts` → the existing paused-scanner CAS test now also asserts exactly one `documentScanResults` row survives the race (previously unchecked); a new, parallel paused-extractor test proves the same for `extractionRuns`/`documentClassifications`/the name-proposal row |
| An invocation whose lease has expired by wall-clock time, but that nobody has actually reclaimed yet, treats itself as having lost the lease too — for BOTH the side effects above and the job record's own completion (Codex review, PR-C1, round 1) | Matching only `id`/`status`/`leaseOwner` (as above) answers "does the row still nominally say I'm the holder," not "is my lease still genuinely unexpired" — a lease past `leaseExpiresAt` with no reclaim yet still passes that check. `stillHoldsLease` now also requires `leaseExpiresAt > now()`. Kept consistent with `completeJob`/`failJob` (`jobs.ts`), which had the identical gap: without the same addition there, an invocation `stillHoldsLease` correctly stopped from writing side effects could still have its job marked `DONE`/resolved, stranding the document version mid-pipeline with nothing left to retry it | `jobs.test.ts` → a new test pauses a scanner, expires the lease with no other invocation ever reclaiming it, then resumes: no scan-result row is written, the job stays `CLAIMED` (never `DONE`), and a follow-up `runIntakeWorker` call genuinely reclaims and completes it normally |
| AI extraction attempts/budget checks can't be raced by two near-simultaneous requests for the same document (a double-click, a network retry) | `runExtraction` (`packages/services/src/ai.ts`) wraps its entire body — consent check through the final insert — in one transaction holding `pg_advisory_xact_lock(hashtext(documentVersionId))`. The second caller's checks only run after the first has fully recorded its run. Does not limit *deliberate* bounded retries (up to `maxAttemptsPerDocument`) — only concurrent ones | Not exercised by a `Promise.all` race test — see "PGlite testability" below. `ai.test.ts` does cover the sequential behavior the lock protects: "enforces a max-attempts cap per document," "enforces the durable, platform-wide cost budget across separate calls," "enforces a per-document budget cap independent of the platform-wide cap" |
| Extraction/classification/naming runs don't need a uniqueness constraint of their own | `extraction_runs`, `document_classifications`, and `ai_extraction_runs` are intentionally append-only (multiple attempts per document version is a *feature* — retry history — not a bug), so they carry query indexes, not unique constraints. They're transitively protected instead: only one `processing_job` can ever be `PENDING`/`CLAIMED` for a given `(documentVersionId, jobType, processingVersion)` at a time, and `runExtraction`'s advisory lock separately protects AI runs specifically | `jobs.test.ts`'s idempotent-enqueue test (job layer); `ai.test.ts`'s budget/attempt-cap tests (AI layer) |
| A document's filename proposal can't be duplicated per version | Pre-existing `document_versions_doc_version_unique` — unrelated to this PR, already covered | `document-naming.test.ts` |

## Upload consistency

Saga order: server-created upload intent → quota reservation → opaque
object key → private upload → server-side size/hash verification
(round-trip read, same discipline as the erasure worker's delete-then-verify)
→ atomic document + first-version registration → job enqueue → reservation
finalization. On failure at any step: release the reservation, delete any
partial blob, mark the intent failed, surface a recoverable error — never an
invisible orphan (a document row nobody can complete, or bytes nobody's
metadata points to).

| Control | Enforcement | Verified by |
|---|---|---|
| Quota is reserved, atomically, BEFORE any bytes are written | `reserveUpload` (`packages/services/src/uploads.ts`) checks every tier (per-file, per-applicant, per-account, platform) against committed bytes *plus* every other still-active reservation, then inserts the `upload_intents` row, all in one transaction | `uploads.test.ts` → "reserves an upload comfortably within every limit"; "refuses a single file larger than the per-file limit, without touching the database" |
| A still-in-flight upload (no document version yet) still counts toward quota — the exact TOCTOU gap a plain read-then-decide check left open | `activeReservedBytesFor`/`activePlatformReservedBytes` sum every `RESERVED`, non-expired intent alongside committed `document_versions.sizeBytes` | `uploads.test.ts` → "a still-active reservation from another in-flight upload counts toward the applicant limit, even though it hasn't committed any bytes yet" |
| An abandoned upload can't hold quota hostage forever | Reservations expire after 10 minutes (well past any realistic upload duration); expired ones are excluded from every quota sum via `expiresAt > now()`, no separate cleanup sweep needed | `uploads.test.ts` → "an expired reservation no longer counts toward any limit" |
| The platform-wide hard stop is race-free across *different* accounts too, not only within one applicant/account | A single fixed, well-known advisory lock key (`pg_advisory_xact_lock(hashtext('visastack:upload-quota'))`) serializes every reservation attempt platform-wide; pilot-scale volume makes full serialization a negligible cost | Not exercised by a `Promise.all` race test — see "PGlite testability" below. `uploads.test.ts` does cover the sequential properties the lock protects: an already-committed reservation is correctly counted by a later call, and an expired one is correctly excluded |
| A written blob is confirmed present and correctly sized before anything is registered against it | A fresh `storage.getObject` read after `putObject` — never trusts "the write call didn't throw" alone | Exercised implicitly by every successful-path service test that calls `addDocumentVersion` after a real `putObject`; the verification logic itself lives in `apps/web`'s `uploadDocumentAction` (server actions are not directly unit-tested in this codebase — see `docs/README.md`'s test conventions) |
| A brand-new document can never end up with zero versions | `registerDocumentWithVersion` (`packages/services/src/documents.ts`) wraps `registerDocument` + `addDocumentVersion` in one transaction (a savepoint-backed nested transaction, since each already opens its own). A failure in the version half rolls back the document insert too — previously, calling the two separately could leave a versionless, uncompletable document row behind if the second call failed after the first had already committed | `documents.test.ts` → "registers a document and its first version together"; "leaves no versionless orphan document behind when the version half of the write fails — the exact partial-commit the two calls used to risk when made separately" (forces a real mid-transaction failure via a unique-constraint collision, not a modeled `Result` error, to exercise the actual rollback path) |
| A genuinely unexpected exception (not a modeled failure) still releases the reservation and cleans up | `uploadDocumentAction`'s reservation-guarded region (bytes read through document registration) is wrapped in one try/catch as a safety net, on top of each step's own specific, better-messaged failure handling. Deliberately scoped to end at successful registration: once a document version durably exists and references the object key, a later failure enqueueing the intake job must never delete the blob out from under it | Not unit-tested (server actions aren't in this codebase — see above); reviewed by inspection. The underlying pieces it calls (`reserveUpload`, `registerDocumentWithVersion`, `failUpload`) are each independently tested above |
| Oversize uploads are rejected before the whole body is buffered into memory | `next.config.mjs`'s `experimental.serverActions.bodySizeLimit` (`'15mb'`, set explicitly — Next's own default of `'1mb'` was silently *below* this app's advertised 10 MB quota) is enforced by Next's own size-tracking streaming body reader, which throws a 413 before fully buffering an oversize body. `uploadDocumentAction` additionally pre-checks `file.size` against the configured quota before reading any bytes, as a faster-fail, defense-in-depth layer against a tighter runtime-configured quota | Confirmed by direct inspection of Next.js 15.5.21's compiled `action-handler.js` (streaming size-tracked read, not full-buffer-then-check); not independently unit-tested (framework behavior, not application code) |

## Free-tier / pilot controls

Every limit below is a *conservative pilot default*, applied the moment an
env var is left unset — never an "unlimited until configured" escape hatch.
An operator can only ever lower a limit via env override, never silently
raise one above its coded default.

| Control | Default | Verified by |
|---|---|---|
| Per-file upload size | 10 MB (`QUOTA_MAX_UPLOAD_MB`) | `quotas.test.ts` → "uses the pilot defaults (10/50/100/500/700 MB) with no env overrides" |
| Per-applicant evidence total | 50 MB (`QUOTA_MAX_APPLICANT_EVIDENCE_MB`) | Same test |
| Per-account evidence total | 100 MB (`QUOTA_MAX_ACCOUNT_EVIDENCE_MB`) | Same test |
| Platform-wide warning threshold | 500 MB (`QUOTA_PLATFORM_WARNING_MB`) | Same test; surfaced on `/app/admin`'s "Platform storage" card (`UsageMeter`'s `warnBytes` prop) — previously computed and tested in isolation but never actually displayed anywhere (dead config) until this PR |
| Platform-wide hard stop | 700 MB (`QUOTA_PLATFORM_HARD_STOP_MB`) | Same test; enforced by `reserveUpload`, also surfaced alongside the warning threshold on the same admin card |
| AI platform-wide monthly budget | $20 (`AI_PILOT_MONTHLY_HARD_LIMIT_USD`) | `apps/web/src/lib/ai.test.ts` → "defaults the platform budget to $20/month..."; enforcement covered by `ai.test.ts`'s budget tests |
| AI per-document budget | $0.50 (`AI_PER_DOCUMENT_LIMIT_USD`) | `apps/web/src/lib/ai.test.ts` → "defaults the per-document budget to $0.50..." |
| AI max attempts per document | 3 (`AI_MAX_ATTEMPTS`) | `apps/web/src/lib/ai.test.ts` → "defaults the max attempts per document to a small bounded-retry budget, not unlimited" — previously `undefined` (no cap at all) when unset, inconsistent with every `QUOTA_*` var in the same `.env.example`, which fails closed to a safe default on blank rather than to "unlimited" |
| AI max pages per document | 25 (`AI_MAX_PAGES_PER_DOCUMENT`) | `apps/web/src/lib/ai.test.ts` → "defaults the max pages per document to a bounded pilot figure, not unlimited" — same previously-uncapped gap |
| Every AI cap above ignores an invalid override rather than silently disabling the cap | `readPositiveIntEnv`/`readUsdEnv` (`apps/web/src/lib/ai.ts`) fall back to the coded default on a non-numeric or non-positive value | `apps/web/src/lib/ai.test.ts` → "ignores invalid overrides and keeps the safe pilot defaults" |

## PGlite testability

Two fixes in this PR (the AI-run advisory lock, the upload-quota advisory
lock) are correct for real Postgres but cannot be shown to matter via a
`Promise.all` race test in this repo's test environment: PGlite fully
serializes `db.transaction()` calls (confirmed by direct experiment — two
transactions instrumented with a delay and event logging always interleave
as `A:start → A:mid → A:end → B:start → B:mid → B:end`, never overlapping).
A second concurrent call's transaction callback never begins until the
first has fully committed, so a race test would pass identically whether or
not the lock is present — false confidence, not a real guarantee.

Both fixes are kept (they are still necessary and correct for production;
their correctness rests on Postgres's own documented
`pg_advisory_xact_lock` semantics — held until the current transaction
ends, a concurrent session requesting the same key blocks until then — not
on anything this codebase invents), and both are honestly documented as
such in code (`ai.ts`, `uploads.ts`) and in this doc, rather than backed by
a misleading test. What *is* genuinely testable, and tested, is the
non-concurrent property each lock's surrounding logic depends on: that an
already-committed run/reservation is correctly counted by a later call, and
that expired/excluded state is correctly excluded.

Races that span a pause *outside* any single transaction remain genuinely
testable, and are tested where they exist in this PR: `jobs.test.ts`'s
stale-lease-reclaim-during-still-running-worker (CAS) test uses a
deferred-promise scanner mock precisely because the pause happens in
application code between two separately-committing transactions, not inside
one.

## What this does NOT yet cover (tracked, not silently dropped)

- **A genuine concurrent-request race test for `reserveUpload` and
  `runExtraction`'s advisory locks.** See "PGlite testability" above —
  deliberately not attempted, rather than faked.
- **Automatic cleanup of a `FAILED` upload intent's row.** `failUpload`
  never deletes the row (by design — it's an audit trail of failed
  attempts), and there is no retention/purge policy for old `upload_intents`
  rows yet. Low priority at pilot volume; revisit if the table's growth
  ever becomes a real operational concern.
- **A proactive sweep for a document version stuck without a job row.**
  If `enqueueIntakeJob` itself were to fail *after* `registerDocumentWithVersion`
  has already committed (a genuinely rare case — a straightforward insert,
  not modeled as a `Result` failure anywhere in this path), the resulting
  document version would sit at `UPLOADING` with no job ever created for
  it, and no existing admin view or sweep currently detects that specific
  shape (only jobs that reached `FAILED` after exhausting retries are
  visible). Accepted as an extremely low-probability edge case at pilot
  scale (the same class of risk as "the database is down mid-request”);
  revisit with a proactive "versions stuck without a job" report if it is
  ever observed in practice.
- **Server actions are not unit-tested directly anywhere in this
  codebase** (confirmed: no `actions.test.ts` exists under `apps/web`).
  `uploadDocumentAction`'s saga is reviewed by inspection and covered
  indirectly through the service-layer functions it composes
  (`reserveUpload`, `registerDocumentWithVersion`, `failUpload`,
  `finalizeUpload`), each independently tested above.

## Verification

`packages/services/src/{jobs,documents,uploads,quotas,ai}.test.ts` and
`apps/web/src/lib/ai.test.ts` are the dedicated suites. Re-run on every
change to `packages/services/src/{jobs,intake,ai,documents,uploads,
quotas}.ts`, `apps/web/src/lib/ai.ts`, `apps/web/next.config.mjs`, or
`apps/web/src/app/app/applicant/[id]/actions.ts`.
