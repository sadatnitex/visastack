// PROGRAMME section 8, row "Before migration" (all lanes): with the four lifecycle tables
// missing, every lifecycle command refuses or is hidden and the ordinary reads behave as before.
import { isOk } from '@visastack/core';
import { describe, expect, it } from 'vitest';
import { accountPrincipal } from '../../access/principal';
import { requireAccess } from '../../access/require-access';
import { systemScopeForTest } from '../../access/system-scope.test-support';
import { listApplicants } from '../../applicants';
import { findDuplicateVersions, listDocuments } from '../../documents';
import { computeReadiness } from '../../missions';
import { expiryReminderPath, sweepExpiryReminders } from '../../notification-sweep';
import { searchWorkspaceRecords } from '../../workspace-search';
import { archiveDocument, restoreDocument } from '../archive';
import { duplicateStatus, tidyUpCounts } from '../duplicates';
import {
  enqueueDocumentRemoval,
  getDocumentLifecycle,
  lifecycleTablesPresent,
  listDeletionReceipts,
  openDeletionReceipt,
} from '../foundation';
import {
  deleteDuplicate,
  previewDeleteDuplicate,
  restoreDeleted,
  undoDelete,
} from '../recently-deleted';
import {
  REMOVAL_REQUEST_REFUSALS,
  decideRemovalRequest,
  listRemovalQueue,
  pendingRemovalRequests,
  requestRemoval,
  sweepRemovalRequests,
} from '../removal-requests';
import {
  TRAVELLER_REFUSALS,
  archiveTraveller,
  deleteEmptyTraveller,
  getTravellerManageView,
  purgeDueTravellers,
  restoreDeletedTraveller,
  restoreTraveller,
} from '../travellers';
import {
  JOURNEY_TIMEOUT,
  MemoryBlobStore,
  SHA_A,
  addTraveller,
  daysAfter,
  documentExists,
  freshJourneyDb,
  openCase,
  ownerProof,
  runErasure,
  runPurge,
  seedOwner,
  staffScope,
  uploadDocument,
} from './journey-helpers.test-support';

const STAFF = 'lcz-premigration-staff@example.com';
const NIL = '00000000-0000-4000-8000-000000000000';

describe('Before migration', () => {
  it(
    'every lifecycle command refuses or is hidden, and the ordinary reads behave as before',
    async () => {
      const { db } = await freshJourneyDb({ withoutLifecycle: true });
      expect(await lifecycleTablesPresent(db)).toBe(false);
      const owner = await seedOwner(db, 'lcz-premigration@example.com');
      const family = await addTraveller(db, owner.accountId, { relationship: 'FAMILY_MEMBER' });
      const familyOwner = { accountId: owner.accountId, applicantId: family };
      const storage = new MemoryBlobStore();
      const now = new Date();
      const older = await uploadDocument(db, owner, {
        sha: SHA_A,
        storage,
        name: 'zebra-one.pdf',
        docType: 'passport',
        expiresAt: daysAfter(now, 30),
      });
      const newer = await uploadDocument(db, owner, {
        sha: SHA_A,
        storage,
        name: 'zebra-two.pdf',
        docType: 'passport',
      });
      const chosen = await openCase(db, owner, {
        documentId: older.documentId,
        docType: 'passport',
      });
      const proof = await ownerProof(db, owner);
      const view = await ownerProof(db, owner, 'VIEW_METADATA');
      const ids = [older.documentId, newer.documentId].sort();

      // Ordinary reads: every document and traveller, as before.
      for (const lifecycle of [undefined, 'everyday', 'all'] as const) {
        const listed = await listDocuments(
          db,
          owner.accountId,
          owner.applicantId,
          lifecycle ? { lifecycle } : {},
        );
        expect(listed.ok && listed.value.map((d) => d.id).sort(), String(lifecycle)).toEqual(ids);
      }
      expect((await listApplicants(db, owner.accountId)).map((a) => a.id).sort()).toEqual(
        [owner.applicantId, family].sort(),
      );
      expect(await listApplicants(db, owner.accountId, { view: 'archived' })).toEqual([]);
      expect(await listApplicants(db, owner.accountId, { view: 'recentlyDeleted' })).toEqual([]);
      const duplicates = await findDuplicateVersions(db, {
        applicantId: owner.applicantId,
        sha256: SHA_A,
        excludeDocumentId: newer.documentId,
      });
      expect(duplicates.map((d) => d.documentId)).toEqual([older.documentId]);
      const search = await searchWorkspaceRecords(
        db,
        owner.accountId,
        { kind: 'personal', applicantId: owner.applicantId },
        'zebra',
      );
      expect(search.ok && search.value.filter((r) => r.category === 'Document')).toHaveLength(2);
      const readiness = await computeReadiness(db, chosen.missionId);
      expect(isOk(readiness) && readiness.value.requirementResults[0]?.state).toBe('SATISFIED');
      // The reminder leads to the expiry list, never to a Replace flow that is not there yet.
      expect(expiryReminderPath(owner.applicantId, older.documentId, false)).toBe(
        `/app/applicant/${owner.applicantId}/expiry`,
      );
      expect((await sweepExpiryReminders(db, now)).enqueued).toBe(1);
      expect(await getDocumentLifecycle(db, older.documentId, proof)).toMatchObject({
        state: 'CURRENT',
        replaced: false,
      });

      // Hidden: no duplicate offered, no Tidy Up, no Manage menu for travellers, no records.
      const status = await duplicateStatus(db, newer.documentId, view);
      expect(status?.isDuplicate ?? false).toBe(false);
      expect(await tidyUpCounts(db, owner.applicantId, proof)).toBeNull();
      const travellerView = await getTravellerManageView(await ownerProof(db, familyOwner));
      expect(travellerView.ok && travellerView.value).toBeNull();
      const records = await listDeletionReceipts(view);
      expect(records.ok && records.value).toEqual([]);
      expect((await pendingRemovalRequests(proof, ids)).size).toBe(0);
      const reader = await staffScope(db, STAFF, 'APPLICANT_DIRECTORY_VIEW');
      const queue = await listRemovalQueue(reader, { db });
      expect(queue.ok && queue.value.rows).toEqual([]);

      // Refused: every document command.
      const refusals: Array<[string, { ok: boolean }]> = [
        ['archive', await archiveDocument(newer.documentId, proof)],
        ['restore', await restoreDocument(newer.documentId, proof)],
        ['delete duplicate', await deleteDuplicate(proof, { documentId: newer.documentId })],
        [
          'remove new copy',
          await deleteDuplicate(proof, { documentId: newer.documentId, atUpload: true }),
        ],
        ['preview delete', await previewDeleteDuplicate(proof, { documentId: newer.documentId })],
        ['undo', await undoDelete(proof, { documentId: newer.documentId })],
        ['restore deleted', await restoreDeleted(proof, { documentId: newer.documentId })],
        [
          'open receipt',
          await openDeletionReceipt(
            db,
            {
              applicantId: owner.applicantId,
              subjectKind: 'DOCUMENT',
              subjectCode: 'D-7K2Q9M',
              path: 'DUPLICATE',
            },
            proof,
          ),
        ],
        [
          'enqueue removal',
          await enqueueDocumentRemoval(
            db,
            { documentId: newer.documentId, applicantId: owner.applicantId, receiptId: NIL },
            proof,
          ),
        ],
      ];
      for (const [name, result] of refusals) expect(result.ok, name).toBe(false);
      const asked = await requestRemoval(proof, {
        documentId: newer.documentId,
        reason: 'NO_LONGER_NEEDED',
      });
      expect(!asked.ok && asked.error.message).toBe(REMOVAL_REQUEST_REFUSALS.unavailable);
      const decider = await staffScope(db, STAFF, 'RETENTION_PURGE');
      const decided = await decideRemovalRequest(
        decider,
        { id: NIL, decision: 'APPROVE', stepUpSatisfied: true },
        { db },
      );
      expect(decided.ok).toBe(false);

      // Refused: every traveller command.
      const familyProof = await ownerProof(db, familyOwner);
      for (const command of [
        archiveTraveller,
        restoreTraveller,
        deleteEmptyTraveller,
        restoreDeletedTraveller,
      ]) {
        const result = await command(familyProof);
        expect(!result.ok && result.error.message, command.name).toBe(
          TRAVELLER_REFUSALS.unavailable,
        );
      }

      // The scheduled jobs do nothing and fail nothing.
      const later = daysAfter(now, 31);
      expect(await runPurge(db, later)).toEqual({ queued: 0, removed: 0, blocked: 0, failed: 0 });
      const travellers = await purgeDueTravellers(db, systemScopeForTest('process-deletions'), {
        now: later,
      });
      expect(travellers.ok && travellers.value).toEqual({ removed: 0, restored: 0, failed: 0 });
      const swept = await sweepRemovalRequests(
        systemScopeForTest('process-notification-sweeps'),
        db,
        {
          alerts: true,
          alertAfterWorkingDays: 3,
        },
      );
      expect(swept.ok && swept.value).toEqual({ completed: 0, kept: 0, alerted: 0 });
      expect(await runErasure(db, storage)).toEqual({ processed: 0, blocked: 0, failed: 0 });

      // Nothing was changed by any of it.
      for (const id of ids) expect(await documentExists(db, id)).toBe(true);
      expect(storage.objects.size).toBe(2);
      expect((await listApplicants(db, owner.accountId)).map((a) => a.id).sort()).toEqual(
        [owner.applicantId, family].sort(),
      );
      // The owner's gate still works as before.
      const gate = await requireAccess(
        db,
        accountPrincipal(owner.accountId),
        'MANAGE',
        { documentId: newer.documentId },
        { purpose: 'self' },
      );
      expect(gate.ok).toBe(true);
    },
    JOURNEY_TIMEOUT,
  );
});
