import { eq } from 'drizzle-orm';
import { type Db, first, required, schema } from './db';
import type { BlobStore, StorageBucket } from './storage';

/**
 * The two steps every upload that keeps its own bytes shares (profile photos, payment proofs):
 * register the object before any byte is written, so bytes with no registration can never exist,
 * and delete bytes first and the registration only once they are gone, so a failed delete stays
 * findable by the orphan sweep (reconciliation.ts).
 */

/** Registers an object (bucket, key, size, hash) and returns its id. Call before writing the bytes. */
export async function registerStorageObject(
  db: Db,
  bucket: StorageBucket,
  objectKey: string,
  bytes: Uint8Array,
  sha256: string,
): Promise<string> {
  const row = required(
    first(
      await db
        .insert(schema.storageObjects)
        .values({ bucket, objectKey, sizeBytes: bytes.byteLength, contentHash: sha256 })
        .returning({ id: schema.storageObjects.id }),
    ),
    'storage object',
  );
  return row.id;
}

/** Deletes bytes, then their registration only once the bytes are gone, so a failed delete stays findable. */
export async function discardStorageObject(
  db: Db,
  storage: Pick<BlobStore, 'deleteObject'>,
  bucket: StorageBucket,
  object: { readonly storageObjectId: string; readonly objectKey: string },
): Promise<void> {
  try {
    await storage.deleteObject(bucket, object.objectKey);
  } catch {
    return;
  }
  await db
    .delete(schema.storageObjects)
    .where(eq(schema.storageObjects.id, object.storageObjectId))
    .catch(() => undefined);
}
