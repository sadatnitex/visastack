import type { MissionState } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull, notExists, notInArray, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from '../../access/require-access';
import { appendAuditEvent } from '../../audit';
import { type Db, first, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
// Through the foundation's public path, the form the read-path guard recognises.
import { everydayDocumentCondition, presentDocumentCondition } from '../../lifecycle/foundation';
import { incrementMaterialRevision } from '../../material-revision';
import { recordProductEvent } from '../../product-events';
import { lifecycleActorAccountId, lifecycleCommandCovers } from '../foundation/access';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';

/** What an archive or restore left the document as, and whether this call changed anything. */
export interface DocumentArchiveOutcome {
  readonly state: 'ARCHIVED' | 'CURRENT';
  /** False when the document already was in that state (a repeated click, or Undo racing). */
  readonly changed: boolean;
  /** Open cases that counted the document on their own (no explicit choice) and now must be re-checked. */
  readonly casesAffected: number;
}

/** One answer for every refusal a stranger could probe, so a guessed id learns nothing. */
const NOT_FOUND = 'document not found';

/** Cases whose evidence is settled: a change to what they would match no longer matters to them. */
const FINISHED_CASE_STATES: readonly MissionState[] = ['SUBMITTED', 'CLOSED', 'CANCELLED'];

/**
 * The document this proof lets its holder archive or restore. The rule itself is the
 * foundation's (`lifecycleCommandCovers`: the record owner's own genuine MANAGE proof); on top of
 * it, a proof for one document reaches only that document and a proof for a case reaches none.
 * Anything else (an agency's or contributor's proof, a read-level or copied proof, a malformed
 * id) reads as "not found", the same as a document that does not exist.
 */
function ownedDocumentId(
  documentId: string,
  access: AuthorizedApplicant<'MANAGE'>,
): string | undefined {
  if (!isUuid(documentId)) return undefined;
  if (!(access instanceof AuthorizedApplicant)) return undefined;
  if (!lifecycleCommandCovers(access, access.applicant.id)) return undefined;
  if (access.actor.kind !== 'applicant_owner') return undefined;
  const resource = access.resource;
  if (resource.kind === 'mission') return undefined;
  const id = documentId.toLowerCase();
  if (resource.kind === 'document' && resource.document.id !== id) return undefined;
  return id;
}

/**
 * Open cases of this person that count a document of this type automatically: their checklist
 * asks for the type and they have not chosen a document for it on purpose. Archiving (or
 * restoring) changes what those cases count, which is a material change (TRU-03). A case that
 * chose its document keeps it either way (owner decision D6), so it is not touched.
 */
async function casesMatchingAutomatically(
  tx: Db,
  applicantId: string,
  docType: string,
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: schema.missions.id })
    .from(schema.missions)
    .innerJoin(
      schema.packRequirements,
      eq(schema.packRequirements.packVersionId, schema.missions.packVersionId),
    )
    .where(
      and(
        eq(schema.missions.applicantId, applicantId),
        notInArray(schema.missions.state, [...FINISHED_CASE_STATES]),
        eq(schema.packRequirements.kind, 'DOCUMENT'),
        eq(schema.packRequirements.docType, docType),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(schema.selectedEvidence)
            .where(
              and(
                eq(schema.selectedEvidence.missionId, schema.missions.id),
                eq(schema.selectedEvidence.packRequirementId, schema.packRequirements.id),
              ),
            ),
        ),
      ),
    );
  return rows.map((row) => row.id);
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
  const actorAccountId = lifecycleActorAccountId(access);
  return access.tx.transaction(async (tx: Db) => {
    const ofThisPerson = and(
      eq(schema.documents.id, id),
      eq(schema.documents.applicantId, applicantId),
    );
    // The document row first, the same lock order as removal and the erasure worker, so an
    // archive never interleaves with a deletion of the same document.
    const locked = first(
      await tx
        .select({ id: schema.documents.id, docType: schema.documents.docType })
        .from(schema.documents)
        .where(ofThisPerson)
        .limit(1)
        .for('update'),
    );
    if (!locked) return err(serviceError('not_found', NOT_FOUND));

    // Its lifecycle state, read after the lock in a statement of its own, so it sees whatever a
    // writer holding the lock before us committed.
    const state = first(
      await tx
        .select({
          present: sql<boolean>`${presentDocumentCondition()}`,
          everyday: sql<boolean>`${everydayDocumentCondition()}`,
        })
        .from(schema.documents)
        .where(ofThisPerson)
        .limit(1),
    );
    // Recently Deleted and removal have their own way back (lane C); archive never touches them.
    if (!state || state.present !== true) {
      return err(serviceError('invalid', 'this document is in Recently Deleted'));
    }

    const archived = state.everyday !== true;
    if (change === 'ARCHIVE' ? archived : !archived) {
      return ok({ state: archived ? 'ARCHIVED' : 'CURRENT', changed: false, casesAffected: 0 });
    }

    const now = new Date();
    // One row per document that has ever been archived or deleted (PROGRAMME 3.1). Only the
    // lifecycle row changes: never the document itself (its retention clock stays where it
    // was), its grants, AI app choices or case selections (owner decision D6).
    const written =
      change === 'ARCHIVE'
        ? await tx
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
            })
            .returning({ documentId: schema.documentLifecycle.documentId })
        : await tx
            .update(schema.documentLifecycle)
            .set({ archivedAt: null, archivedByAccountId: null, updatedAt: now })
            .where(
              and(
                eq(schema.documentLifecycle.documentId, id),
                isNull(schema.documentLifecycle.deletedAt),
              ),
            )
            .returning({ documentId: schema.documentLifecycle.documentId });
    // Nothing written means another change won the race: say nothing happened, record nothing.
    if (written.length === 0) {
      return err(serviceError('stale', 'this document changed meanwhile; try again'));
    }

    const cases = locked.docType
      ? await casesMatchingAutomatically(tx, applicantId, locked.docType)
      : [];
    for (const missionId of cases) await incrementMaterialRevision(tx, missionId);

    const eventType = change === 'ARCHIVE' ? 'DOCUMENT_ARCHIVED' : 'DOCUMENT_RESTORED';
    // Ids and counts only: the audit trail is never edited or removed, so never a name or title.
    await appendAuditEvent(tx, {
      eventType,
      actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: id,
      metadata: { casesAffected: cases.length },
    });
    if (actorAccountId) await recordProductEvent(tx, { eventType, accountId: actorAccountId });
    return ok({
      state: change === 'ARCHIVE' ? 'ARCHIVED' : 'CURRENT',
      changed: true,
      casesAffected: cases.length,
    });
  });
}

/**
 * Archive one document: it leaves the default Documents list, new offers and automatic case
 * matching, and stays wherever it was chosen on purpose (a case selection, a share, an AI app
 * choice), flagged there. Open cases that counted it automatically get a new material revision,
 * so an acknowledgement made before is asked for again. The record owner only. Repeating it
 * changes nothing. The access proof is the last parameter, as for every lifecycle function.
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
