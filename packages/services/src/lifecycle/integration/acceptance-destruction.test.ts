// PROGRAMME section 8, row "Destruction" (lanes F, C and D): a legal hold placed during the 30
// days keeps the file (Removal Record reads Kept), and a backup restore never brings back a
// removed document.
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { reconcileRestoredBranch } from '../../backup-reconciliation';
import { placeLegalHold, releaseLegalHold } from '../../legal-hold';
import { getDocumentLifecycle } from '../foundation';
import { deleteDuplicate } from '../recently-deleted';
import { decideRemovalRequest, requestRemoval } from '../removal-requests';
import {
  JOURNEY_TIMEOUT,
  MemoryBlobStore,
  SHA_A,
  SHA_C,
  backupOf,
  daysAfter,
  documentExists,
  erasureJobsFor,
  freshJourneyDb,
  ownerProof,
  receiptRow,
  receiptsOf,
  runErasure,
  runPurge,
  seedOwner,
  staffScope,
  uploadDocument,
} from './journey-helpers.test-support';

const STAFF = 'lcz-destruction-staff@example.com';

describe('Destruction', () => {
  it(
    'a legal hold placed during the 30 days: the purge is blocked, the record reads Kept, the file stays',
    async () => {
      const { db } = await freshJourneyDb();
      const owner = await seedOwner(db, 'lcz-hold@example.com');
      const storage = new MemoryBlobStore();
      const survivor = await uploadDocument(db, owner, { sha: SHA_A, storage });
      const doomed = await uploadDocument(db, owner, { sha: SHA_A, storage });
      const proof = await ownerProof(db, owner);
      const deletedAt = new Date();
      const deleted = await deleteDuplicate(proof, { documentId: doomed.documentId });
      if (!deleted.ok) throw new Error(`delete: ${deleted.error.code}`);

      // Day 10: compliance places a hold on the whole record.
      const staff = await staffScope(db, STAFF, 'RETENTION_PURGE');
      const hold = await placeLegalHold(db, {
        actorAccountId: staff.accountId,
        applicantId: owner.applicantId,
        reason: 'synthetic hold',
        reviewAt: daysAfter(deletedAt, 120),
        stepUpSatisfied: true,
      });
      if (!hold.ok) throw new Error(`hold: ${hold.error.code}`);

      // Day 31: the purge is blocked, nothing is queued, the record reads Kept, never Removed.
      const later = daysAfter(deletedAt, 31);
      expect(await runPurge(db, later)).toEqual({ queued: 0, removed: 0, blocked: 1, failed: 0 });
      expect(await erasureJobsFor(db, doomed.documentId)).toHaveLength(0);
      expect(await runErasure(db, storage)).toEqual({ processed: 0, blocked: 0, failed: 0 });
      const kept = await receiptRow(db, deleted.value.receiptId);
      expect(kept?.status).toBe('BLOCKED');
      expect(kept?.verifiedGoneAt).toBeNull();
      expect(await documentExists(db, doomed.documentId)).toBe(true);
      expect(storage.objects.has(doomed.objectKey)).toBe(true);
      expect(storage.objects.has(survivor.objectKey)).toBe(true);
      // Still hidden from the person's documents: it stays deleted, only kept.
      expect((await getDocumentLifecycle(db, doomed.documentId, proof))?.state).not.toBe('CURRENT');

      // Released: the next run removes it, and only then does the record read Removed.
      const released = await releaseLegalHold(db, {
        actorAccountId: staff.accountId,
        holdId: hold.value.id,
        stepUpSatisfied: true,
      });
      expect(released.ok).toBe(true);
      expect((await runPurge(db, daysAfter(deletedAt, 32))).queued).toBe(1);
      expect(await runErasure(db, storage)).toEqual({ processed: 1, blocked: 0, failed: 0 });
      expect((await receiptRow(db, deleted.value.receiptId))?.status).toBe('REMOVED');
      expect(await documentExists(db, doomed.documentId)).toBe(false);
      expect(storage.objects.has(survivor.objectKey)).toBe(true);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'a legal hold placed after approval, before the worker runs: the worker keeps the file and the record reads Kept',
    async () => {
      const { db } = await freshJourneyDb();
      const owner = await seedOwner(db, 'lcz-hold-request@example.com');
      const storage = new MemoryBlobStore();
      const doc = await uploadDocument(db, owner, { sha: SHA_C, storage });
      const asked = await requestRemoval(await ownerProof(db, owner), {
        documentId: doc.documentId,
        reason: 'PRIVACY_CONCERN',
      });
      if (!asked.ok) throw new Error('request');
      const staff = await staffScope(db, STAFF, 'RETENTION_PURGE');
      const approved = await decideRemovalRequest(
        staff,
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(approved.ok && approved.value.decision === 'APPROVED' && approved.value.removal).toBe(
        'QUEUED',
      );
      const hold = await placeLegalHold(db, {
        actorAccountId: staff.accountId,
        applicantId: owner.applicantId,
        documentId: doc.documentId,
        reason: 'synthetic hold',
        reviewAt: daysAfter(new Date(), 90),
        stepUpSatisfied: true,
      });
      expect(hold.ok).toBe(true);
      expect(await runErasure(db, storage)).toEqual({ processed: 0, blocked: 1, failed: 0 });
      expect(await documentExists(db, doc.documentId)).toBe(true);
      expect(storage.objects.has(doc.objectKey)).toBe(true);
      const [receipt] = await receiptsOf(db, owner.applicantId);
      expect(receipt?.status).toBe('BLOCKED');
      expect(receipt?.verifiedGoneAt).toBeNull();
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'backup restore reconciliation does not resurrect a removed document',
    async () => {
      const live = await freshJourneyDb();
      const owner = await seedOwner(live.db, 'lcz-backup@example.com');
      const storage = new MemoryBlobStore();
      await uploadDocument(live.db, owner, { sha: SHA_A, storage });
      const doomed = await uploadDocument(live.db, owner, { sha: SHA_A, storage });
      const deletedAt = new Date();
      const deleted = await deleteDuplicate(await ownerProof(live.db, owner), {
        documentId: doomed.documentId,
      });
      if (!deleted.ok) throw new Error('delete');

      // The nightly backup is taken while the duplicate sits in Recently Deleted.
      const restorePoint = new Date();
      const backup = await backupOf(live.client);
      expect(await documentExists(backup.db, doomed.documentId)).toBe(true);

      // After the 30 days the live database destroys it.
      expect((await runPurge(live.db, daysAfter(deletedAt, 31))).queued).toBe(1);
      expect((await runErasure(live.db, storage)).processed).toBe(1);
      expect(await documentExists(live.db, doomed.documentId)).toBe(false);

      // Disaster: the backup is restored and reconciled against the live audit trail.
      const report = await reconcileRestoredBranch(live.db, backup.db, restorePoint);
      expect(report.errors).toEqual([]);
      expect(report.counts.erasuresVerified).toBeGreaterThanOrEqual(1);
      expect(await documentExists(backup.db, doomed.documentId)).toBe(false);
      const [restoredReceipt] = await backup.db
        .select()
        .from(schema.deletionReceipts)
        .where(eq(schema.deletionReceipts.id, deleted.value.receiptId));
      expect(restoredReceipt?.status).toBe('REMOVED');
      expect(restoredReceipt?.verifiedGoneAt).toBeInstanceOf(Date);
      // Running it again changes nothing.
      const again = await reconcileRestoredBranch(live.db, backup.db, restorePoint);
      expect(again.errors).toEqual([]);
      expect(await documentExists(backup.db, doomed.documentId)).toBe(false);
    },
    JOURNEY_TIMEOUT,
  );
});
