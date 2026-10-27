import { and, asc, eq, isNull, notLike, or, sql } from 'drizzle-orm';
import type { SystemScope } from './access/principal';
import { type Db, schema } from './db';
import { isMissingRelationError } from './missing-relation';
import { type KeyManagementPort, isRewrappingKeyManagementPort } from './ports';

/**
 * Moves every stored data key from the local development key to the real key service (S26).
 * Only the wrapping changes: the data key itself, and so every encrypted value, stays exactly as
 * it is. Idempotent (a key already wrapped by the current key is left alone), resumable (each key
 * is its own small step and a stop part way just leaves the rest for the next run), and safe
 * under a race (a key changed by someone else between reading and writing is skipped, not
 * overwritten). Counts by state, never anything secret.
 */

export interface DataKeyRewrapSummary {
  /** Keys wrapped by the current key service before this run began. */
  readonly alreadyCurrent: number;
  /** Keys moved by this run. */
  readonly rewrapped: number;
  /** Keys that changed under us and were left for the next run. */
  readonly skipped: number;
  /** Keys that could not be opened or wrapped; they are left untouched. */
  readonly failed: number;
  /** Keys still not wrapped by the current key after this run. */
  readonly remaining: number;
  /** False when the table or column is not there yet (migration not run). */
  readonly available: boolean;
}

const UNAVAILABLE: DataKeyRewrapSummary = {
  alreadyCurrent: 0,
  rewrapped: 0,
  skipped: 0,
  failed: 0,
  remaining: 0,
  available: false,
};

export async function rewrapDataKeys(
  db: Db,
  scope: SystemScope<'rewrap-data-keys'>,
  port: KeyManagementPort,
  options: { readonly batchSize?: number } = {},
): Promise<DataKeyRewrapSummary> {
  if (scope.job !== 'rewrap-data-keys') throw new Error('wrong job scope');
  if (!isRewrappingKeyManagementPort(port)) {
    throw new Error('the configured key provider cannot re-wrap data keys');
  }
  const prefix = port.wrappingKeyPrefix();
  const limit = Math.max(1, Math.min(options.batchSize ?? 100, 500));
  try {
    const notCurrent = or(
      isNull(schema.dataKeys.wrappingKeyId),
      notLike(schema.dataKeys.wrappingKeyId, `${prefix}%`),
    );
    const countRows = async (where?: ReturnType<typeof or>) => {
      const query = db.select({ n: sql<number>`count(*)::int` }).from(schema.dataKeys);
      const rows = await (where ? query.where(where) : query);
      return rows[0]?.n ?? 0;
    };
    const totalKeys = await countRows();
    const before = await countRows(notCurrent);
    const pending = await db
      .select({
        keyVersion: schema.dataKeys.keyVersion,
        wrappedDataKey: schema.dataKeys.wrappedDataKey,
        wrappingKeyId: schema.dataKeys.wrappingKeyId,
      })
      .from(schema.dataKeys)
      .where(notCurrent)
      .orderBy(asc(schema.dataKeys.createdAt))
      .limit(limit);
    let rewrapped = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of pending) {
      try {
        const plaintext = await port.unwrapDataKey(
          row.keyVersion,
          row.wrappedDataKey,
          row.wrappingKeyId,
        );
        const next = await port.rewrapDataKey(row.keyVersion, plaintext);
        // Compare-and-set on what was read: a concurrent change makes this a no-op.
        const updated = await db
          .update(schema.dataKeys)
          .set({
            wrappedDataKey: Buffer.from(next.wrappedDataKey),
            wrappingKeyId: next.wrappingKeyId,
          })
          .where(
            and(
              eq(schema.dataKeys.keyVersion, row.keyVersion),
              eq(schema.dataKeys.wrappedDataKey, Buffer.from(row.wrappedDataKey)),
            ),
          )
          .returning({ keyVersion: schema.dataKeys.keyVersion });
        if (updated.length === 1) rewrapped += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }
    return {
      alreadyCurrent: totalKeys - before,
      rewrapped,
      skipped,
      failed,
      remaining: await countRows(notCurrent),
      available: true,
    };
  } catch (error) {
    if (isMissingRelationError(error)) return UNAVAILABLE;
    throw error;
  }
}
