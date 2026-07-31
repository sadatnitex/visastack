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
import { and, asc, eq, gt } from 'drizzle-orm';
import { signBlobToken } from './blob-token';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;

/**
 * Neon-bytea storage backend (ADR-0011). Stores object bytes in Postgres and
 * serves them through the app via short-lived HMAC-signed references — no S3,
 * no KMS, no external account. The signed token is the capability: the policy
 * engine has already authorized the access before `issueReadRef` is called, so
 * the serving route only needs to verify the signature and expiry.
 *
 * REDUCED-CONTROL, NON-COMMERCIAL (master directive §10/§21E): bytes live in
 * the application database, not a purpose-built object store. Retained only
 * for automated tests, local development, and legacy migration compatibility.
 * `VercelPrivateBlobStorage` is the pilot/commercial-track backend; both
 * satisfy the same `StoragePort`/`BlobStore` ports, so callers never branch on
 * which one is active.
 */

export interface NeonBlobStorageOptions {
  readonly db: Db;
  /** HMAC secret for signing access references. */
  readonly signingSecret: string;
  /** Absolute base URL of the serving app, e.g. the production origin. */
  readonly baseUrl: string;
}

export class NeonBlobStorage implements StoragePort, BlobStore {
  private readonly db: Db;
  private readonly signingSecret: string;
  private readonly baseUrl: string;

  constructor(options: NeonBlobStorageOptions) {
    this.db = options.db;
    this.signingSecret = options.signingSecret;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const values = {
      objectKey: input.objectKey,
      bucket: input.bucket,
      contentType: input.contentType,
      bytes: input.bytes,
      sizeBytes: input.bytes.byteLength,
    };
    await this.db
      .insert(schema.storageBlobs)
      .values(values)
      .onConflictDoUpdate({
        target: schema.storageBlobs.objectKey,
        set: {
          bucket: values.bucket,
          contentType: values.contentType,
          bytes: values.bytes,
          sizeBytes: values.sizeBytes,
        },
      });
  }

  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    const row = (
      await this.db
        .select()
        .from(schema.storageBlobs)
        .where(eq(schema.storageBlobs.objectKey, objectKey))
        .limit(1)
    )[0];
    if (!row) return undefined;
    return { contentType: row.contentType, bytes: row.bytes };
  }

  /** Idempotent: deleting an already-absent key affects zero rows, not an error. */
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    await this.db.delete(schema.storageBlobs).where(eq(schema.storageBlobs.objectKey, objectKey));
  }

  async listObjectKeys(input: ListObjectKeysInput): Promise<ListObjectsPage> {
    const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const rows = await this.db
      .select({ objectKey: schema.storageBlobs.objectKey })
      .from(schema.storageBlobs)
      .where(
        and(
          eq(schema.storageBlobs.bucket, input.bucket),
          input.cursor ? gt(schema.storageBlobs.objectKey, input.cursor) : undefined,
        ),
      )
      .orderBy(asc(schema.storageBlobs.objectKey))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      objectKeys: page.map((r) => r.objectKey),
      cursor: rows.length > limit ? page[page.length - 1]?.objectKey : undefined,
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
