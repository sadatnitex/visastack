import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  LETTER_TEXT,
  cleanScanner,
  extractorFor,
  freshDb,
  jobsOf,
  seedReader,
  withinLimits,
} from './ai-reading.test-support';
import type { DocumentConverterPort } from './extraction';
import { processIntake } from './intake';

/** A text reader that counts how often it is asked. */
function countingExtractor() {
  const inner = extractorFor(LETTER_TEXT);
  const calls = { extract: 0 };
  const extractor: DocumentConverterPort = {
    async extract(input) {
      calls.extract += 1;
      return inner.extract(input);
    },
  };
  return { extractor, calls };
}

describe('intake and the resource lifecycle (LC-A2)', () => {
  it('skips extraction quietly for a deleted document version and still reads a current one', async () => {
    const db = await freshDb();
    const deleted = await seedReader(db, 'lc-intake-deleted@example.com', {
      docType: 'HOTEL_BOOKING',
    });
    const current = await seedReader(db, 'lc-intake-current@example.com', {
      docType: 'HOTEL_BOOKING',
    });
    const now = new Date();
    await db.insert(schema.documentLifecycle).values({
      documentId: deleted.documentId,
      applicantId: deleted.applicantId,
      deletedAt: now,
      deletePath: 'DUPLICATE',
      purgeAfter: new Date(now.getTime() + 30 * 86_400_000),
    });

    const skipped = countingExtractor();
    const result = await processIntake(db, cleanScanner, skipped.extractor, withinLimits, {
      documentVersionId: deleted.versionId,
    });
    expect(isOk(result)).toBe(true);
    expect(skipped.calls.extract).toBe(0);
    const texts = await db
      .select()
      .from(schema.extractionRuns)
      .where(eq(schema.extractionRuns.documentVersionId, deleted.versionId));
    expect(texts).toHaveLength(0);
    // Nothing is queued for automatic reading either.
    expect(await jobsOf(db, deleted.versionId)).toHaveLength(0);

    const read = countingExtractor();
    const readResult = await processIntake(db, cleanScanner, read.extractor, withinLimits, {
      documentVersionId: current.versionId,
    });
    expect(isOk(readResult)).toBe(true);
    expect(read.calls.extract).toBe(1);
  });
});
