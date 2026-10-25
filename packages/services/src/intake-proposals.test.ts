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
import { listNameVersions } from './document-naming';
import { addDocumentVersion, getDocumentTypeOfVersion, registerDocument } from './documents';
import type { DocumentConverterPort, ExtractionOutcome } from './extraction';
import { type ContentLimitsPort, type MalwareScannerPort, processIntake } from './intake';

/**
 * What intake leaves behind for a person to look at: the kind of document it thinks a file is,
 * and the name it suggests. Written before the "saved only after the person approves" change
 * (owner request 2026-10-25) to pin down every other part of intake, so that change could only
 * move what it meant to move.
 */

// A valid ICAO TD3 specimen (check digits verified in pipeline.test.ts).
const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

const PASSPORT_TEXT = `PASSPORT\n${L1}\n${L2}\n`;
const BANK_TEXT =
  'Statement of Account\nOpening Balance: 100\nClosing Balance: 200\nAccount Number: 12345';
const UNCLEAR_TEXT = 'Some notes about a trip with no recognisable document wording at all.';

const cleanScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: true };
  },
};
const infectedScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: false, detail: 'eicar' };
  },
};
const withinLimits: ContentLimitsPort = {
  name: 'test-content-limits',
  version: '0.0.0',
  async check() {
    return { withinLimits: true };
  },
};

function extractorFor(text: string): DocumentConverterPort {
  return {
    async extract(): Promise<ExtractionOutcome> {
      return {
        ok: true,
        result: {
          text,
          truncated: false,
          pageCount: 1,
          warnings: [],
          parserName: 'test-fixture',
          parserVersion: '1.0.0',
        },
      };
    },
  };
}

const failingExtractor: DocumentConverterPort = {
  async extract(): Promise<ExtractionOutcome> {
    return { ok: false, code: 'unsupported_format', message: 'image format, no OCR' };
  },
};

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seed(db: Db, options: { readonly docType?: string } = {}) {
  const provisioned = await provisionAccount(db, { email: 'intake-proposals@example.com' });
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
    displayName: 'Anna Eriksson',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'scan.PDF',
  });
  if (!isOk(doc)) throw new Error('doc');
  if (options.docType) {
    await db
      .update(schema.documents)
      .set({ docType: options.docType })
      .where(eq(schema.documents.id, doc.value.id));
  }
  const version = await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'QUARANTINE',
    objectKey: 'obj-intake-proposals',
  });
  if (!isOk(version)) throw new Error('version');
  return { documentId: doc.value.id, versionId: version.value.version.id };
}

async function documentRow(db: Db, documentId: string) {
  const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  if (!row) throw new Error('document missing');
  return row;
}

async function classificationsOf(db: Db, versionId: string) {
  return db
    .select()
    .from(schema.documentClassifications)
    .where(eq(schema.documentClassifications.documentVersionId, versionId));
}

describe('what intake proposes for a person to check', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('suggests a name for a confident bank statement and never approves the name itself', async () => {
    const { documentId, versionId } = await seed(db);
    const result = await processIntake(db, cleanScanner, extractorFor(BANK_TEXT), withinLimits, {
      documentVersionId: versionId,
    });
    expect(isOk(result) && result.value.processingStatus).toBe('AWAITING_REVIEW');

    const names = await listNameVersions(db, documentId);
    expect(names.map((n) => [n.decision, n.proposedName])).toEqual([
      ['PENDING', 'Bank Statement - Anna Eriksson.pdf'],
    ]);
    const row = await documentRow(db, documentId);
    expect(row.approvedName).toBeNull();
    expect(row.originalName).toBe('scan.PDF');
    const [classification] = await classificationsOf(db, versionId);
    expect(classification).toMatchObject({
      classifiedType: 'BANK_STATEMENT',
      reviewRequired: false,
      source: 'DETERMINISTIC',
    });
  });

  // Deliberate change (owner request 2026-10-25): before it, a confident classification set the
  // kind by itself. Now the kind waits for the person, like the name.
  it('leaves the kind of a confident bank statement unset until the person accepts it', async () => {
    const { documentId, versionId } = await seed(db);
    await processIntake(db, cleanScanner, extractorFor(BANK_TEXT), withinLimits, {
      documentVersionId: versionId,
    });
    expect((await documentRow(db, documentId)).docType).toBeNull();
    // An AI reading still narrows to what a bank statement holds, as it did when the kind was
    // set by itself, without the kind being saved.
    expect(await getDocumentTypeOfVersion(db, versionId)).toBe('BANK_STATEMENT');
  });

  it('suggests a passport name from the machine-readable lines and fills issuer and expiry', async () => {
    const { documentId, versionId } = await seed(db);
    await processIntake(db, cleanScanner, extractorFor(PASSPORT_TEXT), withinLimits, {
      documentVersionId: versionId,
    });
    const names = await listNameVersions(db, documentId);
    expect(names.map((n) => n.proposedName)).toEqual([
      'Passport - Anna Eriksson - UTO - Expires 2012-04-15.pdf',
    ]);
    const row = await documentRow(db, documentId);
    expect(row.issuer).toBe('UTO');
    expect(row.expiresAt?.toISOString().slice(0, 10)).toBe('2012-04-15');
    // Deliberate change (owner request 2026-10-25): the kind is no longer set by itself.
    expect(row.docType).toBeNull();
  });

  it('keeps a kind the person already chose, but still suggests a name from what it read', async () => {
    const { documentId, versionId } = await seed(db, { docType: 'EMPLOYMENT_CERTIFICATE' });
    await processIntake(db, cleanScanner, extractorFor(BANK_TEXT), withinLimits, {
      documentVersionId: versionId,
    });
    expect((await documentRow(db, documentId)).docType).toBe('EMPLOYMENT_CERTIFICATE');
    const names = await listNameVersions(db, documentId);
    expect(names.map((n) => n.proposedName)).toEqual(['Bank Statement - Anna Eriksson.pdf']);
  });

  it('proposes nothing when it cannot tell what the document is', async () => {
    const { documentId, versionId } = await seed(db);
    await processIntake(db, cleanScanner, extractorFor(UNCLEAR_TEXT), withinLimits, {
      documentVersionId: versionId,
    });
    expect(await listNameVersions(db, documentId)).toHaveLength(0);
    expect((await documentRow(db, documentId)).docType).toBeNull();
    expect(await getDocumentTypeOfVersion(db, versionId)).toBeNull();
    const [classification] = await classificationsOf(db, versionId);
    expect(classification).toMatchObject({ classifiedType: null, reviewRequired: true });
  });

  it('proposes nothing for an unsafe file, which never reaches reading', async () => {
    const { documentId, versionId } = await seed(db);
    const result = await processIntake(db, infectedScanner, extractorFor(BANK_TEXT), withinLimits, {
      documentVersionId: versionId,
    });
    expect(isOk(result) && result.value.processingStatus).toBe('NEEDS_ATTENTION');
    expect(await classificationsOf(db, versionId)).toHaveLength(0);
    expect(await listNameVersions(db, documentId)).toHaveLength(0);
    expect((await documentRow(db, documentId)).docType).toBeNull();
  });

  it('proposes nothing when the file could not be read', async () => {
    const { documentId, versionId } = await seed(db);
    const result = await processIntake(db, cleanScanner, failingExtractor, withinLimits, {
      documentVersionId: versionId,
    });
    expect(isOk(result) && result.value.processingStatus).toBe('AWAITING_REVIEW');
    expect(await classificationsOf(db, versionId)).toHaveLength(0);
    expect(await listNameVersions(db, documentId)).toHaveLength(0);
  });
});
