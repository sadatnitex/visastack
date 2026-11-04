/**
 * UMPE step 3: Also Keep a Copy for Another Person.
 *
 * Some documents belong to two people at once: a marriage certificate sits in both spouses' files,
 * a joint account statement in both account holders'. The owner of both records can keep a copy of
 * such a document under the other person with one choice.
 *
 * It is a separate copy, never a shared file: the bytes are stored again under their own key and
 * registered as a new document for the other person, so removing one never touches the other, and
 * each person's quota and rules apply to their own copy. The copy enters the normal pipeline like
 * any new file (safety check, reading when it is on). Nothing is read from the file here.
 *
 * Owner only, for two records of the same account, each through its own MANAGE proof. Another
 * account, an agency and a companion are never offered it.
 */

import { createHash } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { registerDocumentWithVersion } from './documents';
import { type ServiceError, serviceError } from './errors';
import { enqueueIntakeJob } from './jobs';
import {
  everydayDocumentCondition,
  lifecycleTablesPresent,
  presentApplicantCondition,
} from './lifecycle/foundation';
import { type UploadQuotaConfig, loadUploadQuotaConfig } from './quotas';
import type { BlobStore } from './storage';
import { failUpload, finalizeUpload, reserveUpload } from './uploads';

/**
 * The kinds of document that belong to two or more people, so a copy under another person is
 * natural: a marriage certificate, a joint account statement and a family register. Anything else
 * (a passport, an identity card, a bank statement in one name) belongs to one person only.
 */
export const SHARED_BETWEEN_PEOPLE_KINDS: readonly string[] = [
  'MARRIAGE_CERTIFICATE',
  'JOINT_ACCOUNT_STATEMENT',
  'FAMILY_REGISTER',
];

export function isSharedBetweenPeopleKind(kind: string | null | undefined): boolean {
  return typeof kind === 'string' && SHARED_BETWEEN_PEOPLE_KINDS.includes(kind);
}

export interface CopyPerson {
  readonly applicantId: string;
  readonly displayName: string;
}

type OwnerProof = AuthorizedApplicant<'MANAGE'>;

/** The account's own proof only: a copy is the owner's act, never an agency's or a companion's. */
function ownerOf(proof: unknown, action: 'MANAGE' | 'VIEW_METADATA'): string | null {
  if (!AuthorizedApplicant.isGenuine(proof, action)) return null;
  if (proof.actor.kind !== 'applicant_owner') return null;
  return proof.applicant.ownerAccountId;
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * The other people this account keeps records for, to offer a copy to. Empty for anyone but the
 * record's own owner. Never includes the record the proof is for.
 */
export async function listCopyPeople(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<readonly CopyPerson[]> {
  const owner = ownerOf(proof, 'VIEW_METADATA');
  if (!owner) return [];
  const db = proof.tx;
  const lifecycle = await lifecycleTablesPresent(db);
  const applicants = schema.applicants;
  return db
    .select({ applicantId: applicants.id, displayName: applicants.displayName })
    .from(applicants)
    .where(
      and(
        eq(applicants.ownerAccountId, owner),
        ne(applicants.id, proof.applicant.id),
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .orderBy(applicants.createdAt);
}

export interface CopiedDocument {
  readonly documentId: string;
  readonly title: string | null;
}

const NOT_FOUND = serviceError('not_found', 'We could not find this document.');

/** Carries a refusal out of the registering transaction, so everything in it rolls back. */
class CopyRefused extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

/** Whether `applicantId` already holds a document in use whose stored file has this fingerprint. */
async function alreadyHolds(db: Db, applicantId: string, contentHash: string): Promise<boolean> {
  const documents = schema.documents;
  const versions = schema.documentVersions;
  const objects = schema.storageObjects;
  const row = first(
    await db
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(versions, eq(versions.documentId, documents.id))
      .innerJoin(objects, eq(objects.id, versions.storageObjectId))
      .where(
        and(
          eq(documents.applicantId, applicantId),
          eq(objects.contentHash, contentHash),
          (await lifecycleTablesPresent(db)) ? everydayDocumentCondition() : undefined,
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/**
 * Keeps a copy of one of `sourceProof`'s documents under the person `targetProof` is for. Both
 * proofs must be the account's own MANAGE proofs for two different records of the same account.
 * Only a document of a kind that belongs to two people, safe to open, is copied; a person who
 * already holds the same file is told so and gets nothing twice.
 */
export async function copyDocumentToPerson(
  sourceProof: OwnerProof,
  targetProof: OwnerProof,
  deps: { readonly storage: BlobStore; readonly quotaConfig?: UploadQuotaConfig },
  input: { readonly documentId: string },
): Promise<Result<CopiedDocument, ServiceError>> {
  const owner = ownerOf(sourceProof, 'MANAGE');
  const targetOwner = ownerOf(targetProof, 'MANAGE');
  if (!owner || !targetOwner || owner !== targetOwner) {
    return err(serviceError('forbidden', 'You can keep a copy only between your own people.'));
  }
  const sourceId = sourceProof.applicant.id;
  const targetId = targetProof.applicant.id;
  if (sourceId === targetId) {
    return err(serviceError('invalid', 'Choose a different person for the copy.'));
  }
  const db = sourceProof.tx;
  const documents = schema.documents;

  // Both records must be people in use on this account (not removed, not in Recently Deleted).
  const people = await db
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(
      and(
        inArray(schema.applicants.id, [sourceId, targetId]),
        eq(schema.applicants.ownerAccountId, owner),
        (await lifecycleTablesPresent(db)) ? presentApplicantCondition() : undefined,
      ),
    );
  if (people.length !== 2) return err(serviceError('not_found', 'We could not find that person.'));

  const source = first(
    await db
      .select({
        id: documents.id,
        docType: documents.docType,
        subject: documents.subject,
        originalName: documents.originalName,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, input.documentId),
          eq(documents.applicantId, sourceId),
          (await lifecycleTablesPresent(db)) ? everydayDocumentCondition() : undefined,
        ),
      ),
  );
  if (!source) return err(NOT_FOUND);
  if (!isSharedBetweenPeopleKind(source.docType)) {
    return err(
      serviceError(
        'invalid',
        'A copy for another person is kept only for a document that belongs to two people, such as a marriage certificate.',
      ),
    );
  }

  const versions = schema.documentVersions;
  const objects = schema.storageObjects;
  const latest = first(
    await db
      .select({
        versionId: versions.id,
        safetyStatus: versions.safetyStatus,
        objectKey: objects.objectKey,
        contentHash: objects.contentHash,
        sizeBytes: objects.sizeBytes,
      })
      .from(versions)
      .innerJoin(objects, eq(objects.id, versions.storageObjectId))
      .where(eq(versions.documentId, source.id))
      .orderBy(desc(versions.versionNumber))
      .limit(1),
  );
  if (!latest) return err(NOT_FOUND);
  if (latest.safetyStatus !== 'CLEAN') {
    return err(
      serviceError(
        'invalid',
        'This document is still being checked for safety. Try again in a moment.',
      ),
    );
  }

  // The other person may already hold this very file: one copy each, never two. Checked again
  // under a lock just before the copy is registered, so two at once cannot both get through.
  const ALREADY = serviceError(
    'invalid',
    `${targetProof.applicant.displayName} already has this document.`,
  );
  if (latest.contentHash && (await alreadyHolds(db, targetId, latest.contentHash))) {
    return err(ALREADY);
  }

  const stored = await deps.storage.getObject(latest.objectKey);
  if (!stored) {
    return err(
      serviceError(
        'upstream_error',
        'We could not read this document just now. Try again in a minute.',
      ),
    );
  }
  const hash = sha256Of(stored.bytes);
  if (
    (latest.contentHash && latest.contentHash !== hash) ||
    (latest.sizeBytes !== null && latest.sizeBytes !== stored.bytes.byteLength)
  ) {
    return err(
      serviceError(
        'upstream_error',
        'This document could not be checked against what was stored, so no copy was made.',
      ),
    );
  }

  const reservation = await reserveUpload(
    db,
    { accountId: owner, applicantId: targetId, sizeBytes: stored.bytes.byteLength },
    deps.quotaConfig ?? loadUploadQuotaConfig(),
  );
  if (!reservation.ok) return err(reservation.error);
  const intent = reservation.value;
  const discard = async (reason: string) => {
    await deps.storage.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
    await failUpload(db, intent.id, reason);
  };

  // Everything up to the end of the transaction below can still be undone: the bytes are removed
  // and the reservation let go. After it commits the new document exists and its bytes are never
  // deleted again, whatever happens next.
  let version: { readonly id: string; readonly documentId: string };
  let title: string | null;
  try {
    await deps.storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: intent.objectKey,
      contentType: stored.contentType,
      bytes: stored.bytes,
    });
    const check = deps.storage.getPendingUpload
      ? await deps.storage.getPendingUpload(intent.objectKey)
      : await deps.storage.getObject(intent.objectKey);
    if (!check || sha256Of(check.bytes) !== hash) {
      await discard('copy failed verification immediately after write');
      return err(
        serviceError('upstream_error', 'The copy could not be stored. Try again in a minute.'),
      );
    }
    const created = await db.transaction(async (tx: Db) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`copy:${targetId}:${hash}`}))`);
      if (await alreadyHolds(tx, targetId, hash)) throw new CopyRefused(ALREADY);
      const registered = await registerDocumentWithVersion(tx, {
        actorAccountId: owner,
        applicantId: targetId,
        originalName: source.originalName,
        automaticTitle: true,
        source: 'UPLOAD',
        ...(source.docType ? { docType: source.docType } : {}),
        ...(source.subject ? { subject: source.subject } : {}),
        bucket: 'QUARANTINE',
        objectKey: intent.objectKey,
        sizeBytes: stored.bytes.byteLength,
        sha256: hash,
      });
      if (!registered.ok) throw new CopyRefused(registered.error);
      // The copy goes through the same pipeline as any new file.
      await enqueueIntakeJob(tx, { documentVersionId: registered.value.version.id });
      await appendAuditEvent(tx, {
        eventType: 'DOCUMENT_COPIED_TO_PERSON',
        actorAccountId: owner,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId: targetId,
        resourceType: 'document',
        resourceId: registered.value.version.documentId,
        metadata: { fromApplicantId: sourceId, fromDocumentId: source.id, kind: source.docType },
      });
      return registered.value;
    });
    version = created.version;
    title = created.document.approvedName;
  } catch (error) {
    await discard(error instanceof Error ? error.message : 'copy failed');
    if (error instanceof CopyRefused) return err(error.serviceError);
    return err(
      serviceError('upstream_error', 'The copy could not be made. Try again in a minute.'),
    );
  }

  // Committed. Counting the space for this copy is the last step; if it fails the reservation
  // simply lapses, and the copy that now exists is never touched.
  await finalizeUpload(db, intent.id, version.id).catch(() => undefined);
  return ok({ documentId: version.documentId, title });
}
