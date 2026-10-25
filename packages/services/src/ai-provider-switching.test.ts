import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  type AiExtractionOutcome,
  type AiExtractionPort,
  type FieldProposal,
  runExtraction,
  runOcr,
  totalAiCostUnits,
} from './ai';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import type { AiOcrOutcome, AiOcrPort } from './ocr';

/**
 * Switching between providers (owner request 2026-10-25): an answer from one
 * provider is never served as another provider's, and a fallback to a second
 * provider stays inside the same per-document attempt cap and never charges
 * for the failed call.
 */

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seed(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
  for (const type of ['CORE_PROCESSING', 'AI_EXTRACTION', 'AI_OCR'] as const) {
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type,
      granted: true,
    });
  }
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
    bucket: 'QUARANTINE',
    objectKey: `obj-${email}`,
  });
  if (!isOk(version)) throw new Error('version');
  return {
    accountId: account.id,
    applicantId: applicant.value.id,
    versionId: version.value.version.id,
  };
}

const proposals: FieldProposal[] = [
  { type: 'NEW', fieldKey: 'passport.number', value: 'L898902C3', confidence: 0.98 },
];

/** Same model name on purpose: only the provider differs. */
const SHARED_MODEL = 'shared-model-name';

function extractor(
  provider: string,
  outcome?: AiExtractionOutcome,
): { ai: AiExtractionPort; calls: () => number } {
  let calls = 0;
  const result: AiExtractionOutcome = outcome ?? {
    ok: true,
    result: {
      proposals,
      usage: {
        costUnits: 3,
        inputUnits: 2,
        outputUnits: 1,
        cachedUnits: 0,
        modelVersion: SHARED_MODEL,
        promptVersion: 'p1',
        schemaVersion: 's1',
        provider,
        latencyMs: 10,
      },
    },
  };
  return {
    ai: {
      async extract() {
        calls += 1;
        return result;
      },
      cacheKeyComponents() {
        return { provider, model: SHARED_MODEL, promptVersion: 'p1', schemaVersion: 's1' };
      },
    },
    calls: () => calls,
  };
}

function ocrReader(provider: string): { ai: AiOcrPort; calls: () => number } {
  let calls = 0;
  const result: AiOcrOutcome = {
    ok: true,
    result: {
      text: `read by ${provider}`,
      reviewIssues: [],
      usage: {
        costUnits: 4,
        inputUnits: 3,
        outputUnits: 1,
        modelVersion: SHARED_MODEL,
        promptVersion: 'ocr-p1',
        provider,
        latencyMs: 10,
      },
    },
  };
  return {
    ai: {
      async performOcr() {
        calls += 1;
        return result;
      },
      cacheKeyComponents() {
        return { provider, model: SHARED_MODEL, promptVersion: 'ocr-p1' };
      },
    },
    calls: () => calls,
  };
}

describe('cache keys keep each provider apart', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('never serves one provider an answer cached from another provider with the same model name', async () => {
    const { accountId, applicantId, versionId } = await seed(db, 'cache-split@example.com');
    const base = { actorAccountId: accountId, applicantId, documentVersionId: versionId };
    const openai = extractor('openai');
    const gemini = extractor('gemini');

    expect(
      isOk(await runExtraction(db, openai.ai, { ...base, text: 'MRZ', budgetLimitUnits: 1000 })),
    ).toBe(true);
    expect(
      isOk(await runExtraction(db, gemini.ai, { ...base, text: 'MRZ', budgetLimitUnits: 1000 })),
    ).toBe(true);

    // The second provider was really asked, not handed the first one's answer.
    expect(gemini.calls()).toBe(1);
    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId))
      .orderBy(schema.aiExtractionRuns.createdAt);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.servedFromCacheRunId).toBeNull();
    expect(runs[0]?.cacheKey).not.toBe(runs[1]?.cacheKey);
    expect(runs.map((r) => r.provider)).toEqual(['openai', 'gemini']);

    // The same provider again is still served from its own cache.
    await runExtraction(db, gemini.ai, { ...base, text: 'MRZ', budgetLimitUnits: 1000 });
    expect(gemini.calls()).toBe(1);
  });

  it('keeps OCR readings apart by provider as well', async () => {
    const { accountId, applicantId, versionId } = await seed(db, 'ocr-cache-split@example.com');
    const input = {
      actorAccountId: accountId,
      applicantId,
      documentVersionId: versionId,
      imageBytes: new TextEncoder().encode('fake-page'),
      contentType: 'image/png' as const,
      budgetLimitUnits: 1000,
    };
    const openai = ocrReader('openai');
    const anthropic = ocrReader('anthropic');
    await runOcr(db, openai.ai, input);
    const second = await runOcr(db, anthropic.ai, input);
    expect(anthropic.calls()).toBe(1);
    expect(isOk(second)).toBe(true);
    if (isOk(second)) {
      expect(second.value.ocrRun.servedFromCacheRunId).toBeNull();
      expect(second.value.ocrRun.provider).toBe('anthropic');
    }
  });
});

describe('a fallback to another provider stays inside the existing caps', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('records which provider answered and charges only for the answer, not the failed call', async () => {
    const { accountId, applicantId, versionId } = await seed(db, 'fallback-charge@example.com');
    const primary = extractor('openai', { ok: false, code: 'timeout', message: 'timed out' });
    const fallback = extractor('anthropic');
    const result = await runExtraction(db, primary.ai, {
      actorAccountId: accountId,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 2,
      fallback: { ai: fallback.ai },
    });
    expect(isOk(result)).toBe(true);
    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    const answered = runs.find((r) => r.status === 'SUCCEEDED');
    expect(answered?.provider).toBe('anthropic');
    expect(await totalAiCostUnits(db)).toBe(3);
  });

  it('does not try the fallback when the primary used the last attempt the document is allowed', async () => {
    const { accountId, applicantId, versionId } = await seed(
      db,
      'fallback-last-attempt@example.com',
    );
    const primary = extractor('openai', { ok: false, code: 'rate_limited', message: 'slow down' });
    const fallback = extractor('anthropic');
    const result = await runExtraction(db, primary.ai, {
      actorAccountId: accountId,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
      fallback: { ai: fallback.ai },
    });
    expect(isErr(result)).toBe(true);
    expect(primary.calls()).toBe(1);
    expect(fallback.calls()).toBe(0);
    expect(await totalAiCostUnits(db)).toBe(0);
  });
});
