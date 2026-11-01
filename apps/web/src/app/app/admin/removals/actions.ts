'use server';

import {
  REMOVAL_DECLINE_CODES,
  REMOVAL_REQUEST_REFUSALS,
  type RemovalDeclineCode,
  decideRemovalRequest,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { documentRemovalRequestsOn } from '../../../../lib/env';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';

const PATH = '/app/admin/removals';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DENIED: FormResult = {
  ok: false,
  message: 'Only a compliance admin or platform owner can decide removal requests.',
};

const REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [
    REMOVAL_REQUEST_REFUSALS.legalHold,
    'A legal hold covers this document, so it cannot be removed. Decline the request with the reason Legal Requirement.',
  ],
  [
    REMOVAL_REQUEST_REFUSALS.notPending,
    'This request was already decided or cancelled. Reload the page to see the latest.',
  ],
  [
    REMOVAL_REQUEST_REFUSALS.notLive,
    'This document is already being removed or was deleted. Reload the page to see the latest.',
  ],
  [REMOVAL_REQUEST_REFUSALS.declineCode, 'Choose why the request is declined.'],
  [
    REMOVAL_REQUEST_REFUSALS.gone,
    'This document already left VisaStack, so there is nothing to remove. The request closes at the next daily check, and the person is told.',
  ],
]);

/**
 * Approve or decline one removal request. Both need a fresh sign-in check (owner decision D7),
 * asked for the same way the other admin pages do; the service checks the live request, the
 * legal hold and the role again.
 */
export async function decideRemovalAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  if (!documentRemovalRequestsOn()) {
    return { ok: false, message: 'Removal requests are switched off.' };
  }
  const id = String(formData.get('requestId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const code = String(formData.get('decisionCode') ?? '');
  if (!UUID.test(id) || (decision !== 'APPROVE' && decision !== 'DECLINE')) {
    return {
      ok: false,
      message: 'That request could not be found. Reload the page and try again.',
    };
  }
  if (decision === 'DECLINE' && !(REMOVAL_DECLINE_CODES as readonly string[]).includes(code)) {
    return { ok: false, message: 'Choose why the request is declined.', field: 'decisionCode' };
  }

  const outcome = await withSession(async ({ db, accountId, email }): Promise<FormResult> => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'RETENTION_PURGE',
    );
    if (!staff.ok) return DENIED;
    const input = (stepUpSatisfied: boolean) =>
      decision === 'APPROVE'
        ? { id, decision: 'APPROVE' as const, stepUpSatisfied }
        : {
            id,
            decision: 'DECLINE' as const,
            decisionCode: code as RemovalDeclineCode,
            stepUpSatisfied,
          };

    let result = await decideRemovalRequest(staff.value, input(false), { db });
    if (!result.ok && result.error.code === 'step_up_required') {
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'DOCUMENT_REMOVAL_DECIDE', resourceId: id },
        `${PATH}#removal-${id}`,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      result = await decideRemovalRequest(staff.value, input(true), { db });
    }
    if (!result.ok) {
      if (result.error.code === 'forbidden') return DENIED;
      return {
        ok: false,
        message:
          REFUSAL_WORDS.get(result.error.message) ??
          'This decision could not be saved. Reload the page and try again.',
      };
    }
    revalidatePath(PATH);
    if (result.value.decision === 'DECLINED') return { ok: true, message: 'declined' };
    return { ok: true, message: result.value.removal === 'REMOVED' ? 'removed' : 'approved' };
  });
  if (!outcome.ok) return outcome;
  // The decided request leaves the list, taking its form with it, so the outcome is said at the
  // top of the page instead (DECISION_MESSAGES on the page).
  redirect(`${PATH}?done=${outcome.message}#removal-requests-status`);
}
