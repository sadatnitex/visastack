import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { documentVersionBelongsToApplicant } from './document-version-owner';
import { registerDocumentWithVersion } from './documents';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seedOwner(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId, applicantId: applicant.value.id };
}

async function seedVersion(db: Db, accountId: string, applicantId: string, key: string) {
  const created = await registerDocumentWithVersion(db, {
    actorAccountId: accountId,
    applicantId,
    originalName: `${key}.pdf`,
    bucket: 'QUARANTINE',
    objectKey: key,
    sizeBytes: 10,
  });
  if (!isOk(created)) throw new Error('register');
  return { documentId: created.value.document.id, versionId: created.value.version.id };
}

describe('document version ownership and the resource lifecycle (LC-A2)', () => {
  it('answers false for a deleted document version and true for an archived one', async () => {
    const db = await freshDb();
    const { accountId, applicantId } = await seedOwner(db, 'lc-owner@example.com');
    const deleted = await seedVersion(db, accountId, applicantId, 'lc-owner-deleted');
    const archived = await seedVersion(db, accountId, applicantId, 'lc-owner-archived');
    const current = await seedVersion(db, accountId, applicantId, 'lc-owner-current');
    const now = new Date();
    await db.insert(schema.documentLifecycle).values({
      documentId: deleted.documentId,
      applicantId,
      deletedAt: now,
      deletePath: 'DUPLICATE',
      purgeAfter: new Date(now.getTime() + 30 * 86_400_000),
    });
    await db
      .insert(schema.documentLifecycle)
      .values({ documentId: archived.documentId, applicantId, archivedAt: now });

    expect(await documentVersionBelongsToApplicant(db, deleted.versionId, applicantId)).toBe(false);
    expect(await documentVersionBelongsToApplicant(db, archived.versionId, applicantId)).toBe(true);
    expect(await documentVersionBelongsToApplicant(db, current.versionId, applicantId)).toBe(true);
  });
});
