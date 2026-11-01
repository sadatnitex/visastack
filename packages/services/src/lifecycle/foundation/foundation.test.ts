import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, getTableName } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type StaffScope, accountPrincipal, staffPrincipal } from '../../access/principal';
import {
  type AuthorizedApplicant,
  EACH_GRANT,
  requireAccess,
} from '../../access/require-access';
import { provisionAccount } from '../../accounts';
import { createApplicant } from '../../applicants';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import { addDocumentVersion, registerDocument } from '../../documents';
import { runErasureWorker } from '../../erasure';
import { placeLegalHold } from '../../legal-hold';
import { attachPackVersion, createMission, getMissionForOwner, selectEvidence } from '../../missions';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../../packs';
import type { BlobStore, ListObjectsPage, PutObjectInput, StoredBytes } from '../../storage';
import {
  DOCUMENT_ACTIONS,
  type DocumentActionView,
  LIFECYCLE_RELATIONS,
  advanceDeletionReceipt,
  availableDocumentActions,
  enqueueDocumentRemoval,
  everydayApplicantCondition,
  everydayDocumentCondition,
  getDocumentLifecycle,
  getDocumentLifecycles,
  lifecycleTablesPresent,
  listDeletionReceipts,
  mergeReceiptEffects,
  openDeletionReceipt,
  presentApplicantCondition,
  presentDocumentCondition,
  receiptEffectsSchema,
} from './index';

const HEAVY = 60_000;

async function freshDb(options: { readonly withoutLifecycle?: boolean } = {}): Promise<Db> {
  const client = await createMigratedPglite();
  if (options.withoutLifecycle) {
    // The database as production has it until the owner approves migration 0113.
    await client.exec(
      'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
    );
  }
  return drizzle(client, { schema }) as unknown as Db;
}

class FakeBlobStore implements BlobStore {
  readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: unknown, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

async function seedOwner(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Synthetic Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId: account.id, applicantId: applicant.value.id, email };
}

async function proof<A extends 'MANAGE' | 'VIEW_METADATA'>(
  db: Db,
  accountId: string,
  applicantId: string,
  action: A,
): Promise<AuthorizedApplicant<A>> {
  const result = await requireAccess(
    db,
    accountPrincipal(accountId),
    action,
    { applicantId },
    { purpose: EACH_GRANT },
  );
  if (!result.ok) throw new Error(`proof: ${result.error.code}`);
  return result.value;
}

async function staff(db: Db, accountId: string, email: string) {
  const scope = await staffPrincipal(
    db,
    { accountId, email, bootstrapEmails: [email] },
    'APPLICANT_DIRECTORY_VIEW',
  );
  if (!scope.ok) throw new Error('staff scope');
  return scope.value as StaffScope<'APPLICANT_DIRECTORY_VIEW'>;
}

async function seedDocument(
  db: Db,
  owner: { accountId: string; applicantId: string },
  objectKeys: readonly string[],
  storage?: FakeBlobStore,
  docType?: string,
) {
  const doc = await registerDocument(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    originalName: 'synthetic.pdf',
    ...(docType ? { docType } : {}),
  });
  if (!isOk(doc)) throw new Error('doc');
  for (const objectKey of objectKeys) {
    await addDocumentVersion(db, {
      actorAccountId: owner.accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    await db
      .update(schema.storageObjects)
      .set({ sizeBytes: 10 })
      .where(eq(schema.storageObjects.objectKey, objectKey));
    await storage?.putObject({
      bucket: 'CLEAN',
      objectKey,
      contentType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
  }
  return doc.value.id;
}

/** Puts a document in Recently Deleted (or approved for removal) with an open receipt, as lanes C and D will. */
async function markDeleted(
  db: Db,
  owner: { accountId: string; applicantId: string },
  documentId: string,
  path: 'DUPLICATE' | 'REQUEST' = 'DUPLICATE',
  code = 'D-7K2Q9M',
) {
  const access = await proof(db, owner.accountId, owner.applicantId, 'MANAGE');
  const receipt = await openDeletionReceipt(
    db,
    {
      applicantId: owner.applicantId,
      subjectKind: 'DOCUMENT',
      subjectCode: code,
      path,
      requestedByAccountId: owner.accountId,
    },
    access,
  );
  if (!receipt.ok) throw new Error(`receipt: ${receipt.error.code}`);
  const now = new Date();
  await db.insert(schema.documentLifecycle).values({
    documentId,
    applicantId: owner.applicantId,
    deletedAt: now,
    deletedByAccountId: owner.accountId,
    deletePath: path,
    purgeAfter: path === 'DUPLICATE' ? new Date(now.getTime() + 30 * 86_400_000) : now,
    receiptId: receipt.value.id,
  });
  return { receiptId: receipt.value.id, access };
}

async function receiptRow(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(schema.deletionReceipts)
    .where(eq(schema.deletionReceipts.id, id));
  return row;
}

async function jobsFor(db: Db, documentId: string) {
  return db
    .select()
    .from(schema.erasureJobs)
    .where(eq(schema.erasureJobs.documentId, documentId));
}

describe('lifecycleTablesPresent', () => {
  it('names exactly the four tables of migration 0113', () => {
    expect([...LIFECYCLE_RELATIONS].sort()).toEqual(
      [
        getTableName(schema.documentLifecycle),
        getTableName(schema.applicantLifecycle),
        getTableName(schema.documentRemovalRequests),
        getTableName(schema.deletionReceipts),
      ].sort(),
    );
  });

  it(
    'is false before the migration and true after it',
    async () => {
      expect(await lifecycleTablesPresent(await freshDb({ withoutLifecycle: true }))).toBe(false);
      expect(await lifecycleTablesPresent(await freshDb())).toBe(true);
    },
    HEAVY,
  );
});

describe('availableDocumentActions', () => {
  const base: DocumentActionView = {
    state: 'CURRENT',
    replaced: false,
    isDuplicate: false,
    duplicateBlockReason: null,
    pendingRequest: false,
    legalHold: false,
    requestsSwitchOn: false,
  };
  it.each<[string, Partial<DocumentActionView>, string[]]>([
    ['a current unique document', {}, ['ARCHIVE', 'REPLACE']],
    ['a replaced document', { replaced: true }, ['ARCHIVE']],
    ['a deletable duplicate', { isDuplicate: true }, ['ARCHIVE', 'REPLACE', 'DELETE_DUPLICATE']],
    [
      'a duplicate a finished case selected (D5)',
      { isDuplicate: true, duplicateBlockReason: 'FINISHED_CASE' },
      ['ARCHIVE', 'REPLACE'],
    ],
    [
      'a unique document with requests on',
      { requestsSwitchOn: true },
      ['ARCHIVE', 'REPLACE', 'REQUEST_REMOVAL'],
    ],
    [
      'a document with a pending request',
      { requestsSwitchOn: true, pendingRequest: true, isDuplicate: true },
      ['ARCHIVE', 'REPLACE', 'CANCEL_REMOVAL_REQUEST'],
    ],
    [
      'a held document',
      { legalHold: true, isDuplicate: true, requestsSwitchOn: true },
      ['ARCHIVE', 'REPLACE'],
    ],
    ['an archived document', { state: 'ARCHIVED' }, ['RESTORE']],
    [
      'an archived duplicate',
      { state: 'ARCHIVED', isDuplicate: true },
      ['RESTORE', 'DELETE_DUPLICATE'],
    ],
    [
      'a document in Recently Deleted',
      { state: 'RECENTLY_DELETED', isDuplicate: true, requestsSwitchOn: true },
      ['RESTORE_DELETED'],
    ],
    ['a document being removed', { state: 'REMOVING', requestsSwitchOn: true }, []],
  ])('offers the right actions for %s', (_name, view, expected) => {
    const actions = availableDocumentActions({ ...base, ...view });
    expect(actions).toEqual(expected);
    // Always in DOCUMENT_ACTIONS order.
    expect(actions).toEqual(DOCUMENT_ACTIONS.filter((action) => actions.includes(action)));
  });
});

describe('receipt effects', () => {
  it('refuses unknown keys, so no title or name can be recorded', () => {
    expect(receiptEffectsSchema.safeParse({ title: 'Passport' }).success).toBe(false);
    expect(receiptEffectsSchema.safeParse({ casesSwitched: ['Visit to Japan'] }).success).toBe(
      false,
    );
    expect(receiptEffectsSchema.safeParse({ casesSwitched: ['C-7K2Q9M'], bytesFreed: 3 }).success).toBe(
      true,
    );
  });

  it('merges lists and keeps counts as first written', () => {
    expect(
      mergeReceiptEffects(
        { casesSwitched: ['C-7K2Q9M'], sharesAffected: 2 },
        { casesSwitched: ['C-7K2Q9M', 'C-AAAAAA'], sharesAffected: 2, bytesFreed: 9 },
      ),
    ).toEqual({ casesSwitched: ['C-7K2Q9M', 'C-AAAAAA'], sharesAffected: 2, bytesFreed: 9 });
    expect(mergeReceiptEffects({ sharesAffected: 2 }, { sharesAffected: 3 })).toBeNull();
  });
});

describe('lifecycle foundation with the tables present', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedOwner>>;
  let storage: FakeBlobStore;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedOwner(db, 'lifecycle-owner@example.com');
    storage = new FakeBlobStore();
  }, HEAVY);

  it(
    'filters deleted and archived documents and travellers with the four conditions',
    async () => {
      const current = await seedDocument(db, owner, ['k-current']);
      const archived = await seedDocument(db, owner, ['k-archived']);
      const deleted = await seedDocument(db, owner, ['k-deleted']);
      await db.insert(schema.documentLifecycle).values({
        documentId: archived,
        applicantId: owner.applicantId,
        archivedAt: new Date(),
      });
      await markDeleted(db, owner, deleted);
      const ids = async (condition: ReturnType<typeof presentDocumentCondition>) =>
        (
          await db
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(and(eq(schema.documents.applicantId, owner.applicantId), condition))
        )
          .map((row) => row.id)
          .sort();
      expect(await ids(presentDocumentCondition())).toEqual([current, archived].sort());
      expect(await ids(everydayDocumentCondition())).toEqual([current]);

      const other = await createApplicant(db, {
        actorAccountId: owner.accountId,
        ownerAccountId: owner.accountId,
        displayName: 'Synthetic Second',
      });
      if (!isOk(other)) throw new Error('applicant');
      await db.insert(schema.applicantLifecycle).values({
        applicantId: other.value.id,
        archivedAt: new Date(),
      });
      const people = async (condition: ReturnType<typeof presentApplicantCondition>) =>
        (
          await db
            .select({ id: schema.applicants.id })
            .from(schema.applicants)
            .where(and(eq(schema.applicants.ownerAccountId, owner.accountId), condition))
        ).map((row) => row.id);
      expect((await people(presentApplicantCondition())).sort()).toEqual(
        [owner.applicantId, other.value.id].sort(),
      );
      expect(await people(everydayApplicantCondition())).toEqual([owner.applicantId]);
    },
    HEAVY,
  );

  it(
    'reads each document state, only for the applicant the proof covers',
    async () => {
      const current = await seedDocument(db, owner, ['s-current']);
      const archived = await seedDocument(db, owner, ['s-archived']);
      const deleted = await seedDocument(db, owner, ['s-deleted']);
      const requested = await seedDocument(db, owner, ['s-requested']);
      await db.insert(schema.documentLifecycle).values({
        documentId: archived,
        applicantId: owner.applicantId,
        archivedAt: new Date(),
      });
      await markDeleted(db, owner, deleted);
      await markDeleted(db, owner, requested, 'REQUEST', 'D-7K2Q9N');
      await db
        .update(schema.documents)
        .set({ supersededByDocumentId: archived })
        .where(eq(schema.documents.id, current));
      const access = await proof(db, owner.accountId, owner.applicantId, 'VIEW_METADATA');
      const states = await getDocumentLifecycles(
        db,
        [current, archived, deleted, requested, 'not-a-uuid'],
        access,
      );
      expect(states.get(current)).toMatchObject({ state: 'CURRENT', replaced: true });
      expect(states.get(archived)?.state).toBe('ARCHIVED');
      expect(states.get(deleted)).toMatchObject({ state: 'RECENTLY_DELETED', deletePath: 'DUPLICATE' });
      expect(states.get(requested)?.state).toBe('REMOVING');
      expect(states.size).toBe(4);
      // Thirty days later the deleted duplicate is on its way out.
      const later = await getDocumentLifecycle(db, deleted, access, {
        now: new Date(Date.now() + 31 * 86_400_000),
      });
      expect(later?.state).toBe('REMOVING');

      const stranger = await seedOwner(db, 'lifecycle-stranger@example.com');
      const strangerAccess = await proof(db, stranger.accountId, stranger.applicantId, 'MANAGE');
      expect((await getDocumentLifecycles(db, [current], strangerAccess)).size).toBe(0);
      expect(await getDocumentLifecycle(db, current, { ...access } as typeof access)).toBeNull();
    },
    HEAVY,
  );

  it(
    'writes a receipt only from strict input and the right access',
    async () => {
      const access = await proof(db, owner.accountId, owner.applicantId, 'MANAGE');
      const input = {
        applicantId: owner.applicantId,
        subjectKind: 'DOCUMENT' as const,
        subjectCode: 'D-7K2Q9M',
        path: 'DUPLICATE' as const,
      };
      expect((await openDeletionReceipt(db, { ...input, title: 'Passport' } as never, access)).ok).toBe(
        false,
      );
      expect(
        (await openDeletionReceipt(db, { ...input, subjectCode: 'P-7K2Q9M' }, access)).ok,
      ).toBe(false);
      const stranger = await seedOwner(db, 'receipt-stranger@example.com');
      const strangerAccess = await proof(db, stranger.accountId, stranger.applicantId, 'MANAGE');
      expect((await openDeletionReceipt(db, input, strangerAccess)).error?.code).toBe('forbidden');
      expect((await openDeletionReceipt(db, input, { ...access } as typeof access)).ok).toBe(false);

      const opened = await openDeletionReceipt(
        db,
        { ...input, effects: { casesSwitched: ['C-7K2Q9M'] } },
        access,
      );
      if (!opened.ok) throw new Error('open');
      const id = opened.value.id;
      expect((await advanceDeletionReceipt(db, id, 'REMOVED', {}, access)).ok).toBe(false);
      expect(
        (await advanceDeletionReceipt(db, id, 'REMOVING', { effects: { sharesAffected: 1 } }, access))
          .ok,
      ).toBe(true);
      expect((await advanceDeletionReceipt(db, id, 'SCHEDULED', {}, access)).ok).toBe(false);
      expect(
        (await advanceDeletionReceipt(db, id, 'REMOVING', { effects: { sharesAffected: 2 } }, access))
          .ok,
      ).toBe(false);
      expect((await advanceDeletionReceipt(db, id, 'REMOVED', {}, strangerAccess)).ok).toBe(false);
      const row = await receiptRow(db, id);
      expect(row?.status).toBe('REMOVING');
      expect(row?.effects).toEqual({ casesSwitched: ['C-7K2Q9M'], sharesAffected: 1 });
    },
    HEAVY,
  );

  it(
    'lists receipts for the owner and a privacy admin only, codes and counts only',
    async () => {
      const doc = await seedDocument(db, owner, ['l-doc']);
      await markDeleted(db, owner, doc);
      const view = await proof(db, owner.accountId, owner.applicantId, 'VIEW_METADATA');
      const listed = await listDeletionReceipts(view);
      if (!listed.ok) throw new Error('list');
      expect(listed.value).toHaveLength(1);
      expect(listed.value[0]).toMatchObject({ subjectCode: 'D-7K2Q9M', status: 'SCHEDULED' });
      expect(Object.keys(listed.value[0] ?? {})).not.toContain('requestedByAccountId');

      const admin = await provisionAccount(db, { email: 'privacy-admin@example.com' });
      if (!isOk(admin)) throw new Error('provision');
      const scope = await staff(db, admin.value.id, 'privacy-admin@example.com');
      expect((await listDeletionReceipts(scope, { db })).ok).toBe(false);
      const byStaff = await listDeletionReceipts(scope, { db, applicantId: owner.applicantId });
      expect(byStaff.ok && byStaff.value).toHaveLength(1);
    },
    HEAVY,
  );

  it(
    'refuses to queue a removal under an applicant-wide, document or case hold',
    async () => {
      const holds: Array<'applicant' | 'document' | 'case'> = ['applicant', 'document', 'case'];
      for (const [index, scope] of holds.entries()) {
        const local = await freshDb();
        const person = await seedOwner(local, `hold-${scope}@example.com`);
        const documentId = await seedDocument(local, person, [`hold-${scope}`], undefined, 'bank_statement');
        let missionId: string | undefined;
        if (scope === 'case') missionId = await selectInCase(local, person, documentId);
        const { receiptId, access } = await markDeleted(local, person, documentId, 'REQUEST');
        const placed = await placeLegalHold(local, {
          actorAccountId: person.accountId,
          applicantId: person.applicantId,
          reason: `synthetic ${index}`,
          reviewAt: new Date(Date.now() + 90 * 86_400_000),
          stepUpSatisfied: true,
          ...(scope === 'document' ? { documentId } : {}),
          ...(missionId ? { missionId } : {}),
        });
        expect(isOk(placed), scope).toBe(true);
        const result = await enqueueDocumentRemoval(
          local,
          { documentId, applicantId: person.applicantId, receiptId },
          access,
        );
        expect(result.ok && result.value.outcome, scope).toBe('BLOCKED');
        expect(await jobsFor(local, documentId), scope).toHaveLength(0);
        expect((await receiptRow(local, receiptId))?.status, scope).toBe('BLOCKED');
      }
    },
    HEAVY * 3,
  );

  it(
    'removes a document only after every stored file is verified gone, then reads Removed',
    async () => {
      const documentId = await seedDocument(db, owner, ['r-v1', 'r-v2'], storage, 'bank_statement');
      const missionId = await selectInCase(db, owner, documentId);
      const before = await getMissionForOwner(db, owner.accountId, missionId);
      if (!isOk(before)) throw new Error('mission');
      const { receiptId, access } = await markDeleted(db, owner, documentId, 'REQUEST');

      const notWaiting = await seedDocument(db, owner, ['r-other']);
      expect(
        (await enqueueDocumentRemoval(
          db,
          { documentId: notWaiting, applicantId: owner.applicantId, receiptId },
          access,
        )).ok,
      ).toBe(false);

      const queued = await enqueueDocumentRemoval(
        db,
        { documentId, applicantId: owner.applicantId, receiptId },
        access,
      );
      expect(queued.ok && queued.value).toEqual({ outcome: 'QUEUED', storageObjects: 2 });
      expect((await receiptRow(db, receiptId))?.status).toBe('REMOVING');
      expect((await jobsFor(db, documentId)).map((job) => job.reason)).toEqual([
        'DOCUMENT_REMOVAL',
        'DOCUMENT_REMOVAL',
      ]);

      // One file verified: the document and both files stay.
      expect(await runErasureWorker(db, storage, { limit: 1 })).toEqual({
        processed: 1,
        blocked: 0,
        failed: 0,
      });
      expect(
        await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
      ).toHaveLength(1);
      expect((await receiptRow(db, receiptId))?.status).toBe('REMOVING');

      // The second file verified: the document goes, every selecting case moves on, record reads Removed.
      expect(await runErasureWorker(db, storage, { limit: 5 })).toEqual({
        processed: 1,
        blocked: 0,
        failed: 0,
      });
      expect(
        await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
      ).toHaveLength(0);
      const after = await getMissionForOwner(db, owner.accountId, missionId);
      if (!isOk(after)) throw new Error('mission');
      expect(after.value.materialRevision).toBe(before.value.materialRevision + 1);
      const receipt = await receiptRow(db, receiptId);
      expect(receipt?.status).toBe('REMOVED');
      expect(receipt?.verifiedGoneAt).toBeInstanceOf(Date);
      expect(receipt?.effects).toEqual({ bytesFreed: 20 });
      expect(storage.objects.size).toBe(0);
    },
    HEAVY,
  );

  it(
    'keeps the record and reads Kept when a hold lands while the files are being removed',
    async () => {
      const documentId = await seedDocument(db, owner, ['h-v1'], storage);
      const { receiptId, access } = await markDeleted(db, owner, documentId, 'REQUEST');
      expect(
        (await enqueueDocumentRemoval(
          db,
          { documentId, applicantId: owner.applicantId, receiptId },
          access,
        )).ok,
      ).toBe(true);
      const originalGet = storage.getObject.bind(storage);
      storage.getObject = async (objectKey: string) => {
        const result = await originalGet(objectKey);
        await placeLegalHold(db, {
          actorAccountId: owner.accountId,
          applicantId: owner.applicantId,
          reason: 'synthetic mid-flight',
          reviewAt: new Date(Date.now() + 90 * 86_400_000),
          stepUpSatisfied: true,
        });
        return result;
      };
      expect(await runErasureWorker(db, storage, { limit: 5 })).toEqual({
        processed: 0,
        blocked: 1,
        failed: 0,
      });
      expect(
        await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
      ).toHaveLength(1);
      expect((await receiptRow(db, receiptId))?.status).toBe('BLOCKED');
    },
    HEAVY,
  );
});

describe('lifecycle foundation with the tables missing', () => {
  it(
    'reads every document as Current and refuses lifecycle writes without failing the transaction',
    async () => {
      const db = await freshDb({ withoutLifecycle: true });
      const owner = await seedOwner(db, 'no-lifecycle@example.com');
      const documentId = await seedDocument(db, owner, ['m-doc']);
      const access = await proof(db, owner.accountId, owner.applicantId, 'MANAGE');
      const view = await proof(db, owner.accountId, owner.applicantId, 'VIEW_METADATA');
      await db.transaction(async (tx) => {
        expect(await getDocumentLifecycle(tx, documentId, access)).toEqual({
          state: 'CURRENT',
          replaced: false,
          archivedAt: null,
          deletedAt: null,
          purgeAfter: null,
          deletePath: null,
        });
        const opened = await openDeletionReceipt(
          tx,
          {
            applicantId: owner.applicantId,
            subjectKind: 'DOCUMENT',
            subjectCode: 'D-7K2Q9M',
            path: 'DUPLICATE',
          },
          access,
        );
        expect(opened.ok).toBe(false);
        const removal = await enqueueDocumentRemoval(
          tx,
          {
            documentId,
            applicantId: owner.applicantId,
            receiptId: '00000000-0000-4000-8000-000000000001',
          },
          access,
        );
        expect(removal.ok).toBe(false);
        // The transaction is still usable.
        expect(
          await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
        ).toHaveLength(1);
      });
      expect((await listDeletionReceipts(view)).ok && []).toEqual([]);
    },
    HEAVY,
  );
});

let packCounter = 0;

/** A published pack, a case using it and the document selected as its evidence; returns the case id. */
async function selectInCase(
  db: Db,
  owner: { accountId: string; applicantId: string },
  documentId: string,
): Promise<string> {
  packCounter += 1;
  const pack = await createPack(db, {
    actorAccountId: owner.accountId,
    key: `lifecycle.pack.${packCounter}`,
    name: 'Lifecycle Test Pack',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: owner.accountId, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  const requirement = await addRequirement(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
    kind: 'DOCUMENT',
    docType: 'bank_statement',
    citation: 'rule 1',
  });
  if (!isOk(requirement)) throw new Error('requirement');
  await approvePackVersion(db, { actorAccountId: owner.accountId, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: owner.accountId, packVersionId: version.value.id });
  const mission = await createMission(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    title: 'Synthetic case',
  });
  if (!isOk(mission)) throw new Error('mission');
  await attachPackVersion(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packVersionId: version.value.id,
  });
  const selected = await selectEvidence(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packRequirementId: requirement.value.id,
    documentId,
  });
  if (!isOk(selected)) throw new Error('select');
  return mission.value.id;
}
