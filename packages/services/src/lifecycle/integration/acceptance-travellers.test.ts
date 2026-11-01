// PROGRAMME section 8, row "Travellers" (lane E): archive and restore a traveller, remove an
// empty traveller and let the purge finish it.
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { systemScopeForTest } from '../../access/system-scope.test-support';
import { listApplicants } from '../../applicants';
import type { Db } from '../../db';
import { sweepExpiryReminders } from '../../notification-sweep';
import { listDeletionReceipts } from '../foundation';
import {
  TRAVELLER_REFUSALS,
  archiveTraveller,
  deleteEmptyTraveller,
  getTravellerManageView,
  purgeDueTravellers,
  restoreTraveller,
} from '../travellers';
import {
  JOURNEY_TIMEOUT,
  SHA_A,
  addTraveller,
  daysAfter,
  freshJourneyDb,
  ownerProof,
  seedOwner,
  uploadDocument,
} from './journey-helpers.test-support';

const ids = (rows: readonly { readonly id: string }[]) => rows.map((row) => row.id).sort();

async function applicantExists(db: Db, applicantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, applicantId));
  return rows.length === 1;
}

describe('Travellers', () => {
  it(
    'archive and restore a traveller: hidden from everyday lists and reminders, nothing removed, Myself never archived',
    async () => {
      const { db } = await freshJourneyDb();
      const owner = await seedOwner(db, 'lcz-traveller-archive@example.com');
      const family = await addTraveller(db, owner.accountId, { relationship: 'FAMILY_MEMBER' });
      const familyOwner = { accountId: owner.accountId, applicantId: family };
      const now = new Date();
      const doc = await uploadDocument(db, familyOwner, {
        sha: SHA_A,
        docType: 'passport',
        expiresAt: daysAfter(now, 30),
      });

      const myself = await archiveTraveller(await ownerProof(db, owner));
      expect(!myself.ok && myself.error.message).toBe(TRAVELLER_REFUSALS.myselfArchive);

      const archived = await archiveTraveller(await ownerProof(db, familyOwner));
      expect(archived.ok && archived.value.state).toBe('ARCHIVED');
      expect(ids(await listApplicants(db, owner.accountId))).toEqual([owner.applicantId]);
      expect(ids(await listApplicants(db, owner.accountId, { view: 'archived' }))).toEqual([
        family,
      ]);
      expect((await sweepExpiryReminders(db, now)).enqueued).toBe(0);
      // Nothing is removed: the record and its document stay.
      expect(await applicantExists(db, family)).toBe(true);
      const [kept] = await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, doc.documentId));
      expect(kept).toBeDefined();

      const restored = await restoreTraveller(await ownerProof(db, familyOwner));
      expect(restored.ok && restored.value.state).toBe('CURRENT');
      expect(ids(await listApplicants(db, owner.accountId))).toEqual(
        [owner.applicantId, family].sort(),
      );
      expect((await sweepExpiryReminders(db, now)).enqueued).toBe(1);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'remove an empty traveller: only an empty record, into Recently Deleted, then destroyed with a Removal Record on Myself',
    async () => {
      const { db } = await freshJourneyDb();
      const owner = await seedOwner(db, 'lcz-traveller-remove@example.com');
      const holding = await addTraveller(db, owner.accountId, { relationship: 'FAMILY_MEMBER' });
      const empty = await addTraveller(db, owner.accountId, { relationship: 'FAMILY_MEMBER' });
      const holdingOwner = { accountId: owner.accountId, applicantId: holding };
      const emptyOwner = { accountId: owner.accountId, applicantId: empty };
      await uploadDocument(db, holdingOwner, { sha: SHA_A });

      // A record that holds anything is never removed; Myself is the last of its kind.
      const notEmpty = await deleteEmptyTraveller(await ownerProof(db, holdingOwner));
      expect(!notEmpty.ok && notEmpty.error.message).toBe(TRAVELLER_REFUSALS.notEmpty);
      const lastMyself = await deleteEmptyTraveller(await ownerProof(db, owner));
      expect(!lastMyself.ok && lastMyself.error.message).toBe(TRAVELLER_REFUSALS.lastMyself);

      const access = await ownerProof(db, emptyOwner);
      const view = await getTravellerManageView(access);
      expect(view.ok && view.value?.actions).toContain('REMOVE_EMPTY');
      const now = new Date();
      const removed = await deleteEmptyTraveller(access, { now });
      if (!removed.ok) throw new Error(`remove: ${removed.error.code}`);
      expect(ids(await listApplicants(db, owner.accountId))).toEqual(
        [owner.applicantId, holding].sort(),
      );
      expect(ids(await listApplicants(db, owner.accountId, { view: 'recentlyDeleted' }))).toEqual([
        empty,
      ]);

      const scope = systemScopeForTest('process-deletions');
      // Inside the 30 days nothing happens.
      const early = await purgeDueTravellers(db, scope, { now: daysAfter(now, 29) });
      expect(early.ok && early.value).toEqual({ removed: 0, restored: 0, failed: 0 });
      expect(await applicantExists(db, empty)).toBe(true);

      const purged = await purgeDueTravellers(db, scope, { now: daysAfter(now, 31) });
      expect(purged.ok && purged.value).toEqual({ removed: 1, restored: 0, failed: 0 });
      expect(await applicantExists(db, empty)).toBe(false);
      expect(await applicantExists(db, holding)).toBe(true);

      // The record of it lives on Myself, which stays, and reads Removed.
      const records = await listDeletionReceipts(await ownerProof(db, owner, 'VIEW_METADATA'));
      if (!records.ok) throw new Error('records');
      expect(records.value.map((r) => [r.subjectKind, r.path, r.status])).toEqual([
        ['TRAVELLER', 'EMPTY_TRAVELLER', 'REMOVED'],
      ]);
      expect(records.value[0]?.subjectCode).toMatch(/^P-/);
      expect(JSON.stringify(records.value)).not.toContain('Synthetic Traveller');
    },
    JOURNEY_TIMEOUT,
  );
});
