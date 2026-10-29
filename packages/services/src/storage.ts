/**
 * Storage port — the seam between the domain and object storage.
 *
 * The Document Vault stores encrypted bytes in private buckets (Build Spec §7).
 * The domain never talks to a concrete provider or a hard-coded address: it
 * depends on this port, and a real adapter (S3 + KMS presigned URLs) is
 * injected at the edge. Tests inject a deterministic fake. This keeps the
 * services provider-agnostic and fully testable with no external service.
 */

export type StorageBucket = 'QUARANTINE' | 'CLEAN';
export type AccessDisposition = 'preview' | 'download';
export type AccessVariant = 'original' | 'redacted';

/** A short-lived, read-only reference to a stored object (e.g. a signed URL). */
export interface AccessRef {
  readonly url: string;
  /** ISO-8601 expiry — access is always time-bounded. */
  readonly expiresAt: string;
  readonly disposition: AccessDisposition;
  readonly variant: AccessVariant;
}

export interface IssueReadRefInput {
  readonly bucket: StorageBucket;
  readonly objectKey: string;
  readonly disposition: AccessDisposition;
  readonly variant: AccessVariant;
  readonly expiresInSeconds: number;
  /**
   * The display filename to serve in `Content-Disposition` (master directive
   * §10/§18/§21E). The CURRENT approved name if one exists, else the
   * preserved original name — never the opaque storage key. Embedded in the
   * signed reference so it cannot be substituted after minting.
   */
  readonly filename?: string;
}

export interface StoragePort {
  /** Issue a time-limited read reference for an object. */
  issueReadRef(input: IssueReadRefInput): Promise<AccessRef>;
}

/** The bytes carried by a stored object. */
export interface StoredBytes {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * The object keys every storage adapter accepts: opaque, 1 to 128 letters, digits, `-` or `_`.
 * No `/`, no dots, nothing that reads as a path (the R2 and Vercel Blob adapters refuse anything
 * else). New kinds of stored objects mark themselves with a prefix ending in `-`, never `/`.
 */
export const OPAQUE_OBJECT_KEY = /^[A-Za-z0-9_-]{1,128}$/;

export function isOpaqueObjectKey(key: string): boolean {
  return OPAQUE_OBJECT_KEY.test(key);
}

export interface PutObjectInput extends StoredBytes {
  readonly bucket: StorageBucket;
  /** An opaque key: see `OPAQUE_OBJECT_KEY`. */
  readonly objectKey: string;
}

/** One page of an object listing, for bounded reconciliation sweeps. */
export interface ListObjectsPage {
  readonly objectKeys: readonly string[];
  /** Present when more keys remain; pass back in as `cursor` to continue. */
  readonly cursor: string | undefined;
}

export interface ListObjectKeysInput {
  readonly bucket: StorageBucket;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * The write/read-bytes half of object storage, separate from `StoragePort` so
 * existing read-only consumers are unaffected. A concrete backend (Neon-bytea
 * today, S3 later) implements both.
 */
export interface BlobStore {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(objectKey: string): Promise<StoredBytes | undefined>;
  /** Internal upload verification for an owned, server-reserved quarantine key.
   * Normal delivery must still use getObject and registered domain metadata. */
  getPendingUpload?(objectKey: string): Promise<StoredBytes | undefined>;
  /** Idempotent: deleting an already-absent object is not an error. */
  deleteObject(bucket: StorageBucket, objectKey: string): Promise<void>;
  /** Bounded, paginated listing — used only by the orphan reconciliation sweep. */
  listObjectKeys(input: ListObjectKeysInput): Promise<ListObjectsPage>;
}
