import { createHash, randomUUID } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { accountPrincipal } from './access/principal';
import { requireAccess } from './access/require-access';
import { provisionAccount } from './accounts';
import {
  aiFileErasurePending,
  listAiFileCandidates,
  storeAiConnectionFiles,
} from './ai-connection-files';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';

/** A made-up PDF; synthetic data only. */
const SYNTHETIC_PDF = new Uint8Array(Buffer.from('%PDF-1.7 synthetic lifecycle file'));

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function person(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const ownerId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { ownerId, applicantId: applicant.value.id };
}

/** A clean visa document whose latest version is ready to use. */
async function visa(db: Db, ownerId: string, applicantId: string): Promise<string> {
  const doc = await registerDocument(db, {
    actorAccountId: ownerId,
    applicantId,
    originalName: 'synthetic-visa.pdf',
    docType: 'VISA',
  });
  if (!isOk(doc)) throw new Error('document');
  const version = await addDocumentVersion(db, {
    actorAccountId: ownerId,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `doc-${randomUUID()}`,
    sizeBytes: SYNTHETIC_PDF.byteLength,
    sha256: createHash('sha256').update(SYNTHETIC_PDF).digest('hex'),
    safetyStatus: 'CLEAN',
    processingStatus: 'APPROVED',
  });
  if (!isOk(version)) throw new Error('version');
  return doc.value.id;
}

async function ownerProof(db: Db, ownerId: string, applicantId: string) {
  const result = await requireAccess(
    db,
    accountPrincipal(ownerId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'ai_connection' },
  );
  if (!isOk(result)) throw new Error(`gate: ${result.error.code}`);
  return result.value;
}

async function markDocument(
  db: Db,
  documentId: string,
  applicantId: string,
  state: 'archived' | 'deleted',
) {
  const now = new Date();
  await db.insert(schema.documentLifecycle).values(
    state === 'archived'
      ? { documentId, applicantId, archivedAt: now }
      : {
          documentId,
          applicantId,
          deletedAt: now,
          deletePath: 'DUPLICATE',
          purgeAfter: new Date(now.getTime() + 30 * 86_400_000),
        },
  );
}

describe('AI app original files and the resource lifecycle (LC-A2)', () => {
  it('offers neither archived nor deleted documents as candidates', async () => {
    const db = await freshDb();
    const { ownerId, applicantId } = await person(db, 'lc-files-offer@example.com');
    const current = await visa(db, ownerId, applicantId);
    const archived = await visa(db, ownerId, applicantId);
    const deleted = await visa(db, ownerId, applicantId);
    await markDocument(db, archived, applicantId, 'archived');
    await markDocument(db, deleted, applicantId, 'deleted');

    const listed = await listAiFileCandidates(await ownerProof(db, ownerId, applicantId));
    if (!isOk(listed)) throw new Error('candidates');
    expect(listed.value.documents.map((row) => row.documentId)).toEqual([current]);
  });

  it('keeps an already-chosen archived document and drops a deleted one when choices are stored', async () => {
    const db = await freshDb();
    const { ownerId, applicantId } = await person(db, 'lc-files-store@example.com');
    const archived = await visa(db, ownerId, applicantId);
    const deleted = await visa(db, ownerId, applicantId);
    const [connection] = await db
      .insert(schema.aiConnections)
      .values({
        accountId: ownerId,
        applicantId,
        clientId: 'https://synthetic.example.test/client',
        clientName: 'Synthetic App',
        clientHost: 'synthetic.example.test',
        caseMode: 'NONE',
      })
      .returning({ id: schema.aiConnections.id });
    if (!connection) throw new Error('connection');
    await db.insert(schema.aiConnectionDocuments).values([
      { connectionId: connection.id, documentId: archived, variant: 'SAFE_COPY' },
      { connectionId: connection.id, documentId: deleted, variant: 'SAFE_COPY' },
    ]);
    await markDocument(db, archived, applicantId, 'archived');
    await markDocument(db, deleted, applicantId, 'deleted');

    const stored = await storeAiConnectionFiles(await ownerProof(db, ownerId, applicantId), db, {
      connectionId: connection.id,
      files: undefined,
      documentList: true,
      featureAvailable: true,
      stepUpSatisfied: false,
    });
    expect(stored).toEqual({ ok: true, value: { files: 1, originals: 0 } });
    const left = await db
      .select({ documentId: schema.aiConnectionDocuments.documentId })
      .from(schema.aiConnectionDocuments)
      .where(eq(schema.aiConnectionDocuments.connectionId, connection.id));
    expect(left.map((row) => row.documentId)).toEqual([archived]);
  });

  it('answers a deleted document as leaving and an archived one as not leaving', async () => {
    const db = await freshDb();
    const { ownerId, applicantId } = await person(db, 'lc-files-erasure@example.com');
    const archived = await visa(db, ownerId, applicantId);
    const deleted = await visa(db, ownerId, applicantId);
    await markDocument(db, archived, applicantId, 'archived');
    await markDocument(db, deleted, applicantId, 'deleted');

    const proof = await ownerProof(db, ownerId, applicantId);
    expect(await aiFileErasurePending(proof, deleted)).toBe(true);
    expect(await aiFileErasurePending(proof, archived)).toBe(false);
  });
});
