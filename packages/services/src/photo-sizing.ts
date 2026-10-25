import { type Result, err, ok } from '@visastack/core';
import {
  type CropBox,
  type CropInput,
  type PhotoFinding,
  type PhotoMeasurements,
  type PhotoSpec,
  getPhotoSpec,
  photoFindings,
} from '@visastack/core/photo-specs';
import { desc, eq } from 'drizzle-orm';
import { AuthorizedApplicant, EACH_GRANT } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { hasActiveOrVerifiedErasureJob } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';
import type { BlobStore } from './storage';

/**
 * Visa photo sizes (owner request 2026-10-25). A traveller's passport photo is an ordinary document
 * of the Photograph kind, uploaded, scanned and shared like any other. These two functions read it
 * for the "Visa Photo Sizes" section:
 *
 * - `checkVisaPhoto` measures it (advisory checks in plain words) and returns a small preview for the
 *   crop control, only when the person opens the section.
 * - `produceVisaPhotoSize` makes a JPEG at one published size.
 *
 * Both need a DOWNLOAD_REDACTED proof (shown to people as "Download Safe Copies", owner decision
 * 2026-10-25): the result is a processed copy with every piece of hidden data removed, never the
 * stored original bytes. The owner always holds it; a person or agency holds it only through a grant
 * that includes safe copies, so a viewer who may only preview never sees the sizes or their preview.
 * Each has its own rate-limit bucket, so opening the section never uses up downloads.
 *
 * Both take a proof from the central access gate (`requireAccess`), so who may do this, and when a
 * fresh identity check is needed (a restricted document), is decided exactly as for any other
 * preview or download. Both refuse a version that is not yet safe to serve, and both write one
 * DOCUMENT_ACCESS audit event that names what was produced and never holds image data. Nothing is
 * stored: every size is made on request.
 */

/** The image work, implemented with sharp in packages/adapters/src/photo-sizer.ts. */
export interface PhotoSizerPort {
  measure(bytes: Uint8Array): Promise<PhotoMeasurements>;
  preview(bytes: Uint8Array): Promise<PhotoPreview>;
  produce(bytes: Uint8Array, spec: PhotoSpec, crop: CropInput): Promise<SizedPhoto>;
}

export interface PhotoPreview {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface SizedPhoto {
  readonly bytes: Uint8Array;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi: number;
  readonly quality: number;
  readonly cropBox: CropBox;
  /** False when the published file size range could not be met; the person is told. */
  readonly withinFileSizeRange: boolean;
}

export interface PhotoSizingDeps {
  readonly storage: Pick<BlobStore, 'getObject'>;
  readonly sizer: PhotoSizerPort;
}

/** Stored file types the sizer reads. Uploads accept only these two image types. */
const SIZEABLE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

/**
 * Stored kinds that mean a passport or visa photo: the catalogue's Photograph key (PHOTO, what the
 * kind list stores) and the aliases that name a passport or visa photo. Deliberately not every
 * alias of PHOTO: PHOTO_ID can name a scan of an identity card, which must never be offered as a
 * visa photo.
 */
const PASSPORT_PHOTO_TYPES: ReadonlySet<string> = new Set([
  'PHOTO',
  'PHOTOGRAPH',
  'PASSPORT_PHOTO',
  'VISA_PHOTO',
  'PHOTO_PASSPORT',
  'PHOTO_VISA',
]);

/** True for a document of the Photograph kind itself (see `PASSPORT_PHOTO_TYPES`). */
export function isPassportPhotoType(docType: string | null | undefined): boolean {
  if (!docType) return false;
  return PASSPORT_PHOTO_TYPES.has(docType.trim().toUpperCase());
}

/** The one permission both functions need: a safe copy, never the original. */
type PhotoAction = 'DOWNLOAD_REDACTED';

/** Separate buckets: checking a photo never uses up its downloads. */
const BUCKETS = {
  check: { action: 'photo_check', label: 'photo check', config: RATE_LIMITS.PHOTO_CHECK },
  size: { action: 'photo_size', label: 'photo size', config: RATE_LIMITS.PHOTO_SIZE },
} as const;

function auditActor(access: AuthorizedApplicant<PhotoAction>): {
  readonly actorAccountId: string | null;
  readonly actorRole: string;
  readonly subjectAccountId: string;
} {
  const actor = access.actor;
  switch (actor.kind) {
    case 'applicant_owner':
      return {
        actorAccountId: null,
        actorRole: 'applicant_owner',
        subjectAccountId: access.applicant.ownerAccountId,
      };
    case 'organization_member':
      return {
        actorAccountId: actor.accountId,
        actorRole: `org:${actor.membership.role}`,
        subjectAccountId: actor.accountId,
      };
    case 'individual_recipient':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'individual_recipient',
        subjectAccountId: actor.accountId,
      };
    case 'support_admin':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'support_admin',
        subjectAccountId: actor.accountId,
      };
    case 'contributor':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'contributor',
        subjectAccountId: actor.accountId,
      };
  }
}

function purposeText(access: AuthorizedApplicant<PhotoAction>): string {
  if (access.actor.kind === 'applicant_owner') return 'owner_photo_sizes';
  return access.purpose === EACH_GRANT ? 'shared_photo_sizes' : access.purpose;
}

/** One DOCUMENT_ACCESS event: what was asked for and the outcome, never image data. */
async function writePhotoAudit(
  access: AuthorizedApplicant<PhotoAction>,
  event: {
    readonly documentId: string;
    readonly applicantId: string;
    readonly allowed: boolean;
    readonly reason: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const who = auditActor(access);
  await access.tx.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_ACCESS',
      actorAccountId: who.actorAccountId,
      actorRole: who.actorRole,
      action: 'DOWNLOAD_REDACTED',
      result: event.allowed ? 'ALLOWED' : 'DENIED',
      method: 'API',
      applicantId: event.applicantId,
      resourceType: 'document',
      resourceId: event.documentId,
      reason: event.reason,
      metadata: { ...event.metadata, purpose: purposeText(access) },
    });
  });
}

interface LoadedPhoto {
  readonly documentId: string;
  readonly applicantId: string;
  readonly bytes: Uint8Array;
}

/**
 * Shared checks for both functions: a genuine proof for `action` on one document of the Photograph
 * kind, within the rate limit, whose latest version is safe to serve and is a JPEG or PNG. A refusal
 * after the gate allowed the request is audited as DENIED with its reason, like `accessDocument`.
 */
async function loadPhoto(
  access: AuthorizedApplicant<PhotoAction>,
  bucket: keyof typeof BUCKETS,
  deps: PhotoSizingDeps,
  metadata: Readonly<Record<string, unknown>>,
): Promise<Result<LoadedPhoto, ServiceError>> {
  const action: PhotoAction = 'DOWNLOAD_REDACTED';
  if (!AuthorizedApplicant.isGenuine(access, action) || access.resource.kind !== 'document') {
    return err(serviceError('forbidden', 'access denied'));
  }
  const document = access.resource.document;
  if (!isPassportPhotoType(document.docType)) {
    return err(
      serviceError('invalid', 'sizes are made only from a document of the Photograph kind'),
    );
  }
  const db: Db = access.tx;
  const who = auditActor(access);

  const { action: bucketAction, label, config } = BUCKETS[bucket];
  const limit = await checkRateLimit(
    db,
    { subjectId: who.subjectAccountId, action: bucketAction, label },
    config,
  );
  if (!limit.allowed) return err(serviceError('rate_limited', limit.reason));

  const audit = (allowed: boolean, reason: string | null): Promise<void> =>
    writePhotoAudit(access, {
      documentId: document.id,
      applicantId: document.applicantId,
      allowed,
      reason,
      metadata,
    });

  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, document.id))
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
  const erased = version ? await hasActiveOrVerifiedErasureJob(db, version.storageObjectId) : false;
  const servable =
    version !== undefined &&
    isDocumentVersionUsable({
      safetyStatus: version.safetyStatus,
      processingStatus: version.processingStatus,
      erased,
    });
  if (!version || !servable) {
    await audit(
      false,
      !version ? 'no_stored_version' : erased ? 'bytes_already_erased' : 'not_yet_safe_to_serve',
    );
    return err(serviceError('forbidden', 'this photo is not available yet'));
  }
  const storageObject = first(
    await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, version.storageObjectId))
      .limit(1),
  );
  const stored = storageObject ? await deps.storage.getObject(storageObject.objectKey) : undefined;
  if (!stored) {
    await audit(false, 'stored_object_missing');
    return err(serviceError('not_found', 'the stored photo is missing'));
  }
  if (!SIZEABLE_TYPES.has(stored.contentType)) {
    await audit(false, 'not_a_sizeable_image');
    return err(serviceError('invalid', 'only a JPEG or PNG photo can be sized'));
  }
  return ok({ documentId: document.id, applicantId: document.applicantId, bytes: stored.bytes });
}

/** A photo that passed every check but could not be decoded: audited DENIED, like accessDocument. */
async function refuseUnreadable(
  access: AuthorizedApplicant<PhotoAction>,
  loaded: LoadedPhoto,
  metadata: Readonly<Record<string, unknown>>,
): Promise<Result<never, ServiceError>> {
  await writePhotoAudit(access, {
    documentId: loaded.documentId,
    applicantId: loaded.applicantId,
    allowed: false,
    reason: 'image_unreadable',
    metadata,
  });
  return err(serviceError('invalid', 'this photo could not be read'));
}

const CHECK_METADATA = Object.freeze({ variant: 'photo_check', disposition: 'preview' });

export interface VisaPhotoCheck {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly findings: readonly PhotoFinding[];
  readonly preview: PhotoPreview;
}

/**
 * Advisory checks and a small preview of a Photograph document. Never blocks anything and never
 * claims the photo will be accepted.
 */
export async function checkVisaPhoto(
  access: AuthorizedApplicant<'DOWNLOAD_REDACTED'>,
  deps: PhotoSizingDeps,
): Promise<Result<VisaPhotoCheck, ServiceError>> {
  const loaded = await loadPhoto(access, 'check', deps, CHECK_METADATA);
  if (!loaded.ok) return loaded;
  let measurements: PhotoMeasurements;
  let preview: PhotoPreview;
  try {
    [measurements, preview] = await Promise.all([
      deps.sizer.measure(loaded.value.bytes),
      deps.sizer.preview(loaded.value.bytes),
    ]);
  } catch {
    return refuseUnreadable(access, loaded.value, CHECK_METADATA);
  }
  await writePhotoAudit(access, {
    documentId: loaded.value.documentId,
    applicantId: loaded.value.applicantId,
    allowed: true,
    reason: null,
    metadata: CHECK_METADATA,
  });
  return ok({
    sourceWidth: measurements.width,
    sourceHeight: measurements.height,
    findings: photoFindings(measurements),
    preview,
  });
}

export interface ProduceVisaPhotoInput {
  readonly specId: string;
  readonly crop: CropInput;
}

export interface ProducedVisaPhoto {
  readonly spec: PhotoSpec;
  readonly photo: SizedPhoto;
  /** A plain name that never carries the stored file name. */
  readonly filename: string;
}

/** A JPEG of a Photograph document at one published size, made on request and never stored. */
export async function produceVisaPhotoSize(
  access: AuthorizedApplicant<'DOWNLOAD_REDACTED'>,
  deps: PhotoSizingDeps,
  input: ProduceVisaPhotoInput,
): Promise<Result<ProducedVisaPhoto, ServiceError>> {
  const spec = getPhotoSpec(input.specId);
  if (!spec) return err(serviceError('invalid', 'choose one of the listed sizes'));
  const requested = { variant: 'photo_size', disposition: 'download', photoSpecId: spec.id };
  const loaded = await loadPhoto(access, 'size', deps, requested);
  if (!loaded.ok) return loaded;
  let photo: SizedPhoto;
  try {
    photo = await deps.sizer.produce(loaded.value.bytes, spec, input.crop);
  } catch {
    return refuseUnreadable(access, loaded.value, requested);
  }
  await writePhotoAudit(access, {
    documentId: loaded.value.documentId,
    applicantId: loaded.value.applicantId,
    allowed: true,
    reason: null,
    metadata: { ...requested, widthPx: photo.widthPx, heightPx: photo.heightPx, dpi: photo.dpi },
  });
  return ok({ spec, photo, filename: `visa-photo-${spec.id}.jpg` });
}
