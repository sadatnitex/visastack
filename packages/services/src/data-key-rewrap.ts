import { and, asc, eq, isNull, notLike, or, sql } from 'drizzle-orm';
import type { SystemScope } from './access/principal';
import { appendAuditEvent } from './audit';
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
  /** Keys that could not be opened, wrapped or proved readable again; they are left untouched. */
  readonly failed: number;
  /** Which step failed, by count (never a reason text): opening the old wrapping, wrapping anew, or proving the new wrapping opens. */
  readonly failedBy: { readonly open: number; readonly wrap: number; readonly verify: number };
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
  failedBy: { open: 0, wrap: 0, verify: 0 },
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
    const failedBy = { open: 0, wrap: 0, verify: 0 };
    for (const row of pending) {
      let plaintext: Uint8Array;
      try {
        plaintext = await port.unwrapDataKey(row.keyVersion, row.wrappedDataKey, row.wrappingKeyId);
      } catch {
        failedBy.open += 1;
        continue;
      }
      let next: { readonly wrappedDataKey: Uint8Array; readonly wrappingKeyId: string };
      try {
        next = await port.rewrapDataKey(row.keyVersion, plaintext);
      } catch {
        failedBy.wrap += 1;
        continue;
      }
      // The old wrapping is replaced only after the new one is proved to open to the same key:
      // a key service that accepts a wrap but cannot open it must never cost us the only copy.
      try {
        const again = await port.unwrapDataKey(
          row.keyVersion,
          next.wrappedDataKey,
          next.wrappingKeyId,
        );
        if (!Buffer.from(again).equals(Buffer.from(plaintext))) throw new Error('mismatch');
      } catch {
        failedBy.verify += 1;
        continue;
      }
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
    }
    const failed = failedBy.open + failedBy.wrap + failedBy.verify;
    const remaining = await countRows(notCurrent);
    // One durable record of the run, counts only.
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'DATA_KEYS_REWRAPPED',
        method: 'SYSTEM',
        result: failed === 0 ? 'ALLOWED' : 'DENIED',
        resourceType: 'data_keys',
        metadata: { rewrapped, skipped, failed, remaining },
      });
    });
    return {
      alreadyCurrent: totalKeys - before,
      rewrapped,
      skipped,
      failed,
      failedBy,
      remaining,
      available: true,
    };
  } catch (error) {
    if (isMissingRelationError(error)) return UNAVAILABLE;
    throw error;
  }
}
