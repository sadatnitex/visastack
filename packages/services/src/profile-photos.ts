import { createHash, randomUUID } from 'node:crypto';
import type { PermissionAction } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { eq, inArray } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { enqueueErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import type { MalwareScannerPort } from './intake';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import type { BlobStore } from './storage';
import {
  discardStorageObject as discardObject,
  registerStorageObject as registerObject,
} from './storage-objects';

/**
 * Profile photos for traveller records (WP-PH1, owner request 2026-10-25).
 *
 * A person's own photo is the photo on their own traveller record (the SELF
 * applicant), and a managed traveller's photo is on that traveller's record,
 * so every write here is decided by the central access gate: each function
 * takes an `AuthorizedApplicant` proof, and only the record's owner may use
 * one. An agency or person the record is shared with never sees the photo
 * (it is not part of any grant, share, pack or export), and it is never a
 * visa photo.
 *
 * Upload path, in order, with nothing attached to the record until every
 * step has passed:
 * 1. the declared type (JPEG or PNG; the browser converts everything else,
 *    including iPhone HEIC photos, to JPEG while cropping), the size (5 MB)
 *    and the file signature are checked;
 * 2. the bytes are written to quarantine, read back and verified, and
 *    safety-scanned with the same scanner port documents use;
 * 3. the scanned bytes are decoded and re-encoded on the server into a
 *    512 x 512 JPEG, which drops every piece of metadata (location, camera,
 *    dates) and anything else that is not the picture itself;
 * 4. the re-encoded copy is registered in `storage_objects` (the clean
 *    bucket, a `profile-photo-` key prefix) and written, then the record's
 *    photo row is switched to it in one transaction with its audit event.
 * The quarantined upload is deleted on every path.
 *
 * Removing or replacing a photo deletes its row and queues the old bytes in
 * the erasure outbox (erasure.ts) in the same transaction, so deletion is
 * durable and verified; the bytes are also deleted at once, best effort, so
 * in the normal case they are gone before the request returns. Account
 * deletion queues the photo with the account's other stored objects
 * (deletion.ts).
 */

export const PROFILE_PHOTO_MAX_INPUT_BYTES = 5 * 1024 * 1024;
/** What the server accepts. The browser crop step turns WebP, HEIC and anything else it can open into JPEG. */
export const PROFILE_PHOTO_INPUT_TYPES = ['image/jpeg', 'image/png'] as const;
export const PROFILE_PHOTO_SIZE = 512;
/** The same 40 megapixel ceiling the document content checks use, so a tiny file cannot expand into a huge image. */
export const PROFILE_PHOTO_MAX_INPUT_PIXELS = 40_000_000;
export const PROFILE_PHOTO_MAX_OUTPUT_BYTES = 1024 * 1024;
export const PROFILE_PHOTO_CONTENT_TYPE = 'image/jpeg';
export const PROFILE_PHOTO_KEY_PREFIX = 'profile-photo-';
const UPLOAD_KEY_PREFIX = 'profile-photo-upload-';
const VERSION_LENGTH = 16;

/** Decodes untrusted image bytes and returns a square, metadata-free JPEG. Throws when the bytes are not a readable image. */
export interface PhotoReencoderPort {
  readonly name: string;
  readonly version: string;
  reencode(input: {
    readonly bytes: Uint8Array;
    readonly size: number;
    readonly maxInputPixels: number;
  }): Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }>;
}

export interface ProfilePhotoPorts {
  readonly storage: BlobStore;
  readonly scanner: MalwareScannerPort;
  readonly reencoder: PhotoReencoderPort;
}

export interface ProfilePhotoInput {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface ProfilePhotoSummary {
  /** Changes whenever the photo changes; part of the photo address. */
  readonly version: string;
}

export interface ProfilePhotoBytes extends ProfilePhotoSummary {
  readonly bytes: Uint8Array;
  readonly contentType: typeof PROFILE_PHOTO_CONTENT_TYPE;
}

const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.byteLength >= prefix.length && prefix.every((value, i) => bytes[i] === value);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function versionOf(sha256: string): string {
  return sha256.slice(0, VERSION_LENGTH);
}

/** The photo's address inside the app. The version makes a replaced photo a new address. */
export function applicantPhotoPath(applicantId: string, version: string): string {
  return `/api/photos/applicant/${encodeURIComponent(applicantId)}?v=${encodeURIComponent(version)}`;
}

/**
 * The proof must be genuine, for this exact action, about the applicant
 * record itself, and held by its owner: a grant never reaches a photo.
 */
function ownerProblem(access: unknown, action: PermissionAction): ServiceError | undefined {
  if (!AuthorizedApplicant.isGenuine(access, action) || access.resource.kind !== 'applicant') {
    return serviceError('forbidden', 'access denied');
  }
  if (access.actor.kind !== 'applicant_owner') {
    return serviceError('forbidden', 'Only the owner of this profile can see or change its photo.');
  }
  return undefined;
}

function inputProblem(input: ProfilePhotoInput): ServiceError | undefined {
  if (!(PROFILE_PHOTO_INPUT_TYPES as readonly string[]).includes(input.contentType)) {
    return serviceError('invalid', 'Choose a JPEG or PNG photo.');
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > PROFILE_PHOTO_MAX_INPUT_BYTES) {
    return serviceError('invalid', 'Choose a photo smaller than 5 MB.');
  }
  const signature = input.contentType === 'image/png' ? PNG_SIGNATURE : JPEG_SIGNATURE;
  if (!startsWith(input.bytes, signature)) {
    return serviceError('invalid', 'This file is not the kind of photo it says it is.');
  }
  return undefined;
}

interface EncodedPhoto {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Steps 2 and 3: quarantine, verify, scan, re-encode. The quarantined copy is always deleted. */
async function scanAndReencode(
  db: Db,
  ports: ProfilePhotoPorts,
  input: ProfilePhotoInput,
): Promise<Result<EncodedPhoto, ServiceError>> {
  const objectKey = `${UPLOAD_KEY_PREFIX}${randomUUID()}`;
  const sha256 = sha256Hex(input.bytes);
  const storageObjectId = await registerObject(db, 'QUARANTINE', objectKey, input.bytes, sha256);
  try {
    await ports.storage.putObject({
      bucket: 'QUARANTINE',
      objectKey,
      contentType: input.contentType,
      bytes: input.bytes,
    });
    const stored = await ports.storage.getObject(objectKey);
    if (!stored || sha256Hex(stored.bytes) !== sha256) {
      return err(serviceError('invalid', 'The photo did not upload correctly. Please try again.'));
    }
    const scan = await ports.scanner.scan({ bucket: 'QUARANTINE', objectKey });
    if (!scan.safe) {
      return err(serviceError('invalid', 'This photo did not pass the safety check.'));
    }
    let encoded: EncodedPhoto;
    try {
      encoded = await ports.reencoder.reencode({
        bytes: stored.bytes,
        size: PROFILE_PHOTO_SIZE,
        maxInputPixels: PROFILE_PHOTO_MAX_INPUT_PIXELS,
      });
    } catch {
      return err(serviceError('invalid', 'This photo could not be read. Try a JPEG or PNG photo.'));
    }
    if (
      encoded.width !== PROFILE_PHOTO_SIZE ||
      encoded.height !== PROFILE_PHOTO_SIZE ||
      encoded.bytes.byteLength === 0 ||
      encoded.bytes.byteLength > PROFILE_PHOTO_MAX_OUTPUT_BYTES ||
      !startsWith(encoded.bytes, JPEG_SIGNATURE)
    ) {
      return err(serviceError('invalid', 'This photo could not be read. Try a JPEG or PNG photo.'));
    }
    return ok(encoded);
  } finally {
    await discardObject(db, ports.storage, 'QUARANTINE', { storageObjectId, objectKey });
  }
}

interface StoredPhoto {
  readonly storageObjectId: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Step 4, first half: register and write the re-encoded copy, then verify it reads back exactly. */
async function storeEncoded(
  db: Db,
  storage: BlobStore,
  encoded: EncodedPhoto,
): Promise<Result<StoredPhoto, ServiceError>> {
  const objectKey = `${PROFILE_PHOTO_KEY_PREFIX}${randomUUID()}`;
  const sha256 = sha256Hex(encoded.bytes);
  const storageObjectId = await registerObject(db, 'CLEAN', objectKey, encoded.bytes, sha256);
  const object = { storageObjectId, objectKey };
  try {
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey,
      contentType: PROFILE_PHOTO_CONTENT_TYPE,
      bytes: encoded.bytes,
    });
    const stored = await storage.getObject(objectKey);
    if (!stored || sha256Hex(stored.bytes) !== sha256) {
      await discardObject(db, storage, 'CLEAN', object);
      return err(serviceError('invalid', 'The photo did not save correctly. Please try again.'));
    }
  } catch (error) {
    await discardObject(db, storage, 'CLEAN', object);
    throw error;
  }
  return ok({ storageObjectId, objectKey, sha256, sizeBytes: encoded.bytes.byteLength });
}

interface CurrentPhoto {
  readonly storageObjectId: string;
  readonly objectKey: string;
  readonly contentSha256: string;
}

async function currentPhoto(db: Db, applicantId: string): Promise<CurrentPhoto | undefined> {
  return first(
    await db
      .select({
        storageObjectId: schema.applicantPhotos.storageObjectId,
        objectKey: schema.storageObjects.objectKey,
        contentSha256: schema.applicantPhotos.contentSha256,
      })
      .from(schema.applicantPhotos)
      .innerJoin(
        schema.storageObjects,
        eq(schema.storageObjects.id, schema.applicantPhotos.storageObjectId),
      )
      .where(eq(schema.applicantPhotos.applicantId, applicantId))
      .limit(1),
  );
}

/** Locks the applicant row first, the same order account deletion and the document paths take. */
async function lockApplicant(tx: Db, applicantId: string): Promise<void> {
  await tx
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, applicantId))
    .for('update');
}

async function queueErasure(tx: Db, applicantId: string, photo: CurrentPhoto): Promise<void> {
  await enqueueErasureJob(tx, {
    reason: 'PROFILE_PHOTO_REMOVAL',
    bucket: 'CLEAN',
    objectKey: photo.objectKey,
    expectedHash: photo.contentSha256,
    storageObjectId: photo.storageObjectId,
    applicantId,
  });
}

async function deleteNow(storage: BlobStore, photo: CurrentPhoto): Promise<void> {
  // The queued erasure job deletes again (idempotent) and verifies; this only makes the usual case immediate.
  await storage.deleteObject('CLEAN', photo.objectKey).catch(() => undefined);
}

/** Postgres "undefined_table": the photo table's migration has not run on this database yet. */
const UNDEFINED_TABLE = '42P01';

/** True when `error` (or anything it wraps) is Postgres saying a table does not exist. */
export function isMissingTableError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === UNDEFINED_TABLE) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs a read of the photo table and answers `fallback` when the table does
 * not exist yet. Application code goes live minutes before migration 0088
 * runs, so in that window a photo read means "no photo", never an error.
 * The read runs in its own transaction, which inside an outer transaction is
 * a savepoint: a missing table rolls back only the read, and the outer
 * transaction (account deletion, for example) stays usable.
 */
export async function readUnlessPhotoTableMissing<T>(
  db: Db,
  fallback: T,
  read: (tx: Db) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(read);
  } catch (error) {
    if (isMissingTableError(error)) return fallback;
    throw error;
  }
}

const PHOTOS_UNAVAILABLE = 'Photos are not available yet. Please try again later.';

async function changeAllowed(db: Db, ownerAccountId: string): Promise<ServiceError | undefined> {
  const allowed = await checkRateLimit(
    db,
    { subjectId: ownerAccountId, action: 'profile_photo.change', label: 'photo' },
    RATE_LIMITS.PROFILE_PHOTO_CHANGE,
  );
  return allowed.allowed
    ? undefined
    : serviceError('rate_limited', 'Too many photo changes in a short time. Try later.');
}

/** Add or replace the photo on a traveller record. Owner only. */
export async function setApplicantPhoto(
  access: AuthorizedApplicant<'MANAGE'>,
  ports: ProfilePhotoPorts,
  input: ProfilePhotoInput,
): Promise<Result<ProfilePhotoSummary, ServiceError>> {
  const denied = ownerProblem(access, 'MANAGE');
  if (denied) return err(denied);
  const invalid = inputProblem(input);
  if (invalid) return err(invalid);
  const db = access.tx;
  const applicantId = access.applicant.id;
  const ownerAccountId = access.applicant.ownerAccountId;

  // Before any storage work: refuse plainly while the photo table does not exist yet.
  const ready = await readUnlessPhotoTableMissing(db, false, async (tx) => {
    await currentPhoto(tx, applicantId);
    return true;
  });
  if (!ready) return err(serviceError('upstream_error', PHOTOS_UNAVAILABLE));
  const limited = await changeAllowed(db, ownerAccountId);
  if (limited) return err(limited);

  const encoded = await scanAndReencode(db, ports, input);
  if (!encoded.ok) return encoded;
  const stored = await storeEncoded(db, ports.storage, encoded.value);
  if (!stored.ok) return stored;
  const photo = stored.value;

  let previous: CurrentPhoto | undefined;
  try {
    previous = await db.transaction(async (tx) => {
      await lockApplicant(tx, applicantId);
      const existing = await currentPhoto(tx, applicantId);
      const now = new Date();
      await tx
        .insert(schema.applicantPhotos)
        .values({
          applicantId,
          storageObjectId: photo.storageObjectId,
          contentSha256: photo.sha256,
          sizeBytes: photo.sizeBytes,
        })
        .onConflictDoUpdate({
          target: schema.applicantPhotos.applicantId,
          set: {
            storageObjectId: photo.storageObjectId,
            contentSha256: photo.sha256,
            sizeBytes: photo.sizeBytes,
            updatedAt: now,
          },
        });
      if (existing) await queueErasure(tx, applicantId, existing);
      // No image data, key or hash in the audit trail: only what happened.
      await appendAuditEvent(tx, {
        eventType: 'PROFILE_PHOTO_SET',
        actorAccountId: ownerAccountId,
        action: 'MANAGE',
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId,
        resourceType: 'applicant_photo',
        resourceId: applicantId,
        metadata: {
          replaced: existing !== undefined,
          sizeBytes: photo.sizeBytes,
          width: encoded.value.width,
          height: encoded.value.height,
        },
      });
      return existing;
    });
  } catch (error) {
    await discardObject(db, ports.storage, 'CLEAN', photo);
    throw error;
  }
  if (previous) await deleteNow(ports.storage, previous);
  return ok({ version: versionOf(photo.sha256) });
}

/** Remove the photo from a traveller record. Owner only; a no-op success when there is none. */
export async function removeApplicantPhoto(
  access: AuthorizedApplicant<'MANAGE'>,
  storage: BlobStore,
): Promise<Result<{ readonly removed: boolean }, ServiceError>> {
  const denied = ownerProblem(access, 'MANAGE');
  if (denied) return err(denied);
  const applicantId = access.applicant.id;
  const limited = await changeAllowed(access.tx, access.applicant.ownerAccountId);
  if (limited) return err(limited);
  // With no photo table yet there is no photo to remove.
  const removed = await readUnlessPhotoTableMissing(access.tx, undefined, async (tx) => {
    await lockApplicant(tx, applicantId);
    const existing = await currentPhoto(tx, applicantId);
    if (!existing) return undefined;
    await tx
      .delete(schema.applicantPhotos)
      .where(eq(schema.applicantPhotos.applicantId, applicantId));
    await queueErasure(tx, applicantId, existing);
    await appendAuditEvent(tx, {
      eventType: 'PROFILE_PHOTO_REMOVED',
      actorAccountId: access.applicant.ownerAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'applicant_photo',
      resourceId: applicantId,
    });
    return existing;
  });
  if (removed) await deleteNow(storage, removed);
  return ok({ removed: removed !== undefined });
}

/** The current photo's version, or null when the record has none. Owner only. */
export async function getApplicantPhotoVersion(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<string | null, ServiceError>> {
  const denied = ownerProblem(access, 'VIEW_METADATA');
  if (denied) return err(denied);
  const versions = await listApplicantPhotoVersions(access);
  if (!versions.ok) return versions;
  return ok(versions.value.get(access.applicant.id) ?? null);
}

/**
 * Current photo versions for several traveller records in one read, keyed by
 * applicant id; a record without a photo is absent. Every proof must be the
 * owner's own (the first is required, so at least one proof is always given).
 */
export async function listApplicantPhotoVersions(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  ...more: readonly AuthorizedApplicant<'VIEW_METADATA'>[]
): Promise<Result<ReadonlyMap<string, string>, ServiceError>> {
  const proofs = [access, ...more];
  for (const proof of proofs) {
    const denied = ownerProblem(proof, 'VIEW_METADATA');
    if (denied) return err(denied);
  }
  const ids = [...new Set(proofs.map((proof) => proof.applicant.id))];
  const rows = await readUnlessPhotoTableMissing(access.tx, [], (tx) =>
    tx
      .select({
        applicantId: schema.applicantPhotos.applicantId,
        contentSha256: schema.applicantPhotos.contentSha256,
      })
      .from(schema.applicantPhotos)
      .where(inArray(schema.applicantPhotos.applicantId, ids)),
  );
  return ok(new Map(rows.map((row) => [row.applicantId, versionOf(row.contentSha256)])));
}

/**
 * The photo's bytes for the photo route. Owner only. Served only if the
 * stored bytes still match the recorded hash and are a JPEG, so whatever is
 * returned is exactly what the re-encoder produced.
 */
export async function readApplicantPhoto(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  storage: Pick<BlobStore, 'getObject'>,
): Promise<Result<ProfilePhotoBytes, ServiceError>> {
  const denied = ownerProblem(access, 'VIEW_METADATA');
  if (denied) return err(denied);
  const photo = await readUnlessPhotoTableMissing(access.tx, undefined, (tx) =>
    currentPhoto(tx, access.applicant.id),
  );
  if (!photo) return err(serviceError('not_found', 'no photo'));
  const stored = await storage.getObject(photo.objectKey);
  if (
    !stored ||
    sha256Hex(stored.bytes) !== photo.contentSha256 ||
    !startsWith(stored.bytes, JPEG_SIGNATURE)
  ) {
    return err(serviceError('not_found', 'no photo'));
  }
  return ok({
    bytes: stored.bytes,
    contentType: PROFILE_PHOTO_CONTENT_TYPE,
    version: versionOf(photo.contentSha256),
  });
}

/** True when `bytes` are a JPEG whose SHA-256 is `sha256`: the check every reader of stored photo bytes makes. */
export function isIntactPhoto(bytes: Uint8Array, sha256: string): boolean {
  return sha256Hex(bytes) === sha256 && startsWith(bytes, JPEG_SIGNATURE);
}
