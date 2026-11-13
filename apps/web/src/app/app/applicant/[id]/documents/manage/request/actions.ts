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
import { REMOVAL_WORDS as W, type WordedRefusal, said } from '../removal-words';
import { CANCELLED_MESSAGE, REQUESTED_MESSAGE } from './messages';

export type RemovalRequestResult =
  | { readonly ok: true; readonly message: string }
  | ({ readonly ok: false; readonly message: string } & Partial<WordedRefusal>);

const NOT_ALLOWED = said(W.requestNotOwner);
const SWITCHED_OFF = { ok: false, ...said(W.requestsNotAvailable) } as const;

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
const REFUSAL_WORDS: ReadonlyMap<string, WordedRefusal> = new Map([
  [REMOVAL_REQUEST_REFUSALS.notOwner, NOT_ALLOWED],
  [REMOVAL_REQUEST_REFUSALS.unavailable, said(W.requestsNotAvailable)],
  [REMOVAL_REQUEST_REFUSALS.notLive, said(W.requestAlreadyRemoving)],
  [REMOVAL_REQUEST_REFUSALS.legalHold, said(W.requestLegalHold)],
  [REMOVAL_REQUEST_REFUSALS.alreadyPending, said(W.requestAlreadyAsked)],
  [REMOVAL_REQUEST_REFUSALS.notPending, said(W.requestAlreadyDecided)],
  [REMOVAL_REQUEST_REFUSALS.reason, said(W.chooseReasonFromList)],
]);

function refusalMessage(code: string, message: string): WordedRefusal {
  if (code === 'forbidden') return NOT_ALLOWED;
  if (code === 'not_found') return said(W.documentNoLongerHere);
  return REFUSAL_WORDS.get(message) ?? said(W.requestCouldNotBeSent);
}

/** Ask Us to Remove This File: sends the owner's request, with the reason they chose. */
export async function requestRemovalAction(
  applicantId: string,
  documentId: string,
  reason: string,
): Promise<RemovalRequestResult> {
  if (!documentRemovalRequestsOn()) return SWITCHED_OFF;
  if (!(REMOVAL_REQUEST_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, ...said(W.chooseReasonFromList) };
  }
  return withSession(async ({ db, accountId }): Promise<RemovalRequestResult> => {
    const access = await manageProof(db, accountId, applicantId, documentId);
    if (!access) return { ok: false, ...NOT_ALLOWED };
    const asked = await requestRemoval(access, {
      documentId,
      reason: reason as RemovalRequestReason,
    });
    if (!asked.ok) return { ok: false, ...refusalMessage(asked.error.code, asked.error.message) };
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
    if (!access) return { ok: false, ...NOT_ALLOWED };
    const requestId = (await pendingRemovalRequests(access, [documentId])).get(
      documentId.toLowerCase(),
    );
    if (!requestId) {
      return { ok: false, ...said(W.noWaitingRequest) };
    }
    const cancelled = await cancelRemovalRequest(access, requestId);
    if (!cancelled.ok) {
      return { ok: false, ...refusalMessage(cancelled.error.code, cancelled.error.message) };
    }
    return { ok: true, message: CANCELLED_MESSAGE };
  });
}
