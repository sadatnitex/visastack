import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { cleanDocumentName } from './naming';

/**
 * Automatic filename proposal workflow (master directive §11/§21E).
 *
 * A proposal is PENDING until a human decides. Accepting (unchanged or
 * edited) atomically sets `documents.approvedName`; rejecting leaves it
 * untouched. The storage key and `originalName` are never touched by this
 * module — naming only ever affects the displayed name.
 */

export type DocumentNameVersion = typeof schema.documentNameVersions.$inferSelect;

export interface ProposeDocumentNameInput {
  readonly documentId: string;
  readonly proposedName: string;
  readonly reason?: string;
}

/** The next free name version number for a document. Call it with the document row locked. */
async function nextNameVersionNumber(tx: Db, documentId: string): Promise<number> {
  const top = first(
    await tx
      .select({ versionNumber: schema.documentNameVersions.versionNumber })
      .from(schema.documentNameVersions)
      .where(eq(schema.documentNameVersions.documentId, documentId))
      .orderBy(desc(schema.documentNameVersions.versionNumber))
      .limit(1),
  );
  return (top?.versionNumber ?? 0) + 1;
}

/**
 * Record a new (system-generated) naming proposal for a document. The document row is locked for
 * the rest of the transaction before the next version number is worked out, the same lock every
 * other writer of a document's names takes (`renameDocument`, `setDocumentType`), so two writers
 * can never pick the same number.
 */
export async function proposeDocumentName(
  db: Db,
  input: ProposeDocumentNameInput,
): Promise<Result<DocumentNameVersion, ServiceError>> {
  if (input.proposedName.trim().length === 0) {
    return err(serviceError('invalid', 'a proposed name is required'));
  }

  return db.transaction(async (tx) => {
    const document = first(
      await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, input.documentId))
        .limit(1)
        .for('update'),
    );
    if (!document) return err(serviceError('not_found', 'document not found'));
    const nextNumber = await nextNameVersionNumber(tx, input.documentId);

    const version = required(
      first(
        await tx
          .insert(schema.documentNameVersions)
          .values({
            documentId: input.documentId,
            versionNumber: nextNumber,
            proposedName: input.proposedName,
            reason: input.reason ?? 'automatic proposal from deterministic classification',
          })
          .returning(),
      ),
      'document name version',
    );

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_NAME_PROPOSED',
      method: 'SYSTEM',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      metadata: { versionNumber: nextNumber, proposedName: input.proposedName },
    });

    return ok(version);
  });
}

export type NameDecision = 'ACCEPTED_UNCHANGED' | 'ACCEPTED_EDITED' | 'REJECTED';

export interface DecideDocumentNameInput {
  readonly actorAccountId: string;
  readonly nameVersionId: string;
  readonly decision: NameDecision;
  /** Required for ACCEPTED_UNCHANGED/ACCEPTED_EDITED; ignored for REJECTED. */
  readonly finalName?: string;
  readonly reason?: string;
}

/**
 * Apply a human decision to a PENDING naming proposal. Accepting atomically
 * updates `documents.approvedName`; the decision and the profile-visible name
 * change commit or roll back together.
 */
export async function decideDocumentName(
  db: Db,
  input: DecideDocumentNameInput,
): Promise<Result<DocumentNameVersion, ServiceError>> {
  const version = first(
    await db
      .select()
      .from(schema.documentNameVersions)
      .where(eq(schema.documentNameVersions.id, input.nameVersionId))
      .limit(1),
  );
  if (!version) return err(serviceError('not_found', 'name version not found'));
  if (version.decision !== 'PENDING') {
    return err(serviceError('invalid', 'this naming proposal has already been decided'));
  }

  const document = first(
    await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, version.documentId))
      .limit(1),
  );
  if (!document) return err(serviceError('not_found', 'document not found'));

  const applicant = first(
    await db
      .select()
      .from(schema.applicants)
      .where(eq(schema.applicants.id, document.applicantId))
      .limit(1),
  );
  if (!applicant || applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to decide this document name'));
  }

  const accepting = input.decision !== 'REJECTED';
  if (accepting && (!input.finalName || input.finalName.trim().length === 0)) {
    return err(serviceError('invalid', 'a final name is required to accept a naming proposal'));
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.documentNameVersions)
          .set({
            decision: input.decision,
            finalName: accepting ? (input.finalName as string).trim() : null,
            decidedByAccountId: input.actorAccountId,
            decidedAt: new Date(),
            ...(input.reason ? { reason: input.reason } : {}),
          })
          .where(eq(schema.documentNameVersions.id, input.nameVersionId))
          .returning(),
      ),
      'document name version',
    );

    if (accepting) {
      await tx
        .update(schema.documents)
        .set({ approvedName: updated.finalName, updatedAt: new Date() })
        .where(eq(schema.documents.id, document.id));
    }

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_NAME_DECIDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: document.id,
      metadata: { decision: input.decision, finalName: updated.finalName },
    });

    return ok(updated);
  });
}

/** The most recent naming proposal for a document (for the review UI). */
export async function getLatestNameVersion(
  db: Db,
  documentId: string,
): Promise<DocumentNameVersion | undefined> {
  return first(
    await db
      .select()
      .from(schema.documentNameVersions)
      .where(eq(schema.documentNameVersions.documentId, documentId))
      .orderBy(desc(schema.documentNameVersions.versionNumber))
      .limit(1),
  );
}

/** Full immutable naming history for a document, newest first. */
export async function listNameVersions(
  db: Db,
  documentId: string,
): Promise<readonly DocumentNameVersion[]> {
  return db
    .select()
    .from(schema.documentNameVersions)
    .where(eq(schema.documentNameVersions.documentId, documentId))
    .orderBy(desc(schema.documentNameVersions.versionNumber));
}

/** Recorded on the name version a person writes with `renameDocument`. */
export const OWNER_RENAME_REASON = 'renamed by the owner';

/**
 * Give a document a name of the person's own. The owner only, through the access gate, with the
 * proof made for this document. The name is cleaned the way every name a person types is
 * (`cleanDocumentName`) and saved as a name version written and decided in one step, so nothing
 * is left waiting. A name suggested by a reading and still waiting stays waiting; the person can
 * still accept or skip it.
 *
 * The name itself is kept only in the document and its name history, which erasing the person's
 * data removes. The audit trail, which is never edited or removed, records that the person renamed
 * the document and how long the name is, never the name.
 */
export async function renameDocument(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly name: string },
): Promise<Result<DocumentNameVersion, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'MANAGE') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'document'
  ) {
    return err(serviceError('forbidden', 'only the owner can rename this document'));
  }
  const name = cleanDocumentName(input.name);
  if (name.length === 0) return err(serviceError('invalid', 'enter a name for this document'));
  const documentId = proof.resource.document.id;
  const actorAccountId = proof.applicant.ownerAccountId;

  return proof.tx.transaction(async (tx) => {
    const document = first(
      await tx
        .select({ id: schema.documents.id, applicantId: schema.documents.applicantId })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.applicantId, proof.applicant.id),
          ),
        )
        .limit(1)
        .for('update'),
    );
    if (!document) return err(serviceError('not_found', 'document not found'));
    const versionNumber = await nextNameVersionNumber(tx, documentId);
    const decidedAt = new Date();
    const version = required(
      first(
        await tx
          .insert(schema.documentNameVersions)
          .values({
            documentId,
            versionNumber,
            proposedName: name,
            finalName: name,
            decision: 'ACCEPTED_UNCHANGED',
            decidedByAccountId: actorAccountId,
            decidedAt,
            reason: OWNER_RENAME_REASON,
          })
          .returning(),
      ),
      'document name version',
    );
    await tx
      .update(schema.documents)
      .set({ approvedName: name, updatedAt: decidedAt })
      .where(eq(schema.documents.id, documentId));
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_RENAMED',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: documentId,
      metadata: { versionNumber, nameLength: name.length, automatic: false },
    });
    return ok(version);
  });
}
