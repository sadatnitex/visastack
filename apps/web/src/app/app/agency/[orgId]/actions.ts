'use server';

import { requestEvidence } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Org admin requests a specific field or document from an applicant. */
export async function requestEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const applicantId = String(formData.get('applicantId') ?? '').trim();
  const kind = String(formData.get('kind') ?? '') === 'DOCUMENT' ? 'DOCUMENT' : 'FIELD';
  const key = String(formData.get('key') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();

  if (applicantId.length === 0) return { ok: false, message: 'Enter the applicant ID.' };
  if (key.length === 0) {
    return {
      ok: false,
      message: kind === 'FIELD' ? 'Enter the field key.' : 'Enter the document type.',
    };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const requested = await requestEvidence(db, {
      actorAccountId: accountId,
      organizationId,
      applicantId,
      kind,
      ...(kind === 'FIELD' ? { fieldKey: key } : { docType: key }),
      ...(message.length > 0 ? { message } : {}),
    });
    if (!requested.ok) return { ok: false, message: requested.error.message } satisfies ActionState;
    return { ok: true, message: 'Evidence request sent.' } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
  return result;
}
