// Delete My File (owner decision of 3 Nov 2026, PROGRAMME D12): the owner removes one of their own
// documents for good, at once. Every guard here is proven by breaking the real code once.
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { accountPrincipal } from '../../access/principal';
import { type AuthorizedApplicant, EACH_GRANT, requireAccess } from '../../access/require-access';
import type { Db } from '../../db';
import { readDocumentAccessToken } from '../../document-access-token';
import { listDocuments, previewDocument, recheckDocumentAccess } from '../../documents';
import { placeLegalHold } from '../../legal-hold';
import { listTasks } from '../../missions';
import { RATE_LIMITS, windowStartFor } from '../../rate-limit';
import type { AccessRef, IssueReadRefInput, StoragePort } from '../../storage';
import { getDocumentLifecycle } from '../foundation';
import {
  JOURNEY_TIMEOUT,
  type JourneyOwner,
  MemoryBlobStore,
  SHA_A,
  SHA_B,
  addTraveller,
  auditEventsOf,
  daysAfter,
  erasureJobsFor,
  lifecycleRow,
  openCase,
  ownerProof,
  productEventTypes,
  receiptRow,
  receiptsOf,
  revisionOf,
  runErasure,
  seedAccount,
  seedAgencyWithGrant,
  seedOwner,
  selectedDocumentsOf,
  staffScope,
  uploadDocument,
} from '../integration/journey-helpers.test-support';
import { deleteDuplicate } from '../recently-deleted';
import { requestRemoval } from './index';
import {
  type DeleteMyFileInput,
  SELF_DELETE_REFUSALS,
  type SelfDeleteImpact,
  deleteMyFile,
  previewDeleteMyFile,
} from './self-delete';

type Manage = AuthorizedApplicant<'MANAGE'>;

const STAFF = 'self-delete-staff@example.com';
const NONE: SelfDeleteImpact = {
  openCases: 0,
  agencies: 0,
  shares: 0,
  profileDetails: 0,
  aiChoices: 0,
  trips: 0,
  contributorHandovers: 0,
};

async function fresh(): Promise<{ db: Db; client: PGlite }> {
  const client = await createMigratedPglite();
  return { db: drizzle(client, { schema }) as unknown as Db, client };
}

/** Preview, then delete exactly what the preview showed (the way the screen does). */
async function remove(proof: Manage, documentId: string, over: Partial<DeleteMyFileInput> = {}) {
  const preview = await previewDeleteMyFile(proof, { documentId });
  if (!preview.ok) return preview;
  return deleteMyFile(proof, {
    documentId,
    typed: 'DELETE',
    confirmed: preview.value.impact,
    stepUpSatisfied: true,
    ...over,
  });
}

/** Everything a deletion writes, counted, so a refusal can be shown to have written nothing. */
async function written(db: Db): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tables = {
    lifecycle: schema.documentLifecycle,
    receipts: schema.deletionReceipts,
    erasureJobs: schema.erasureJobs,
    notifications: schema.notifications,
    tasks: schema.missionTasks,
    selected: schema.selectedEvidence,
    audit: schema.auditEvents,
    events: schema.productEvents,
  } as const;
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: count() }).from(table);
    counts[name] = row?.n ?? -1;
  }
  return counts;
}

async function expectRefusedWithNothingWritten(
  db: Db,
  attempt: () => Promise<{
    readonly ok: boolean;
    readonly error?: { code: string; message: string };
  }>,
  expected: { code?: string; message?: string },
) {
  const before = await written(db);
  const outcome = await attempt();
  expect(outcome.ok).toBe(false);
  if (expected.code) expect(outcome.error?.code).toBe(expected.code);
  if (expected.message) expect(outcome.error?.message).toBe(expected.message);
  expect(await written(db)).toEqual(before);
}

describe('Delete My File', () => {
  it(
    'deletes at once: hidden everywhere, one record without a name, the owner told, the worker verifies the file gone',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-happy@example.com');
      const storage = new MemoryBlobStore();
      const doc = await uploadDocument(db, owner, {
        sha: SHA_A,
        storage,
        sizeBytes: 23,
        name: 'Private Person Passport.pdf',
      });
      const open = await openCase(db, owner, { documentId: doc.documentId, title: 'Open Trip' });
      const agency = await seedAgencyWithGrant(db, owner, { missionId: open.missionId });
      const proof = await ownerProof(db, owner);
      const revision = await revisionOf(db, open.missionId);

      const preview = await previewDeleteMyFile(proof, { documentId: doc.documentId });
      if (!preview.ok) throw new Error(`preview: ${preview.error.message}`);
      expect(preview.value).toEqual({
        impact: { ...NONE, openCases: 1, agencies: 1 },
        needsFreshSignIn: true,
      });

      const deleted = await remove(proof, doc.documentId);
      if (!deleted.ok) throw new Error(`delete: ${deleted.error.message}`);
      expect(deleted.value).toMatchObject({
        removal: 'QUEUED',
        openCasesUpdated: 1,
        agenciesTold: 1,
      });
      expect(deleted.value.documentCode).toMatch(/^D-/);

      // Hidden and unservable the moment it commits, before the worker runs.
      expect((await getDocumentLifecycle(db, doc.documentId, proof))?.state).toBe('REMOVING');
      const listed = await listDocuments(db, owner.accountId, owner.applicantId);
      expect(listed.ok && listed.value).toEqual([]);
      expect(storage.objects.has(doc.objectKey)).toBe(true);

      // The open case lost the selection, got a task and a revision bump.
      expect(await selectedDocumentsOf(db, open.missionId)).toEqual([]);
      expect(await revisionOf(db, open.missionId)).toBeGreaterThan(revision);
      const tasks = await listTasks(db, owner.accountId, open.missionId);
      expect(tasks.ok && tasks.value.map((t) => t.description)).toEqual([
        expect.stringContaining('deleted by you'),
      ]);

      // The record: path REQUEST, asked by the owner, approved by nobody, codes and counts only.
      const [receipt] = await receiptsOf(db, owner.applicantId);
      expect(receipt).toMatchObject({
        path: 'REQUEST',
        status: 'REMOVING',
        requestedByAccountId: owner.accountId,
        approvedByAccountId: null,
        subjectCode: deleted.value.documentCode,
        documentKind: 'passport',
        verifiedGoneAt: null,
      });
      expect((await lifecycleRow(db, doc.documentId))?.deletePath).toBe('REQUEST');
      expect((await erasureJobsFor(db, doc.documentId)).map((j) => j.reason)).toEqual([
        'DOCUMENT_REMOVAL',
      ]);

      // The audit event, the product event and every notice carry no name.
      const [audit] = await auditEventsOf(db, 'DOCUMENT_SELF_DELETED');
      expect(audit?.metadata).toMatchObject({
        path: 'SELF',
        receiptId: receipt?.id,
        openCases: 1,
        agenciesTold: 1,
      });
      expect(await productEventTypes(db)).toContain('DOCUMENT_SELF_DELETED');
      const notices = await db.select().from(schema.notifications);
      const toOwner = notices.filter((n) => n.recipientAccountId === owner.accountId);
      expect(toOwner.map((n) => `${n.eventType}:${n.channel}`).sort()).toEqual([
        'DOCUMENT_SELF_DELETED:EMAIL',
        'DOCUMENT_SELF_DELETED:IN_APP',
      ]);
      expect(notices.some((n) => n.recipientAccountId === agency.agentAccountId)).toBe(true);
      for (const text of [
        JSON.stringify(receipt),
        JSON.stringify(audit),
        JSON.stringify(notices.map((n) => n.payload)),
      ]) {
        expect(text).not.toContain('Private Person');
      }

      // The worker destroys and verifies it; only then does the record read Removed.
      expect(await runErasure(db, storage)).toEqual({ processed: 1, blocked: 0, failed: 0 });
      expect(storage.objects.has(doc.objectKey)).toBe(false);
      const removed = await receiptRow(db, receipt?.id ?? '');
      expect(removed).toMatchObject({ status: 'REMOVED', effects: { bytesFreed: 23 } });
      expect(removed?.verifiedGoneAt).toBeInstanceOf(Date);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'takes the traveller row, then the document row (the removal engine and the worker lock in that order)',
    async () => {
      const client = await createMigratedPglite();
      const statements: string[] = [];
      const db = drizzle(client, {
        schema,
        logger: { logQuery: (query) => void statements.push(query) },
      }) as unknown as Db;
      const owner = await seedOwner(db, 'sd-locks@example.com');
      const doc = await uploadDocument(db, owner, { sha: SHA_A });
      const proof = await ownerProof(db, owner);
      statements.length = 0;
      const deleted = await remove(proof, doc.documentId);
      expect(deleted.ok).toBe(true);
      const locks = statements.filter((s) => /for update/i.test(s));
      const applicantLock = locks.findIndex((s) => s.includes('from "applicants"'));
      const documentLock = locks.findIndex((s) => s.includes('from "documents"'));
      expect(applicantLock).toBeGreaterThanOrEqual(0);
      expect(documentLock).toBeGreaterThan(applicantLock);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'asks for a fresh sign-in only when the file is shared or an open case uses it, and refuses without it',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-stepup@example.com');
      const plain = await uploadDocument(db, owner, { sha: SHA_A });
      const used = await uploadDocument(db, owner, { sha: SHA_B });
      await openCase(db, owner, { documentId: used.documentId });
      const proof = await ownerProof(db, owner);

      const plainPreview = await previewDeleteMyFile(proof, { documentId: plain.documentId });
      expect(plainPreview.ok && plainPreview.value.needsFreshSignIn).toBe(false);
      const usedPreview = await previewDeleteMyFile(proof, { documentId: used.documentId });
      expect(usedPreview.ok && usedPreview.value.needsFreshSignIn).toBe(true);

      await expectRefusedWithNothingWritten(
        db,
        () => remove(proof, used.documentId, { stepUpSatisfied: false }),
        { code: 'step_up_required' },
      );
      expect((await remove(proof, plain.documentId, { stepUpSatisfied: false })).ok).toBe(true);
      expect((await remove(proof, used.documentId, { stepUpSatisfied: true })).ok).toBe(true);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'checks the typed word on the server: any other word, an empty one, or a non-string is refused',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-word@example.com');
      const doc = await uploadDocument(db, owner, { sha: SHA_A });
      const proof = await ownerProof(db, owner);
      for (const typed of ['', ' ', 'delet', 'DELETE IT', 'REMOVE', 'yes', undefined, 7, null]) {
        await expectRefusedWithNothingWritten(
          db,
          () => remove(proof, doc.documentId, { typed: typed as unknown as string }),
          { code: 'invalid', message: SELF_DELETE_REFUSALS.word },
        );
      }
      // The word as the person types it on a phone: lower case and spaces around it are fine.
      expect((await remove(proof, doc.documentId, { typed: '  delete ' })).ok).toBe(true);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'refuses when more would change than the person saw, and works after they look again',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-stale@example.com');
      const doc = await uploadDocument(db, owner, { sha: SHA_A });
      const proof = await ownerProof(db, owner);
      const seen = await previewDeleteMyFile(proof, { documentId: doc.documentId });
      if (!seen.ok) throw new Error('preview');
      expect(seen.value.impact).toEqual(NONE);

      // After the screen was read, a case starts using the file and an agency can see it.
      const open = await openCase(db, owner, { documentId: doc.documentId });
      await seedAgencyWithGrant(db, owner, { missionId: open.missionId });
      await expectRefusedWithNothingWritten(
        db,
        () =>
          deleteMyFile(proof, {
            documentId: doc.documentId,
            typed: 'DELETE',
            confirmed: seen.value.impact,
            stepUpSatisfied: true,
          }),
        { code: 'stale', message: SELF_DELETE_REFUSALS.stale },
      );
      // Less than before is fine; more is not, in any one count.
      const looked = await previewDeleteMyFile(proof, { documentId: doc.documentId });
      if (!looked.ok) throw new Error('preview again');
      expect(looked.value.impact).toMatchObject({ openCases: 1, agencies: 1 });
      await expectRefusedWithNothingWritten(
        db,
        () =>
          deleteMyFile(proof, {
            documentId: doc.documentId,
            typed: 'DELETE',
            confirmed: { ...looked.value.impact, agencies: 0 },
            stepUpSatisfied: true,
          }),
        { code: 'stale' },
      );
      expect(
        (
          await deleteMyFile(proof, {
            documentId: doc.documentId,
            typed: 'DELETE',
            confirmed: looked.value.impact,
            stepUpSatisfied: true,
          })
        ).ok,
      ).toBe(true);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'refuses a malformed confirmation without writing anything',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-confirmed@example.com');
      const doc = await uploadDocument(db, owner, { sha: SHA_A });
      const proof = await ownerProof(db, owner);
      for (const confirmed of [
        undefined,
        null,
        {},
        { ...NONE, openCases: -1 },
        { ...NONE, shares: 0.5 },
        { ...NONE, trips: '0' },
      ]) {
        await expectRefusedWithNothingWritten(
          db,
          () =>
            remove(proof, doc.documentId, { confirmed: confirmed as unknown as SelfDeleteImpact }),
          { code: 'invalid', message: SELF_DELETE_REFUSALS.impact },
        );
      }
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'refuses under a legal hold of any scope, queues nothing and leaves the file visible',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-hold@example.com');
      const staff = await staffScope(db, STAFF, 'RETENTION_PURGE');
      const proof = await ownerProof(db, owner);
      const hold = (extra: { documentId?: string; missionId?: string }) =>
        placeLegalHold(db, {
          actorAccountId: staff.accountId,
          applicantId: owner.applicantId,
          reason: 'synthetic hold',
          reviewAt: daysAfter(new Date(), 90),
          stepUpSatisfied: true,
          ...extra,
        });

      const onDocument = await uploadDocument(db, owner, { sha: SHA_A });
      const onCase = await uploadDocument(db, owner, { sha: SHA_B });
      const heldCase = await openCase(db, owner, { documentId: onCase.documentId });
      const placed = [
        await hold({ documentId: onDocument.documentId }),
        await hold({ missionId: heldCase.missionId }),
      ];
      expect(placed.every((p) => p.ok)).toBe(true);
      for (const doc of [onDocument, onCase]) {
        await expectRefusedWithNothingWritten(db, () => remove(proof, doc.documentId), {
          code: 'invalid',
          message: SELF_DELETE_REFUSALS.legalHold,
        });
        expect((await erasureJobsFor(db, doc.documentId)).length).toBe(0);
        expect((await getDocumentLifecycle(db, doc.documentId, proof))?.state).toBe('CURRENT');
      }

      // A hold on the whole record stops every file.
      const other = await seedOwner(db, 'sd-hold-wide@example.com');
      const wide = await uploadDocument(db, other, { sha: SHA_A });
      const wideHold = await placeLegalHold(db, {
        actorAccountId: staff.accountId,
        applicantId: other.applicantId,
        reason: 'synthetic hold',
        reviewAt: daysAfter(new Date(), 90),
        stepUpSatisfied: true,
      });
      expect(wideHold.ok).toBe(true);
      const outcome = await remove(await ownerProof(db, other), wide.documentId);
      expect(!outcome.ok && outcome.error.message).toBe(SELF_DELETE_REFUSALS.legalHold);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'a hold placed after the delete, before the worker runs, keeps the file and the record reads Kept',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-hold-late@example.com');
      const storage = new MemoryBlobStore();
      const doc = await uploadDocument(db, owner, { sha: SHA_A, storage });
      const deleted = await remove(await ownerProof(db, owner), doc.documentId);
      expect(deleted.ok).toBe(true);
      const staff = await staffScope(db, STAFF, 'RETENTION_PURGE');
      const placed = await placeLegalHold(db, {
        actorAccountId: staff.accountId,
        applicantId: owner.applicantId,
        documentId: doc.documentId,
        reason: 'synthetic hold',
        reviewAt: daysAfter(new Date(), 90),
        stepUpSatisfied: true,
      });
      expect(placed.ok).toBe(true);
      expect(await runErasure(db, storage)).toEqual({ processed: 0, blocked: 1, failed: 0 });
      expect(storage.objects.has(doc.objectKey)).toBe(true);
      const [receipt] = await receiptsOf(db, owner.applicantId);
      expect(receipt?.status).toBe('BLOCKED');
      expect(receipt?.verifiedGoneAt).toBeNull();
      // Still hidden from the person: kept, not shown.
      const listed = await listDocuments(db, owner.accountId, owner.applicantId);
      expect(listed.ok && listed.value).toEqual([]);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'refuses a file a finished case used, or an agency request answered, and a withdrawn answer no longer keeps it',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-kept@example.com');
      const proof = await ownerProof(db, owner);
      const agency = await seedAgencyWithGrant(db, owner);

      const finished = await uploadDocument(db, owner, { sha: SHA_A });
      await openCase(db, owner, { documentId: finished.documentId, state: 'SUBMITTED' });
      await expectRefusedWithNothingWritten(db, () => remove(proof, finished.documentId), {
        code: 'invalid',
        message: SELF_DELETE_REFUSALS.finishedCase,
      });

      const answered = await uploadDocument(db, owner, { sha: SHA_B });
      await db.insert(schema.evidenceRequests).values({
        organizationId: agency.organizationId,
        applicantId: owner.applicantId,
        kind: 'DOCUMENT',
        respondingDocumentId: answered.documentId,
      });
      await expectRefusedWithNothingWritten(db, () => remove(proof, answered.documentId), {
        code: 'invalid',
        message: SELF_DELETE_REFUSALS.agencyAnswer,
      });

      const collected = await uploadDocument(db, owner, { sha: 'c'.repeat(64) });
      const response = await seedCollectionAnswer(db, owner, agency.organizationId, collected);
      await expectRefusedWithNothingWritten(db, () => remove(proof, collected.documentId), {
        code: 'invalid',
        message: SELF_DELETE_REFUSALS.agencyAnswer,
      });
      await db.insert(schema.agencyCollectionResponseWithdrawals).values({
        responseId: response,
        applicantId: owner.applicantId,
        withdrawnByAccountId: owner.accountId,
        reason: 'WITHDRAWN',
      });
      expect((await remove(proof, collected.documentId)).ok).toBe(true);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'counts shares by name, profile details, AI app choices, trips and a hand-over, still deletes, and the profile detail stays',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-warn@example.com');
      const storage = new MemoryBlobStore();
      const doc = await uploadDocument(db, owner, { sha: SHA_A, storage });
      const agency = await seedAgencyWithGrant(db, owner);
      await db.insert(schema.grants).values({
        applicantId: owner.applicantId,
        recipientOrganizationId: agency.organizationId,
        actions: ['VIEW_METADATA'],
        documentIds: [doc.documentId],
        purpose: 'review',
        status: 'ACTIVE',
      });
      const [field] = await db
        .insert(schema.fieldDefinitions)
        .values({ key: 'sd.synthetic.field', dataType: 'text' })
        .returning({ id: schema.fieldDefinitions.id });
      const [fact] = await db
        .insert(schema.facts)
        .values({ applicantId: owner.applicantId, fieldDefinitionId: field?.id ?? '' })
        .returning({ id: schema.facts.id });
      await db.insert(schema.factVersions).values({
        factId: fact?.id ?? '',
        value: 'synthetic',
        sourceDocumentVersionId: doc.versionId,
      });
      const open = await openCase(db, owner);
      await db.insert(schema.contributorRequests).values({
        missionId: open.missionId,
        applicantId: owner.applicantId,
        contributorEmail: 'sponsor@example.com',
        docType: 'PASSPORT',
        purpose: 'sponsor',
        tokenHash: 'synthetic-token-hash',
        expiresAt: daysAfter(new Date(), 1),
        submittedDocumentId: doc.documentId,
      });
      const [connection] = await db
        .insert(schema.aiConnections)
        .values({
          accountId: owner.accountId,
          applicantId: owner.applicantId,
          clientId: 'synthetic-client',
          clientName: 'Synthetic App',
          clientHost: 'app.example.com',
          caseMode: 'NONE',
        })
        .returning({ id: schema.aiConnections.id });
      await db.insert(schema.aiConnectionDocuments).values({
        connectionId: connection?.id ?? '',
        documentId: doc.documentId,
        variant: 'SAFE_COPY',
      });
      const [trip] = await db
        .insert(schema.umpeTrips)
        .values({
          ownerAccountId: owner.accountId,
          title: 'Synthetic Trip',
          destination: 'GB',
          purpose: 'visit',
          itineraryRef: 'ref',
        })
        .returning({ id: schema.umpeTrips.id });
      await db.insert(schema.umpeTripEvidence).values({
        tripId: trip?.id ?? '',
        sourceApplicantId: owner.applicantId,
        documentId: doc.documentId,
      });
      const proof = await ownerProof(db, owner);
      const preview = await previewDeleteMyFile(proof, { documentId: doc.documentId });
      expect(preview.ok && preview.value).toEqual({
        impact: {
          ...NONE,
          agencies: 1,
          shares: 1,
          profileDetails: 1,
          aiChoices: 1,
          trips: 1,
          contributorHandovers: 1,
        },
        needsFreshSignIn: true,
      });
      const deleted = await remove(proof, doc.documentId);
      expect(deleted.ok).toBe(true);
      // The agency was shared the file by name, so its owner is told, without the file name.
      const told = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.eventType, 'DOCUMENT_REMOVED_BY_TRAVELLER'));
      expect(told.map((n) => n.recipientAccountId)).toEqual([agency.agentAccountId]);
      // The profile detail stays, now without its source, once the file is gone.
      expect(await runErasure(db, storage)).toEqual({ processed: 1, blocked: 0, failed: 0 });
      const [kept] = await db
        .select({ source: schema.factVersions.sourceDocumentVersionId })
        .from(schema.factVersions)
        .where(eq(schema.factVersions.factId, fact?.id ?? ''));
      expect(kept?.source).toBeNull();
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'closes a waiting removal request for the same file',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-request@example.com');
      const doc = await uploadDocument(db, owner, { sha: SHA_A });
      const proof = await ownerProof(db, owner);
      const asked = await requestRemoval(proof, { documentId: doc.documentId, reason: 'OTHER' });
      if (!asked.ok) throw new Error('request');
      const deleted = await remove(proof, doc.documentId);
      if (!deleted.ok) throw new Error(`delete: ${deleted.error.message}`);
      const [request] = await db
        .select()
        .from(schema.documentRemovalRequests)
        .where(eq(schema.documentRemovalRequests.id, asked.value.id));
      expect(request).toMatchObject({ status: 'COMPLETED', receiptId: deleted.value.receiptId });
      expect(request?.completedAt).toBeInstanceOf(Date);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'deletes an archived file and a family record file by the account that manages the record',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-family@example.com');
      const familyId = await addTraveller(db, owner.accountId, { relationship: 'FAMILY_MEMBER' });
      const mine = await uploadDocument(db, owner, { sha: SHA_A });
      await db.insert(schema.documentLifecycle).values({
        documentId: mine.documentId,
        applicantId: owner.applicantId,
        archivedAt: new Date(),
      });
      expect((await remove(await ownerProof(db, owner), mine.documentId)).ok).toBe(true);

      const theirs = await uploadDocument(
        db,
        { accountId: owner.accountId, applicantId: familyId },
        { sha: SHA_B },
      );
      const family = await ownerProof(db, { accountId: owner.accountId, applicantId: familyId });
      expect((await remove(family, theirs.documentId)).ok).toBe(true);
      // The family record's proof never reaches the other record's files.
      const again = await uploadDocument(db, owner, { sha: 'd'.repeat(64) });
      const crossed = await remove(family, again.documentId);
      expect(!crossed.ok && crossed.error.code).toBe('not_found');
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'a file already deleted, or in Recently Deleted, is refused in plain terms',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-twice@example.com');
      const proof = await ownerProof(db, owner);
      const doc = await uploadDocument(db, owner, { sha: SHA_A });
      expect((await remove(proof, doc.documentId)).ok).toBe(true);
      const second = await previewDeleteMyFile(proof, { documentId: doc.documentId });
      expect(!second.ok && second.error.message).toBe(SELF_DELETE_REFUSALS.alreadyGone);

      const survivor = await uploadDocument(db, owner, { sha: SHA_B });
      const copy = await uploadDocument(db, owner, { sha: SHA_B });
      expect(survivor.documentId).not.toBe(copy.documentId);
      expect((await deleteDuplicate(proof, { documentId: copy.documentId })).ok).toBe(true);
      const recent = await remove(proof, copy.documentId);
      expect(!recent.ok && recent.error.message).toBe(SELF_DELETE_REFUSALS.alreadyGone);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'is refused for everyone but the record owner, even a staff scope, a read-level proof or a made-up proof',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-actors@example.com');
      const doc = await uploadDocument(db, owner, { sha: SHA_A });
      const ownerView = await ownerProof(db, owner, 'VIEW_METADATA');
      const staff = await staffScope(db, STAFF, 'RETENTION_PURGE');
      const stranger = await seedAccount(db, 'sd-stranger@example.com');
      const agency = await seedAgencyWithGrant(db, owner, { actions: ['VIEW_METADATA', 'MANAGE'] });
      const agencyGate = await requireAccess(
        db,
        accountPrincipal(agency.agentAccountId),
        'MANAGE',
        { applicantId: owner.applicantId },
        { purpose: EACH_GRANT },
      );
      if (!agencyGate.ok) throw new Error('agency proof');
      expect(agencyGate.value.actor.kind).toBe('organization_member');
      const strangerGate = await requireAccess(
        db,
        accountPrincipal(stranger),
        'MANAGE',
        { applicantId: owner.applicantId },
        { purpose: EACH_GRANT },
      );
      expect(strangerGate.ok).toBe(false);

      const impostors: ReadonlyArray<readonly [string, unknown]> = [
        ['agency member with a MANAGE grant', agencyGate.value],
        ['owner read-level proof', ownerView],
        ['staff scope', staff],
        [
          'plain object',
          { applicant: { id: owner.applicantId }, actor: { kind: 'applicant_owner' } },
        ],
        ['nothing', undefined],
      ];
      for (const [label, proof] of impostors) {
        await expectRefusedWithNothingWritten(
          db,
          async () => {
            const preview = await previewDeleteMyFile(proof as Manage, {
              documentId: doc.documentId,
            });
            expect(preview.ok, `${label} preview`).toBe(false);
            return deleteMyFile(proof as Manage, {
              documentId: doc.documentId,
              typed: 'DELETE',
              confirmed: NONE,
              stepUpSatisfied: true,
            });
          },
          { code: 'forbidden', message: SELF_DELETE_REFUSALS.notOwner },
        );
      }
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'is rate limited per account: the tenth in an hour goes, the eleventh is refused and writes nothing',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-rate@example.com');
      const proof = await ownerProof(db, owner);
      const now = new Date();
      // Nine already this hour, then two more.
      await db.insert(schema.rateLimitBuckets).values({
        subjectId: owner.accountId,
        action: 'document.self_delete',
        windowStart: windowStartFor(now, RATE_LIMITS.DOCUMENT_SELF_DELETE.windowMs),
        count: RATE_LIMITS.DOCUMENT_SELF_DELETE.limit - 1,
      });
      const tenth = await uploadDocument(db, owner, { sha: SHA_A });
      const eleventh = await uploadDocument(db, owner, { sha: SHA_B });
      const preview = await previewDeleteMyFile(proof, { documentId: tenth.documentId }, { now });
      if (!preview.ok) throw new Error('preview');
      const input = (documentId: string): DeleteMyFileInput => ({
        documentId,
        typed: 'DELETE',
        confirmed: preview.value.impact,
        stepUpSatisfied: true,
      });
      expect((await deleteMyFile(proof, input(tenth.documentId), { now })).ok).toBe(true);
      const before = await written(db);
      const refused = await deleteMyFile(proof, input(eleventh.documentId), { now });
      expect(!refused.ok && refused.error.code).toBe('rate_limited');
      const after = await written(db);
      expect({ ...after, events: 0 }).toEqual({ ...before, events: 0 });
      expect((await getDocumentLifecycle(db, eleventh.documentId, proof))?.state).toBe('CURRENT');
      const [bucket] = await db
        .select({ n: schema.rateLimitBuckets.count })
        .from(schema.rateLimitBuckets)
        .where(
          and(
            eq(schema.rateLimitBuckets.subjectId, owner.accountId),
            eq(schema.rateLimitBuckets.action, 'document.self_delete'),
          ),
        );
      expect(bucket?.n).toBe(RATE_LIMITS.DOCUMENT_SELF_DELETE.limit + 1);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'a backup restore never brings the file back: reconciliation replays the removal',
    async () => {
      const live = await fresh();
      const owner = await seedOwner(live.db, 'sd-backup@example.com');
      const storage = new MemoryBlobStore();
      const doc = await uploadDocument(live.db, owner, { sha: SHA_A, storage });
      const restorePoint = new Date();
      const dump = await live.client.dumpDataDir('none');
      const copy = new PGlite({ loadDataDir: dump });
      const backup = drizzle(copy, { schema }) as unknown as Db;

      expect((await remove(await ownerProof(live.db, owner), doc.documentId)).ok).toBe(true);
      expect(await runErasure(live.db, storage)).toEqual({ processed: 1, blocked: 0, failed: 0 });

      const { reconcileRestoredBranch } = await import('../../backup-reconciliation');
      const present = async (db: Db) =>
        (
          await db
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(eq(schema.documents.id, doc.documentId))
        ).length === 1;
      expect(await present(backup)).toBe(true);
      const report = await reconcileRestoredBranch(live.db, backup, restorePoint);
      expect(report.errors).toEqual([]);
      expect(await present(backup)).toBe(false);
      await copy.close();
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'is hidden from the owner before the worker runs: list, preview and an already issued link',
    async () => {
      const { db } = await fresh();
      const owner = await seedOwner(db, 'sd-hidden@example.com');
      const doc = await uploadDocument(db, owner, { sha: SHA_A });
      const storage: StoragePort = {
        issueReadRef: async (input: IssueReadRefInput): Promise<AccessRef> => ({
          url: `fake://${input.bucket}/${input.objectKey}?d=${input.disposition}&v=${input.variant}`,
          expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
          disposition: input.disposition,
          variant: input.variant,
        }),
      };
      const actor = { kind: 'applicant_owner', applicantId: owner.applicantId as never } as const;
      const preview = (purpose: string) =>
        previewDocument(db, storage, {
          actor,
          documentId: doc.documentId,
          purpose,
          accessTokenSecret: 'self-delete-test-secret',
        });
      const issued = await preview('owner_preview');
      if (!issued.ok) throw new Error('preview before');
      const fields = readDocumentAccessToken(new URL(issued.value.url).searchParams);
      if (!fields) throw new Error('no token');
      expect((await recheckDocumentAccess(db, fields)).allowed).toBe(true);

      expect((await remove(await ownerProof(db, owner), doc.documentId)).ok).toBe(true);

      // Before the worker has run: a link already issued fails at redemption, a new one is refused.
      expect(await recheckDocumentAccess(db, fields)).toEqual({
        allowed: false,
        reason: 'document_not_found',
      });
      expect((await preview('owner_preview_again')).ok).toBe(false);
      const listed = await listDocuments(db, owner.accountId, owner.applicantId);
      expect(listed.ok && listed.value).toEqual([]);
    },
    JOURNEY_TIMEOUT,
  );
});

/** One agency answer that names `document`, with the rows it needs (request, revision, response). */
async function seedCollectionAnswer(
  db: Db,
  owner: JourneyOwner,
  organizationId: string,
  document: { readonly documentId: string; readonly versionId: string },
): Promise<string> {
  const [request] = await db
    .insert(schema.agencyCollectionRequests)
    .values({ organizationId, destination: 'GB' })
    .returning({ id: schema.agencyCollectionRequests.id });
  const requestId = request?.id ?? '';
  const [revision] = await db
    .insert(schema.agencyCollectionRequestRevisions)
    .values({
      requestId,
      revisionNo: 1,
      items: [],
      contentSha256: 'a'.repeat(64),
      issuedByAccountId: owner.accountId,
    })
    .returning({ id: schema.agencyCollectionRequestRevisions.id });
  const [response] = await db
    .insert(schema.agencyCollectionResponses)
    .values({
      organizationId,
      requestId,
      revisionId: revision?.id ?? '',
      linkId: owner.accountId,
      applicantId: owner.applicantId,
      submittedByAccountId: owner.accountId,
      destination: 'GB',
      revisionNo: 1,
      personName: 'Synthetic Person',
      consentVersion: 'v1',
      contentSha256: 'b'.repeat(64),
    })
    .returning({ id: schema.agencyCollectionResponses.id });
  const responseId = response?.id ?? '';
  await db.insert(schema.agencyCollectionResponseItems).values({
    responseId,
    itemId: 'passport',
    kind: 'DOCUMENT',
    documentId: document.documentId,
    documentVersionId: document.versionId,
    title: 'passport.pdf',
  });
  return responseId;
}
