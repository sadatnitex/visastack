// PROGRAMME section 8, row "Archive" (lanes A1, A2 and B): archive a document an open case selected.
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listDocuments } from '../../documents';
import { computeReadiness } from '../../missions';
import { sweepExpiryReminders } from '../../notification-sweep';
import { searchWorkspaceRecords } from '../../workspace-search';
import { archiveDocument, restoreDocument } from '../archive';
import { availableDocumentActions, getDocumentLifecycle } from '../foundation';
import {
  JOURNEY_TIMEOUT,
  SHA_A,
  daysAfter,
  freshJourneyDb,
  openCase,
  ownerProof,
  revisionOf,
  seedOwner,
  selectedDocumentsOf,
  uploadDocument,
} from './journey-helpers.test-support';

describe('Archive', () => {
  it(
    'archive a document an open case selected: hidden everywhere by default, kept and flagged where chosen, Restore brings it back',
    async () => {
      const { db } = await freshJourneyDb();
      const owner = await seedOwner(db, 'lcz-archive@example.com');
      const now = new Date();
      const doc = await uploadDocument(db, owner, {
        sha: SHA_A,
        name: 'zebra-passport.pdf',
        docType: 'passport',
        expiresAt: daysAfter(now, 30),
      });
      const chosen = await openCase(db, owner, { documentId: doc.documentId, docType: 'passport' });
      // A second open case that never chose it, so it only ever counted automatically.
      const automatic = await openCase(db, owner, { docType: 'passport' });
      const autoBefore = await computeReadiness(db, automatic.missionId);
      if (!isOk(autoBefore)) throw new Error('readiness');
      expect(autoBefore.value.requirementResults[0]?.state).toBe('SATISFIED');
      const [documentBefore] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, doc.documentId));
      const chosenRevision = await revisionOf(db, chosen.missionId);
      const automaticRevision = await revisionOf(db, automatic.missionId);

      const proof = await ownerProof(db, owner);
      const before = await getDocumentLifecycle(db, doc.documentId, proof);
      expect(
        availableDocumentActions({
          state: before?.state ?? 'CURRENT',
          replaced: before?.replaced ?? false,
          isDuplicate: false,
          duplicateBlockReason: null,
          pendingRequest: false,
          legalHold: false,
          requestsSwitchOn: true,
        }),
      ).toContain('ARCHIVE');

      const archived = await archiveDocument(doc.documentId, proof);
      expect(archived.ok && archived.value).toMatchObject({ state: 'ARCHIVED', changed: true });
      expect((await getDocumentLifecycle(db, doc.documentId, proof))?.state).toBe('ARCHIVED');

      // Hidden from the everyday list, offers and search, and from reminders.
      const everyday = await listDocuments(db, owner.accountId, owner.applicantId, {
        lifecycle: 'everyday',
      });
      expect(everyday.ok && everyday.value).toEqual([]);
      const present = await listDocuments(db, owner.accountId, owner.applicantId);
      expect(present.ok && present.value.map((d) => d.id)).toEqual([doc.documentId]);
      const search = await searchWorkspaceRecords(
        db,
        owner.accountId,
        { kind: 'personal', applicantId: owner.applicantId },
        'zebra',
      );
      expect(search.ok && search.value.filter((r) => r.category === 'Document')).toEqual([]);
      expect((await sweepExpiryReminders(db, now)).enqueued).toBe(0);

      // Automatic readiness no longer counts it; the open case that chose it keeps it, flagged.
      const autoAfter = await computeReadiness(db, automatic.missionId);
      if (!isOk(autoAfter)) throw new Error('readiness');
      expect(autoAfter.value.requirementResults[0]?.state).not.toBe('SATISFIED');
      expect(await revisionOf(db, automatic.missionId)).toBe(automaticRevision + 1);
      expect(await selectedDocumentsOf(db, chosen.missionId)).toEqual([doc.documentId]);
      const chosenAfter = await computeReadiness(db, chosen.missionId);
      if (!isOk(chosenAfter)) throw new Error('readiness');
      expect(chosenAfter.value.requirementResults[0]?.state).toBe('SATISFIED');
      expect(chosenAfter.value.requirementResults[0]?.selectedButReplacedOrArchived).toBe(true);
      expect(await revisionOf(db, chosen.missionId)).toBe(chosenRevision);

      // The document itself, its retention clock included, is unchanged.
      const [documentArchived] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, doc.documentId));
      expect(documentArchived).toEqual(documentBefore);

      // Restore: back in every everyday place, counted automatically again, no flag.
      const restored = await restoreDocument(doc.documentId, await ownerProof(db, owner));
      expect(restored.ok && restored.value.state).toBe('CURRENT');
      const again = await listDocuments(db, owner.accountId, owner.applicantId, {
        lifecycle: 'everyday',
      });
      expect(again.ok && again.value.map((d) => d.id)).toEqual([doc.documentId]);
      const found = await searchWorkspaceRecords(
        db,
        owner.accountId,
        { kind: 'personal', applicantId: owner.applicantId },
        'zebra',
      );
      expect(found.ok && found.value.filter((r) => r.category === 'Document')).toHaveLength(1);
      expect((await sweepExpiryReminders(db, now)).enqueued).toBe(1);
      const autoRestored = await computeReadiness(db, automatic.missionId);
      if (!isOk(autoRestored)) throw new Error('readiness');
      expect(autoRestored.value.requirementResults[0]?.state).toBe('SATISFIED');
      const chosenRestored = await computeReadiness(db, chosen.missionId);
      if (!isOk(chosenRestored)) throw new Error('readiness');
      expect(chosenRestored.value.requirementResults[0]?.selectedButReplacedOrArchived).toBeFalsy();
      const [documentRestored] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, doc.documentId));
      expect(documentRestored).toEqual(documentBefore);
    },
    JOURNEY_TIMEOUT,
  );
});
