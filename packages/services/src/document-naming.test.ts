import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  decideDocumentName,
  getLatestNameVersion,
  listNameVersions,
  proposeDocumentName,
} from './document-naming';
import { registerDocument } from './documents';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

async function seedDocument(db: Db, email: string) {
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
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'p.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  return { accountId: account.id, documentId: doc.value.id };
}

describe('document naming — propose then decide, atomically', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('proposes a PENDING name version that does not touch approvedName until decided', async () => {
    const { documentId } = await seedDocument(db, 'n1@example.com');
    const proposed = await proposeDocumentName(db, {
      documentId,
      proposedName: 'Passport - Owner - Bangladesh - Expires 2031-04-16.pdf',
    });
    expect(isOk(proposed)).toBe(true);
    if (!isOk(proposed)) return;
    expect(proposed.value.decision).toBe('PENDING');
    expect(proposed.value.versionNumber).toBe(1);

    const document = (
      await db.select().from(schema.documents).where(eq(schema.documents.id, documentId))
    )[0];
    expect(document?.approvedName).toBeNull();
  });

  it('accepting unchanged atomically sets documents.approvedName', async () => {
    const { accountId, documentId } = await seedDocument(db, 'n2@example.com');
    const proposed = await proposeDocumentName(db, {
      documentId,
      proposedName: 'Passport - Owner - Bangladesh - Expires 2031-04-16.pdf',
    });
    if (!isOk(proposed)) throw new Error('propose failed');

    const decided = await decideDocumentName(db, {
      actorAccountId: accountId,
      nameVersionId: proposed.value.id,
      decision: 'ACCEPTED_UNCHANGED',
      finalName: proposed.value.proposedName,
    });
    expect(isOk(decided)).toBe(true);
    if (!isOk(decided)) return;
    expect(decided.value.finalName).toBe(proposed.value.proposedName);
    expect(decided.value.decidedByAccountId).toBe(accountId);

    const document = (
      await db.select().from(schema.documents).where(eq(schema.documents.id, documentId))
    )[0];
    expect(document?.approvedName).toBe(proposed.value.proposedName);
  });

  it('accepting an edited name uses the edited value, not the original proposal', async () => {
    const { accountId, documentId } = await seedDocument(db, 'n3@example.com');
    const proposed = await proposeDocumentName(db, {
      documentId,
      proposedName: 'Passport - Owner.pdf',
    });
    if (!isOk(proposed)) throw new Error('propose failed');

    const decided = await decideDocumentName(db, {
      actorAccountId: accountId,
      nameVersionId: proposed.value.id,
      decision: 'ACCEPTED_EDITED',
      finalName: 'Passport - Owner - Bangladesh.pdf',
    });
    expect(isOk(decided)).toBe(true);
    if (!isOk(decided)) return;
    expect(decided.value.finalName).toBe('Passport - Owner - Bangladesh.pdf');

    const document = (
      await db.select().from(schema.documents).where(eq(schema.documents.id, documentId))
    )[0];
    expect(document?.approvedName).toBe('Passport - Owner - Bangladesh.pdf');
  });

  it('rejecting leaves approvedName untouched', async () => {
    const { accountId, documentId } = await seedDocument(db, 'n4@example.com');
    const proposed = await proposeDocumentName(db, {
      documentId,
      proposedName: 'Bank Statement - Owner.pdf',
    });
    if (!isOk(proposed)) throw new Error('propose failed');

    const decided = await decideDocumentName(db, {
      actorAccountId: accountId,
      nameVersionId: proposed.value.id,
      decision: 'REJECTED',
      reason: 'wrong classification',
    });
    expect(isOk(decided)).toBe(true);
    if (!isOk(decided)) return;
    expect(decided.value.finalName).toBeNull();

    const document = (
      await db.select().from(schema.documents).where(eq(schema.documents.id, documentId))
    )[0];
    expect(document?.approvedName).toBeNull();
  });

  it('refuses to re-decide an already-decided proposal', async () => {
    const { accountId, documentId } = await seedDocument(db, 'n5@example.com');
    const proposed = await proposeDocumentName(db, {
      documentId,
      proposedName: 'Bank Statement - Owner.pdf',
    });
    if (!isOk(proposed)) throw new Error('propose failed');

    await decideDocumentName(db, {
      actorAccountId: accountId,
      nameVersionId: proposed.value.id,
      decision: 'REJECTED',
    });

    const again = await decideDocumentName(db, {
      actorAccountId: accountId,
      nameVersionId: proposed.value.id,
      decision: 'ACCEPTED_UNCHANGED',
      finalName: 'Bank Statement - Owner.pdf',
    });
    expect(again.ok).toBe(false);
  });

  it('refuses to decide on behalf of another account (ownership enforced)', async () => {
    const { documentId } = await seedDocument(db, 'n6@example.com');
    const other = await provisionAccount(db, { email: 'other@example.com' });
    if (!isOk(other)) throw new Error('other account');

    const proposed = await proposeDocumentName(db, {
      documentId,
      proposedName: 'Passport - Owner.pdf',
    });
    if (!isOk(proposed)) throw new Error('propose failed');

    const decided = await decideDocumentName(db, {
      actorAccountId: other.value.id,
      nameVersionId: proposed.value.id,
      decision: 'ACCEPTED_UNCHANGED',
      finalName: 'Passport - Owner.pdf',
    });
    expect(decided.ok).toBe(false);
    if (decided.ok) return;
    expect(decided.error.code).toBe('forbidden');
  });

  it('requires a final name to accept, but not to reject', async () => {
    const { accountId, documentId } = await seedDocument(db, 'n7@example.com');
    const proposed = await proposeDocumentName(db, {
      documentId,
      proposedName: 'Passport - Owner.pdf',
    });
    if (!isOk(proposed)) throw new Error('propose failed');

    const missingFinalName = await decideDocumentName(db, {
      actorAccountId: accountId,
      nameVersionId: proposed.value.id,
      decision: 'ACCEPTED_UNCHANGED',
    });
    expect(missingFinalName.ok).toBe(false);
  });

  it('lists full immutable naming history, newest first', async () => {
    const { documentId } = await seedDocument(db, 'n8@example.com');
    await proposeDocumentName(db, { documentId, proposedName: 'first.pdf' });
    await proposeDocumentName(db, { documentId, proposedName: 'second.pdf' });

    const history = await listNameVersions(db, documentId);
    expect(history).toHaveLength(2);
    expect(history[0]?.proposedName).toBe('second.pdf');
    expect(history[1]?.proposedName).toBe('first.pdf');

    const latest = await getLatestNameVersion(db, documentId);
    expect(latest?.proposedName).toBe('second.pdf');
  });
});
