import {
  LATEST_MANIFEST_KEY,
  MANIFEST_CLOCK_SKEW_MS,
  parseBackupManifest,
} from './backup-retention';
import { createR2BackupClient } from './r2-backup-client';
import { R2_DOCUMENT_BUCKET } from './r2-storage';

/**
 * How old the newest completed capture may be. Captures run daily at 05:17 UTC and this check
 * runs daily at 11:07 UTC (S27), so a capture under 24 hours old is that morning's: when the
 * morning's capture failed, the newest one is about 30 hours old and the check fails the same
 * day, which asks GitHub for a fallback run.
 */
export const BACKUP_FRESHNESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A completed encrypted dump is evidence of capture, never of restore. */
export async function hasRecentDatabaseBackup(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: number;
}): Promise<boolean> {
  const { GetObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await createR2BackupClient(input);
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket: R2_DOCUMENT_BUCKET, Key: LATEST_MANIFEST_KEY }),
    );
    if (
      !object.Body ||
      !object.ContentLength ||
      object.ContentLength > 8192 ||
      !(Symbol.asyncIterator in object.Body)
    )
      throw new Error('invalid backup manifest');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > 8192) throw new Error('invalid backup manifest');
      chunks.push(Buffer.from(chunk));
    }
    const now = input.now ?? Date.now();
    const manifest = parseBackupManifest(Buffer.concat(chunks, total).toString(), new Date(now));
    if (!manifest) return false;
    const age = now - manifest.completedAt.getTime();
    if (age < -MANIFEST_CLOCK_SKEW_MS || age >= BACKUP_FRESHNESS_MAX_AGE_MS) return false;
    const backup = await client.send(
      new HeadObjectCommand({
        Bucket: R2_DOCUMENT_BUCKET,
        Key: manifest.objectKey,
      }),
    );
    return backup.ContentLength === manifest.size;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      '$metadata' in error &&
      (error as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404
    )
      return false;
    throw new Error('backup status unavailable');
  } finally {
    client.destroy();
  }
}
