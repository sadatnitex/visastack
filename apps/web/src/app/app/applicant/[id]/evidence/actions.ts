'use server';

import {
  accountPrincipal,
  askAboutRequestItem,
  requireAccess,
  submitEvidenceResponse,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { triggerNotificationWorker } from '../../../../../lib/jobs';
import { withSession } from '../../../../../lib/session';
import { EVIDENCE_SENT_LINE } from '../../../../../lib/success-lines';

/**
 * Result surfaced back to the client for inline feedback. `savedAt` is set only when the server
 * confirmed the change, and is that confirmed moment, so "Saved at" on screen is never a guess.
 */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly savedAt?: string;
}

/**
 * The service's own sentences are written for developers in two common cases. Say them the way a
 * traveller needs to hear them; any other reason is passed on as the service wrote it.
 */
function plainSubmitReason(message: string): string {
  if (message === 'this request is not awaiting a submission') {
    return 'This request is no longer waiting for you. Refresh the page to see where it stands.';
  }
  if (message.startsWith('this document has not finished safety processing')) {
    return 'That file has not finished its safety checks, or could not be used. Choose another file, or wait a moment.';
  }
  if (message.startsWith('this organization no longer has access')) {
    return 'This agency no longer has access to your records, so nothing was sent. You can ask them to start a new request.';
  }
  // The page's retry key or chosen copy no longer matches what is on record: the page is old.
  if (
    message === 'the retry key is not valid' ||
    message.startsWith('this retry key was already used') ||
    message.startsWith('Choosing an exact version is not available yet')
  ) {
    return 'This page is out of date. Refresh it and choose again.';
  }
  if (message === 'evidence request not found') {
    return 'This request could not be found. Refresh the page to see where it stands.';
  }
  return message;
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
  // The page's own retry key, when it sends one: pressing Send twice then answers with the first
  // send instead of an error. Absent, the service numbers the send itself.
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '').trim() || undefined;
  // The exact file version the person saw when they chose: the agency gets that copy, never a newer one.
  const documentVersionId = String(formData.get('documentVersionId') ?? '').trim() || undefined;
  if (requestId.length === 0 || (!factId && !documentId)) {
    return { ok: false, message: 'Choose what to submit.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const submitted = await submitEvidenceResponse(db, {
      actorAccountId: accountId,
      requestId,
      ...(factId ? { factId } : {}),
      ...(documentId ? { documentId } : {}),
      ...(documentId && documentVersionId ? { documentVersionId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    if (!submitted.ok) {
      return {
        ok: false,
        message: plainSubmitReason(submitted.error.message),
      } satisfies ActionState;
    }
    return {
      ok: true,
      message: EVIDENCE_SENT_LINE,
      savedAt: (submitted.value.respondedAt ?? submitted.value.updatedAt).toISOString(),
    } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath(`/app/applicant/${applicantId}/evidence`);
    // The agency hears about the new answer now, not at the next daily run.
    after(() => triggerNotificationWorker().then(() => undefined));
  }
  return result;
}

/**
 * The owner asks the agency a short question about one request. It becomes a shared note on the
 * request's own case (the existing comment mechanism); access is checked on that case, and the
 * service checks the request belongs to it.
 */
export async function askAboutRequestItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const question = String(formData.get('question') ?? '');
  if (applicantId.length === 0 || missionId.length === 0 || requestId.length === 0) {
    return { ok: false, message: 'This question could not be sent.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'COMMENT',
      { missionId },
      { purpose: 'owner_request_question' },
    );
    if (!access.ok || access.value.applicant.id !== applicantId) {
      return { ok: false, message: 'This question could not be sent.' } satisfies ActionState;
    }
    const asked = await askAboutRequestItem(access.value, { requestId, question });
    if (!asked.ok) return { ok: false, message: asked.error.message } satisfies ActionState;
    return {
      ok: true,
      message: 'The agency can read it in the case notes.',
      savedAt: asked.value.createdAt.toISOString(),
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/applicant/${applicantId}/evidence`);
  return result;
}
