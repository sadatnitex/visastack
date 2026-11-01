import { createHash } from 'node:crypto';
import { type PermissionAction, type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { AuthorizedApplicant, EACH_GRANT } from './access/require-access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { hasActiveOrVerifiedErasureJob } from './erasure';
import { lifecycleTablesPresent, presentDocumentCondition } from './lifecycle/foundation';
import type { StoredBytes } from './storage';

/**
 * Shared steps for the services that make something from one document on request, through a
 * proof from the access gate (Visa Photo Sizes in photo-sizing.ts, safe copies in redaction.ts):
 * who to record, the purpose to record, one DOCUMENT_ACCESS audit event that never holds image
 * data, and the document's latest version only when it is safe to use.
 */

export type DocumentProof = AuthorizedApplicant<PermissionAction>;

export interface DocumentAuditActor {
  readonly actorAccountId: string | null;
  readonly actorRole: string;
  /** The account a rate limit is counted against. */
  readonly subjectAccountId: string;
}

/** Who acted, for the audit trail and rate limits. The owner is recorded by role. */
export function documentAuditActor(proof: DocumentProof): DocumentAuditActor {
  const actor = proof.actor;
  switch (actor.kind) {
    case 'applicant_owner':
      return {
        actorAccountId: null,
        actorRole: 'applicant_owner',
        subjectAccountId: proof.applicant.ownerAccountId,
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

export interface DocumentPurposes {
  /** Recorded when the record owner acts. */
  readonly owner: string;
  /** Recorded when someone acts through every grant judged on its own purpose. */
  readonly shared: string;
}

/** The purpose recorded: the owner's, the shared one, or the grant purpose the caller named. */
export function documentAccessPurpose(proof: DocumentProof, purposes: DocumentPurposes): string {
  if (proof.actor.kind === 'applicant_owner') return purposes.owner;
  return proof.purpose === EACH_GRANT ? purposes.shared : proof.purpose;
}

export interface DocumentAccessEvent {
  readonly documentId: string;
  readonly applicantId: string;
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly purposes: DocumentPurposes;
}

/**
 * One DOCUMENT_ACCESS event for the proof's action: what was asked for and the outcome. `db`, when
 * given, is where it is written instead of the proof's own transaction: for a refusal recorded
 * after the savepoint the proof was made in was undone (S20).
 */
export async function writeDocumentAccessAudit(
  proof: DocumentProof,
  event: DocumentAccessEvent,
  db: Db = proof.tx,
): Promise<void> {
  const who = documentAuditActor(proof);
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_ACCESS',
      actorAccountId: who.actorAccountId,
      actorRole: who.actorRole,
      action: proof.action,
      result: event.allowed ? 'ALLOWED' : 'DENIED',
      method: 'API',
      applicantId: event.applicantId,
      resourceType: 'document',
      resourceId: event.documentId,
      reason: event.reason,
      metadata: { ...event.metadata, purpose: documentAccessPurpose(proof, event.purposes) },
    });
  });
}

type VersionRow = typeof schema.documentVersions.$inferSelect;

export type LatestUsableVersion =
  | { readonly kind: 'usable'; readonly version: VersionRow }
  | {
      readonly kind: 'refused';
      readonly reason: 'no_stored_version' | 'bytes_already_erased' | 'not_yet_safe_to_serve';
    };

/**
 * The latest version of the proof's document, only when it is safe to use: scanned clean, in a
 * servable state, and not being or already erased. An older version is never offered instead.
 */
export async function latestUsableVersion(proof: DocumentProof): Promise<LatestUsableVersion> {
  if (proof.resource.kind !== 'document') return { kind: 'refused', reason: 'no_stored_version' };
  const db = proof.tx;
  // Every byte path (Safe Copy, AI original file, photo sizing) comes through here: a document in
  // Recently Deleted or being removed answers like one with no file (presentDocumentCondition,
  // LC-A2). The proof loaded the record whatever its lifecycle state; an archived one stays usable.
  if (await lifecycleTablesPresent(db)) {
    const present = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.id, proof.resource.document.id), presentDocumentCondition()))
      .limit(1);
    if (present.length === 0) return { kind: 'refused', reason: 'no_stored_version' };
  }
  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, proof.resource.document.id))
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
  if (!version) return { kind: 'refused', reason: 'no_stored_version' };
  const erased = await hasActiveOrVerifiedErasureJob(db, version.storageObjectId);
  if (erased) return { kind: 'refused', reason: 'bytes_already_erased' };
  const usable = isDocumentVersionUsable({
    safetyStatus: version.safetyStatus,
    processingStatus: version.processingStatus,
    erased,
  });
  return usable
    ? { kind: 'usable', version }
    : { kind: 'refused', reason: 'not_yet_safe_to_serve' };
}

// --- The original file, read whole for an AI app (S20) -----------------------------------------

/** The file types an original is given as: what the uploader accepts as images and PDFs. */
const ORIGINAL_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type OriginalFileType = (typeof ORIGINAL_FILE_TYPES)[number];

/** The first bytes each type must start with, so a mislabelled file is never passed on as one. */
const SIGNATURES: Readonly<Record<OriginalFileType, readonly number[]>> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

function isOriginalFileType(value: string): value is OriginalFileType {
  return (ORIGINAL_FILE_TYPES as readonly string[]).includes(value);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export interface OriginalDocumentFile {
  readonly bytes: Uint8Array;
  readonly contentType: OriginalFileType;
  readonly sizeBytes: number;
}

/**
 * Why an original was not given: its latest version is not safe to use yet (`not_ready`), it is
 * larger than the caller's limit (`too_large`, refused before a byte is read when its size is
 * recorded), it is not a PDF, PNG or JPEG (`unsupported`), or it has no recorded size or hash,
 * or what was read is missing or does not match what was stored (`unreadable`).
 */
export type OriginalFileRefusal = 'not_ready' | 'too_large' | 'unsupported' | 'unreadable';

/** The purpose a DOCUMENT_ACCESS event records for an original given to an AI app. */
const AI_ORIGINAL_PURPOSES: DocumentPurposes = Object.freeze({
  owner: 'ai_connection_original',
  shared: 'ai_connection_original',
});

/**
 * The bytes of the proof's document's latest usable version, for an AI app the owner allowed to
 * receive the Original (S20). Needs a genuine `DOWNLOAD_ORIGINAL` proof for the owner, which the
 * access gate gives only with a fresh identity check. Never an older version, never a file whose
 * scan is not clean, never more than `maxBytes`, and only a PDF, PNG or JPEG whose bytes match
 * its stored hash and its type. One DOCUMENT_ACCESS event either way, with the outcome, the type
 * and the size only: never the bytes, the file name, the hash or the storage key.
 */
export async function readOriginalDocumentFile(
  proof: AuthorizedApplicant<'DOWNLOAD_ORIGINAL'>,
  deps: { readonly storage: { getObject(objectKey: string): Promise<StoredBytes | undefined> } },
  maxBytes: number,
): Promise<Result<OriginalDocumentFile, OriginalFileRefusal>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'DOWNLOAD_ORIGINAL') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'document' ||
    proof.resource.document.applicantId !== proof.applicant.id
  ) {
    return err('unreadable');
  }
  const document = proof.resource.document;
  const requested = { variant: 'original', disposition: 'ai_file' };
  const refuse = async (
    reason: string,
    refusal: OriginalFileRefusal,
  ): Promise<Result<never, OriginalFileRefusal>> => {
    await writeDocumentAccessAudit(proof, {
      documentId: document.id,
      applicantId: document.applicantId,
      allowed: false,
      reason,
      metadata: requested,
      purposes: AI_ORIGINAL_PURPOSES,
    });
    return err(refusal);
  };
  const latest = await latestUsableVersion(proof);
  if (latest.kind !== 'usable') return refuse(latest.reason, 'not_ready');
  const version = latest.version;
  const storageObject = first(
    await proof.tx
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, version.storageObjectId))
      .limit(1),
  );
  if (!storageObject) return refuse('stored_object_missing', 'unreadable');
  // Nothing is read without a recorded size and a recorded hash to check it against.
  const expected = version.sha256 ?? storageObject.contentHash;
  if (expected === null) return refuse('hash_unknown', 'unreadable');
  if (version.sizeBytes === null && storageObject.sizeBytes === null) {
    return refuse('size_unknown', 'unreadable');
  }
  // Refused unread when the recorded size is already too large.
  if (
    (version.sizeBytes !== null && version.sizeBytes > maxBytes) ||
    (storageObject.sizeBytes !== null && storageObject.sizeBytes > maxBytes)
  ) {
    return refuse('too_large', 'too_large');
  }
  const stored = await deps.storage.getObject(storageObject.objectKey);
  if (!stored) return refuse('stored_object_missing', 'unreadable');
  if (stored.bytes.byteLength > maxBytes) return refuse('too_large', 'too_large');
  const hash = createHash('sha256').update(stored.bytes).digest('hex');
  if (expected !== hash) return refuse('hash_mismatch', 'unreadable');
  const contentType = stored.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!isOriginalFileType(contentType) || !startsWith(stored.bytes, SIGNATURES[contentType])) {
    return refuse('unsupported_type', 'unsupported');
  }
  await writeDocumentAccessAudit(proof, {
    documentId: document.id,
    applicantId: document.applicantId,
    allowed: true,
    reason: null,
    metadata: {
      ...requested,
      outputType: contentType === 'application/pdf' ? 'pdf' : contentType.slice('image/'.length),
      sizeBytes: stored.bytes.byteLength,
    },
    purposes: AI_ORIGINAL_PURPOSES,
  });
  return ok({ bytes: stored.bytes, contentType, sizeBytes: stored.bytes.byteLength });
}
