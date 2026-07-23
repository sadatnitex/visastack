import { type Result, err, ok } from '@visastack/core';
import { desc, eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

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

/** Record a new (system-generated) naming proposal for a document. */
export async function proposeDocumentName(
  db: Db,
  input: ProposeDocumentNameInput,
): Promise<Result<DocumentNameVersion, ServiceError>> {
  const document = first(
    await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .limit(1),
  );
  if (!document) return err(serviceError('not_found', 'document not found'));
  if (input.proposedName.trim().length === 0) {
    return err(serviceError('invalid', 'a proposed name is required'));
  }

  return db.transaction(async (tx) => {
    const top = first(
      await tx
        .select({ versionNumber: schema.documentNameVersions.versionNumber })
        .from(schema.documentNameVersions)
        .where(eq(schema.documentNameVersions.documentId, input.documentId))
        .orderBy(desc(schema.documentNameVersions.versionNumber))
        .limit(1),
    );
    const nextNumber = (top?.versionNumber ?? 0) + 1;

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
