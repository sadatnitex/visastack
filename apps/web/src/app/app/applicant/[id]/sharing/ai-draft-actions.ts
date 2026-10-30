'use server';

import { accountPrincipal, deleteAiDraft, requireAccess } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import type { FormResult } from '../../../../../components/form-feedback';
import { withSession } from '../../../../../lib/session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' && value.length <= 200 ? value : '';
}

const NOT_FOUND: FormResult = {
  ok: false,
  message: 'This draft was not found. It may have been deleted already. Reload the page.',
};

/** The person deletes one draft an AI app saved for them (S21). Owner only, through the access gate. */
export async function deleteAiDraftAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const applicantId = text(formData, 'applicantId');
  const draftId = text(formData, 'draftId');
  if (!UUID_RE.test(applicantId) || !UUID_RE.test(draftId)) return NOT_FOUND;
  const outcome = await withSession(({ db, accountId }) =>
    db.transaction(async (tx) => {
      const gate = await requireAccess(
        tx,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId },
        { purpose: 'ai_drafts' },
      );
      if (!gate.ok || gate.value.actor.kind !== 'applicant_owner') return 'denied' as const;
      const removed = await deleteAiDraft(gate.value, draftId);
      return removed.ok ? ('done' as const) : ('missing' as const);
    }),
  );
  if (outcome === 'denied') {
    return { ok: false, message: 'Only the owner of this record can delete its drafts.' };
  }
  if (outcome === 'missing') return NOT_FOUND;
  revalidatePath(`/app/applicant/${applicantId}/sharing`);
  return { ok: true, message: 'Draft deleted.' };
}
