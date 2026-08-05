# Erasure and Retention Boundary

Authority: master recovery directive §7 "PR 4"; Build Spec §13, §14; PRD §2, §5.
Companion to [tenant-isolation-matrix.md](./tenant-isolation-matrix.md) and
[document-trust-boundary.md](./document-trust-boundary.md)'s same pattern —
this is the concrete control-to-test map for erasure, retention, and data
portability, maintained as erasure-relevant code changes.

A deletion is never "done" the moment a database row disappears. Two
distinct facts have to both become true, in order: the logical record is
gone (nobody can query it), and the external bytes it pointed at are
verified gone (not merely "a delete call was made"). Nothing in this system
reports the second fact before actually checking it.

## Deletion outbox

| Control | Enforcement | Verified by |
|---|---|---|
| Logical deletion and external-byte deletion are decoupled — a slow or failing external call never blocks, and is never silently skipped by, the logical cascade | `erasure_jobs` (migration `0018`) is a durable, append-only outbox: `PENDING → CLAIMED → DELETED → VERIFIED`, or `FAILED`/`BLOCKED_BY_HOLD`. `executeAccountDeletion`/`purgeExpiredDocuments` (`packages/services/src/{deletion,retention}.ts`) only ever enqueue; `runErasureWorker` (`packages/services/src/erasure.ts`) is the only thing that ever calls `BlobStore.deleteObject` | `erasure.test.ts` — full state-machine coverage |
| A job never reports itself deleted before the bytes are confirmed gone | `deleteObject` then `getObject` (expect `undefined`) are two separate steps; only a confirmed-absent read moves a job to `VERIFIED`. A delete that "succeeds" but leaves bytes in place (e.g. an eventually-consistent backend) is treated as a failure, not a success | `erasure.test.ts` → "treats a delete that leaves bytes in place as a failure, never as verified" |
| A retriable failure never loses the job | Bounded exponential backoff (`FOR UPDATE SKIP LOCKED` claim, same proven shape as `processingJobs`/`jobs.ts`) up to `maxAttempts`, then parked at `FAILED` — visible, never silently dropped | `erasure.test.ts` → "retries a failed delete with backoff, then parks at FAILED" |
| The storage-object row and (for a deferred purge) the document row are removed only after verification, and in an order that never violates the `documentVersions.storageObjectId` `restrict` FK | `finalizeVerifiedJob` deletes the document first (cascading its versions), then the now-unreferenced storage object | `erasure.test.ts` → "also deletes the deferred document once verified" |
| Failed and blocked jobs are admin-visible and retryable, never a silent dead end | `listErasureJobsNeedingAttention`/`retryErasureJob`, surfaced on `/app/admin` (mirrors the existing failed-intake-job card exactly) | `erasure.test.ts` → the listing/retry tests; manual verification on `/app/admin` |
| A crashed invocation or missed trigger is never a permanent loss | `/api/jobs/process-erasure` (Vercel Cron, `CRON_SECRET`-gated, same pattern as `process-intake`) sweeps due jobs independently of any specific caller | Manual verification (cron configuration in `apps/web/vercel.json`) |
| Enqueuing the same storage object twice while a job is still active never creates a duplicate row (D-A1, post-programme defect register, PR-C1) | `enqueueErasureJob` checks for an existing job on the same `storageObjectId` in any status except `VERIFIED` (whose bytes are already provably gone) before inserting, returning the existing row instead — `purgeExpiredDocuments` can be invoked repeatedly (a manual admin action) against a document that deliberately survives until every sibling verifies (finding #13), and without this check would keep re-enqueueing redundant jobs against a stuck `FAILED`/`BLOCKED_BY_HOLD` sibling. A pure efficiency/hygiene fix — `finalizeVerifiedJob`'s completion check (finding #13, round 5) was already correct regardless of duplicates, by construction | `erasure.test.ts` → "enqueue-time deduplication" describe block; `retention.test.ts` → "does not enqueue a duplicate erasure job when purgeExpiredDocuments runs again against the same still-eligible document" |

## Legal hold — closing the check-then-act race

| Control | Enforcement | Verified by |
|---|---|---|
| A hold placed between "check" and "act" can never be raced past for account deletion | The hold check in `executeAccountDeletion` runs on the same transaction (`tx`) that performs the cascade — not on a separate pre-check against `db` before the transaction opens | `retention.test.ts` → "blocks account deletion while an active hold exists" |
| Same race, closed the same way, for retention purge | `purgeExpiredDocuments` rechecks the hold per-document, inside that document's own enqueue transaction — `documentsPastRetention`'s own read is a snapshot, never trusted as still-true moments later | `retention.test.ts` → "blocks the erasure worker... when a hold appears after queuing" |
| A hold placed during the (potentially slow) external delete+verify round trip is still caught | The erasure worker rechecks the hold again at finalize time, immediately before removing the document/storage-object rows. Bytes already deleted at that point are unrecoverable, but the logical record is preserved rather than removed | `erasure.test.ts` → "blocks a RETENTION_PURGE job at finalize time if a hold appears mid-flight" |

## Account deletion — include or anonymize

| Data | Treatment | Why |
|---|---|---|
| Applicants, missions, grants, documents, versions, facts | Deleted (cascade from `applicants`) | Owned outright by the account |
| Storage bytes | Queued to the erasure outbox, not deleted synchronously | See above |
| Memberships, assignments, recipient-side grants, consents | Deleted (existing `onDelete: cascade` FKs) | Account-scoped |
| Product events, audit trail actor references | Anonymized (`set null` FK) | The aggregate/history is retained; the identity is not |
| Rate-limit buckets | Deleted explicitly (`subjectId` is the raw accountId, not FK-linked) | Named explicitly in the directive; nothing else would ever clean these up |
| Mission notes authored by this account | Anonymized explicitly (`authorAccountId` set null) | Collaborative history can live on a mission this account never owned (an org member's note on someone else's mission) — this column has no FK to enforce it declaratively, so it's done in application code |
| A due request is actually executed | `/api/jobs/process-deletions` (Vercel Cron) calls `executeAccountDeletion` for every request whose grace window has elapsed. Before this PR, nothing ever called it — a request would sit at `PENDING` forever | `lifecycle.test.ts`; manual verification on the cron schedule |

## Account export — data portability

`exportAccount` (`packages/services/src/export.ts`) assembles every
account-linked record: identity, consents, memberships, assignments, grants
(both owned and received), mission notes authored, product events, and, per
applicant: facts with full version history, documents with versions/name-
history/scan-results, missions with snapshots, grants, evidence requests,
and AI extraction runs with their field proposals. Excludes: secrets,
internal cryptographic material (the audit hash chain's signing material,
blob-token signing secret), other users' data, unrelated organization data.

## What this does NOT yet cover (tracked, not silently dropped)

- **AI provenance below the proposal level.** `evidenceLocations`
  (the cited source-text snippet a proposal points to), `conflicts`, and
  `correctionFeedback` are not included in the export — only the
  `fieldProposals` themselves. These are meta-annotations on a proposal
  rather than personal data in their own right; add them if a real user
  request surfaces a concrete need.
- **Orphan reconciliation's "blob without DB reference" finding is report-
  only, permanently, by design** — not a gap to close later. Deleting bytes
  on the strength of "no database row found it" is a categorically
  higher-risk, irreversible action than tidying a dangling pointer, and
  deserves an explicit human decision every time, not a bulk automated rule.
- **No automatic retry sweep for `BLOCKED_BY_HOLD`.** A blocked job clears
  once an admin retries it (same action as a `FAILED` job); it does not
  automatically re-attempt the moment the hold is released. Add a periodic
  sweep if held-then-released volume ever makes manual retry impractical.
- **Orphan reconciliation's duplicate-reference and size/hash-mismatch
  checks are unbounded table scans** (`documentVersions`, and per-object
  reads respectively, both capped by `limit` where the cost is real i/o —
  the blob listing and the per-object byte reads — but not by an artificial
  cap on the cheap indexed aggregation). Fine at pilot scale; revisit if the
  document count grows large enough for it to matter.

## Verification

`packages/services/src/{erasure,reconciliation}.test.ts` are the dedicated
suites. `packages/services/src/{retention,lifecycle}.test.ts` cover the two
callers end-to-end, including driving a queued job through
`runErasureWorker` to confirm actual byte removal. Re-run on every change to
`packages/services/src/{erasure,deletion,retention,reconciliation,export,
legal-hold}.ts`, `packages/adapters/src/{neon-blob,vercel-blob}.ts`,
`packages/services/src/storage.ts`, or `apps/web/src/lib/jobs.ts`.
