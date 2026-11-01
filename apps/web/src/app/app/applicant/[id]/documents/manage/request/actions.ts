'use server';

import {
  REMOVAL_REQUEST_REASONS,
  REMOVAL_REQUEST_REFUSALS,
  type RemovalRequestReason,
  accountPrincipal,
  cancelRemovalRequest,
  pendingRemovalRequests,
  requestRemoval,
  requireAccess,
} from '@visastack/services';
import { documentRemovalRequestsOn } from '../../../../../../../lib/env';
import { withSession } from '../../../../../../../lib/session';
import { CANCELLED_MESSAGE, NOT_ALLOWED, REQUESTED_MESSAGE } from './messages';

export type RemovalRequestResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

const SWITCHED_OFF: RemovalRequestResult = {
  ok: false,
  message: 'Removal requests are not available yet.',
};

/** The owner's MANAGE proof for one document of `applicantId`, from the signed-in session. */
async function manageProof(
  db: Parameters<typeof requireAccess>[0],
  accountId: string,
  applicantId: string,
  documentId: string,
) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { documentId },
    { purpose: 'owner_document_removal_request' },
  );
  if (!access.ok || access.value.applicant.id !== applicantId) return null;
  return access.value;
}

/** The person's words for each refusal the service gives (REMOVAL_REQUEST_REFUSALS). */
const REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [REMOVAL_REQUEST_REFUSALS.notOwner, NOT_ALLOWED],
  [REMOVAL_REQUEST_REFUSALS.unavailable, SWITCHED_OFF.message],
  [
    REMOVAL_REQUEST_REFUSALS.notLive,
    'This document is already being removed or is in Recently Deleted.',
  ],
  [
    REMOVAL_REQUEST_REFUSALS.legalHold,
    'We have to keep this document for now because of a legal requirement, so it cannot be removed.',
  ],
  [
    REMOVAL_REQUEST_REFUSALS.alreadyPending,
    'You already asked us to remove this document. Refresh the page to see the request.',
  ],
  [
    REMOVAL_REQUEST_REFUSALS.notPending,
    'Support has already decided this request. Refresh the page to see the latest.',
  ],
  [REMOVAL_REQUEST_REFUSALS.reason, 'Choose a reason from the list.'],
]);

function refusalMessage(code: string, message: string): string {
  if (code === 'forbidden') return NOT_ALLOWED;
  if (code === 'not_found')
    return 'That document is no longer here. Refresh the page and try again.';
  return (
    REFUSAL_WORDS.get(message) ?? 'This request could not be sent. Refresh the page and try again.'
  );
}

/** Ask Us to Remove This File: sends the owner's request, with the reason they chose. */
export async function requestRemovalAction(
  applicantId: string,
  documentId: string,
  reason: string,
): Promise<RemovalRequestResult> {
  if (!documentRemovalRequestsOn()) return SWITCHED_OFF;
  if (!(REMOVAL_REQUEST_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, message: 'Choose a reason from the list.' };
  }
  return withSession(async ({ db, accountId }): Promise<RemovalRequestResult> => {
    const access = await manageProof(db, accountId, applicantId, documentId);
    if (!access) return { ok: false, message: NOT_ALLOWED };
    const asked = await requestRemoval(access, {
      documentId,
      reason: reason as RemovalRequestReason,
    });
    if (!asked.ok)
      return { ok: false, message: refusalMessage(asked.error.code, asked.error.message) };
    return { ok: true, message: REQUESTED_MESSAGE };
  });
}

/**
 * Cancel Request: withdraws the waiting request for one document. Works with the switch off too,
 * so a request sent before the owner turned it off can still be withdrawn.
 */
export async function cancelRemovalRequestAction(
  applicantId: string,
  documentId: string,
): Promise<RemovalRequestResult> {
  return withSession(async ({ db, accountId }): Promise<RemovalRequestResult> => {
    const access = await manageProof(db, accountId, applicantId, documentId);
    if (!access) return { ok: false, message: NOT_ALLOWED };
    const requestId = (await pendingRemovalRequests(access, [documentId])).get(
      documentId.toLowerCase(),
    );
    if (!requestId) {
      return {
        ok: false,
        message:
          'There is no waiting request for this document. Refresh the page to see the latest.',
      };
    }
    const cancelled = await cancelRemovalRequest(access, requestId);
    if (!cancelled.ok) {
      return { ok: false, message: refusalMessage(cancelled.error.code, cancelled.error.message) };
    }
    return { ok: true, message: CANCELLED_MESSAGE };
  });
}
