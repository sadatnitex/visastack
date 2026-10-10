import { del, get, list, put } from '@vercel/blob';
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

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;

/**
 * Vercel Private Blob storage backend (master directive §10 — Release B).
 *
 * Uses `@vercel/blob`'s genuine private-access mode (`access: 'private'`,
 * requiring the store's read-write token to fetch bytes) — not a public blob
 * with an unguessable URL. Bytes are fetched SERVER-SIDE only, through the
 * app's own `/api/blob/[key]` route: `issueReadRef` mints the same kind of
 * short-lived HMAC-signed reference to that route as `NeonBlobStorage` does,
 * never a direct Vercel presigned URL to the browser. This is deliberate, not
 * an oversight — it is the only way to keep the required per-request
 * `Content-Disposition` (the *current* approved filename, which can change
 * after upload) and the single server-side enforcement/audit point (§18).
 *
 * The object key is opaque; the bucket association is recovered from the
 * `storage_objects` domain table (never encoded in the object path itself,
 * alongside applicant id, email, or filename — §10).
 */

export interface VercelPrivateBlobStorageOptions {
  readonly db: Db;
  /** HMAC secret for signing read references to `/api/blob/[key]`. */
  readonly signingSecret: string;
  /** Absolute base URL of the serving app. */
  readonly baseUrl: string;
  /** Vercel Blob read-write token. Defaults to `process.env.BLOB_READ_WRITE_TOKEN`. */
  readonly token?: string;
}

function pathnameFor(bucket: StorageBucket, objectKey: string): string {
  return `${bucket.toLowerCase()}/${objectKey}`;
}

export class VercelPrivateBlobStorage implements StoragePort, BlobStore {
  private readonly db: Db;
  private readonly signingSecret: string;
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(options: VercelPrivateBlobStorageOptions) {
    this.db = options.db;
    this.signingSecret = options.signingSecret;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const pathname = pathnameFor(input.bucket, input.objectKey);
    await put(pathname, Buffer.from(input.bytes), {
      access: 'private',
      contentType: input.contentType,
      // The caller already generated a unique opaque key; a random suffix
      // would break the objectKey <-> pathname round-trip used by getObject.
      addRandomSuffix: false,
      // Each version gets a fresh opaque key (never reused), so an overwrite
      // attempt indicates a real key collision — fail rather than silently
      // replace another version's bytes.
      allowOverwrite: false,
      ...(this.token ? { token: this.token } : {}),
    });
  }

  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    const row = (
      await this.db
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.objectKey, objectKey))
        .limit(1)
    )[0];
    if (!row) return undefined;

    return this.readPrivate(row.bucket, objectKey);
  }

  async getPendingUpload(objectKey: string): Promise<StoredBytes | undefined> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(objectKey)) throw new Error('invalid upload object key');
    return this.readPrivate('QUARANTINE', objectKey);
  }

  private async readPrivate(
    bucket: StorageBucket,
    objectKey: string,
  ): Promise<StoredBytes | undefined> {
    const pathname = pathnameFor(bucket, objectKey);
    const result = await get(pathname, {
      access: 'private',
      ...(this.token ? { token: this.token } : {}),
    });
    if (!result || result.statusCode !== 200) return undefined;

    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    return { contentType: result.blob.contentType, bytes };
  }

  /**
   * Delete the underlying blob (master directive §7 "PR 4" — the erasure
   * outbox in `packages/services/src/erasure.ts` is the only caller). Vercel
   * Blob's `del` is itself idempotent: deleting an already-absent pathname is
   * not an error.
   */
  async deleteObject(bucket: StorageBucket, objectKey: string): Promise<void> {
    await del(pathnameFor(bucket, objectKey), this.token ? { token: this.token } : undefined);
  }

  async listObjectKeys(input: ListObjectKeysInput): Promise<ListObjectsPage> {
    const prefix = `${input.bucket.toLowerCase()}/`;
    const result = await list({
      prefix,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
      mode: 'expanded',
      ...(this.token ? { token: this.token } : {}),
    });
    return {
      objectKeys: result.blobs.map((b) => b.pathname.slice(prefix.length)),
      cursor: result.hasMore ? result.cursor : undefined,
    };
  }

  async issueReadRef(input: IssueReadRefInput): Promise<AccessRef> {
    const exp = Math.floor(Date.now() / 1000) + input.expiresInSeconds;
    const filename = input.filename ?? '';
    const sig = signBlobToken(
      this.signingSecret,
      input.objectKey,
      input.disposition,
      input.variant,
      exp,
      filename,
    );
    const query = `d=${input.disposition}&v=${input.variant}&exp=${exp}&sig=${sig}${filename ? `&f=${encodeURIComponent(filename)}` : ''}`;
    return {
      url: `${this.baseUrl}/api/blob/${encodeURIComponent(input.objectKey)}?${query}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      disposition: input.disposition,
      variant: input.variant,
    };
  }
}
