import { createHash } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { resolveDocumentType } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { enqueueErasureJob } from './erasure';
import {
  JOURNEY_TIMEOUT,
  MemoryBlobStore,
  addTraveller,
  auditEventsOf,
  freshJourneyDb,
  ownerProof,
  seedOwner,
  uploadDocument,
} from './lifecycle/integration/journey-helpers.test-support';
import { loadUploadQuotaConfig } from './quotas';
import {
  SHARED_BETWEEN_PEOPLE_KINDS,
  copyDocumentToPerson,
  isSharedBetweenPeopleKind,
  listCopyPeople,
} from './umpe-document-copies';
import { sweepAbandonedUploads } from './uploads';

const BYTES = new Uint8Array(10);
const SHA = createHash('sha256').update(BYTES).digest('hex');

let db: Db;
let store: MemoryBlobStore;
beforeEach(async () => {
  db = (await freshJourneyDb()).db;
  store = new MemoryBlobStore();
});

async function couple(email = 'copies@example.invalid') {
  const husband = await seedOwner(db, email, { displayName: 'Nazmus Sadat' });
  const wifeId = await addTraveller(db, husband.accountId, {
    relationship: 'FAMILY_MEMBER',
    displayName: 'Salma Sadat',
  });
  return { husband, wife: { accountId: husband.accountId, applicantId: wifeId } };
}

const certificate = (
  who: { accountId: string; applicantId: string },
  over: Parameters<typeof uploadDocument>[2] = {},
) =>
  uploadDocument(db, who, {
    docType: 'MARRIAGE_CERTIFICATE',
    sha: SHA,
    sizeBytes: BYTES.byteLength,
    storage: store,
    ...over,
  });

const documentsOf = (applicantId: string) =>
  db.select().from(schema.documents).where(eq(schema.documents.applicantId, applicantId));

describe('the kinds that belong to two people', () => {
  it('are real catalogue kinds, named by their own key', () => {
    for (const kind of SHARED_BETWEEN_PEOPLE_KINDS) {
      expect(resolveDocumentType(kind)?.key).toBe(kind);
    }
  });
});

describe('which documents belong to two people', () => {
  it('names a marriage certificate, a joint account statement and a family register, and nothing else', () => {
    expect([...SHARED_BETWEEN_PEOPLE_KINDS].sort()).toEqual([
      'FAMILY_REGISTER',
      'JOINT_ACCOUNT_STATEMENT',
      'MARRIAGE_CERTIFICATE',
    ]);
    for (const kind of [
      'PASSPORT',
      'NATIONAL_ID',
      'BANK_STATEMENT',
      'PHOTO',
      '',
      null,
      undefined,
    ]) {
      expect(isSharedBetweenPeopleKind(kind)).toBe(false);
    }
  });
});

describe('listing who a copy can go to', () => {
  it("offers the account's other people, never the record itself or another account's", async () => {
    const { husband } = await couple();
    const stranger = await seedOwner(db, 'stranger@example.invalid', {
      displayName: 'Someone Else',
    });
    const people = await listCopyPeople(await ownerProof(db, husband, 'VIEW_METADATA'));
    expect(people.map((person) => person.displayName)).toEqual(['Salma Sadat']);
    expect(
      (await listCopyPeople(await ownerProof(db, stranger, 'VIEW_METADATA'))).map(
        (person) => person.displayName,
      ),
    ).toEqual([]);
    expect(await listCopyPeople({} as never)).toEqual([]);
  });
});

describe('keeping a copy under another person', () => {
  it(
    'stores a separate copy for the spouse and leaves the original alone',
    async () => {
      const { husband, wife } = await couple();
      const original = await certificate(husband);
      const result = await copyDocumentToPerson(
        await ownerProof(db, husband),
        await ownerProof(db, wife),
        { storage: store },
        { documentId: original.documentId },
      );
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const [theirs] = await documentsOf(wife.applicantId);
      expect(theirs).toMatchObject({
        id: result.value.documentId,
        docType: 'MARRIAGE_CERTIFICATE',
      });
      expect(await documentsOf(husband.applicantId)).toHaveLength(1);

      // Its own stored file, with the same bytes: removing one can never touch the other.
      const keys = await db
        .select({ key: schema.storageObjects.objectKey, hash: schema.storageObjects.contentHash })
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.contentHash, SHA));
      expect(keys).toHaveLength(2);
      expect(new Set(keys.map((row) => row.key)).size).toBe(2);
      expect(store.objects.size).toBe(2);
      expect(store.objects.get(original.objectKey)).toBeDefined();

      // It goes through the normal pipeline, and the act is recorded.
      const [version] = await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, result.value.documentId));
      const jobs = await db
        .select()
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.documentVersionId, version?.id ?? ''));
      expect(jobs).toHaveLength(1);
      expect(await auditEventsOf(db, 'DOCUMENT_COPIED_TO_PERSON')).toHaveLength(1);
    },
    JOURNEY_TIMEOUT,
  );

  it('keeps one copy each, not two', async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    const args = [
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: store },
      { documentId: original.documentId },
    ] as const;
    expect(isOk(await copyDocumentToPerson(...args))).toBe(true);
    const again = await copyDocumentToPerson(...args);
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.error.message).toBe('Salma Sadat already has this document.');
    expect(await documentsOf(wife.applicantId)).toHaveLength(1);
    expect(store.objects.size).toBe(2);
  });

  it('refuses a document that belongs to one person only', async () => {
    const { husband, wife } = await couple();
    const passport = await certificate(husband, { docType: 'PASSPORT' });
    const result = await copyDocumentToPerson(
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: store },
      { documentId: passport.documentId },
    );
    expect(isErr(result)).toBe(true);
    expect(await documentsOf(wife.applicantId)).toHaveLength(0);
    expect(store.objects.size).toBe(1);
  });

  it("refuses the same person, another account's person, and a proof that is not the owner's", async () => {
    const { husband, wife } = await couple();
    const stranger = await seedOwner(db, 'other@example.invalid');
    const original = await certificate(husband);
    const input = { documentId: original.documentId };
    const asHusband = await ownerProof(db, husband);

    const same = await copyDocumentToPerson(asHusband, asHusband, { storage: store }, input);
    expect(isErr(same)).toBe(true);
    const foreign = await copyDocumentToPerson(
      asHusband,
      await ownerProof(db, stranger),
      { storage: store },
      input,
    );
    expect(isErr(foreign) && foreign.error.code).toBe('forbidden');
    const forged = await copyDocumentToPerson(asHusband, {} as never, { storage: store }, input);
    expect(isErr(forged) && forged.error.code).toBe('forbidden');
    // A document that is not the source person's own is not found, whoever asks.
    const wifeDoc = await certificate(wife, { sha: 'e'.repeat(64) });
    const crossed = await copyDocumentToPerson(
      asHusband,
      await ownerProof(db, wife),
      { storage: store },
      { documentId: wifeDoc.documentId },
    );
    expect(isErr(crossed) && crossed.error.code).toBe('not_found');
    expect(await documentsOf(stranger.applicantId)).toHaveLength(0);
    expect(store.objects.size).toBe(2);
  });

  it('waits for the safety check and refuses a file that does not match what was stored', async () => {
    const { husband, wife } = await couple();
    const checking = await certificate(husband, { ready: false });
    const notReady = await copyDocumentToPerson(
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: store },
      { documentId: checking.documentId },
    );
    expect(isErr(notReady) && notReady.error.message).toContain('still being checked for safety');

    const changed = await certificate(husband, { sha: SHA });
    store.objects.set(changed.objectKey, {
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    });
    const tampered = await copyDocumentToPerson(
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: store },
      { documentId: changed.documentId },
    );
    expect(isErr(tampered) && tampered.error.code).toBe('upstream_error');
    store.objects.delete(changed.objectKey);
    const missing = await copyDocumentToPerson(
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: store },
      { documentId: changed.documentId },
    );
    expect(isErr(missing) && missing.error.code).toBe('upstream_error');
    expect(await documentsOf(wife.applicantId)).toHaveLength(0);
  });

  it("counts the copy against the spouse's own space and stores nothing when it does not fit", async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    const tight = { ...loadUploadQuotaConfig(), maxApplicantEvidenceBytes: 5 };
    const result = await copyDocumentToPerson(
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: store, quotaConfig: tight },
      { documentId: original.documentId },
    );
    expect(isErr(result)).toBe(true);
    expect(await documentsOf(wife.applicantId)).toHaveLength(0);
    expect(store.objects.size).toBe(1);
    const intents = await db
      .select()
      .from(schema.uploadIntents)
      .where(and(eq(schema.uploadIntents.applicantId, wife.applicantId)));
    expect(intents.every((intent) => intent.status !== 'COMPLETED')).toBe(true);
  });

  it('keeps one copy when two requests for the same copy arrive together', async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    const attempt = async () =>
      copyDocumentToPerson(
        await ownerProof(db, husband),
        await ownerProof(db, wife),
        { storage: store },
        { documentId: original.documentId },
      );
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.filter((result) => isOk(result))).toHaveLength(1);
    const refused = results.find((result) => isErr(result));
    expect(refused && isErr(refused) && refused.error.message).toBe(
      'Salma Sadat already has this document.',
    );
    expect(await documentsOf(wife.applicantId)).toHaveLength(1);
    // The loser's half-stored bytes are removed: the original and the one copy remain.
    expect(store.objects.size).toBe(2);
  });

  it('refuses a person who has been removed (in Recently Deleted)', async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    await db.insert(schema.applicantLifecycle).values({
      applicantId: wife.applicantId,
      deletedAt: new Date(),
      deletedByAccountId: husband.accountId,
      purgeAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const result = await copyDocumentToPerson(
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: store },
      { documentId: original.documentId },
    );
    expect(isErr(result) && result.error.code).toBe('not_found');
    expect(await documentsOf(wife.applicantId)).toHaveLength(0);
    expect(store.objects.size).toBe(1);
    // Nobody is offered a removed person either.
    expect(await listCopyPeople(await ownerProof(db, husband, 'VIEW_METADATA'))).toEqual([]);
  });

  it('cleans up the stored copy when the document cannot be registered', async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    const failing = Object.assign(new MemoryBlobStore(), {
      objects: store.objects,
      async getPendingUpload() {
        return undefined;
      },
    });
    const result = await copyDocumentToPerson(
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: failing },
      { documentId: original.documentId },
    );
    expect(isErr(result)).toBe(true);
    // Only the original's bytes remain: the half-made copy is removed.
    expect(store.objects.size).toBe(1);
    expect(await documentsOf(wife.applicantId)).toHaveLength(0);
  });
});

describe('which documents and people a copy is refused for', () => {
  const asOwner = async (who: { accountId: string; applicantId: string }) => ownerProof(db, who);
  const copy = async (
    from: { accountId: string; applicantId: string },
    to: { accountId: string; applicantId: string },
    documentId: string,
    quotaConfig?: ReturnType<typeof loadUploadQuotaConfig>,
  ) =>
    copyDocumentToPerson(
      await asOwner(from),
      await asOwner(to),
      { storage: store, ...(quotaConfig ? { quotaConfig } : {}) },
      { documentId },
    );

  it('refuses a file handed in for one case only, and one that was replaced by a newer document', async () => {
    const { husband, wife } = await couple();
    const caseOnly = await certificate(husband);
    await db
      .update(schema.documents)
      .set({ walletVisible: false })
      .where(eq(schema.documents.id, caseOnly.documentId));
    const first = await copy(husband, wife, caseOnly.documentId);
    expect(isErr(first) && first.error.message).toContain('handed in for one case only');

    const older = await certificate(husband, { sha: 'f'.repeat(64) });
    const newer = await certificate(husband, { sha: 'd'.repeat(64) });
    await db
      .update(schema.documents)
      .set({ supersededByDocumentId: newer.documentId })
      .where(eq(schema.documents.id, older.documentId));
    const second = await copy(husband, wife, older.documentId);
    expect(isErr(second) && second.error.message).toContain('replaced by a newer one');
    expect(await documentsOf(wife.applicantId)).toHaveLength(0);
  });

  it('refuses a file that is being erased, one that did not pass its checks, and one still being checked', async () => {
    const { husband, wife } = await couple();
    const erasing = await certificate(husband);
    const [object] = await db
      .select({ id: schema.storageObjects.id })
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.objectKey, erasing.objectKey));
    await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: erasing.objectKey,
      expectedHash: SHA,
      storageObjectId: object?.id ?? '',
      documentId: erasing.documentId,
      applicantId: husband.applicantId,
    });
    const first = await copy(husband, wife, erasing.documentId);
    expect(isErr(first) && first.error.message).toContain('is being removed');

    const failed = await certificate(husband, { sha: 'c'.repeat(64) });
    await db
      .update(schema.documentVersions)
      .set({ safetyStatus: 'QUARANTINED' })
      .where(eq(schema.documentVersions.id, failed.versionId));
    const second = await copy(husband, wife, failed.documentId);
    expect(isErr(second) && second.error.message).toContain('did not pass its checks');

    const checking = await certificate(husband, { sha: 'b'.repeat(64), ready: false });
    const third = await copy(husband, wife, checking.documentId);
    expect(isErr(third) && third.error.message).toContain('still being checked for safety');
    expect(await documentsOf(wife.applicantId)).toHaveLength(0);
    expect(store.objects.size).toBe(3);
  });

  it('counts an archived copy as held, so the person restores it instead of getting two', async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    const made = await copy(husband, wife, original.documentId);
    expect(isOk(made)).toBe(true);
    if (!isOk(made)) return;
    await db.insert(schema.documentLifecycle).values({
      documentId: made.value.documentId,
      applicantId: wife.applicantId,
      archivedAt: new Date(),
      archivedByAccountId: husband.accountId,
    });
    const again = await copy(husband, wife, original.documentId);
    expect(isErr(again) && again.error.message).toBe('Salma Sadat already has this document.');
    expect(await documentsOf(wife.applicantId)).toHaveLength(1);
  });

  it('carries what the person recorded about the document, and no name into the log', async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    await db
      .update(schema.documents)
      .set({ issuer: 'City Registrar', documentDate: '2019-05-17', subject: 'Nikah' })
      .where(eq(schema.documents.id, original.documentId));
    const made = await copy(husband, wife, original.documentId);
    expect(isOk(made)).toBe(true);
    const [theirs] = await documentsOf(wife.applicantId);
    expect(theirs).toMatchObject({
      issuer: 'City Registrar',
      documentDate: '2019-05-17',
      subject: 'Nikah',
    });
    const [event] = await auditEventsOf(db, 'DOCUMENT_COPIED_TO_PERSON');
    expect(JSON.stringify(event)).not.toContain('Nazmus');
    expect(JSON.stringify(event)).not.toContain('Salma');
  });

  it('keeps a typed expiry date labelled as typed on the copy, and a read one as read', async () => {
    const { husband, wife } = await couple();
    const typed = await certificate(husband);
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date('2031-04-30T00:00:00.000Z') })
      .where(eq(schema.documents.id, typed.documentId));
    await db.insert(schema.documentExpiryEntries).values({
      documentId: typed.documentId,
      expiresOn: '2031-04-30',
      source: 'TYPED',
      mirrored: true,
    });
    expect(isOk(await copy(husband, wife, typed.documentId))).toBe(true);
    const [typedCopy] = await documentsOf(wife.applicantId);
    expect(typedCopy?.expiresAt?.toISOString().slice(0, 10)).toBe('2031-04-30');
    const copied = await db
      .select()
      .from(schema.documentExpiryEntries)
      .where(eq(schema.documentExpiryEntries.documentId, typedCopy?.id ?? ''));
    expect(copied.map((e) => [e.source, e.expiresOn, e.mirrored])).toEqual([
      ['TYPED', '2031-04-30', true],
    ]);

    // A date saved before typed dates existed (no entries) is a read date on the copy too.
    const other = await couple('legacy-copies@example.invalid');
    const legacy = await certificate(other.husband);
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date('2032-01-15T00:00:00.000Z') })
      .where(eq(schema.documents.id, legacy.documentId));
    expect(isOk(await copy(other.husband, other.wife, legacy.documentId))).toBe(true);
    const [legacyCopy] = await documentsOf(other.wife.applicantId);
    const legacyEntries = await db
      .select()
      .from(schema.documentExpiryEntries)
      .where(eq(schema.documentExpiryEntries.documentId, legacyCopy?.id ?? ''));
    expect(legacyEntries.map((e) => [e.source, e.expiresOn, e.mirrored])).toEqual([
      ['READ', '2032-01-15', false],
    ]);
  });

  it('says whose space is full, in plain words, and reads no file for it', async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    let reads = 0;
    const read = store.getObject.bind(store);
    store.getObject = async (key: string) => {
      reads += 1;
      return read(key);
    };
    const result = await copy(husband, wife, original.documentId, {
      ...loadUploadQuotaConfig(),
      maxApplicantEvidenceBytes: 5,
    });
    expect(isErr(result) && result.error.message).toBe(
      'Salma Sadat has no room left for another document. Remove one that is not needed, or ask us about a larger plan.',
    );
    expect(reads).toBe(0);
  });

  it('offers only people in use: not someone archived', async () => {
    const { husband, wife } = await couple();
    const third = await addTraveller(db, husband.accountId, {
      relationship: 'FAMILY_MEMBER',
      displayName: 'Nila Sadat',
    });
    await db.insert(schema.applicantLifecycle).values({
      applicantId: third,
      archivedAt: new Date(),
      archivedByAccountId: husband.accountId,
    });
    expect(
      (await listCopyPeople(await ownerProof(db, husband, 'VIEW_METADATA'))).map(
        (person) => person.applicantId,
      ),
    ).toEqual([wife.applicantId]);
  });

  it('is never undone by the daily cleanup of abandoned uploads', async () => {
    const { husband, wife } = await couple();
    const original = await certificate(husband);
    const made = await copy(husband, wife, original.documentId);
    expect(isOk(made)).toBe(true);
    // The space reservation is closed with the copy, so even a long-aged one is not abandoned.
    await db
      .update(schema.uploadIntents)
      .set({ expiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) });
    await sweepAbandonedUploads(db, store);
    expect(store.objects.size).toBe(2);
    expect(await documentsOf(wife.applicantId)).toHaveLength(1);
  });
});
