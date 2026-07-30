'use server';

import { respondEvidence } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Applicant owner fulfils or declines an evidence request. */
export async function respondEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (requestId.length === 0 || (decision !== 'FULFILLED' && decision !== 'DECLINED')) {
    return { ok: false, message: 'Invalid request.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const responded = await respondEvidence(db, { actorAccountId: accountId, requestId, decision });
    if (!responded.ok) {
      return { ok: false, message: responded.error.message } satisfies ActionState;
    }
    return {
      ok: true,
      message: decision === 'FULFILLED' ? 'Marked as fulfilled.' : 'Request declined.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/applicant/${applicantId}/evidence`);
  return result;
}
