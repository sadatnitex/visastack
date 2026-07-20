import { createHmac, timingSafeEqual } from 'node:crypto';
import { schema } from '@visastack/db';
import type {
  AccessRef,
  BlobStore,
  Db,
  IssueReadRefInput,
  PutObjectInput,
  StoragePort,
  StoredBytes,
} from '@visastack/services';
import { eq } from 'drizzle-orm';

/**
 * Neon-bytea storage backend (ADR-0011). Stores object bytes in Postgres and
 * serves them through the app via short-lived HMAC-signed references — no S3,
 * no KMS, no external account. The signed token is the capability: the policy
 * engine has already authorized the access before `issueReadRef` is called, so
 * the serving route only needs to verify the signature and expiry.
 *
 * The same class satisfies both `StoragePort` (read refs) and `BlobStore`
 * (bytes I/O); an S3 adapter can replace it behind the same interfaces.
 */

export interface BlobTokenFields {
  readonly objectKey: string;
  readonly disposition: string;
  readonly variant: string;
  readonly exp: number;
  readonly sig: string;
}

function signToken(
  secret: string,
  objectKey: string,
  disposition: string,
  variant: string,
  exp: number,
): string {
  return createHmac('sha256', secret)
    .update(`${objectKey}.${disposition}.${variant}.${exp}`)
    .digest('hex');
}

/** Verify a blob access token: correct signature and not expired. */
export function verifyBlobToken(
  secret: string,
  fields: BlobTokenFields,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(fields.exp) || fields.exp * 1000 < now) return false;
  const expected = signToken(
    secret,
    fields.objectKey,
    fields.disposition,
    fields.variant,
    fields.exp,
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(fields.sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

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

  async issueReadRef(input: IssueReadRefInput): Promise<AccessRef> {
    const exp = Math.floor(Date.now() / 1000) + input.expiresInSeconds;
    const sig = signToken(
      this.signingSecret,
      input.objectKey,
      input.disposition,
      input.variant,
      exp,
    );
    const query = `d=${input.disposition}&v=${input.variant}&exp=${exp}&sig=${sig}`;
    return {
      url: `${this.baseUrl}/api/blob/${encodeURIComponent(input.objectKey)}?${query}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      disposition: input.disposition,
      variant: input.variant,
    };
  }
}
