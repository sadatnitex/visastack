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
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { expiryDay, isTypedMirror, toExpiryEntry } from './document-expiry-rules';
import { documentExpiryEntriesTablePresent } from './document-expiry-tables';
import {
  type RegisteredDocumentWithVersion,
  isDocumentVersionUsable,
  registerDocumentWithVersion,
} from './documents';
import { type ServiceError, serviceError, keyedError } from './errors';
import { enqueueIntakeJob } from './jobs';
import {
  everydayApplicantCondition,
  lifecycleTablesPresent,
  presentApplicantCondition,
  presentDocumentCondition,
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
        lifecycle ? everydayApplicantCondition() : undefined,
      ),
    )
    .orderBy(applicants.createdAt);
}

export interface CopiedDocument {
  readonly documentId: string;
  readonly title: string | null;
}

const NOT_FOUND = keyedError('not_found', 'umpe_document_copies.we_could_not_find_this_document');
const CHECKING = keyedError('invalid', 'umpe_document_copies.this_document_is_still_being_checked');
const NOT_USABLE = keyedError('invalid', 'umpe_document_copies.this_document_did_not_pass_its');
const BEING_REMOVED = keyedError('invalid', 'umpe_document_copies.this_document_is_being_removed_so');
const REPLACED = keyedError('invalid', 'umpe_document_copies.this_document_was_replaced_by_a');
const CASE_ONLY = keyedError('invalid', 'umpe_document_copies.this_document_was_handed_in_for');
const CANNOT_VERIFY = keyedError('upstream_error', 'umpe_document_copies.this_document_could_not_be_checked');

/** States in which a file is still on its way to being usable (the same words replace uses). */
const IN_FLIGHT_SAFETY: ReadonlySet<string> = new Set(['PENDING', 'SCANNING']);
const IN_FLIGHT_PROCESSING: ReadonlySet<string> = new Set([
  'UPLOADING',
  'QUARANTINED',
  'SCANNING',
  'NORMALIZING',
  'EXTRACTING',
]);

/** Carries a refusal out of the registering transaction, so everything in it rolls back. */
class CopyRefused extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

/**
 * Whether `applicantId` already holds a document (archived ones included) whose stored file has
 * this fingerprint. An archived copy still counts: the person restores it instead of getting two.
 */
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
          (await lifecycleTablesPresent(db)) ? presentDocumentCondition() : undefined,
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/**
 * Keeps a copy of one of `sourceProof`'s documents under the person `targetProof` is for. Both
 * proofs must be the account's own MANAGE proofs for two different records of the same account.
 * Only a document of a kind that belongs to two people, in use and safe to open, is copied; a
 * person who already holds the same file is told so and gets nothing twice.
 *
 * The copy is all or nothing. Registering the document, queueing its intake, closing the space
 * reservation and recording the act happen in one transaction; if any of it fails the new bytes
 * are removed and the reservation is let go, so nothing half-made is ever left behind, and once
 * the transaction has committed nothing can delete the copy's bytes.
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
    return err(keyedError('forbidden', 'umpe_document_copies.you_can_keep_a_copy_only'));
  }
  const sourceId = sourceProof.applicant.id;
  const targetId = targetProof.applicant.id;
  if (sourceId === targetId) {
    return err(keyedError('invalid', 'umpe_document_copies.choose_a_different_person_for_the'));
  }
  const db = sourceProof.tx;
  const documents = schema.documents;
  const lifecycle = await lifecycleTablesPresent(db);

  // Both records must be people in use on this account (not removed, not in Recently Deleted).
  const people = await db
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(
      and(
        inArray(schema.applicants.id, [sourceId, targetId]),
        eq(schema.applicants.ownerAccountId, owner),
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    );
  if (people.length !== 2) return err(keyedError('not_found', 'umpe_document_copies.we_could_not_find_that_person'));

  const source = first(
    await db
      .select({
        id: documents.id,
        docType: documents.docType,
        subject: documents.subject,
        issuer: documents.issuer,
        documentDate: documents.documentDate,
        expiresAt: documents.expiresAt,
        originalName: documents.originalName,
        walletVisible: documents.walletVisible,
        supersededBy: documents.supersededByDocumentId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, input.documentId),
          eq(documents.applicantId, sourceId),
          // In use and not archived, as the Documents page lists it for a copy.
          lifecycle
            ? sql`${presentDocumentCondition()} and not exists (select 1 from "document_lifecycle" as "lc_copy_archived" where "lc_copy_archived"."document_id" = "documents"."id" and "lc_copy_archived"."archived_at" is not null)`
            : undefined,
        ),
      ),
  );
  if (!source) return err(NOT_FOUND);
  if (!isSharedBetweenPeopleKind(source.docType)) {
    return err(
      keyedError('invalid', 'umpe_document_copies.a_copy_for_another_person_is'),
    );
  }
  // Only what the person keeps in their own documents (CAS-08): a file handed in for one case
  // only is never turned into a reusable copy.
  if (!source.walletVisible) return err(CASE_ONLY);
  if (source.supersededBy) return err(REPLACED);

  const versions = schema.documentVersions;
  const objects = schema.storageObjects;
  const latest = first(
    await db
      .select({
        safetyStatus: versions.safetyStatus,
        processingStatus: versions.processingStatus,
        storageObjectId: objects.id,
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
  // The same rule previews and case readiness use, so a file being erased, rejected or still being
  // checked is never copied (a copy would start its own retention clock).
  const leaving = first(
    await db
      .select({ id: schema.erasureJobs.id })
      .from(schema.erasureJobs)
      .where(
        and(
          eq(schema.erasureJobs.storageObjectId, latest.storageObjectId),
          // Queued, running or done, as the document read path and the erasure worker count it.
          or(
            inArray(schema.erasureJobs.status, ['PENDING', 'CLAIMED', 'DELETED', 'VERIFIED']),
            isNotNull(schema.erasureJobs.deletionAttemptedAt),
          ),
        ),
      )
      .limit(1),
  );
  if (leaving) return err(BEING_REMOVED);
  if (
    !isDocumentVersionUsable({
      safetyStatus: latest.safetyStatus,
      processingStatus: latest.processingStatus,
      erased: false,
    })
  ) {
    const checking =
      IN_FLIGHT_SAFETY.has(latest.safetyStatus) ||
      (latest.safetyStatus === 'CLEAN' && IN_FLIGHT_PROCESSING.has(latest.processingStatus));
    return err(checking ? CHECKING : NOT_USABLE);
  }
  // The stored size is what the space is counted from; a file with no recorded size or
  // fingerprint cannot be checked against what was stored.
  if (latest.sizeBytes === null || latest.sizeBytes < 1 || !latest.contentHash) {
    return err(CANNOT_VERIFY);
  }
  const size = latest.sizeBytes;
  const contentHash = latest.contentHash;

  // The other person may already hold this very file: one copy each, never two. Checked again
  // under a lock just before the copy is registered, so two at once cannot both get through.
  const ALREADY = serviceError(
    'invalid',
    `${targetProof.applicant.displayName} already has this document.`,
  );
  if (await alreadyHolds(db, targetId, contentHash)) return err(ALREADY);

  // Space first, so a person with no room left costs nothing to refuse: no file is read.
  const reservation = await reserveUpload(
    db,
    { accountId: owner, applicantId: targetId, sizeBytes: size },
    deps.quotaConfig ?? loadUploadQuotaConfig(),
  );
  if (!reservation.ok) {
    // A refusal for no room is worded for a person and names whose space is full; the service's
    // own words are for the log.
    return err(
      reservation.error.code === 'rate_limited'
        ? reservation.error
        : serviceError(
            'invalid',
            `${targetProof.applicant.displayName} has no room left for another document. Remove one that is not needed, or ask us about a larger plan.`,
          ),
    );
  }
  const intent = reservation.value;
  const discard = async (reason: string) => {
    await deps.storage.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
    await failUpload(db, intent.id, reason);
  };

  let created: RegisteredDocumentWithVersion;
  try {
    const stored = await deps.storage.getObject(latest.objectKey);
    if (!stored) {
      await discard('source file not readable');
      return err(
        keyedError('upstream_error', 'umpe_document_copies.we_could_not_read_this_document'),
      );
    }
    const hash = sha256Of(stored.bytes);
    if (hash !== contentHash || stored.bytes.byteLength !== size) {
      await discard('source file did not match its fingerprint');
      return err(CANNOT_VERIFY);
    }
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
        keyedError('upstream_error', 'umpe_document_copies.the_copy_could_not_be_stored'),
      );
    }
    created = await db.transaction(async (tx: Db) => {
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
        sizeBytes: size,
        sha256: hash,
      });
      if (!registered.ok) throw new CopyRefused(registered.error);
      const copy = registered.value;
      // What the person recorded about the document goes with the copy (a joint statement's date
      // is what tells it apart from the next one).
      if (source.issuer !== null || source.documentDate !== null || source.expiresAt !== null) {
        await tx
          .update(documents)
          .set({
            ...(source.issuer !== null ? { issuer: source.issuer } : {}),
            ...(source.documentDate !== null ? { documentDate: source.documentDate } : {}),
            ...(source.expiresAt !== null ? { expiresAt: source.expiresAt } : {}),
          })
          .where(eq(documents.id, copy.document.id));
      }
      // A date the person typed stays labelled as typed on the copy; any other date is a read one.
      if (source.expiresAt !== null && (await documentExpiryEntriesTablePresent(tx))) {
        const sourceEntries = (
          await tx
            .select({
              source: schema.documentExpiryEntries.source,
              expiresOn: schema.documentExpiryEntries.expiresOn,
              mirrored: schema.documentExpiryEntries.mirrored,
            })
            .from(schema.documentExpiryEntries)
            .where(eq(schema.documentExpiryEntries.documentId, source.id))
            .orderBy(
              desc(schema.documentExpiryEntries.createdAt),
              desc(schema.documentExpiryEntries.id),
            )
        ).map(toExpiryEntry);
        const typedOnSource = isTypedMirror(source.expiresAt, sourceEntries);
        await tx.insert(schema.documentExpiryEntries).values({
          documentId: copy.document.id,
          expiresOn: expiryDay(source.expiresAt),
          source: typedOnSource ? 'TYPED' : 'READ',
          // The copy's own date was set above, so a copied typed date is its typed mirror.
          mirrored: typedOnSource,
          enteredByAccountId: typedOnSource ? owner : null,
        });
      }
      // The copy goes through the same pipeline as any new file, and its space is now counted: all
      // inside this transaction, so a failure anywhere undoes the lot.
      await enqueueIntakeJob(tx, { documentVersionId: copy.version.id });
      await finalizeUpload(tx, intent.id, copy.version.id);
      await appendAuditEvent(tx, {
        eventType: 'DOCUMENT_COPIED_TO_PERSON',
        actorAccountId: owner,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId: targetId,
        resourceType: 'document',
        resourceId: copy.version.documentId,
        metadata: { fromApplicantId: sourceId, fromDocumentId: source.id, kind: source.docType },
      });
      return copy;
    });
  } catch (error) {
    // Nothing references the new bytes yet (the transaction rolled back), so they go with the
    // reservation. The reason is fixed text: a person's name is never written to the log.
    await discard(error instanceof CopyRefused ? 'copy refused' : 'copy failed');
    if (error instanceof CopyRefused) return err(error.serviceError);
    return err(
      keyedError('upstream_error', 'umpe_document_copies.the_copy_could_not_be_made'),
    );
  }
  return ok({ documentId: created.version.documentId, title: created.document.approvedName });
}
