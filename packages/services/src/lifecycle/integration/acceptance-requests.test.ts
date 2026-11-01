// PROGRAMME section 8, row "Requests" (lane D, with F's destruction): request removal of a unique
// file, approve with the staff step-up, verify destruction, read the Removal Record.
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { systemScopeForTest } from '../../access/system-scope.test-support';
import type { Db } from '../../db';
import { listDocuments } from '../../documents';
import { listTasks } from '../../missions';
import { getDocumentLifecycle, listDeletionReceipts } from '../foundation';
import {
  REMOVAL_REQUEST_REFUSALS,
  cancelRemovalRequest,
  decideRemovalRequest,
  listRemovalQueue,
  pendingRemovalRequests,
  requestRemoval,
  sweepRemovalRequests,
} from '../removal-requests';
import {
  JOURNEY_TIMEOUT,
  MemoryBlobStore,
  SHA_C,
  documentExists,
  erasureJobsFor,
  freshJourneyDb,
  openCase,
  ownerProof,
  receiptsOf,
  runErasure,
  seedOwner,
  selectedDocumentsOf,
  staffScope,
  uploadDocument,
} from './journey-helpers.test-support';

const STAFF = 'lcz-removal-staff@example.com';

async function requestStatus(db: Db, id: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: schema.documentRemovalRequests.status })
    .from(schema.documentRemovalRequests)
    .where(eq(schema.documentRemovalRequests.id, id));
  return row?.status;
}

describe('Requests', () => {
  it(
    'request removal of a unique file, approve with step-up, verify destruction, read the Removal Record',
    async () => {
      const { db } = await freshJourneyDb();
      const owner = await seedOwner(db, 'lcz-request@example.com');
      const storage = new MemoryBlobStore();
      const doc = await uploadDocument(db, owner, {
        sha: SHA_C,
        storage,
        sizeBytes: 23,
        name: 'Private Person Passport.pdf',
      });
      const open = await openCase(db, owner, { documentId: doc.documentId, title: 'Open Trip' });
      const finished = await openCase(db, owner, {
        documentId: doc.documentId,
        state: 'CLOSED',
        title: 'Old Trip',
      });
      const proof = await ownerProof(db, owner);

      // Cancel while pending, then ask again.
      const first = await requestRemoval(proof, { documentId: doc.documentId, reason: 'OTHER' });
      if (!first.ok) throw new Error(`request: ${first.error.code}`);
      expect((await cancelRemovalRequest(proof, first.value.id)).ok).toBe(true);
      expect(await requestStatus(db, first.value.id)).toBe('CANCELLED');
      const asked = await requestRemoval(proof, {
        documentId: doc.documentId,
        reason: 'NO_LONGER_NEEDED',
      });
      if (!asked.ok) throw new Error(`request: ${asked.error.code}`);
      expect((await pendingRemovalRequests(proof, [doc.documentId])).get(doc.documentId)).toBe(
        asked.value.id,
      );
      // Nothing happens to the document while support decides.
      expect((await getDocumentLifecycle(db, doc.documentId, proof))?.state).toBe('CURRENT');

      const reader = await staffScope(db, STAFF, 'APPLICANT_DIRECTORY_VIEW');
      const queue = await listRemovalQueue(reader, { db });
      if (!queue.ok) throw new Error('queue');
      expect(queue.value.rows.map((r) => r.id)).toEqual([asked.value.id]);
      expect(JSON.stringify(queue.value)).not.toContain('Private Person');

      const decider = await staffScope(db, STAFF, 'RETENTION_PURGE');
      // A decline needs a code; an approval needs the fresh sign-in check. Neither changes anything.
      const noCode = await decideRemovalRequest(
        decider,
        {
          id: asked.value.id,
          decision: 'DECLINE',
          decisionCode: 'BECAUSE' as unknown as 'OTHER',
          stepUpSatisfied: true,
        },
        { db },
      );
      expect(!noCode.ok && noCode.error.message).toBe(REMOVAL_REQUEST_REFUSALS.declineCode);
      const noStepUp = await decideRemovalRequest(
        decider,
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: false },
        { db },
      );
      expect(!noStepUp.ok && noStepUp.error.code).toBe('step_up_required');
      expect(await requestStatus(db, asked.value.id)).toBe('PENDING');
      expect(await receiptsOf(db, owner.applicantId)).toEqual([]);

      const approved = await decideRemovalRequest(
        decider,
        { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      if (!approved.ok) throw new Error(`approve: ${approved.error.code}`);
      expect(approved.value).toMatchObject({
        decision: 'APPROVED',
        removal: 'QUEUED',
        openCasesUpdated: 1,
      });
      // The open case loses the selection and gets a task; the finished case keeps it.
      expect(await selectedDocumentsOf(db, open.missionId)).toEqual([]);
      expect(await selectedDocumentsOf(db, finished.missionId)).toEqual([doc.documentId]);
      const tasks = await listTasks(db, owner.accountId, open.missionId);
      expect(
        isOk(tasks) && tasks.value.some((t) => t.description.includes('removed by request')),
      ).toBe(true);

      // Hidden at once, but never Removed before the worker verifies the file gone.
      expect((await getDocumentLifecycle(db, doc.documentId, proof))?.state).toBe('REMOVING');
      const listed = await listDocuments(db, owner.accountId, owner.applicantId);
      expect(listed.ok && listed.value).toEqual([]);
      const [removing] = await receiptsOf(db, owner.applicantId);
      expect(removing).toMatchObject({ path: 'REQUEST', status: 'REMOVING', verifiedGoneAt: null });
      expect(storage.objects.has(doc.objectKey)).toBe(true);
      expect((await erasureJobsFor(db, doc.documentId)).map((j) => j.reason)).toEqual([
        'DOCUMENT_REMOVAL',
      ]);

      // The erasure worker destroys it.
      expect(await runErasure(db, storage)).toEqual({ processed: 1, blocked: 0, failed: 0 });
      expect(storage.objects.has(doc.objectKey)).toBe(false);
      expect(await documentExists(db, doc.documentId)).toBe(false);

      // The sweep closes the request and tells the person.
      const swept = await sweepRemovalRequests(
        systemScopeForTest('process-notification-sweeps'),
        db,
        {
          alerts: false,
        },
      );
      expect(swept.ok && swept.value.completed).toBe(1);
      expect(await requestStatus(db, asked.value.id)).toBe('COMPLETED');

      // The Removal Record, for the person and for a privacy administrator.
      const records = await listDeletionReceipts(await ownerProof(db, owner, 'VIEW_METADATA'));
      if (!records.ok) throw new Error('records');
      expect(records.value).toHaveLength(1);
      const [record] = records.value;
      expect(record).toMatchObject({
        subjectKind: 'DOCUMENT',
        subjectCode: asked.value.documentCode,
        documentKind: 'passport',
        path: 'REQUEST',
        status: 'REMOVED',
        effects: { bytesFreed: 23 },
      });
      expect(record?.verifiedGoneAt).toBeInstanceOf(Date);
      expect(JSON.stringify(records.value)).not.toContain('Private Person');
      const byAdmin = await listDeletionReceipts(reader, { db, applicantId: owner.applicantId });
      expect(byAdmin.ok && byAdmin.value.map((r) => r.id)).toEqual([record?.id]);
    },
    JOURNEY_TIMEOUT,
  );
});
