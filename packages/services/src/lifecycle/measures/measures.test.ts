import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { type StaffScope, staffPrincipal } from '../../access/principal';
import { provisionAccount } from '../../accounts';
import { createApplicant } from '../../applicants';
import { appendAuditEvent } from '../../audit';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import { addDocumentVersion, registerDocument } from '../../documents';
import { recordProductEvent } from '../../product-events';
import { getLifecycleMeasures } from './measures';

/**
 * Lane Z: the PROGRAMME section 9 measures on the admin Product Scorecard, counted from the
 * registered events and the lifecycle tables, with the tables present and with them missing.
 */

const HEAVY = 60_000;
const DAY = 86_400_000;
/** Audit times cannot be backdated (the table refuses edits), so the measure is read 10 days ahead. */
const REAL = Date.now();
const NOW = new Date(REAL + 10 * DAY);
const STAFF_EMAIL = 'measures-staff@example.test';
let counter = 0;

async function freshDb(options: { readonly withoutLifecycle?: boolean } = {}): Promise<Db> {
  const client = await createMigratedPglite();
  if (options.withoutLifecycle) {
    await client.exec(
      'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
    );
  }
  return drizzle(client, { schema }) as unknown as Db;
}

async function seedOwner(db: Db) {
  counter += 1;
  const provisioned = await provisionAccount(db, { email: `measures-${counter}@example.test` });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Synthetic Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId, applicantId: applicant.value.id };
}

async function addDocument(
  db: Db,
  owner: { accountId: string; applicantId: string },
  sha: string | null,
) {
  const doc = await registerDocument(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    originalName: 'synthetic.pdf',
    docType: 'PASSPORT',
  });
  if (!isOk(doc)) throw new Error('document');
  counter += 1;
  const version = await addDocumentVersion(db, {
    actorAccountId: owner.accountId,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `lc-z-measures-${counter}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
    ...(sha === null ? {} : { sha256: sha }),
  });
  if (!isOk(version)) throw new Error('version');
  return doc.value.id;
}

async function staff(db: Db): Promise<StaffScope<'APPLICANT_DIRECTORY_VIEW'>> {
  const account = await provisionAccount(db, { email: STAFF_EMAIL });
  if (!isOk(account)) throw new Error('staff');
  const scope = await staffPrincipal(
    db,
    { accountId: account.value.id, email: STAFF_EMAIL, bootstrapEmails: [STAFF_EMAIL] },
    'APPLICANT_DIRECTORY_VIEW',
  );
  if (!scope.ok) throw new Error('staff scope');
  return scope.value;
}

async function reminder(db: Db, accountId: string, documentId: string, at: Date) {
  counter += 1;
  await db.insert(schema.notifications).values({
    eventType: 'DOCUMENT_EXPIRY',
    channel: 'IN_APP',
    idempotencyKey: `lc-z-measures-${counter}`,
    recipientAccountId: accountId,
    resourceId: documentId,
    payload: {},
    createdAt: at,
  });
}

async function seed(db: Db, options: { readonly lifecycle: boolean }) {
  const owner = await seedOwner(db);
  const a1 = await addDocument(db, owner, 'a'.repeat(64));
  const a2 = await addDocument(db, owner, 'a'.repeat(64));
  const b = await addDocument(db, owner, 'b'.repeat(64));
  const c = await addDocument(db, owner, 'c'.repeat(64));
  // Two files with no fingerprint are never counted as duplicates of each other.
  await addDocument(db, owner, null);
  await addDocument(db, owner, null);
  // Another person's identical file is not a duplicate of this person's.
  const other = await seedOwner(db);
  await addDocument(db, other, 'b'.repeat(64));
  if (options.lifecycle) {
    // A deleted third copy is not kept, so it is not counted.
    const a3 = await addDocument(db, owner, 'a'.repeat(64));
    await db.insert(schema.documentLifecycle).values({
      documentId: a3,
      applicantId: owner.applicantId,
      deletedAt: new Date(NOW.getTime() - DAY),
      deletePath: 'DUPLICATE',
      purgeAfter: new Date(NOW.getTime() + 29 * DAY),
    });
  }
  // Reminders: b first reminded 15 days before NOW and replaced 5 days later (counts); c first
  // reminded 30 days before NOW and replaced 20 days later (does not count); a1 reminded 3 days
  // before NOW (too recent to judge); a2 reminded 120 days before NOW (too old).
  await reminder(db, owner.accountId, b, new Date(REAL - 5 * DAY));
  await reminder(db, owner.accountId, b, new Date(REAL - 2 * DAY));
  await reminder(db, owner.accountId, c, new Date(REAL - 20 * DAY));
  await reminder(db, owner.accountId, a1, new Date(NOW.getTime() - 3 * DAY));
  await reminder(db, owner.accountId, a2, new Date(NOW.getTime() - 120 * DAY));
  // The replacements are recorded now (REAL).
  for (const documentId of [b, c]) {
    await appendAuditEvent(db, {
      eventType: 'DOCUMENT_SUPERSEDED',
      actorAccountId: owner.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: owner.applicantId,
      resourceType: 'document',
      resourceId: documentId,
    });
  }
  return { owner };
}

describe('lifecycle measures on the admin scorecard (PROGRAMME section 9)', () => {
  it(
    'counts reminders replaced within 14 days, duplicates kept, restores and removal decisions',
    async () => {
      const db = await freshDb();
      const { owner } = await seed(db, { lifecycle: true });
      // Restores per 100 deletions and archives: 1 undo and 1 restore against 10 removals.
      for (let i = 0; i < 6; i += 1) {
        await recordProductEvent(db, {
          eventType: 'DOCUMENT_ARCHIVED',
          accountId: owner.accountId,
        });
      }
      for (let i = 0; i < 4; i += 1) {
        await recordProductEvent(db, { eventType: 'DOCUMENT_DELETED', accountId: owner.accountId });
      }
      await recordProductEvent(db, { eventType: 'DOCUMENT_RESTORED', accountId: owner.accountId });
      await recordProductEvent(db, {
        eventType: 'DOCUMENT_DELETE_UNDONE',
        accountId: owner.accountId,
      });
      // Removal requests: decided in 1, 3 and 5 working days; one pending for 40 days.
      const requested = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
      const base = {
        applicantId: owner.applicantId,
        documentCode: 'D-TEST01',
        reason: 'NO_LONGER_NEEDED' as const,
      };
      await db.insert(schema.documentRemovalRequests).values([
        {
          ...base,
          status: 'APPROVED',
          requestedAt: new Date('2026-11-16T09:00:00Z'),
          decidedAt: new Date('2026-11-17T09:00:00Z'),
          decisionCode: 'APPROVED',
        },
        {
          ...base,
          status: 'DECLINED',
          requestedAt: new Date('2026-11-12T09:00:00Z'),
          decidedAt: new Date('2026-11-17T09:00:00Z'),
          decisionCode: 'LEGAL_HOLD',
        },
        {
          ...base,
          status: 'APPROVED',
          requestedAt: new Date('2026-11-10T09:00:00Z'),
          decidedAt: new Date('2026-11-17T09:00:00Z'),
          decisionCode: 'APPROVED',
        },
        { ...base, documentCode: 'D-TEST02', status: 'PENDING', requestedAt: requested(40) },
        { ...base, documentCode: 'D-TEST03', status: 'CANCELLED', requestedAt: requested(60) },
      ]);

      const measures = await getLifecycleMeasures(db, await staff(db), { now: NOW });
      if (!measures.ok) throw new Error(measures.error.code);
      expect(measures.value.tablesPresent).toBe(true);
      expect(measures.value.duplicatesKept).toEqual({
        documents: 5,
        duplicates: 1,
        per100: 20,
        target: 3,
      });
      expect(measures.value.restores).toEqual({
        deletionsAndArchives: 10,
        restores: 2,
        per100: 20,
        target: 10,
      });
      expect(measures.value.removalDecisions).toEqual({
        decided: 3,
        medianWorkingDays: 3,
        overThirtyDays: 1,
        targetMedian: 3,
        targetMaxDays: 30,
      });
      expect(measures.value.reminderToReplacement).toEqual({
        reminded: 2,
        replacedWithin14Days: 1,
        percent: 50,
        target: 40,
      });
    },
    HEAVY,
  );

  it(
    'works before migration 0113: the duplicate figure counts every document, removal decisions are left out',
    async () => {
      const db = await freshDb({ withoutLifecycle: true });
      await seed(db, { lifecycle: false });
      const measures = await getLifecycleMeasures(db, await staff(db), { now: NOW });
      if (!measures.ok) throw new Error(measures.error.code);
      expect(measures.value.tablesPresent).toBe(false);
      expect(measures.value.duplicatesKept).toMatchObject({ documents: 5, duplicates: 1 });
      expect(measures.value.removalDecisions).toBeNull();
      expect(measures.value.restores.per100).toBeNull();
      expect(measures.value.reminderToReplacement).toMatchObject({
        reminded: 2,
        replacedWithin14Days: 1,
      });
    },
    HEAVY,
  );
});
