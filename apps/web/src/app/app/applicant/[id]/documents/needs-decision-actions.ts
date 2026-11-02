'use server';

import {
  accountPrincipal,
  decideDocumentRelation,
  isRelationDecision,
  requireAccess,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { isRecordId } from '../../../../../lib/record-id';
import { withSession } from '../../../../../lib/session';

export interface RelationDecisionState {
  readonly ok: boolean;
  readonly message: string;
}

const GONE = 'That suggestion is no longer here. Refresh the page to see the latest list.';

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
    if (!decided.ok) return { ok: false, message: GONE };
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
      message: 'Confirmed. Both files are kept, and the list now shows how they belong together.',
    };
  });
  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`, 'layout');
  return result;
}
