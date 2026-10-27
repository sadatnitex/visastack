import { createHash } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { billingFileReferenced } from './manual-claims';
import type { BlobStore, StorageBucket } from './storage';

/**
 * Orphan reconciliation (master directive §7 "PR 4") — an admin-triggered
 * sweep that detects drift between the domain's storage metadata and the
 * actual bytes in the blob backend. Bounded per run (`limit`), never a full
 * unbounded scan; safe to re-run repeatedly.
 *
 * Only one class of finding is ever corrected automatically, even outside
 * dry run: a metadata row with no backing bytes AND no remaining reference
 * (pure debris — nothing real is lost by removing it). Every other finding
 * — bytes with no metadata row, duplicate references, size/hash mismatches,
 * a VERIFIED job whose bytes somehow still exist — is report-only. Deleting
 * someone's still-existing bytes on the strength of "no DB row found it" is a
 * categorically higher-risk, irreversible action than tidying a dangling
 * pointer, and deserves an explicit human decision, not a bulk auto-delete.
 */

export interface DuplicateObjectReference {
  readonly storageObjectId: string;
  readonly documentVersionIds: readonly string[];
}

export interface SizeOrHashMismatch {
  readonly storageObjectId: string;
  readonly objectKey: string;
  readonly detail: string;
}

export interface OrphanReconciliationReport {
  readonly dryRun: boolean;
  /** storageObjects rows with no backing bytes. */
  readonly dbReferencesWithoutBlob: readonly string[];
  /** Object keys present in the blob store with no storageObjects row. */
  readonly blobsWithoutDbReference: readonly string[];
  readonly duplicateReferences: readonly DuplicateObjectReference[];
  readonly sizeOrHashMismatches: readonly SizeOrHashMismatch[];
  /** erasure_jobs ids marked VERIFIED whose bytes are somehow still present — a verification bug, not ordinary drift. */
  readonly verifiedButStillPresent: readonly string[];
  /** Debris rows actually removed (only ever a subset of dbReferencesWithoutBlob, and only outside dry run). */
  readonly cleaned: number;
}

export interface ReconcileOrphansInput {
  readonly actorAccountId: string;
  readonly bucket: StorageBucket;
  readonly dryRun: boolean;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const BLOB_LIST_PAGE_SIZE = 200;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function reconcileOrphans(
  db: Db,
  blobStore: BlobStore,
  input: ReconcileOrphansInput,
): Promise<OrphanReconciliationReport> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // (1) DB references without backing bytes, and size/hash mismatches for the
  // objects that DO still have bytes — one pass, one read per object.
  const objects = await db
    .select()
    .from(schema.storageObjects)
    .where(eq(schema.storageObjects.bucket, input.bucket))
    .limit(limit);
  const dbReferencesWithoutBlob: string[] = [];
  const sizeOrHashMismatches: SizeOrHashMismatch[] = [];
  for (const object of objects) {
    const stored = await blobStore.getObject(object.objectKey);
    if (!stored) {
      dbReferencesWithoutBlob.push(object.id);
      continue;
    }
    if (object.sizeBytes !== null && stored.bytes.byteLength !== object.sizeBytes) {
      sizeOrHashMismatches.push({
        storageObjectId: object.id,
        objectKey: object.objectKey,
        detail: `size mismatch: recorded ${object.sizeBytes}, actual ${stored.bytes.byteLength}`,
      });
    } else if (object.contentHash && sha256Hex(stored.bytes) !== object.contentHash) {
      sizeOrHashMismatches.push({
        storageObjectId: object.id,
        objectKey: object.objectKey,
        detail: 'content hash mismatch',
      });
    }
  }

  // (2) Blobs with no DB reference at all — page through the blob store,
  // batch-check each page against storageObjects in one query.
  const blobsWithoutDbReference: string[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await blobStore.listObjectKeys({
      bucket: input.bucket,
      ...(cursor ? { cursor } : {}),
      limit: Math.min(BLOB_LIST_PAGE_SIZE, limit - scanned),
    });
    if (page.objectKeys.length > 0) {
      const known = new Set(
        (
          await db
            .select({ objectKey: schema.storageObjects.objectKey })
            .from(schema.storageObjects)
            .where(inArray(schema.storageObjects.objectKey, [...page.objectKeys]))
        ).map((r) => r.objectKey),
      );
      for (const key of page.objectKeys) {
        if (!known.has(key)) blobsWithoutDbReference.push(key);
      }
    }
    scanned += page.objectKeys.length;
    cursor = page.cursor;
  } while (cursor && scanned < limit);

  // (3) Duplicate object references — more than one document version pointing
  // at the same storage object (pilot scale: a plain aggregation is cheap).
  const versionRows = await db
    .select({
      storageObjectId: schema.documentVersions.storageObjectId,
      documentVersionId: schema.documentVersions.id,
    })
    .from(schema.documentVersions);
  const byObject = new Map<string, string[]>();
  for (const row of versionRows) {
    const list = byObject.get(row.storageObjectId) ?? [];
    list.push(row.documentVersionId);
    byObject.set(row.storageObjectId, list);
  }
  const duplicateReferences: DuplicateObjectReference[] = [...byObject.entries()]
    .filter(([, versionIds]) => versionIds.length > 1)
    .map(([storageObjectId, documentVersionIds]) => ({ storageObjectId, documentVersionIds }));

  // (4) VERIFIED erasure jobs whose bytes are somehow still present — a
  // verification bug, distinct from ordinary drift. Most-recent first and
  // bounded, since VERIFIED jobs accumulate forever as durable history.
  const verifiedJobs = await db
    .select()
    .from(schema.erasureJobs)
    .where(eq(schema.erasureJobs.status, 'VERIFIED'))
    .orderBy(desc(schema.erasureJobs.completedAt))
    .limit(limit);
  const verifiedButStillPresent: string[] = [];
  for (const job of verifiedJobs) {
    const stored = await blobStore.getObject(job.objectKey);
    if (stored !== undefined) verifiedButStillPresent.push(job.id);
  }

  // Corrective action, dry run or not: only ever the unambiguous, reversible
  // case — a metadata row with no bytes AND no remaining reference.
  let cleaned = 0;
  if (!input.dryRun) {
    for (const storageObjectId of dbReferencesWithoutBlob) {
      const stillReferenced = first(
        await db
          .select({ id: schema.documentVersions.id })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.storageObjectId, storageObjectId))
          .limit(1),
      );
      if (stillReferenced) continue;
      // A payment proof whose bytes went missing stays registered (its report points at it).
      if (await billingFileReferenced(db, storageObjectId)) continue;
      await db.transaction(async (tx) => {
        await tx.delete(schema.storageObjects).where(eq(schema.storageObjects.id, storageObjectId));
        await appendAuditEvent(tx, {
          eventType: 'ORPHAN_RECONCILED',
          actorAccountId: input.actorAccountId,
          method: 'SYSTEM',
          result: 'ALLOWED',
          resourceType: 'storage_object',
          resourceId: storageObjectId,
          reason: 'no backing bytes and no remaining reference',
        });
      });
      cleaned++;
    }
  }

  return {
    dryRun: input.dryRun,
    dbReferencesWithoutBlob,
    blobsWithoutDbReference,
    duplicateReferences,
    sizeOrHashMismatches,
    verifiedButStillPresent,
    cleaned,
  };
}
