// PROGRAMME section 8, row "Duplicates" (lanes C and F): the journeys of lanes/Z.md build step 1.
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal } from '../../access/principal';
import { requireAccess } from '../../access/require-access';
import type { Db } from '../../db';
import { findDuplicateVersions, listDocuments } from '../../documents';
import { duplicateStatus } from '../duplicates';
import { getDocumentLifecycle, listDeletionReceipts } from '../foundation';
import { RESTORE_REFUSALS, deleteDuplicate, restoreDeleted, undoDelete } from '../recently-deleted';
import {
  JOURNEY_TIMEOUT,
  type JourneyOwner,
  MemoryBlobStore,
  SHA_A,
  daysAfter,
  documentExists,
  erasureJobsFor,
  freshJourneyDb,
  lifecycleRow,
  openCase,
  ownerProof,
  productEventTypes,
  receiptRow,
  revisionOf,
  runErasure,
  runPurge,
  seedOwner,
  selectedDocumentsOf,
  uploadDocument,
} from './journey-helpers.test-support';

describe('Duplicates', () => {
  let db: Db;
  let owner: JourneyOwner;
  let storage: MemoryBlobStore;
  beforeEach(async () => {
    ({ db } = await freshJourneyDb());
    owner = await seedOwner(db, 'lcz-dup-owner@example.com');
    storage = new MemoryBlobStore();
  }, JOURNEY_TIMEOUT);

  it(
    'upload a duplicate, then Remove This New Copy: only the new copy leaves, the kept copy is untouched',
    async () => {
      const kept = await uploadDocument(db, owner, { sha: SHA_A, storage, name: 'kept.pdf' });
      const fresh = await uploadDocument(db, owner, { sha: SHA_A, storage, name: 'fresh.pdf' });

      // The upload result offers Remove This New Copy exactly as the web action decides it.
      const matches = await findDuplicateVersions(db, {
        applicantId: owner.applicantId,
        sha256: SHA_A,
        excludeDocumentId: fresh.documentId,
      });
      expect(matches.map((m) => m.documentId)).toEqual([kept.documentId]);
      const view = await requireAccess(
        db,
        accountPrincipal(owner.accountId),
        'VIEW_METADATA',
        { documentId: fresh.documentId },
        { purpose: 'self' },
      );
      if (!view.ok) throw new Error('view proof');
      const status = await duplicateStatus(db, fresh.documentId, view.value);
      expect(status).toEqual({
        isDuplicate: true,
        survivorDocumentId: kept.documentId,
        blockReason: null,
      });

      const proof = await ownerProof(db, owner);
      const removed = await deleteDuplicate(proof, {
        documentId: fresh.documentId,
        atUpload: true,
      });
      expect(removed.ok).toBe(true);
      if (!removed.ok) return;
      expect(removed.value.survivorDocumentId).toBe(kept.documentId);
      expect(await productEventTypes(db)).toContain('DUPLICATE_REMOVED_AT_UPLOAD');
      expect(await productEventTypes(db)).not.toContain('DOCUMENT_DELETED');

      // The new copy is in Recently Deleted; the kept one is Current and still listed.
      expect((await getDocumentLifecycle(db, fresh.documentId, proof))?.state).toBe(
        'RECENTLY_DELETED',
      );
      expect((await getDocumentLifecycle(db, kept.documentId, proof))?.state).toBe('CURRENT');
      const listed = await listDocuments(db, owner.accountId, owner.applicantId);
      expect(listed.ok && listed.value.map((d) => d.id)).toEqual([kept.documentId]);
      expect(storage.objects.has(kept.objectKey)).toBe(true);
      expect(storage.objects.has(fresh.objectKey)).toBe(true);

      // Its Removal Record is Scheduled, readable by the owner, codes only.
      const records = await listDeletionReceipts(await ownerProof(db, owner, 'VIEW_METADATA'));
      expect(records.ok && records.value.map((r) => [r.path, r.status])).toEqual([
        ['DUPLICATE', 'SCHEDULED'],
      ]);
      expect(JSON.stringify(records)).not.toContain('fresh.pdf');
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'delete a duplicate an open case uses, Undo, delete again, then the purge destroys it after 30 days',
    async () => {
      const survivor = await uploadDocument(db, owner, { sha: SHA_A, storage, sizeBytes: 7 });
      const doomed = await uploadDocument(db, owner, { sha: SHA_A, storage, sizeBytes: 11 });
      const open = await openCase(db, owner, { documentId: doomed.documentId });
      const revision0 = await revisionOf(db, open.missionId);
      const proof = await ownerProof(db, owner);

      // Delete: the open case switches to the identical copy and must be confirmed again.
      const first = await deleteDuplicate(proof, { documentId: doomed.documentId });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.cases.map((c) => c.missionId)).toEqual([open.missionId]);
      expect(await selectedDocumentsOf(db, open.missionId)).toEqual([survivor.documentId]);
      expect(await revisionOf(db, open.missionId)).toBe(revision0 + 1);
      const firstReceipt = await receiptRow(db, first.value.receiptId);
      expect(firstReceipt?.status).toBe('SCHEDULED');
      expect(firstReceipt?.effects).toMatchObject({
        casesSwitched: [expect.stringMatching(/^C-/)],
      });

      // Undo: the document is back, the record reads Restored, the case stays on the copy (D4).
      expect((await undoDelete(proof, { documentId: doomed.documentId })).ok).toBe(true);
      expect((await getDocumentLifecycle(db, doomed.documentId, proof))?.state).toBe('CURRENT');
      expect((await receiptRow(db, first.value.receiptId))?.status).toBe('RESTORED');
      expect(await selectedDocumentsOf(db, open.missionId)).toEqual([survivor.documentId]);
      expect(await revisionOf(db, open.missionId)).toBe(revision0 + 1);

      // Delete again: a new record; nothing left to switch.
      const deletedAt = new Date();
      const second = await deleteDuplicate(proof, { documentId: doomed.documentId });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.receiptId).not.toBe(first.value.receiptId);
      expect(second.value.cases).toEqual([]);
      expect(await revisionOf(db, open.missionId)).toBe(revision0 + 1);

      // Inside the 30 days nothing is queued; the record never reads Removed early.
      expect((await runPurge(db, daysAfter(deletedAt, 29))).queued).toBe(0);
      expect(await erasureJobsFor(db, doomed.documentId)).toHaveLength(0);
      expect((await receiptRow(db, second.value.receiptId))?.status).toBe('SCHEDULED');

      // After the 30 days: queued, Removing until the worker verifies the file gone.
      const later = daysAfter(deletedAt, 31);
      expect(await runPurge(db, later)).toEqual({ queued: 1, removed: 0, blocked: 0, failed: 0 });
      expect((await receiptRow(db, second.value.receiptId))?.status).toBe('REMOVING');
      expect((await receiptRow(db, second.value.receiptId))?.verifiedGoneAt).toBeNull();
      expect(await documentExists(db, doomed.documentId)).toBe(true);
      const tooLate = await restoreDeleted(
        proof,
        { documentId: doomed.documentId },
        { now: later },
      );
      expect(!tooLate.ok && tooLate.error.message).toBe(RESTORE_REFUSALS.tooLate);

      expect(await runErasure(db, storage)).toEqual({ processed: 1, blocked: 0, failed: 0 });
      expect(await documentExists(db, doomed.documentId)).toBe(false);
      expect(await lifecycleRow(db, doomed.documentId)).toBeUndefined();
      expect(storage.objects.has(doomed.objectKey)).toBe(false);
      const finalReceipt = await receiptRow(db, second.value.receiptId);
      expect(finalReceipt?.status).toBe('REMOVED');
      expect(finalReceipt?.verifiedGoneAt).toBeInstanceOf(Date);
      // The storage figure drops by exactly the removed file.
      expect(finalReceipt?.effects).toMatchObject({ bytesFreed: 11 });
      // The registered measure is recorded once for the destroyed file (lane Z fix in erasure.ts).
      const destroyed = await db
        .select({ id: schema.productEvents.id })
        .from(schema.productEvents)
        .where(eq(schema.productEvents.eventType, 'DOCUMENT_DESTROYED'));
      expect(destroyed).toHaveLength(1);

      // Nothing else touched: the survivor, its file, the case and its selection stay.
      expect(await documentExists(db, survivor.documentId)).toBe(true);
      expect(storage.objects.has(survivor.objectKey)).toBe(true);
      expect(await selectedDocumentsOf(db, open.missionId)).toEqual([survivor.documentId]);
      expect((await receiptRow(db, first.value.receiptId))?.status).toBe('RESTORED');
      expect(await productEventTypes(db)).toEqual(
        expect.arrayContaining(['DOCUMENT_DELETED', 'DOCUMENT_DELETE_UNDONE']),
      );
      // A second worker pass has nothing left to do.
      expect(await runErasure(db, storage)).toEqual({ processed: 0, blocked: 0, failed: 0 });
    },
    JOURNEY_TIMEOUT,
  );
});
