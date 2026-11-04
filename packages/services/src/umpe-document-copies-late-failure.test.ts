import { createHash } from 'node:crypto';
import { isErr } from '@visastack/core';
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

// Closing the space reservation is part of the one transaction that makes the copy. When it fails,
// the whole copy is undone: no document, no stored bytes, no space held, and a plain answer.
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

describe('a failure while the copy is being made', () => {
  it('undoes the whole copy: no document, no stored copy, no space held', async () => {
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
    expect(isErr(result) && result.error.message).toBe(
      'The copy could not be made. Try again in a minute.',
    );
    expect(
      await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.applicantId, wife.applicantId)),
    ).toHaveLength(0);
    // Only the original's stored file remains, and no reservation is left holding space.
    expect(store.objects.size).toBe(1);
    const intents = await db
      .select({ status: schema.uploadIntents.status })
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.applicantId, wife.applicantId));
    expect(intents.every((intent) => intent.status === 'FAILED')).toBe(true);
    // The failure reason written for the log is fixed text, never a name.
    const [reason] = await db
      .select({ reason: schema.uploadIntents.failureReason })
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.applicantId, wife.applicantId));
    expect(reason?.reason).toBe('copy failed');
  });
});
