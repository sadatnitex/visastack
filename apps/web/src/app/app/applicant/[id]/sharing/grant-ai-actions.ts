'use server';

import {
  GRANT_AI_ASSIST_STEP_UP_ACTION,
  type GrantAiAssistRefusal,
  accountPrincipal,
  requireAccess,
  setGrantAiAssist,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../../components/form-feedback';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, establishStepUpProof } from '../../../../../lib/step-up';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plain words for each typed refusal (never matched on message text). */
const REFUSED: Readonly<Record<GrantAiAssistRefusal, string>> = {
  not_owner: 'Only the owner of this record can change this.',
  not_available: 'This choice is not available yet. Try again after the next update.',
  not_found: 'This access was not found. Reload the page and try again.',
  not_agency_grant:
    'AI tools can be allowed only on live access to an agency that lets it see your details.',
  step_up_required: 'Confirm it is you, then save again.',
};

/**
 * "Let This Agency Use AI Tools on What I Share" (S22) on one agency grant. The grant id comes in
 * the form body, never the address. Turning it on needs a fresh identity check (decision D2):
 * without one, the person is sent to confirm it is them and comes back to Sharing, where they tick
 * the box again (nothing is carried across). Turning it off needs nothing more.
 */
export async function setGrantAiAssistAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const grantId = String(formData.get('grantId') ?? '');
  const allow = formData.get('allow') === 'on';
  if (!UUID_RE.test(applicantId) || !UUID_RE.test(grantId)) {
    return { ok: false, message: REFUSED.not_found };
  }
  const outcome = await withSession(async ({ db, accountId }) => {
    let stepUp: Parameters<typeof setGrantAiAssist>[1]['stepUp'];
    if (allow) {
      const established = await establishStepUpProof(
        { accountId, action: GRANT_AI_ASSIST_STEP_UP_ACTION, resourceId: applicantId },
        `/app/applicant/${applicantId}/sharing`,
      );
      if (established.kind === 'not_configured') return { kind: 'step_up_unavailable' } as const;
      if (established.kind === 'reauth_required') {
        return { kind: 'reauth', url: established.reauthUrl } as const;
      }
      stepUp = established.proof;
    }
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'owner_sharing' },
    );
    if (!proof.ok || proof.value.actor.kind !== 'applicant_owner') {
      return { kind: 'refused', reason: 'not_owner' as const } as const;
    }
    const changed = await setGrantAiAssist(proof.value, {
      grantId,
      allow,
      ...(stepUp ? { stepUp } : {}),
    });
    return changed.ok
      ? ({ kind: 'saved', allowed: changed.value.allowed } as const)
      : ({ kind: 'refused', reason: changed.error } as const);
  });
  if (outcome.kind === 'reauth') redirect(outcome.url);
  if (outcome.kind === 'step_up_unavailable') {
    return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
  }
  if (outcome.kind === 'refused') return { ok: false, message: REFUSED[outcome.reason] };
  revalidatePath(`/app/applicant/${applicantId}/sharing`);
  return {
    ok: true,
    message: outcome.allowed
      ? 'Saved. This agency’s AI tools can now read what you share with it.'
      : 'Saved. This agency’s AI tools can no longer read anything, from their next request.',
  };
}
