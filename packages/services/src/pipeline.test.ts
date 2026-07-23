import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  type AiExtractionPort,
  type AiExtractionResult,
  type FieldProposal,
  approveProposal,
  runExtraction,
} from './ai';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { getLatestNameVersion } from './document-naming';
import { addDocumentVersion, registerDocument } from './documents';
import type { ExtractionOutcome, TextExtractionPort } from './extraction';
import { type ScannerPort, processIntake } from './intake';
import { checkDigit, parseTd3 } from './mrz';
import { getCurrentFactVersion, registerFieldDefinition } from './profile';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

// A valid ICAO TD3 specimen (check digits computed to validate).
const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

describe('MRZ TD3 parser', () => {
  it('computes the ICAO 7-3-1 check digit', () => {
    expect(checkDigit('L898902C3')).toBe(6);
    expect(checkDigit('740812')).toBe(2);
    expect(checkDigit('120415')).toBe(9);
  });

  it('parses a valid passport MRZ', () => {
    const result = parseTd3([L1, L2]);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.passportNumber).toBe('L898902C3');
    expect(result.value.issuingCountry).toBe('UTO');
    expect(result.value.surname).toBe('ERIKSSON');
    expect(result.value.givenNames).toBe('ANNA MARIA');
    expect(result.value.dateOfBirth).toBe('1974-08-12');
    expect(result.value.expiryDate).toBe('2012-04-15');
    expect(result.value.checksValid).toBe(true);
  });

  it('accepts a single 88-char string', () => {
    expect(isOk(parseTd3(L1 + L2))).toBe(true);
  });

  it('rejects a wrong length', () => {
    const r = parseTd3(['too short', L2]);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('bad_format');
  });

  it('rejects a tampered field via check digit', () => {
    // Flip a digit in the passport number; its check digit no longer matches.
    const tampered = `L898902C46${L2.slice(10)}`;
    const r = parseTd3([L1, tampered]);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('check_failed');
  });
});

async function seedVersion(db: Db, email: string, bucket: 'QUARANTINE' | 'CLEAN' = 'QUARANTINE') {
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
  const version = await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket,
    objectKey: `obj-${email}`,
  });
  if (!isOk(version)) throw new Error('version');
  return { account, applicantId: applicant.value.id, versionId: version.value.version.id };
}

describe('document intake pipeline', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const cleanScanner: ScannerPort = {
    async scan() {
      return { safe: true };
    },
  };
  const infectedScanner: ScannerPort = {
    async scan() {
      return { safe: false, detail: 'eicar' };
    },
  };
  const noOpExtractor: TextExtractionPort = {
    async extract(): Promise<ExtractionOutcome> {
      return { ok: false, code: 'unsupported_format', message: 'test fixture: not exercised here' };
    },
  };

  it('drives a clean document to AWAITING_REVIEW', async () => {
    const { versionId } = await seedVersion(db, 'intake1@example.com');
    const result = await processIntake(db, cleanScanner, noOpExtractor, {
      documentVersionId: versionId,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.processingStatus).toBe('AWAITING_REVIEW');
    expect(result.value.safetyStatus).toBe('CLEAN');
  });

  it('quarantines an unsafe document (NEEDS_ATTENTION, never processed)', async () => {
    const { versionId } = await seedVersion(db, 'intake2@example.com');
    const result = await processIntake(db, infectedScanner, noOpExtractor, {
      documentVersionId: versionId,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.processingStatus).toBe('NEEDS_ATTENTION');
    expect(result.value.safetyStatus).toBe('QUARANTINED');
  });

  it('is idempotent when already terminal', async () => {
    const { versionId } = await seedVersion(db, 'intake3@example.com');
    await processIntake(db, cleanScanner, noOpExtractor, { documentVersionId: versionId });
    const again = await processIntake(db, cleanScanner, noOpExtractor, {
      documentVersionId: versionId,
    });
    expect(isOk(again)).toBe(true);
    if (isOk(again)) expect(again.value.processingStatus).toBe('AWAITING_REVIEW');
  });

  it('is resumable after a scanner failure', async () => {
    const { versionId } = await seedVersion(db, 'intake4@example.com');
    let calls = 0;
    const flaky: ScannerPort = {
      async scan() {
        calls++;
        if (calls === 1) throw new Error('scanner down');
        return { safe: true };
      },
    };
    await expect(
      processIntake(db, flaky, noOpExtractor, { documentVersionId: versionId }),
    ).rejects.toThrow();
    // State is parked at SCANNING and resumes cleanly on retry.
    const resumed = await processIntake(db, flaky, noOpExtractor, {
      documentVersionId: versionId,
    });
    expect(isOk(resumed)).toBe(true);
    if (isOk(resumed)) expect(resumed.value.processingStatus).toBe('AWAITING_REVIEW');
  });

  it('classifies a passport from its embedded MRZ text and proposes a filename', async () => {
    const { versionId, applicantId } = await seedVersion(db, 'intake5@example.com');
    const documentRow = (
      await db
        .select()
        .from(schema.documents)
        .innerJoin(
          schema.documentVersions,
          eq(schema.documentVersions.documentId, schema.documents.id),
        )
        .where(eq(schema.documentVersions.id, versionId))
    )[0];
    if (!documentRow) throw new Error('document not found');
    const document = documentRow.documents;

    const passportExtractor: TextExtractionPort = {
      async extract(): Promise<ExtractionOutcome> {
        return {
          ok: true,
          result: {
            text: `PASSPORT\n${L1}\n${L2}\n`,
            truncated: false,
            pageCount: 1,
            warnings: [],
            parserName: 'test-fixture',
            parserVersion: '1.0.0',
          },
        };
      },
    };

    const result = await processIntake(db, cleanScanner, passportExtractor, {
      documentVersionId: versionId,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.processingStatus).toBe('AWAITING_REVIEW');

    const runs = await db
      .select()
      .from(schema.processingRuns)
      .where(eq(schema.processingRuns.documentVersionId, versionId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('COMPLETED');

    const extractions = await db
      .select()
      .from(schema.extractionRuns)
      .where(eq(schema.extractionRuns.documentVersionId, versionId));
    expect(extractions).toHaveLength(1);
    expect(extractions[0]?.status).toBe('SUCCEEDED');
    expect(extractions[0]?.parserName).toBe('test-fixture');

    const classifications = await db
      .select()
      .from(schema.documentClassifications)
      .where(eq(schema.documentClassifications.documentVersionId, versionId));
    expect(classifications).toHaveLength(1);
    expect(classifications[0]?.classifiedType).toBe('PASSPORT');
    expect(classifications[0]?.confidence).toBe(100);
    expect(classifications[0]?.reviewRequired).toBe(false);

    const applicantRow = (
      await db.select().from(schema.applicants).where(eq(schema.applicants.id, applicantId))
    )[0];
    const nameVersion = await getLatestNameVersion(db, document.id);
    expect(nameVersion?.decision).toBe('PENDING');
    expect(nameVersion?.proposedName).toContain('Passport');
    expect(nameVersion?.proposedName).toContain(applicantRow?.displayName ?? '');
    expect(nameVersion?.proposedName.endsWith('.pdf')).toBe(true);
  });

  it('advances to AWAITING_REVIEW even when extraction fails (unsupported format)', async () => {
    const { versionId } = await seedVersion(db, 'intake6@example.com');
    const failingExtractor: TextExtractionPort = {
      async extract(): Promise<ExtractionOutcome> {
        return { ok: false, code: 'unsupported_format', message: 'image format, no OCR' };
      },
    };
    const result = await processIntake(db, cleanScanner, failingExtractor, {
      documentVersionId: versionId,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.processingStatus).toBe('AWAITING_REVIEW');

    const runs = await db
      .select()
      .from(schema.processingRuns)
      .where(eq(schema.processingRuns.documentVersionId, versionId));
    expect(runs[0]?.status).toBe('FAILED');
    expect(runs[0]?.errorCode).toBe('unsupported_format');

    // No classification/naming proposal was invented from a failed extraction.
    const classifications = await db
      .select()
      .from(schema.documentClassifications)
      .where(eq(schema.documentClassifications.documentVersionId, versionId));
    expect(classifications).toHaveLength(0);
  });
});

describe('AI Gateway — proposals never silently mutate', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const proposals: FieldProposal[] = [
    { type: 'NEW', fieldKey: 'passport.number', value: 'L898902C3', confidence: 0.98 },
    { type: 'UNMAPPED', value: 'mystery', confidence: 0.4 },
  ];
  const ai: AiExtractionPort = {
    async extract(): Promise<AiExtractionResult> {
      return { proposals, usage: { costUnits: 3, modelVersion: 'terra-1', promptVersion: 'p1' } };
    },
  };

  it('requires AI_EXTRACTION consent to run', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai1@example.com');
    const budget = { limitUnits: 10, used: 0 };
    const denied = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budget,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('consent_required');
  });

  it('runs, proposes without mutating, then approves atomically with provenance', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai2@example.com');
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'AI_EXTRACTION',
      granted: true,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const budget = { limitUnits: 10, used: 0 };

    const run = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budget,
    });
    expect(isOk(run)).toBe(true);
    if (!isOk(run)) return;
    expect(run.value.proposals).toHaveLength(2);
    expect(budget.used).toBe(3);
    // No facts were written by extraction.
    expect(await db.select().from(schema.facts)).toHaveLength(0);

    // Approving the mapped proposal writes an immutable, provenance-tagged version.
    const approved = await approveProposal(db, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      proposal: proposals[0] as FieldProposal,
      usage: { modelVersion: 'terra-1', promptVersion: 'p1' },
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    const current = await getCurrentFactVersion(db, approved.value.fact.id);
    expect(current?.value).toBe('L898902C3');
    expect(current?.status).toBe('DOCUMENT_SUPPORTED');
    expect(current?.method).toBe('DOCUMENT');
    expect(current?.sourceDocumentVersionId).toBe(versionId);
    expect(current?.modelVersion).toBe('terra-1');
  });

  it('refuses to approve an UNMAPPED proposal', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai3@example.com');
    const result = await approveProposal(db, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      proposal: proposals[1] as FieldProposal,
      usage: { modelVersion: 'terra-1', promptVersion: 'p1' },
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('unknown_field');
  });

  it('enforces the cost budget', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai4@example.com');
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'AI_EXTRACTION',
      granted: true,
    });
    const budget = { limitUnits: 2, used: 2 };
    const result = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budget,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });
});
