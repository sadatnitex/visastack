// PROGRAMME section 8, row "Replace" (lanes B and A1): replace from a reminder's deep link.
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { computeReadiness, listTasks } from '../../missions';
import { sweepExpiryReminders } from '../../notification-sweep';
import { archiveDocument, restoreDocument } from '../archive';
import { DOCUMENT_ACTIONS, availableDocumentActions, getDocumentLifecycle } from '../foundation';
import {
  REPLACE_REFUSALS,
  documentLifecycleLabel,
  listReplacementOptions,
  replaceDocument,
} from '../replace';
import {
  JOURNEY_TIMEOUT,
  SHA_A,
  SHA_B,
  daysAfter,
  freshJourneyDb,
  openCase,
  ownerProof,
  revisionOf,
  seedOwner,
  selectedDocumentsOf,
  uploadDocument,
} from './journey-helpers.test-support';

describe('Replace', () => {
  it(
    'replace from a reminder: the deep link opens Replace, the newer document is used, the case is flagged',
    async () => {
      const { db } = await freshJourneyDb();
      const owner = await seedOwner(db, 'lcz-replace@example.com');
      const now = new Date();
      const old = await uploadDocument(db, owner, {
        sha: SHA_A,
        docType: 'passport',
        name: 'old-passport.pdf',
        expiresAt: daysAfter(now, 30),
      });
      const chosen = await openCase(db, owner, { documentId: old.documentId, docType: 'passport' });
      const automatic = await openCase(db, owner, { docType: 'passport' });
      const chosenRevision = await revisionOf(db, chosen.missionId);

      // The reminder.
      expect((await sweepExpiryReminders(db, now)).enqueued).toBe(1);
      const reminders = await db
        .select({ payload: schema.notifications.payload })
        .from(schema.notifications)
        .where(eq(schema.notifications.eventType, 'DOCUMENT_EXPIRY'));
      expect(reminders.length).toBeGreaterThan(0);
      const deepLinks = new Set(
        reminders.map((row) => (row.payload as { deepLinkPath: string }).deepLinkPath),
      );
      expect(deepLinks.size).toBe(1);
      const [deepLink] = [...deepLinks];
      const url = new URL(deepLink ?? '', 'https://example.invalid');
      expect(url.pathname).toBe(`/app/applicant/${owner.applicantId}/documents`);
      const manage = url.searchParams.get('manage');
      const action = url.searchParams.get('action');
      expect(manage).toBe(old.documentId);
      expect(action).toBe('REPLACE');
      expect((DOCUMENT_ACTIONS as readonly string[]).includes(action ?? '')).toBe(true);

      // The Documents page opens that action only when the Manage menu would offer it.
      const proof = await ownerProof(db, owner);
      const lifecycle = await getDocumentLifecycle(db, manage ?? '', proof);
      if (!lifecycle) throw new Error('lifecycle');
      expect(
        availableDocumentActions({
          state: lifecycle.state,
          replaced: lifecycle.replaced,
          isDuplicate: false,
          duplicateBlockReason: null,
          pendingRequest: false,
          legalHold: false,
          requestsSwitchOn: true,
        }),
      ).toContain('REPLACE');

      // The person uploads the newer passport; it is offered as ready.
      const newer = await uploadDocument(db, owner, {
        sha: SHA_B,
        docType: 'passport',
        name: 'new-passport.pdf',
        expiresAt: daysAfter(now, 3650),
      });
      const options = await listReplacementOptions(proof, { oldDocumentId: manage ?? '' });
      if (!options.ok) throw new Error(`options: ${options.error.code}`);
      expect(options.value.candidates.map((c) => [c.documentId, c.status])).toEqual([
        [newer.documentId, 'READY'],
      ]);
      expect(options.value.cases.map((c) => c.missionId)).toEqual([chosen.missionId]);

      // A document never replaces itself.
      const self = await replaceDocument(proof, {
        oldDocumentId: old.documentId,
        newDocumentId: old.documentId,
      });
      expect(!self.ok && self.error.message).toBe(REPLACE_REFUSALS.sameDocument);

      const replaced = await replaceDocument(proof, {
        oldDocumentId: old.documentId,
        newDocumentId: newer.documentId,
      });
      if (!replaced.ok) throw new Error(`replace: ${replaced.error.code}`);
      expect(replaced.value.flaggedMissionIds).toEqual([chosen.missionId]);
      expect(await revisionOf(db, chosen.missionId)).toBe(chosenRevision + 1);
      const tasks = await listTasks(db, owner.accountId, chosen.missionId);
      expect(isOk(tasks) && tasks.value.some((t) => t.description.includes('replaced'))).toBe(true);
      // The explicit choice stays where it was made, flagged; nothing is switched silently.
      expect(await selectedDocumentsOf(db, chosen.missionId)).toEqual([old.documentId]);

      // No loop: the newer one cannot be replaced by the older one.
      const loop = await replaceDocument(proof, {
        oldDocumentId: newer.documentId,
        newDocumentId: old.documentId,
      });
      expect(loop.ok).toBe(false);

      // The old document reads Replaced, no longer counts automatically and sends no more reminders.
      const after = await getDocumentLifecycle(db, old.documentId, proof);
      expect(after?.replaced).toBe(true);
      expect(after && documentLifecycleLabel(after, now)).toBe('Replaced');
      const auto = await computeReadiness(db, automatic.missionId);
      if (!isOk(auto)) throw new Error('readiness');
      expect(auto.value.requirementResults[0]?.state).toBe('SATISFIED');
      // Proof that only the newer one counts: with it archived, the replaced one does not step in.
      expect((await archiveDocument(newer.documentId, proof)).ok).toBe(true);
      const withoutNewer = await computeReadiness(db, automatic.missionId);
      if (!isOk(withoutNewer)) throw new Error('readiness');
      expect(withoutNewer.value.requirementResults[0]?.state).not.toBe('SATISFIED');
      expect((await restoreDocument(newer.documentId, proof)).ok).toBe(true);
      const replacedOptions = await listReplacementOptions(proof, {
        oldDocumentId: old.documentId,
      });
      expect(!replacedOptions.ok && replacedOptions.error.message).toBe(
        REPLACE_REFUSALS.alreadyReplaced,
      );
      const before = await db.select().from(schema.notifications);
      await sweepExpiryReminders(db, daysAfter(now, 23));
      const afterSweep = await db.select().from(schema.notifications);
      expect(afterSweep.length).toBe(before.length);
    },
    JOURNEY_TIMEOUT,
  );
});
