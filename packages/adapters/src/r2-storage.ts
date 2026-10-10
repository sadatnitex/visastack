import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { schema } from '@visastack/db';
import type {
  AccessRef,
  BlobStore,
  Db,
  IssueReadRefInput,
  ListObjectKeysInput,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoragePort,
  StoredBytes,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { signBlobToken } from './blob-token';

const loadS3 = () => import('@aws-sdk/client-s3');

export const R2_DOCUMENT_BUCKET = 'visastack-document-backups';
const MAX_BYTES = 25 * 1024 * 1024;
const isExport = (key: string) => /^exports\/[a-f0-9-]{36}-[a-f0-9-]{36}\.zip\.enc$/.test(key);

export function validateR2Endpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(url.hostname)
  ) {
    throw new Error('R2_ENDPOINT_URL must be a Cloudflare R2 HTTPS account endpoint');
  }
  return url.origin;
}

/** Live credential and bucket reachability check, with a short bounded timeout. */
export async function probeR2Storage(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<void> {
  const { S3Client, HeadBucketCommand } = await loadS3();
  const client = new S3Client({
    region: 'auto',
    forcePathStyle: true,
    endpoint: validateR2Endpoint(input.endpoint),
    credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 5000 },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: R2_DOCUMENT_BUCKET }));
  } catch {
    throw new Error('R2 storage is unavailable');
  } finally {
    client.destroy();
  }
}

function path(bucket: StorageBucket, key: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error('invalid opaque object key');
  return `documents/${bucket.toLowerCase()}/${key}`;
}

function missing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    '$metadata' in error &&
    (error as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404
  );
}

export interface R2StorageOptions {
  readonly db: Db;
  readonly signingSecret: string;
  readonly baseUrl: string;
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Retain reads, erasure and reconciliation of objects written before R2. */
  readonly legacy: StoragePort & BlobStore;
}

/** Private R2 objects, served only through the existing authorized app route. */
export class R2Storage implements StoragePort, BlobStore {
  private client: Promise<S3Client> | undefined;
  constructor(private readonly options: R2StorageOptions) {
    validateR2Endpoint(options.endpoint);
  }

  private getClient(): Promise<S3Client> {
    this.client ??= loadS3().then(
      ({ S3Client }) =>
        new S3Client({
          region: 'auto',
          forcePathStyle: true,
          endpoint: validateR2Endpoint(this.options.endpoint),
          credentials: {
            accessKeyId: this.options.accessKeyId,
            secretAccessKey: this.options.secretAccessKey,
          },
          maxAttempts: 3,
          requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }),
    );
    return this.client;
  }

  async putObject(input: PutObjectInput): Promise<void> {
    // Expiring encrypted account exports retain their existing backend and limits.
    if (isExport(input.objectKey)) return this.options.legacy.putObject(input);
    const objectPath = path(input.bucket, input.objectKey);
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_BYTES) {
      throw new Error('R2 object exceeds upload bounds');
    }
    const { PutObjectCommand } = await loadS3();
    // Never replace an existing object. The source is bounded and validated
    // before this stream starts; no unverified public presigned upload exists.
    // Keep an independent copy in the existing storage provider. A failed
    // mirror is an upload failure, not an unreported loss of redundancy.
    await this.options.legacy.putObject(input);
    await (await this.getClient()).send(
      new PutObjectCommand({
        Bucket: R2_DOCUMENT_BUCKET,
        Key: objectPath,
        Body: Readable.from([Buffer.from(input.bytes)]),
        ContentLength: input.bytes.byteLength,
        ContentType: input.contentType,
        IfNoneMatch: '*',
      }),
    );
  }

  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    if (isExport(objectKey)) return this.options.legacy.getObject(objectKey);
    const { GetObjectCommand } = await loadS3();
    const [row] = await this.options.db
      .select({ bucket: schema.storageObjects.bucket })
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.objectKey, objectKey))
      .limit(1);
    // Upload verification happens before registration. Only quarantine is
    // accessible through this path until the domain has recorded its bucket.
    try {
      const object = await (await this.getClient()).send(
        new GetObjectCommand({
          Bucket: R2_DOCUMENT_BUCKET,
          Key: path(row?.bucket ?? 'QUARANTINE', objectKey),
        }),
      );
      if (!object.Body || !object.ContentLength || object.ContentLength > MAX_BYTES) {
        if (object.Body && 'destroy' in object.Body) object.Body.destroy();
        throw new Error('stored R2 object exceeds read bounds');
      }
      if (!(Symbol.asyncIterator in object.Body)) throw new Error('invalid R2 response stream');
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > object.ContentLength || total > MAX_BYTES) {
          if ('destroy' in object.Body) object.Body.destroy();
          throw new Error('stored R2 object exceeds read bounds');
        }
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks, total);
      if (bytes.byteLength !== object.ContentLength || bytes.byteLength > MAX_BYTES) {
        throw new Error('stored R2 object failed length verification');
      }
      return { bytes, contentType: object.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      if (!missing(error)) throw new Error('private R2 read failed');
      return this.options.legacy.getObject(objectKey);
    }
  }

  async getPendingUpload(objectKey: string): Promise<StoredBytes | undefined> {
    return this.getObject(objectKey);
  }

  async deleteObject(bucket: StorageBucket, objectKey: string): Promise<void> {
    if (isExport(objectKey)) return this.options.legacy.deleteObject(bucket, objectKey);
    const { DeleteObjectCommand } = await loadS3();
    await (await this.getClient()).send(
      new DeleteObjectCommand({
        Bucket: R2_DOCUMENT_BUCKET,
        Key: path(bucket, objectKey),
      }),
    );
    await this.options.legacy.deleteObject(bucket, objectKey);
  }

  async listObjectKeys(input: ListObjectKeysInput): Promise<ListObjectsPage> {
    // Separate cursor phases preserve the legacy inventory without allowing
    // document sweeps to inspect or erase the database backup prefix.
    if (input.cursor?.startsWith('legacy:')) {
      const cursor = input.cursor.slice(7);
      const page = await this.options.legacy.listObjectKeys({
        bucket: input.bucket,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(cursor ? { cursor } : {}),
      });
      return { ...page, cursor: page.cursor ? `legacy:${page.cursor}` : undefined };
    }
    const { ListObjectsV2Command } = await loadS3();
    const prefix = `documents/${input.bucket.toLowerCase()}/`;
    const page = await (await this.getClient()).send(
      new ListObjectsV2Command({
        Bucket: R2_DOCUMENT_BUCKET,
        Prefix: prefix,
        MaxKeys: Math.max(1, Math.min(input.limit ?? 100, 1000)),
        ...(input.cursor ? { ContinuationToken: input.cursor } : {}),
      }),
    );
    return {
      objectKeys: (page.Contents ?? []).flatMap((object) => {
        const key = object.Key?.slice(prefix.length);
        return key && /^[A-Za-z0-9_-]{1,128}$/.test(key) ? [key] : [];
      }),
      cursor:
        page.IsTruncated && page.NextContinuationToken ? page.NextContinuationToken : 'legacy:',
    };
  }

  async issueReadRef(input: IssueReadRefInput): Promise<AccessRef> {
    const exp = Math.floor(Date.now() / 1000) + input.expiresInSeconds;
    const filename = input.filename ?? '';
    const sig = signBlobToken(
      this.options.signingSecret,
      input.objectKey,
      input.disposition,
      input.variant,
      exp,
      filename,
    );
    const query = new URLSearchParams({
      d: input.disposition,
      v: input.variant,
      exp: String(exp),
      sig,
      ...(filename ? { f: filename } : {}),
    });
    return {
      url: `${this.options.baseUrl.replace(/\/$/, '')}/api/blob/${encodeURIComponent(input.objectKey)}?${query}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      disposition: input.disposition,
      variant: input.variant,
    };
  }
}
