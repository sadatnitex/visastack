import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isUuid } from './lifecycle/foundation/ids';
import {
  type PackEditor,
  type PackRequirement,
  type PackVersion,
  citationProblem,
  packEditorProblem,
  packEditorQuickProblem,
  packStudioWaiting,
} from './packs';

/**
 * Changing a checklist that is already published (Owner, 6 Nov 2026: an admin updates a pack
 * system-wide). A published version never changes, so an update is a new draft that starts as a
 * copy of the current one: change, add or remove items there, then approve and publish it as the
 * next version. Cases already on the old version keep it, as they always have.
 */

/** The longest wording a traveller reads for one item, and the longest note on who it is for. */
export const MAX_WORDING_LENGTH = 400;
export const MAX_AUDIENCE_LENGTH = 120;
const NOT_DRAFT_WORDS = 'Items can only change while the version is a draft.';

/** What an admin may change on an item of a draft. Anything left out stays as it is. */
export interface DraftRequirementPatch {
  readonly docType?: string;
  readonly necessity?: 'MANDATORY' | 'RECOMMENDED' | 'OPTIONAL';
  /** The wording shown to the traveller (an empty string clears it). */
  readonly notes?: string;
  /** Who the item is for (an empty string clears it). */
  readonly interpretation?: string;
  readonly citation?: string;
  readonly sourceTitle?: string;
}

/**
 * The item and its version, locked, for an editor who may change that pack and only while the
 * version is a draft. The editor is checked before the status, so a person who may not change the
 * pack gets the same "item not found" as for an id that does not exist, never a hint that it does.
 */
async function draftItem(
  tx: Db,
  editor: PackEditor,
  requirementId: string,
): Promise<Result<{ item: PackRequirement; version: PackVersion }, ServiceError>> {
  const missing = serviceError('not_found', 'item not found');
  if (!isUuid(requirementId)) return err(missing);
  const item = first(
    await tx
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.id, requirementId))
      .limit(1),
  );
  if (!item) return err(missing);
  const owner = first(
    await tx
      .select({ packId: schema.packVersions.packId })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, item.packVersionId))
      .limit(1),
  );
  if (!owner) return err(missing);
  const refused = await packEditorProblem(tx, editor, owner.packId);
  if (refused) return err(refused.code === 'not_found' ? missing : refused);
  const version = first(
    await tx
      .select()
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, item.packVersionId))
      .limit(1)
      .for('update'),
  );
  if (!version) return err(missing);
  if (version.status !== 'DRAFT') return err(serviceError('invalid', NOT_DRAFT_WORDS));
  return ok({ item: item as PackRequirement, version });
}

/** Changes one item of a draft: its document type, how necessary it is, its wording or its source. */
export async function updateDraftRequirement(
  db: Db,
  editor: PackEditor,
  input: {
    readonly requirementId: string;
    readonly patch: DraftRequirementPatch;
  },
): Promise<Result<PackRequirement, ServiceError>> {
  const quick = packEditorQuickProblem(editor);
  if (quick) return err(quick);
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  const { patch } = input;
  if ((patch.notes?.trim().length ?? 0) > MAX_WORDING_LENGTH) {
    return err(
      serviceError('invalid', `the wording can be at most ${MAX_WORDING_LENGTH} characters`),
    );
  }
  if ((patch.interpretation?.trim().length ?? 0) > MAX_AUDIENCE_LENGTH) {
    return err(
      serviceError('invalid', `who it is for can be at most ${MAX_AUDIENCE_LENGTH} characters`),
    );
  }
  if (patch.docType !== undefined && patch.docType.trim() === '') {
    return err(serviceError('invalid', 'a document item needs a document type'));
  }
  if (patch.citation !== undefined) {
    const problem = citationProblem(patch.citation);
    if (problem || patch.citation.trim() === '') {
      return err(serviceError('invalid', problem ?? 'every item must carry a source'));
    }
  }
  return db.transaction(async (tx) => {
    const found = await draftItem(tx, editor, input.requirementId);
    if (!found.ok) return found;
    const { item } = found.value;
    if (patch.docType !== undefined && item.kind !== 'DOCUMENT') {
      return err(serviceError('invalid', 'only a document item has a document type'));
    }
    const changes: Partial<typeof schema.packRequirements.$inferInsert> = {};
    if (patch.docType !== undefined) changes.docType = patch.docType.trim();
    if (patch.necessity !== undefined) {
      changes.necessity = patch.necessity;
      changes.optional = patch.necessity === 'OPTIONAL';
    }
    if (patch.notes !== undefined)
      changes.notes = patch.notes.trim() === '' ? null : patch.notes.trim();
    if (patch.interpretation !== undefined) {
      changes.interpretation =
        patch.interpretation.trim() === '' ? null : patch.interpretation.trim();
    }
    if (patch.citation !== undefined) changes.citation = patch.citation.trim();
    if (patch.sourceTitle !== undefined) {
      changes.sourceTitle = patch.sourceTitle.trim() === '' ? null : patch.sourceTitle.trim();
    }
    if (Object.keys(changes).length === 0) return ok(item);
    const updated = required(
      first(
        await tx
          .update(schema.packRequirements)
          .set(changes)
          .where(eq(schema.packRequirements.id, item.id))
          .returning(),
      ),
      'requirement',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_REQUIREMENT_CHANGED',
      actorAccountId: editor.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: item.packVersionId,
      metadata: { requirementId: item.id, changed: Object.keys(changes) },
    });
    return ok(updated as PackRequirement);
  });
}

/** Removes one item from a draft. Never from a version that has been approved or published. */
export async function removeDraftRequirement(
  db: Db,
  editor: PackEditor,
  input: { readonly requirementId: string },
): Promise<Result<{ readonly removed: true }, ServiceError>> {
  const quick = packEditorQuickProblem(editor);
  if (quick) return err(quick);
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  return db.transaction(async (tx) => {
    const found = await draftItem(tx, editor, input.requirementId);
    if (!found.ok) return found;
    const { item } = found.value;
    await tx.delete(schema.packRequirements).where(eq(schema.packRequirements.id, item.id));
    await appendAuditEvent(tx, {
      eventType: 'PACK_REQUIREMENT_REMOVED',
      actorAccountId: editor.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: item.packVersionId,
      metadata: { requirementId: item.id, kind: item.kind, docType: item.docType },
    });
    return ok({ removed: true as const });
  });
}

/** The newest version of a pack that is published, or undefined. */
export async function newestPublishedVersion(
  db: Db,
  packId: string,
): Promise<PackVersion | undefined> {
  return first(
    await db
      .select()
      .from(schema.packVersions)
      .where(
        and(eq(schema.packVersions.packId, packId), eq(schema.packVersions.status, 'PUBLISHED')),
      )
      .orderBy(desc(schema.packVersions.version))
      .limit(1),
  ) as PackVersion | undefined;
}
