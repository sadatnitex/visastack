'use server';

import {
  accountPrincipal,
  changeRecognisedKind,
  decideDocumentRelation,
  discardHeldFile,
  dismissIntakeException,
  fileHeldFile,
  isRelationDecision,
  requireAccess,
  returnAutoFiledHold,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { isRecordId } from '../../../../../lib/record-id';
import { withSession } from '../../../../../lib/session';
import { createStorage } from '../../../../../lib/storage';
import { triggerIntakeAndReading } from '../../../../api/jobs/process-ai-reading/run';

export interface RelationDecisionState {
  readonly ok: boolean;
  readonly message: string;
}

const GONE = 'That suggestion is no longer here. Refresh the page to see the latest list.';
const FILE_GONE = 'That file is no longer waiting. Refresh the page to see the latest list.';
const PLACEMENT_GONE = 'That is no longer here to change. Refresh the page to see the latest list.';

/** Plain words for a refused Change (UMPE G4). */
function changeRefusal(code: string): string {
  if (code === 'stale') {
    return 'Not changed: this file was already changed or used since. Change it from its own page.';
  }
  if (code === 'rate_limited') return 'Too many changes in a short time. Try again in a while.';
  return PLACEMENT_GONE;
}

/**
 * The traveller's answer to one suggested link between two documents (UMPE P3): Confirm or Keep
 * Separate. Owner only, through the access gate. Nothing is merged or deleted.
 */
export async function decideRelationAction(
  _prev: RelationDecisionState,
  formData: FormData,
): Promise<RelationDecisionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (!isRecordId(applicantId) || !isRecordId(proposalId) || !isRelationDecision(decision)) {
    return { ok: false, message: GONE };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: 'owner_document_relation' },
    );
    // A refused check reads exactly like a missing suggestion.
    if (!access.ok) return { ok: false, message: GONE };
    const decided = await decideDocumentRelation(access.value, { proposalId, decision });
    if (!decided.ok) {
      // The replace path said not yet (for example the newer file is still being checked):
      // nothing changed, and the suggestion stays to be answered later.
      return decided.error.code === 'invalid'
        ? {
            ok: false,
            message:
              'Nothing was changed yet: the newer file cannot replace the older one right now. Try again once both files have finished being checked.',
          }
        : { ok: false, message: GONE };
    }
    if (decided.value.status === 'DISMISSED') {
      return { ok: true, message: 'Kept separate. Both files stay as they are.' };
    }
    if (decided.value.replaced) {
      return {
        ok: true,
        message: 'Confirmed. The newer file is now the Current Copy; the older one is kept.',
      };
    }
    return {
      ok: true,
      message: 'Confirmed. Both files are kept, and Linked Copies shows how they belong together.',
    };
  });
  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}

/**
 * UMPE G1: every other answer in Needs One Decision, one action so the list keeps one status line.
 * - `keep`: Keep As It Is for a finding raised when a file was read (owner of this person only).
 * - `file`: Which Person? files a held file under the chosen person, through the access check for
 *   exactly that person; a refused check reads like a file no longer waiting.
 * - `discard`: removes a held file and its bytes (the account's own files only).
 * - `change-kind` (UMPE G4): puts back what a file was before its kind was recognised
 *   automatically (owner proof for that document).
 * - `change-person` (UMPE G4): moves a file filed automatically back to Which Person? (owner
 *   proof for the person it was filed under).
 */
export async function needsDecisionAction(
  prev: RelationDecisionState,
  formData: FormData,
): Promise<RelationDecisionState> {
  const intent = String(formData.get('intent') ?? '');
  if (intent === 'relation') return decideRelationAction(prev, formData);
  const applicantId = String(formData.get('applicantId') ?? '');
  if (!isRecordId(applicantId)) return { ok: false, message: GONE };

  if (intent === 'keep') {
    const exceptionId = String(formData.get('exceptionId') ?? '');
    if (!isRecordId(exceptionId)) return { ok: false, message: GONE };
    const result = await withSession(async ({ db, accountId }) => {
      const access = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId },
        { purpose: 'owner_document_finding' },
      );
      if (!access.ok) return { ok: false, message: GONE };
      const kept = await dismissIntakeException(access.value, { exceptionId });
      return kept.ok
        ? { ok: true, message: 'Kept as it is. Nothing about the file was changed.' }
        : { ok: false, message: GONE };
    });
    if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
    return result;
  }

  // UMPE G4: Change on something placed automatically. A refused check reads like a placement
  // that is no longer there.
  if (intent === 'change-kind' || intent === 'change-person') {
    const placementId = String(formData.get('placementId') ?? '');
    const documentId = String(formData.get('documentId') ?? '');
    if (!isRecordId(placementId) || (intent === 'change-kind' && !isRecordId(documentId))) {
      return { ok: false, message: PLACEMENT_GONE };
    }
    const result = await withSession(async ({ db, accountId }) => {
      if (intent === 'change-kind') {
        const access = await requireAccess(
          db,
          accountPrincipal(accountId),
          'MANAGE',
          { documentId },
          { purpose: 'owner_document_finding' },
        );
        if (!access.ok) return { ok: false, message: PLACEMENT_GONE };
        const changed = await changeRecognisedKind(access.value, { placementId });
        if (!changed.ok) return { ok: false, message: changeRefusal(changed.error.code) };
        return {
          ok: true,
          message:
            'Changed back. The file is as it was before, and the suggestion waits in Needs One Decision.',
        };
      }
      const access = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId },
        { purpose: 'owner_family_batch' },
      );
      if (!access.ok) return { ok: false, message: PLACEMENT_GONE };
      const returned = await returnAutoFiledHold(access.value, { placementId });
      if (!returned.ok) return { ok: false, message: changeRefusal(returned.error.code) };
      return {
        ok: true,
        message: 'Moved back. The file waits in Which Person? until you choose who it belongs to.',
      };
    });
    if (result.ok) revalidatePath('/app', 'layout');
    return result;
  }

  const holdId = String(formData.get('holdId') ?? '');
  if (!isRecordId(holdId)) return { ok: false, message: FILE_GONE };

  if (intent === 'file') {
    const personId = String(formData.get('personId') ?? '');
    if (!isRecordId(personId)) {
      return { ok: false, message: 'Choose who this file belongs to, then choose File It.' };
    }
    const result = await withSession(async ({ db, accountId }) => {
      const access = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId: personId },
        { purpose: 'owner_family_batch' },
      );
      if (!access.ok) return { ok: false, message: FILE_GONE };
      const filed = await fileHeldFile(access.value, { holdId });
      if (!filed.ok) {
        return filed.error.code === 'not_found'
          ? { ok: false, message: FILE_GONE }
          : { ok: false, message: `Not filed yet: ${filed.error.message}.` };
      }
      return {
        ok: true,
        message: 'Filed. The file is now being checked and read, as any upload is.',
      };
    });
    if (result.ok) {
      after(() => triggerIntakeAndReading());
      revalidatePath(`/app/applicant/${applicantId}`, 'layout');
      revalidatePath(`/app/applicant/${personId}`, 'layout');
    }
    return result;
  }

  if (intent === 'discard') {
    const result = await withSession(async ({ db, accountId }) => {
      const access = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId },
        { purpose: 'owner_family_batch' },
      );
      if (!access.ok) return { ok: false, message: FILE_GONE };
      const discarded = await discardHeldFile(
        access.value,
        { storage: createStorage(db) },
        { holdId },
      );
      if (!discarded.ok) return { ok: false, message: FILE_GONE };
      return {
        ok: true,
        message: discarded.value.bytesRemoved
          ? 'Removed. The file was not kept.'
          : 'Removed from your list. The stored copy will be deleted within a day.',
      };
    });
    if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
    return result;
  }
  return { ok: false, message: GONE };
}
