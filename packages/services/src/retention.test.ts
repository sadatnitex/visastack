import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { executeAccountDeletion, requestAccountDeletion } from './deletion';
import { addDocumentVersion, registerDocument } from './documents';
import {
  documentsPastRetention,
  placeLegalHold,
  purgeExpiredDocuments,
  releaseLegalHold,
  setRetentionPolicy,
} from './retention';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function consentedApplicant(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { account, applicantId: applicant.value.id };
}

/** A compliance/system operator account (its id is a real uuid). */
async function operator(db: Db, email: string): Promise<string> {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  return p.value.id;
}

describe('legal hold overrides deletion', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('blocks account deletion while an active hold exists, then allows it once released', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'hold@example.com');
    const officer = await operator(db, 'officer1@example.com');
    await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
      gracePeriodMs: 0,
    });

    const hold = await placeLegalHold(db, {
      actorAccountId: officer,
      applicantId,
      reason: 'litigation X',
    });
    expect(isOk(hold)).toBe(true);
    if (!isOk(hold)) return;

    const blocked = await executeAccountDeletion(db, { accountId: account.id });
    expect(isErr(blocked)).toBe(true);
    if (isErr(blocked)) expect(blocked.error.message).toContain('legal hold');
    // Account still present.
    expect(
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)),
    ).toHaveLength(1);

    await releaseLegalHold(db, { actorAccountId: officer, holdId: hold.value.id });
    const executed = await executeAccountDeletion(db, { accountId: account.id });
    expect(isOk(executed)).toBe(true);
    expect(
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)),
    ).toHaveLength(0);
  });
});

describe('retention purge', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("purges documents past their retention, but never a held applicant's", async () => {
    const { account, applicantId } = await consentedApplicant(db, 'ret@example.com');
    const officer = await operator(db, 'officer2@example.com');
    await setRetentionPolicy(db, {
      actorAccountId: account.id,
      docType: 'receipt',
      retentionDays: 30,
    });

    // A receipt document with a version.
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'r.pdf',
      docType: 'receipt',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'obj-ret',
    });
    // Backdate its creation beyond the retention window.
    await db.execute(
      sql`update documents set created_at = now() - interval '60 days' where id = ${doc.value.id}`,
    );

    // Eligible now.
    expect(await documentsPastRetention(db)).toHaveLength(1);

    // A legal hold makes it ineligible.
    const hold = await placeLegalHold(db, {
      actorAccountId: officer,
      applicantId,
      reason: 'hold',
    });
    if (!isOk(hold)) throw new Error('hold');
    expect(await documentsPastRetention(db)).toHaveLength(0);
    const noop = await purgeExpiredDocuments(db, { actorAccountId: officer });
    expect(isOk(noop)).toBe(true);
    if (isOk(noop)) expect(noop.value.purged).toBe(0);

    // Release the hold → purge removes the document and its storage object.
    await releaseLegalHold(db, { actorAccountId: officer, holdId: hold.value.id });
    const purged = await purgeExpiredDocuments(db, { actorAccountId: officer });
    expect(isOk(purged)).toBe(true);
    if (isOk(purged)) expect(purged.value.purged).toBe(1);
    expect(await db.select().from(schema.documents)).toHaveLength(0);
    expect(await db.select().from(schema.storageObjects)).toHaveLength(0);
  });
});
