import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { requestDocumentReExtraction } from './jobs';

describe('owner-requested reading of a previously checked file', () => {
  let client: PGlite;
  let db: Db;
  let owner: string;
  let other: string;
  let person: string;
  const value = <T>(result: { ok: true; value: T } | { ok: false }): T => {
    if (!result.ok) throw new Error('Fixture failed');
    return result.value;
  };
  beforeAll(async () => {
    client = await createMigratedPglite();
    const handle = drizzle(client, { schema });
    db = handle as unknown as Db;
    owner = value(await provisionAccount(db, { email: 'reader-owner@example.test' })).id;
    other = value(await provisionAccount(db, { email: 'reader-other@example.test' })).id;
    value(
      await setConsent(db, {
        actorAccountId: owner,
        accountId: owner,
        type: 'CORE_PROCESSING',
        granted: true,
      }),
    );
    person = value(
      await createApplicant(db, {
        actorAccountId: owner,
        ownerAccountId: owner,
        displayName: 'Synthetic Reader',
      }),
    ).id;
  });
  afterAll(async () => {
    await client.close();
  });
  async function document(clean = true) {
    const doc = value(
      await registerDocument(db, {
        actorAccountId: owner,
        applicantId: person,
        originalName: 'synthetic.png',
      }),
    );
    const version = value(
      await addDocumentVersion(db, {
        actorAccountId: owner,
        documentId: doc.id,
        bucket: clean ? 'CLEAN' : 'QUARANTINE',
        objectKey: randomUUID(),
        safetyStatus: clean ? 'CLEAN' : 'QUARANTINED',
        processingStatus: clean ? 'AWAITING_REVIEW' : 'NEEDS_ATTENTION',
      }),
    ).version;
    return { actorAccountId: owner, documentId: doc.id, expectedVersionId: version.id };
  }
  it('preserves earlier job history, queues once and refuses an already refreshed copy', async () => {
    const input = await document();
    await db.insert(schema.processingJobs).values({
      documentVersionId: input.expectedVersionId,
      jobType: 'INTAKE',
      processingVersion: 1,
      idempotencyKey: `${input.expectedVersionId}:INTAKE:1`,
      status: 'DONE',
    });
    expect((await requestDocumentReExtraction(db, input)).ok).toBe(true);
    const jobs = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.documentVersionId, input.expectedVersionId));
    expect(jobs).toHaveLength(2);
    expect(jobs.find((job) => job.processingVersion === 1)?.status).toBe('DONE');
    expect(jobs.find((job) => job.processingVersion === 2)?.status).toBe('PENDING');
    expect((await requestDocumentReExtraction(db, input)).ok).toBe(false);
    await db
      .update(schema.processingJobs)
      .set({ status: 'DONE' })
      .where(eq(schema.processingJobs.documentVersionId, input.expectedVersionId));
    await db
      .update(schema.documentVersions)
      .set({ processingStatus: 'AWAITING_REVIEW' })
      .where(eq(schema.documentVersions.id, input.expectedVersionId));
    expect((await requestDocumentReExtraction(db, input)).ok).toBe(false);
  });
  it('refuses another owner, a quarantined file and a stale version', async () => {
    const input = await document();
    expect((await requestDocumentReExtraction(db, { ...input, actorAccountId: other })).ok).toBe(
      false,
    );
    expect((await requestDocumentReExtraction(db, await document(false))).ok).toBe(false);
    await addDocumentVersion(db, {
      actorAccountId: owner,
      documentId: input.documentId,
      bucket: 'CLEAN',
      objectKey: randomUUID(),
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    expect((await requestDocumentReExtraction(db, input)).ok).toBe(false);
    expect(
      await db
        .select()
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.documentVersionId, input.expectedVersionId)),
    ).toHaveLength(0);
  });
  it('refuses withdrawn processing consent without creating a job', async () => {
    const input = await document();
    await setConsent(db, {
      actorAccountId: owner,
      accountId: owner,
      type: 'CORE_PROCESSING',
      granted: false,
    });
    expect((await requestDocumentReExtraction(db, input)).ok).toBe(false);
    expect(
      await db
        .select()
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.documentVersionId, input.expectedVersionId)),
    ).toHaveLength(0);
  });
});
