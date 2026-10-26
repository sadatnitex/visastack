import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  type AiClassifyPort,
  type AiExtractionPort,
  type AiInconsistencyPort,
  runClassification,
  runExtraction,
  runInconsistencyCheck,
  runOcr,
} from './ai';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { getLatestExtractedText } from './intake';
import { type AiOcrPort, renderOcrSourceImage } from './ocr';
import type { PreviewRendererPort } from './preview-rendering';
import type { BlobStore } from './storage';

/**
 * S2, M12: every AI reading entry point proves the file version belongs to the applicant it was
 * asked to act for. A version of someone else's reads exactly like one that does not exist, and
 * nothing is written for the person who asked.
 */

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function seedTraveller(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'AI_EXTRACTION', 'AI_OCR'] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: email,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const doc = await registerDocument(db, {
    actorAccountId: accountId,
    applicantId: applicant.value.id,
    originalName: 'p.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: accountId,
    documentId: doc.value.id,
    bucket: 'QUARANTINE',
    objectKey: `obj-${email}`,
  });
  if (!isOk(version)) throw new Error('version');
  return { accountId, applicantId: applicant.value.id, versionId: version.value.version.id };
}

const usage = {
  costUnits: 3,
  inputUnits: 2,
  outputUnits: 1,
  cachedUnits: 0,
  modelVersion: 'm',
  promptVersion: 'p1',
  schemaVersion: 's1',
  provider: 'openai',
  latencyMs: 1,
};

/** A provider that records every call, so a test can prove a refusal never reached it. */
function countingExtractor() {
  let calls = 0;
  const ai: AiExtractionPort = {
    async extract() {
      calls += 1;
      return {
        ok: true,
        result: {
          proposals: [
            { type: 'UNMAPPED', value: 'Traveller One passport L898902C3', confidence: 0.9 },
          ],
          usage,
        },
      };
    },
    cacheKeyComponents: () => ({ model: 'm', promptVersion: 'p1', schemaVersion: 's1' }),
  };
  return { ai, calls: () => calls };
}

const NOT_CALLED = (): never => {
  throw new Error('a refused request must never reach a provider');
};

describe('AI reading entry points bind the version to the applicant (M12)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('refuses another applicant’s version in runExtraction, writes nothing, and never copies their proposals from the cache', async () => {
    const victim = await seedTraveller(db, 'victim@example.com');
    const attacker = await seedTraveller(db, 'attacker@example.com');
    const { ai, calls } = countingExtractor();
    const text = 'Passport L898902C3 for Traveller One';
    const first = await runExtraction(db, ai, {
      actorAccountId: victim.accountId,
      applicantId: victim.applicantId,
      documentVersionId: victim.versionId,
      text,
      budgetLimitUnits: 100,
    });
    expect(isOk(first)).toBe(true);
    expect(calls()).toBe(1);

    // The attacker names the victim's version and supplies the same text: the cache key would match.
    const stolen = await runExtraction(db, ai, {
      actorAccountId: attacker.accountId,
      applicantId: attacker.applicantId,
      documentVersionId: victim.versionId,
      text,
      budgetLimitUnits: 100,
    });
    expect(isErr(stolen)).toBe(true);
    if (isErr(stolen)) expect(stolen.error.code).toBe('not_found');
    expect(calls()).toBe(1);
    const copied = await db
      .select()
      .from(schema.fieldProposals)
      .where(eq(schema.fieldProposals.applicantId, attacker.applicantId));
    expect(copied).toHaveLength(0);
    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.applicantId, attacker.applicantId));
    expect(runs).toHaveLength(0);
  });

  it('answers a missing version and a malformed id exactly like another applicant’s version', async () => {
    const victim = await seedTraveller(db, 'victim2@example.com');
    const attacker = await seedTraveller(db, 'attacker2@example.com');
    const { ai } = countingExtractor();
    const base = {
      actorAccountId: attacker.accountId,
      applicantId: attacker.applicantId,
      text: 't',
      budgetLimitUnits: 100,
    };
    const answers = [];
    for (const documentVersionId of [
      victim.versionId,
      '11111111-1111-4111-8111-111111111111',
      'not-an-id',
    ]) {
      const result = await runExtraction(db, ai, { ...base, documentVersionId });
      if (!isErr(result)) throw new Error('expected a refusal');
      answers.push({ code: result.error.code, message: result.error.message });
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]?.code).toBe('not_found');
  });

  it('answers every entry point the same for another person’s version, a missing one and a malformed id', async () => {
    const victim = await seedTraveller(db, 'victim6@example.com');
    const attacker = await seedTraveller(db, 'attacker6@example.com');
    const ocr = { performOcr: NOT_CALLED, cacheKeyComponents: NOT_CALLED } as unknown as AiOcrPort;
    const checker = {
      checkConsistency: NOT_CALLED,
      inconsistencyCacheKeyComponents: NOT_CALLED,
    } as unknown as AiInconsistencyPort;
    const classifier = {
      classify: NOT_CALLED,
      classifyCacheKeyComponents: NOT_CALLED,
    } as unknown as AiClassifyPort;
    const common = {
      actorAccountId: attacker.accountId,
      applicantId: attacker.applicantId,
      budgetLimitUnits: 100,
    };
    const ids = [victim.versionId, '11111111-1111-4111-8111-111111111111', 'not-an-id'];
    const calls = {
      ocr: (documentVersionId: string) =>
        runOcr(db, ocr, {
          ...common,
          documentVersionId,
          imageBytes: new Uint8Array([1]),
          contentType: 'image/png',
        }),
      inconsistency: (documentVersionId: string) =>
        runInconsistencyCheck(db, checker, { ...common, documentVersionId, text: 't' }),
      classification: (documentVersionId: string) =>
        runClassification(db, classifier, { ...common, documentVersionId, text: 't' }),
    };
    for (const [name, call] of Object.entries(calls)) {
      const answers = new Set<string>();
      for (const id of ids) {
        const result = await call(id);
        const error = result.ok ? undefined : result.error;
        if (!error) throw new Error(`${name}: expected a refusal`);
        answers.add(`${error.code}:${error.message}`);
      }
      expect(answers.size, name).toBe(1);
    }
    const blobStore = { getObject: NOT_CALLED } as unknown as BlobStore;
    const renderer = { render: NOT_CALLED } as unknown as PreviewRendererPort;
    const rendered = new Set<string>();
    for (const id of ids) {
      const outcome = await renderOcrSourceImage(db, blobStore, renderer, id, attacker.applicantId);
      rendered.add(JSON.stringify(outcome));
    }
    expect(rendered.size).toBe(1);
  });

  it('refuses another person’s applicant exactly like a missing applicant', async () => {
    const victim = await seedTraveller(db, 'victim7@example.com');
    const attacker = await seedTraveller(db, 'attacker7@example.com');
    const { ai } = countingExtractor();
    const base = { actorAccountId: attacker.accountId, text: 't', budgetLimitUnits: 100 };
    const other = await runExtraction(db, ai, {
      ...base,
      applicantId: victim.applicantId,
      documentVersionId: victim.versionId,
    });
    const missing = await runExtraction(db, ai, {
      ...base,
      applicantId: '22222222-2222-4222-8222-222222222222',
      documentVersionId: victim.versionId,
    });
    if (!isErr(other) || !isErr(missing)) throw new Error('expected refusals');
    expect(other.error).toEqual(missing.error);
  });

  it('does not reuse another applicant’s reading of identical text', async () => {
    const first = await seedTraveller(db, 'twin-a@example.com');
    const second = await seedTraveller(db, 'twin-b@example.com');
    const { ai, calls } = countingExtractor();
    const text = 'the very same passport text';
    for (const who of [first, second]) {
      const result = await runExtraction(db, ai, {
        actorAccountId: who.accountId,
        applicantId: who.applicantId,
        documentVersionId: who.versionId,
        text,
        budgetLimitUnits: 100,
      });
      expect(isOk(result)).toBe(true);
    }
    // Each person's text is read afresh; nothing is copied from the other person's records.
    expect(calls()).toBe(2);
  });

  it('still reads the applicant’s own version', async () => {
    const own = await seedTraveller(db, 'own@example.com');
    const { ai, calls } = countingExtractor();
    const result = await runExtraction(db, ai, {
      actorAccountId: own.accountId,
      applicantId: own.applicantId,
      documentVersionId: own.versionId,
      text: 'text',
      budgetLimitUnits: 100,
    });
    expect(isOk(result)).toBe(true);
    expect(calls()).toBe(1);
  });

  it('refuses another applicant’s version in runOcr before any provider call', async () => {
    const victim = await seedTraveller(db, 'victim3@example.com');
    const attacker = await seedTraveller(db, 'attacker3@example.com');
    const ocr = {
      performOcr: NOT_CALLED,
      ocrCacheKeyComponents: NOT_CALLED,
    } as unknown as AiOcrPort;
    const result = await runOcr(db, ocr, {
      actorAccountId: attacker.accountId,
      applicantId: attacker.applicantId,
      documentVersionId: victim.versionId,
      imageBytes: new Uint8Array([1]),
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    expect(isErr(result) && result.error.code).toBe('not_found');
    const runs = await db.select().from(schema.ocrRuns);
    expect(runs).toHaveLength(0);
  });

  it('refuses another applicant’s version in runInconsistencyCheck and runClassification', async () => {
    const victim = await seedTraveller(db, 'victim4@example.com');
    const attacker = await seedTraveller(db, 'attacker4@example.com');
    const inconsistency = await runInconsistencyCheck(
      db,
      {
        checkConsistency: NOT_CALLED,
        inconsistencyCacheKeyComponents: NOT_CALLED,
      } as unknown as AiInconsistencyPort,
      {
        actorAccountId: attacker.accountId,
        applicantId: attacker.applicantId,
        documentVersionId: victim.versionId,
        text: 't',
        budgetLimitUnits: 100,
      },
    );
    expect(isErr(inconsistency) && inconsistency.error.code).toBe('not_found');
    const classification = await runClassification(
      db,
      { classify: NOT_CALLED, classifyCacheKeyComponents: NOT_CALLED } as unknown as AiClassifyPort,
      {
        actorAccountId: attacker.accountId,
        applicantId: attacker.applicantId,
        documentVersionId: victim.versionId,
        text: 't',
        budgetLimitUnits: 100,
      },
    );
    expect(isErr(classification) && classification.error.code).toBe('not_found');
  });

  it('reads extracted text and renders the image only for the applicant’s own version', async () => {
    const victim = await seedTraveller(db, 'victim5@example.com');
    const attacker = await seedTraveller(db, 'attacker5@example.com');
    const processing = await db
      .insert(schema.processingRuns)
      .values({ documentVersionId: victim.versionId, pipelineVersion: 'test' })
      .returning({ id: schema.processingRuns.id });
    await db.insert(schema.extractionRuns).values({
      processingRunId: processing[0]?.id ?? '',
      documentVersionId: victim.versionId,
      parserName: 'test-parser',
      parserVersion: 'p',
      status: 'SUCCEEDED',
      extractedText: 'secret passport text',
    });
    expect(await getLatestExtractedText(db, victim.versionId, victim.applicantId)).toBe(
      'secret passport text',
    );
    expect(
      await getLatestExtractedText(db, victim.versionId, attacker.applicantId),
    ).toBeUndefined();

    const blobStore = { getObject: NOT_CALLED } as unknown as BlobStore;
    const renderer = { render: NOT_CALLED } as unknown as PreviewRendererPort;
    const outcome = await renderOcrSourceImage(
      db,
      blobStore,
      renderer,
      victim.versionId,
      attacker.applicantId,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('document_version_not_found');
  });
});
