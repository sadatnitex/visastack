import { type SQL, not, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * How an automatic AI reading is queued (S5, ADR 0019). It is one more row in the same durable
 * queue as intake (`processing_jobs`), told apart by its idempotency key, because the job type
 * column is a closed list that only a migration can widen. A later migration can add an
 * `AI_READING` job type and retire the key test below; nothing outside this file reads the key.
 *
 * The key is the file version plus the reader version, so queueing the same version twice, from
 * a retried intake or a second worker, is one job. Bump `READER_VERSION` only when reading has
 * changed enough that finished work should be done again.
 */
export const READER_VERSION = 1;

const READING_KEY_MARKER = ':AI_READING:';

export function aiReadingIdempotencyKey(
  documentVersionId: string,
  readerVersion: number = READER_VERSION,
): string {
  return `${documentVersionId}${READING_KEY_MARKER}${readerVersion}`;
}

/** True when a queue row is an automatic AI reading rather than an intake pass. */
export function isAiReadingKey(idempotencyKey: string): boolean {
  return idempotencyKey.includes(READING_KEY_MARKER);
}

/** SQL for "this queue row is an automatic AI reading", on the idempotency key column. */
export function isAiReadingJob(idempotencyKey: PgColumn): SQL {
  // `_` is a one-character wildcard in LIKE, so it is escaped: only the exact marker matches.
  const pattern = `%${READING_KEY_MARKER.replace(/[\\_%]/g, '\\$&')}%`;
  return sql`${idempotencyKey} like ${pattern} escape '\\'`;
}

/** SQL for "this queue row is an intake pass". */
export function isIntakeJob(idempotencyKey: PgColumn): SQL {
  return not(isAiReadingJob(idempotencyKey));
}

/**
 * Why a finished reading job did not finish the reading. A closed list of safe-to-show words,
 * kept on the job row; the document page turns each into plain wording. A reading that worked
 * has none.
 */
export const READING_STOP_REASONS = [
  /** The owner has not switched AI reading on (or switched it off after the job was queued). */
  'NO_CONSENT',
  /** The platform kill switch is on, or no AI provider is usable right now. */
  'SWITCHED_OFF',
  /** The kind of document is on the protected list, so it is only ever read on request. */
  'PROTECTED',
  /** A spend, attempt or page limit stopped the reading. */
  'LIMIT_REACHED',
  /** The reading was tried and did not work (the file, or the provider). */
  'COULD_NOT_READ',
  /** There was nothing to read: no text, and the file cannot be read as an image. */
  'NOTHING_TO_READ',
] as const;

export type ReadingStopReason = (typeof READING_STOP_REASONS)[number];

export function isReadingStopReason(value: string | null | undefined): value is ReadingStopReason {
  return (READING_STOP_REASONS as readonly string[]).includes(value ?? '');
}
