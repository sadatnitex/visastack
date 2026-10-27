import { type ConsentType, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import type { AiExtractionPort } from './ai';
import type { AiReadingPorts } from './ai-reading';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import type { DocumentConverterPort, ExtractionOutcome } from './extraction';
import { type ContentLimitsPort, type MalwareScannerPort, processIntake } from './intake';
import type { AiOcrPort } from './ocr';

/** Shared fixtures for the automatic reading tests (S5, S6): real intake and queue, providers that count every call. */

// A valid ICAO TD3 specimen (check digits verified in pipeline.test.ts).
export const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
export const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
export const PASSPORT_TEXT = `PASSPORT\n${L1}\n${L2}\n`;
export const LETTER_TEXT = 'Hotel booking confirmation for Anna Eriksson, arriving 3 May.';
export const SCAN_TEXT = 'Hotel booking confirmation read from the picture of a scan.';

export const cleanScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: true };
  },
};
export const withinLimits: ContentLimitsPort = {
  name: 'test-content-limits',
  version: '0.0.0',
  async check() {
    return { withinLimits: true };
  },
};
export function extractorFor(text: string, parserName = 'test-fixture'): DocumentConverterPort {
  return {
    async extract(): Promise<ExtractionOutcome> {
      return {
        ok: true,
        result: {
          text,
          truncated: false,
          pageCount: 1,
          warnings: [],
          parserName,
          parserVersion: '1',
        },
      };
    },
  };
}
/** A photo or scan: the embedded-text reader finds nothing. */
export const noTextExtractor: DocumentConverterPort = {
  async extract(): Promise<ExtractionOutcome> {
    return { ok: false, code: 'unsupported_format', message: 'image format, no OCR' };
  },
};

export const LIMITS = {
  budgetLimitUnits: 1_000_000,
  perDocumentBudgetLimitUnits: 1_000_000,
  maxAttemptsPerDocument: 3,
  maxPagesPerDocument: 25,
  cacheMaxAgeDays: 30,
  maxConcurrentCalls: 5,
};

export const usage = {
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

/** Providers that count every call and remember what text the extraction was handed. */
export function countingPorts(overrides: Partial<typeof LIMITS> = {}) {
  const calls = { extract: 0, ocr: 0, render: 0, prepare: 0, texts: [] as string[] };
  const limits = { ...LIMITS, ...overrides };
  const extractor: AiExtractionPort = {
    async extract(input) {
      calls.extract += 1;
      calls.texts.push(input.text);
      return {
        ok: true,
        result: {
          proposals: [
            {
              type: 'NEW',
              fieldKey: 'given_name',
              value: 'Anna',
              confidence: 0.95,
              evidenceSnippet: 'Anna',
            },
          ],
          usage,
        },
      };
    },
    cacheKeyComponents: () => ({ model: 'm', promptVersion: 'p1', schemaVersion: 's1' }),
  };
  const ocr: AiOcrPort = {
    async performOcr() {
      calls.ocr += 1;
      return {
        ok: true,
        result: {
          text: SCAN_TEXT,
          reviewIssues: [],
          usage: {
            costUnits: 2,
            inputUnits: 2,
            outputUnits: 1,
            modelVersion: 'm',
            promptVersion: 'p1',
            provider: 'openai',
            latencyMs: 1,
          },
        },
      };
    },
    cacheKeyComponents: () => ({ model: 'm', promptVersion: 'o1' }),
  };
  const ports: AiReadingPorts = {
    async extraction() {
      return { ai: extractor, limits };
    },
    async ocr() {
      return { ai: ocr, limits };
    },
    async renderImage() {
      calls.render += 1;
      return { ok: true, imageBytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' };
    },
    async prepareFields() {
      calls.prepare += 1;
    },
  };
  return { ports, calls };
}

export async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

export interface Reader {
  readonly accountId: string;
  readonly applicantId: string;
  readonly documentId: string;
  readonly versionId: string;
}

export async function seedReader(
  db: Db,
  email: string,
  options: { readonly consents?: readonly ConsentType[]; readonly docType?: string } = {},
): Promise<Reader> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of options.consents ?? ['CORE_PROCESSING', 'AI_EXTRACTION', 'AI_OCR']) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Anna Eriksson',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const doc = await registerDocument(db, {
    actorAccountId: accountId,
    applicantId: applicant.value.id,
    originalName: 'scan.pdf',
    ...(options.docType ? { docType: options.docType } : {}),
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: accountId,
    documentId: doc.value.id,
    bucket: 'QUARANTINE',
    objectKey: `obj-${email}`,
  });
  if (!isOk(version)) throw new Error('version');
  return {
    accountId,
    applicantId: applicant.value.id,
    documentId: doc.value.id,
    versionId: version.value.version.id,
  };
}

export async function runIntake(db: Db, versionId: string, extractor: DocumentConverterPort) {
  const result = await processIntake(db, cleanScanner, extractor, withinLimits, {
    documentVersionId: versionId,
  });
  if (!isOk(result)) throw new Error('intake failed');
  return result.value;
}

export const jobsOf = (db: Db, versionId: string) =>
  db
    .select()
    .from(schema.processingJobs)
    .where(eq(schema.processingJobs.documentVersionId, versionId));

export const proposalsOf = (db: Db, versionId: string) =>
  db
    .select()
    .from(schema.fieldProposals)
    .where(eq(schema.fieldProposals.documentVersionId, versionId));

export const scope = () => systemScopeForTest('process-ai-reading');

/** An admin has configured AI but nothing is active: the platform kill switch is on. */
export async function switchAiOff(db: Db): Promise<void> {
  await db.insert(schema.aiProviderConfigs).values({
    status: 'DRAFT',
    provider: 'openai',
    model: 'm',
    apiKeyCiphertext: new Uint8Array([1]),
    apiKeyNonce: new Uint8Array([1]),
    apiKeyVersion: 'v1',
    apiKeyFingerprint: '...0000',
    budgetLimitUnits: 100,
  });
}
