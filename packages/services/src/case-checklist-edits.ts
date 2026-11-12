import { type Result, err, ok } from '@visastack/core';
import { isHiddenCodePoint } from '@visastack/core/ai-features';
import { and, eq, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { caseChecklistEditsTablePresent } from './case-checklist-edit-tables';
import { type Db, first, schema } from './db';
import { type ServiceError, keyedError } from './errors';
import { listRequirements } from './packs';
import { INACTIVE_CASE_STATES } from './umpe-package-tables';

/**
 * A traveller's edits to the checklist on their own case (Owner, 6 Nov 2026). Display only: an edit
 * changes the sentence shown for one item of the case's pack version, nothing else. The readiness
 * engine, the package, the handoff, frozen records, exports and AI never read these rows (a guard
 * test keeps those files from naming this module), so an edit can never make a case look ready, hide
 * an item, or change what is required. The pack version stays exactly as it was published.
 *
 * Every function takes the gate's proof for this traveller, and reads and writes both need the
 * traveller who owns the case: the words are the traveller's own and are not shown to an agency
 * (a later package adds a separate, deliberate agency read). A refused or unknown case, or an item
 * that is not on the case's checklist, gets the same "not available" answer.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest sentence a traveller may write for one item. */
export const CHECKLIST_WORDING_MAX = 400;
/** The most rows (rewords and own items together) one case may hold. */
export const CHECKLIST_EDITS_MAX = 100;

export interface CaseChecklistEdits {
  /** False until the table exists: no edit controls are shown and nothing is changed. */
  readonly available: boolean;
  /** The table exists and the case is open with a checklist: the traveller may change the words. */
  readonly editable: boolean;
  /** The traveller's sentence for each reworded item of the case's current checklist. */
  readonly rewords: readonly { readonly packRequirementId: string; readonly wording: string }[];
}

const NOTHING: CaseChecklistEdits = { available: false, editable: false, rewords: [] };

/** The case as the proof names it, or a refusal. Writes need the traveller who owns the case. */
function missionOf<A extends 'VIEW_METADATA' | 'MANAGE'>(
  proof: AuthorizedApplicant<A>,
  action: A,
  missionId: string,
): Result<{ readonly id: string; readonly applicantId: string }, ServiceError> {
  if (!AuthorizedApplicant.isGenuine(proof, action)) {
    return err(keyedError('forbidden', 'checklist_wording.you_cannot_change_this_list'));
  }
  if (proof.actor.kind !== 'applicant_owner') {
    return err(keyedError('forbidden', 'case_flow.only_the_traveller_who_owns_this'));
  }
  const resource = proof.resource;
  if (
    !UUID.test(missionId) ||
    resource.kind !== 'mission' ||
    resource.mission.id !== missionId ||
    resource.mission.applicantId !== proof.applicant.id
  ) {
    return err(keyedError('not_found', 'case_flow.that_case_is_not_available'));
  }
  return ok({ id: resource.mission.id, applicantId: proof.applicant.id });
}

/**
 * What a sentence is saved as: control, zero-width, line-separator and text-direction characters
 * (the same list every other text filter uses) and runs of spaces become one space.
 */
export function tidyWording(raw: string): string {
  let out = '';
  for (const char of raw) out += isHiddenCodePoint(char.codePointAt(0) ?? 0) ? ' ' : char;
  return out.replace(/\s+/g, ' ').trim();
}

/** The case is open and holds a checklist: the one rule for whether its words may change. */
function openWithChecklist(mission: {
  readonly purgedAt: Date | null;
  readonly state: string;
  readonly packVersionId: string | null;
}): boolean {
  return (
    mission.purgedAt === null &&
    !(INACTIVE_CASE_STATES as readonly string[]).includes(mission.state) &&
    mission.packVersionId !== null
  );
}

/**
 * The traveller's rewords for this case, only for items that are on the checklist the case holds
 * now (a reword saved against an earlier version never shows against a different item). Before the
 * table exists, nothing.
 */
export async function listCaseChecklistEdits(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  missionId: string,
): Promise<Result<CaseChecklistEdits, ServiceError>> {
  const owned = missionOf(proof, 'VIEW_METADATA', missionId);
  if (!owned.ok) return owned;
  const tx = proof.tx;
  if (!(await caseChecklistEditsTablePresent(tx))) return ok(NOTHING);
  const mission = first(
    await tx
      .select({
        purgedAt: schema.missions.purgedAt,
        state: schema.missions.state,
        packVersionId: schema.missions.packVersionId,
      })
      .from(schema.missions)
      .where(
        and(
          eq(schema.missions.id, owned.value.id),
          eq(schema.missions.applicantId, owned.value.applicantId),
        ),
      )
      .limit(1),
  );
  if (!mission) return err(keyedError('not_found', 'case_flow.that_case_is_not_available'));
  const rows = await tx
    .select({
      packRequirementId: schema.caseChecklistEdits.packRequirementId,
      wording: schema.caseChecklistEdits.wording,
    })
    .from(schema.caseChecklistEdits)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.caseChecklistEdits.missionId))
    .innerJoin(
      schema.packRequirements,
      and(
        eq(schema.packRequirements.id, schema.caseChecklistEdits.packRequirementId),
        eq(schema.packRequirements.packVersionId, schema.missions.packVersionId),
      ),
    )
    .where(
      and(
        eq(schema.caseChecklistEdits.missionId, owned.value.id),
        eq(schema.caseChecklistEdits.applicantId, owned.value.applicantId),
        eq(schema.caseChecklistEdits.kind, 'REWORD'),
      ),
    );
  return ok({
    available: true,
    editable: openWithChecklist(mission),
    rewords: rows.flatMap((row) =>
      row.packRequirementId
        ? [{ packRequirementId: row.packRequirementId, wording: row.wording }]
        : [],
    ),
  });
}

/**
 * Saves the traveller's sentence for one item of their case's checklist, or puts the original back
 * when the sentence is empty. Only while the case is open. Never changes the
 * item's kind, key, necessity, state or evidence, and never counts as a change to the case, so a
 * handoff already confirmed stays confirmed. The audit record names the item, never the words.
 */
export async function setChecklistWording(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: {
    readonly missionId: string;
    readonly packRequirementId: string;
    readonly wording: string;
  },
): Promise<Result<{ readonly wording: string | null }, ServiceError>> {
  const owned = missionOf(proof, 'MANAGE', input.missionId);
  if (!owned.ok) return owned;
  const tx = proof.tx;
  if (!UUID.test(input.packRequirementId))
    return err(keyedError('not_found', 'case_flow.that_item_is_not_on_this'));
  const wording = tidyWording(input.wording);
  if (wording.length > CHECKLIST_WORDING_MAX) {
    return err(
      keyedError('invalid', 'checklist_wording.wording_max', { max: CHECKLIST_WORDING_MAX }),
    );
  }
  if (!(await caseChecklistEditsTablePresent(tx))) {
    return err(keyedError('invalid', 'checklist_wording.editing_your_list_is_not_switched'));
  }
  return tx.transaction(async (inner: Db) => {
    // The case is read again here and locked, so two edits at once cannot both pass the row cap.
    const mission = first(
      await inner
        .select()
        .from(schema.missions)
        .where(
          and(
            eq(schema.missions.id, owned.value.id),
            eq(schema.missions.applicantId, owned.value.applicantId),
          ),
        )
        .limit(1)
        .for('update'),
    );
    if (!mission) return err(keyedError('not_found', 'case_flow.that_case_is_not_available'));
    if (
      mission.purgedAt !== null ||
      (INACTIVE_CASE_STATES as readonly string[]).includes(mission.state)
    ) {
      return err(keyedError('invalid', 'checklist_wording.this_case_is_finished_so_its'));
    }
    if (!openWithChecklist(mission) || !mission.packVersionId) {
      return err(keyedError('invalid', 'case_flow.this_case_has_no_checklist_yet'));
    }
    const requirement = (await listRequirements(inner, mission.packVersionId)).find(
      (r) => r.id === input.packRequirementId,
    );
    if (!requirement) return err(keyedError('not_found', 'case_flow.that_item_is_not_on_this'));

    const existing = first(
      await inner
        .select({ id: schema.caseChecklistEdits.id, wording: schema.caseChecklistEdits.wording })
        .from(schema.caseChecklistEdits)
        .where(
          and(
            eq(schema.caseChecklistEdits.missionId, mission.id),
            eq(schema.caseChecklistEdits.packRequirementId, requirement.id),
          ),
        )
        .limit(1),
    );
    // An empty sentence puts the original back. The page also sends an empty sentence when the
    // traveller types the original as it is shown, because only the page knows how it is shown.
    const clear = wording === '';

    if (clear) {
      if (!existing) return ok({ wording: null });
      await inner
        .delete(schema.caseChecklistEdits)
        .where(eq(schema.caseChecklistEdits.id, existing.id));
    } else if (existing) {
      if (existing.wording === wording) return ok({ wording });
      await inner
        .update(schema.caseChecklistEdits)
        .set({ wording, updatedAt: sql`now()` })
        .where(eq(schema.caseChecklistEdits.id, existing.id));
    } else {
      const held = await inner
        .select({ id: schema.caseChecklistEdits.id })
        .from(schema.caseChecklistEdits)
        .where(eq(schema.caseChecklistEdits.missionId, mission.id));
      if (held.length >= CHECKLIST_EDITS_MAX) {
        return err(keyedError('invalid', 'checklist_wording.this_list_has_as_many_changes'));
      }
      await inner.insert(schema.caseChecklistEdits).values({
        missionId: mission.id,
        applicantId: mission.applicantId,
        kind: 'REWORD',
        packRequirementId: requirement.id,
        wording,
        createdByAccountId: proof.applicant.ownerAccountId,
      });
    }
    await appendAuditEvent(inner, {
      eventType: clear ? 'CASE_CHECKLIST_WORDING_CLEARED' : 'CASE_CHECKLIST_WORDING_SET',
      actorAccountId: proof.applicant.ownerAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: mission.applicantId,
      missionId: mission.id,
      resourceType: 'pack_requirement',
      resourceId: requirement.id,
      // Ids and kind only: the traveller's words are never written to the audit trail.
      metadata: { kind: requirement.kind },
    });
    return ok({ wording: clear ? null : wording });
  });
}
