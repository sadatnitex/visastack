'use server';

import { respondEvidence } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../../../lib/session';

/** Applicant owner fulfils or declines an evidence request. */
export async function respondEvidenceAction(formData: FormData): Promise<void> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (requestId.length === 0 || (decision !== 'FULFILLED' && decision !== 'DECLINED')) return;

  await withSession(async ({ db, accountId }) => {
    await respondEvidence(db, { actorAccountId: accountId, requestId, decision });
  });
  revalidatePath(`/app/applicant/${applicantId}/evidence`);
}
