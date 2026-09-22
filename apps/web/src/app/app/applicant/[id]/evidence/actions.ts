'use server';

import { submitEvidenceResponse } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Applicant owner submits a fact or document they already hold as the response to an evidence request. */
export async function submitEvidenceResponseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const factId = String(formData.get('factId') ?? '') || undefined;
  const documentId = String(formData.get('documentId') ?? '') || undefined;
  if (requestId.length === 0 || (!factId && !documentId)) {
    return { ok: false, message: 'Choose what to submit.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const submitted = await submitEvidenceResponse(db, {
      actorAccountId: accountId,
      requestId,
      ...(factId ? { factId } : {}),
      ...(documentId ? { documentId } : {}),
    });
    if (!submitted.ok) {
      return { ok: false, message: submitted.error.message } satisfies ActionState;
    }
    return { ok: true, message: 'Submitted. The agency will review it.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/applicant/${applicantId}/evidence`);
  return result;
}
