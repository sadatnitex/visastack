import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { OWNER_RENAME_REASON, renameDocument } from './document-naming';
import {
  CONVERTED_FROM_HEIC_SOURCE,
  listDocumentsDetailed,
  registerDocument,
  registerDocumentWithVersion,
  setDocumentType,
} from './documents';
import { AUTOMATIC_TITLE_REASON, buildDocumentTitle, firstNameOf, titleDate } from './naming';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seedOwner(db: Db, email: string, displayName = 'Md. Nazmus Sadat') {
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
    displayName,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId, applicantId: applicant.value.id };
}

async function nameVersions(db: Db, documentId: string) {
  return db
    .select()
    .from(schema.documentNameVersions)
    .where(eq(schema.documentNameVersions.documentId, documentId))
    .orderBy(schema.documentNameVersions.versionNumber);
}

async function documentRow(db: Db, documentId: string) {
  const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  if (!row) throw new Error('document missing');
  return row;
}

const today = (db: Db, documentId: string) =>
  documentRow(db, documentId).then((row) => titleDate(row.createdAt, 'Asia/Dhaka'));

describe('the parts of a document title', () => {
  it('takes the first name, skipping short forms and initials before it', () => {
    expect(firstNameOf('Nazmus Sadat')).toBe('Nazmus');
    expect(firstNameOf('Md. Nazmus Sadat')).toBe('Nazmus');
    expect(firstNameOf('Md Nazmus Sadat')).toBe('Nazmus');
    expect(firstNameOf('Dr Anna Eriksson')).toBe('Anna');
    expect(firstNameOf('A. K. Rahman')).toBe('Rahman');
    expect(firstNameOf('  José   García ')).toBe('José');
    expect(firstNameOf('Nazmus')).toBe('Nazmus');
    expect(firstNameOf('')).toBe('');
    // Text-direction characters and separators never reach a title.
    expect(firstNameOf('Naz‮mus/ Sadat')).toBe('Nazmus');
  });

  it("writes the day in the traveller's own time zone, the same way on every server", () => {
    const lateEvening = new Date('2026-10-26T20:00:00Z');
    expect(titleDate(lateEvening, 'Asia/Dhaka')).toBe('27 Oct 2026');
    expect(titleDate(lateEvening, 'UTC')).toBe('26 Oct 2026');
    expect(titleDate(new Date('2026-09-05T08:00:00Z'), 'Asia/Dhaka')).toBe('5 Sep 2026');
    expect(titleDate(lateEvening, 'Not/AZone')).toBe('26 Oct 2026');
  });

  it('names the kind and the first name, or says Document with the day when the kind is not known', () => {
    const base = {
      subject: null,
      displayName: 'Md. Nazmus Sadat',
      addedAt: new Date('2026-10-27T06:00:00Z'),
      timeZone: 'Asia/Dhaka',
    };
    expect(buildDocumentTitle({ ...base, docType: 'PASSPORT' })).toBe('Passport, Nazmus');
    expect(buildDocumentTitle({ ...base, docType: 'BANK_STATEMENT' })).toBe(
      'Bank Statement, Nazmus',
    );
    expect(buildDocumentTitle({ ...base, docType: 'OTHER', subject: 'Marriage Certificate' })).toBe(
      'Marriage Certificate, Nazmus',
    );
    // An "Other" kind without its own name says no more than an unknown one.
    expect(buildDocumentTitle({ ...base, docType: 'OTHER' })).toBe('Document, Nazmus, 27 Oct 2026');
    expect(buildDocumentTitle({ ...base, docType: null })).toBe('Document, Nazmus, 27 Oct 2026');
    expect(buildDocumentTitle({ ...base, docType: null, displayName: '' })).toBe(
      'Document, 27 Oct 2026',
    );
  });
});

describe('automatic titles for new documents', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lists a document under its kind and first name, never the file name', async () => {
    const { accountId, applicantId } = await seedOwner(db, 't1@example.com');
    const created = await registerDocumentWithVersion(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'MHM.png',
      docType: 'PASSPORT',
      source: 'UPLOAD',
      automaticTitle: true,
      bucket: 'QUARANTINE',
      objectKey: 'title-key-1',
      sizeBytes: 10,
    });
    if (!isOk(created)) throw new Error(created.error.message);
    expect(created.value.document.approvedName).toBe('Passport, Nazmus');
    expect(created.value.document.originalName).toBe('MHM.png');

    const [version] = await nameVersions(db, created.value.document.id);
    expect(version).toMatchObject({
      versionNumber: 1,
      proposedName: 'Passport, Nazmus',
      finalName: 'Passport, Nazmus',
      decision: 'ACCEPTED_UNCHANGED',
      reason: AUTOMATIC_TITLE_REASON,
      decidedByAccountId: null,
    });

    // The audit trail says a title was made, never what it says.
    const [audit] = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.eventType, 'DOCUMENT_REGISTERED'),
          eq(schema.auditEvents.resourceId, created.value.document.id),
        ),
      );
    expect(audit?.metadata).toMatchObject({ docType: 'PASSPORT', automaticTitle: true });
    expect(JSON.stringify(audit?.metadata)).not.toContain('Nazmus');
  });

  it('uses Document, the first name and the day while the kind is not known', async () => {
    const { accountId, applicantId } = await seedOwner(db, 't2@example.com');
    const created = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'IMG_2041.jpg',
      automaticTitle: true,
    });
    if (!isOk(created)) throw new Error('register');
    expect(created.value.approvedName).toBe(
      `Document, Nazmus, ${await today(db, created.value.id)}`,
    );
    expect(created.value.approvedName).not.toContain('IMG');
  });

  it('leaves the name alone when no automatic title is asked for', async () => {
    const { accountId, applicantId } = await seedOwner(db, 't3@example.com');
    const created = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'p.pdf',
    });
    if (!isOk(created)) throw new Error('register');
    expect(created.value.approvedName).toBeNull();
    expect(await nameVersions(db, created.value.id)).toEqual([]);
  });

  it('takes the title of a kind chosen later, until the person names it themselves', async () => {
    const { accountId, applicantId } = await seedOwner(db, 't4@example.com');
    const created = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'scan.jpg',
      automaticTitle: true,
    });
    if (!isOk(created)) throw new Error('register');
    const documentId = created.value.id;

    const typed = await setDocumentType(db, {
      actorAccountId: accountId,
      documentId,
      docType: 'PASSPORT',
    });
    if (!isOk(typed)) throw new Error('type');
    expect(typed.value.approvedName).toBe('Passport, Nazmus');

    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { documentId },
      { purpose: 'owner_document_rename' },
    );
    if (!access.ok) throw new Error('access');
    const renamed = await renameDocument(access.value, { name: '  My  Passport‮ Scan ' });
    if (!isOk(renamed)) throw new Error(renamed.error.message);
    expect(renamed.value).toMatchObject({
      finalName: 'My Passport Scan',
      decision: 'ACCEPTED_UNCHANGED',
      decidedByAccountId: accountId,
      reason: OWNER_RENAME_REASON,
    });
    expect((await documentRow(db, documentId)).approvedName).toBe('My Passport Scan');

    // A later change of kind keeps the person's own name.
    const retyped = await setDocumentType(db, {
      actorAccountId: accountId,
      documentId,
      docType: 'NATIONAL_ID',
    });
    if (!isOk(retyped)) throw new Error('retype');
    expect(retyped.value.approvedName).toBe('My Passport Scan');
    expect((await nameVersions(db, documentId)).map((v) => v.finalName)).toEqual([
      `Document, Nazmus, ${await today(db, documentId)}`,
      'Passport, Nazmus',
      'My Passport Scan',
    ]);
  });

  it('records that a stored file is a converted copy of an iPhone photo', async () => {
    const { accountId, applicantId } = await seedOwner(db, 't5@example.com');
    const created = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'document.jpg',
      source: CONVERTED_FROM_HEIC_SOURCE,
      automaticTitle: true,
    });
    if (!isOk(created)) throw new Error('register');
    expect(created.value.source).toBe(CONVERTED_FROM_HEIC_SOURCE);
    const listed = await listDocumentsDetailed(db, accountId, applicantId);
    if (!isOk(listed)) throw new Error('list');
    expect(listed.value[0]?.source).toBe(CONVERTED_FROM_HEIC_SOURCE);
    const [audit] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, created.value.id));
    expect(audit?.metadata).toMatchObject({ source: CONVERTED_FROM_HEIC_SOURCE });
  });
});

describe('renaming a document', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('is for the owner of that document only, and needs a name', async () => {
    const owner = await seedOwner(db, 'r1@example.com');
    const other = await seedOwner(db, 'r2@example.com', 'Anna Eriksson');
    const created = await registerDocument(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      originalName: 'scan.jpg',
      automaticTitle: true,
    });
    if (!isOk(created)) throw new Error('register');
    const documentId = created.value.id;

    // Someone else cannot even get a proof for it.
    const denied = await requireAccess(
      db,
      accountPrincipal(other.accountId),
      'MANAGE',
      { documentId },
      { purpose: 'owner_document_rename' },
    );
    expect(denied.ok).toBe(false);

    // A proof for the whole record is not a proof for one document.
    const wide = await requireAccess(
      db,
      accountPrincipal(owner.accountId),
      'MANAGE',
      { applicantId: owner.applicantId },
      { purpose: 'owner_document_rename' },
    );
    if (!wide.ok) throw new Error('access');
    const refused = await renameDocument(wide.value, { name: 'Anything' });
    expect(refused.ok ? null : refused.error.code).toBe('forbidden');

    const access = await requireAccess(
      db,
      accountPrincipal(owner.accountId),
      'MANAGE',
      { documentId },
      { purpose: 'owner_document_rename' },
    );
    if (!access.ok) throw new Error('access');
    const blank = await renameDocument(access.value, { name: ' ‮ ' });
    expect(blank.ok ? null : blank.error.code).toBe('invalid');
    expect((await documentRow(db, documentId)).approvedName).toMatch(/^Document, Nazmus, /);
  });
});
