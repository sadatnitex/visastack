import { createHash } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './db';
import {
  MemoryBlobStore,
  addTraveller,
  freshJourneyDb,
  ownerProof,
  seedOwner,
  uploadDocument,
} from './lifecycle/integration/journey-helpers.test-support';

// Counting the space for the copy is the last step. When it fails, the copy that already exists
// must stay exactly as it is: its stored bytes are never deleted by a failure that came after it.
vi.mock('./uploads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./uploads')>()),
  finalizeUpload: vi.fn(async () => {
    throw new Error('the reservation could not be closed');
  }),
}));

const { copyDocumentToPerson } = await import('./umpe-document-copies');

const BYTES = new Uint8Array(10);
const SHA = createHash('sha256').update(BYTES).digest('hex');

let db: Db;
beforeEach(async () => {
  db = (await freshJourneyDb()).db;
});

describe('a failure after the copy exists', () => {
  it('leaves the copy and its stored bytes alone and still reports the copy as kept', async () => {
    const store = new MemoryBlobStore();
    const husband = await seedOwner(db, 'late@example.invalid', { displayName: 'Nazmus Sadat' });
    const wife = {
      accountId: husband.accountId,
      applicantId: await addTraveller(db, husband.accountId, {
        relationship: 'FAMILY_MEMBER',
        displayName: 'Salma Sadat',
      }),
    };
    const original = await uploadDocument(db, husband, {
      docType: 'MARRIAGE_CERTIFICATE',
      sha: SHA,
      sizeBytes: BYTES.byteLength,
      storage: store,
    });
    const result = await copyDocumentToPerson(
      await ownerProof(db, husband),
      await ownerProof(db, wife),
      { storage: store },
      { documentId: original.documentId },
    );
    expect(isOk(result)).toBe(true);
    const copies = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.applicantId, wife.applicantId));
    expect(copies).toHaveLength(1);
    // Both stored files are still there: the original and the copy's own.
    expect(store.objects.size).toBe(2);
  });
});
