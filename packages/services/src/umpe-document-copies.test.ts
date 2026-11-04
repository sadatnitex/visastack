import { createHash } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
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
