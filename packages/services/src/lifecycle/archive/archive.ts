import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from '../../access/require-access';
import { appendAuditEvent } from '../../audit';
import { type Db, first, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
import { recordProductEvent } from '../../product-events';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';

/** What an archive or restore left the document as, and whether this call changed anything. */
export interface DocumentArchiveOutcome {
  readonly state: 'ARCHIVED' | 'CURRENT';
  /** False when the document already was in that state (a repeated click, or Undo racing). */
  readonly changed: boolean;
}

/** One answer for every refusal a stranger could probe, so a guessed id learns nothing. */
const NOT_FOUND = 'document not found';

/**
 * The document this proof lets its holder archive or restore: the record owner's own MANAGE
 * proof, for the person's record or for that very document. An agency's or contributor's proof,
 * a read-level proof, a proof for a case or for another document, and a malformed id all read as
 * "not found", the same as a document that does not exist.
 */
function ownedDocumentId(
  documentId: string,
  access: AuthorizedApplicant<'MANAGE'>,
): string | undefined {
  if (!isUuid(documentId)) return undefined;
  if (!AuthorizedApplicant.isGenuine(access, 'MANAGE')) return undefined;
  if (access.actor.kind !== 'applicant_owner') return undefined;
  const resource = access.resource;
  if (resource.kind === 'mission') return undefined;
  const id = documentId.toLowerCase();
  if (resource.kind === 'document' && resource.document.id !== id) return undefined;
  return id;
}

type Change = 'ARCHIVE' | 'RESTORE';

async function changeArchive(
  change: Change,
  documentId: string,
  access: AuthorizedApplicant<'MANAGE'>,
): Promise<Result<DocumentArchiveOutcome, ServiceError>> {
  const id = ownedDocumentId(documentId, access);
  if (!id) return err(serviceError('not_found', NOT_FOUND));
  // Before migration 0113 there is nowhere to keep the archive: the action is hidden, and a
  // direct call is answered as if the document were not there.
  if (!(await lifecycleTablesPresent(access.tx))) return err(serviceError('not_found', NOT_FOUND));

  const applicantId = access.applicant.id;
  const actorAccountId = access.applicant.ownerAccountId;
  return access.tx.transaction(async (tx: Db) => {
    // The document row first, the same lock order as removal and the erasure worker, so an
    // archive never interleaves with a deletion of the same document.
    const document = first(
      await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(and(eq(schema.documents.id, id), eq(schema.documents.applicantId, applicantId)))
        .limit(1)
        .for('update'),
    );
    if (!document) return err(serviceError('not_found', NOT_FOUND));

    const lifecycle = first(
      await tx
        .select({
          archivedAt: schema.documentLifecycle.archivedAt,
          deletedAt: schema.documentLifecycle.deletedAt,
        })
        .from(schema.documentLifecycle)
        .where(eq(schema.documentLifecycle.documentId, id))
        .limit(1),
    );
    // Recently Deleted and removal have their own way back (lane C); archive never touches them.
    if (lifecycle?.deletedAt) {
      return err(serviceError('invalid', 'this document is in Recently Deleted'));
    }

    const archived = lifecycle?.archivedAt != null;
    if (change === 'ARCHIVE' ? archived : !archived) {
      return ok({ state: archived ? 'ARCHIVED' : 'CURRENT', changed: false });
    }

    const now = new Date();
    if (change === 'ARCHIVE') {
      // One row per document that has ever been archived or deleted (PROGRAMME 3.1). Only the
      // lifecycle row changes: never the document itself (its retention clock stays where it
      // was), its grants, AI app choices or case selections (owner decision D6).
      await tx
        .insert(schema.documentLifecycle)
        .values({
          documentId: id,
          applicantId,
          archivedAt: now,
          archivedByAccountId: actorAccountId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.documentLifecycle.documentId,
          set: { archivedAt: now, archivedByAccountId: actorAccountId, updatedAt: now },
          where: sql`${schema.documentLifecycle.archivedAt} is null and ${schema.documentLifecycle.deletedAt} is null`,
        });
    } else {
      await tx
        .update(schema.documentLifecycle)
        .set({ archivedAt: null, archivedByAccountId: null, updatedAt: now })
        .where(
          and(
            eq(schema.documentLifecycle.documentId, id),
            isNull(schema.documentLifecycle.deletedAt),
          ),
        );
    }

    const eventType = change === 'ARCHIVE' ? 'DOCUMENT_ARCHIVED' : 'DOCUMENT_RESTORED';
    // Ids only: the audit trail is never edited or removed, so it never holds a name or title.
    await appendAuditEvent(tx, {
      eventType,
      actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: id,
    });
    await recordProductEvent(tx, { eventType, accountId: actorAccountId });
    return ok({ state: change === 'ARCHIVE' ? 'ARCHIVED' : 'CURRENT', changed: true });
  });
}

/**
 * Archive one document: it leaves the default Documents list, new offers and automatic case
 * matching, and stays wherever it was chosen on purpose (a case selection, a share, an AI app
 * choice), flagged there. The record owner only. Repeating it changes nothing.
 */
export function archiveDocument(
  documentId: string,
  access: AuthorizedApplicant<'MANAGE'>,
): Promise<Result<DocumentArchiveOutcome, ServiceError>> {
  return changeArchive('ARCHIVE', documentId, access);
}

/** Bring an archived document back to Current. The record owner only. Repeating it changes nothing. */
export function restoreDocument(
  documentId: string,
  access: AuthorizedApplicant<'MANAGE'>,
): Promise<Result<DocumentArchiveOutcome, ServiceError>> {
  return changeArchive('RESTORE', documentId, access);
}
