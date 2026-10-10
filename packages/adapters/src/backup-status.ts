import { R2_DOCUMENT_BUCKET, validateR2Endpoint } from './r2-storage';

/** A completed encrypted dump is evidence of capture, never of restore. */
export async function hasRecentDatabaseBackup(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: number;
}): Promise<boolean> {
  const { GetObjectCommand, HeadObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    forcePathStyle: true,
    endpoint: validateR2Endpoint(input.endpoint),
    credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
    requestHandler: { connectionTimeout: 5000, requestTimeout: 10000 },
    maxAttempts: 2,
  });
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket: R2_DOCUMENT_BUCKET, Key: 'database/latest.json' }),
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
    const manifest = JSON.parse(Buffer.concat(chunks, total).toString()) as {
      version?: unknown;
      scope?: unknown;
      completedAt?: unknown;
      objectKey?: unknown;
      sha256?: unknown;
      size?: unknown;
    };
    const completed =
      typeof manifest.completedAt === 'string' ? Date.parse(manifest.completedAt) : Number.NaN;
    const now = input.now ?? Date.now();
    const valid =
      manifest.version === 1 &&
      manifest.scope === 'database-only' &&
      typeof manifest.objectKey === 'string' &&
      /^database\/[A-Za-z0-9_-]+\.sql\.vsbk$/.test(manifest.objectKey) &&
      typeof manifest.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(manifest.sha256) &&
      typeof manifest.size === 'number' &&
      manifest.size > 0 &&
      Number.isFinite(completed) &&
      completed <= now &&
      now - completed < 7 * 24 * 60 * 60 * 1000;
    if (!valid) return false;
    const backup = await client.send(
      new HeadObjectCommand({
        Bucket: R2_DOCUMENT_BUCKET,
        Key: manifest.objectKey as string,
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
