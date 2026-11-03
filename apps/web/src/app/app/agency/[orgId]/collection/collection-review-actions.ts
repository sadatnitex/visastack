'use server';

import {
  agencyCollectionPrincipal,
  placeGuestHold,
  recordCollectionReview,
  releaseGuestHold,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { reportServerError } from '../../../../../lib/server-error';
import { withSession } from '../../../../../lib/session';

/**
 * The agency's review of an answer to its document request (UMPE P9), for answers from a signed-in
 * traveller and from a guest alike, and its legal hold on a request's guest files. The scope is
 * re-checked live on every action (an active owner or admin of this agency); the services refuse
 * anything that is not this agency's own live answer, the same way for every refusal.
 */

export interface ReviewActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
}

const UNAVAILABLE: ReviewActionState = {
  ok: false,
  message: 'This answer is no longer available. Reload the page.',
};

/** Record Received, Needs Correction (with a note per item) or Accepted. */
export async function reviewAnswerAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const source = formData.get('source') === 'guest' ? 'guest' : 'account';
  const answerId = String(formData.get('answerId') ?? '');
  const decision = formData.get('decision');
  if (typeof decision !== 'string' || decision === '') {
    return { ok: false, message: 'Choose a decision.', field: 'decision' };
  }
  const itemNotes: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('note:') && typeof value === 'string') itemNotes[key.slice(5)] = value;
  }
  try {
    const result = await withSession(async ({ db, accountId }) => {
      const scope = await agencyCollectionPrincipal(db, accountId, organizationId);
      if (!scope.ok) return null;
      return recordCollectionReview(db, scope.value, {
        source,
        answerId,
        decision,
        note: formData.get('note'),
        itemNotes,
      });
    });
    if (!result) return UNAVAILABLE;
    if (!result.ok) {
      return result.error.code === 'invalid'
        ? { ok: false, message: result.error.message, field: 'decision' }
        : UNAVAILABLE;
    }
    revalidatePath(`/app/agency/${organizationId}/collection/request`);
    return {
      ok: true,
      message:
        result.value.decision !== 'NEEDS_CORRECTION'
          ? 'Saved.'
          : source === 'guest'
            ? 'Saved. The person sees your notes when they next open the request.'
            : 'Saved for your team. A signed-in person does not see these notes yet: tell them directly what to correct.',
    };
  } catch (error) {
    reportServerError('collectionReview', error, { step: 'review failed', requestId });
    return { ok: false, message: 'Your decision could not be saved. Try again in a minute.' };
  }
}

/** Place or release the legal hold on this request's guest files. */
export async function guestHoldAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const release = formData.get('intent') === 'release';
  try {
    const result = await withSession(async ({ db, accountId }) => {
      const scope = await agencyCollectionPrincipal(db, accountId, organizationId);
      if (!scope.ok) return null;
      return release
        ? releaseGuestHold(db, scope.value, requestId)
        : placeGuestHold(db, scope.value, requestId, formData.get('reason'));
    });
    if (!result) return UNAVAILABLE;
    if (!result.ok) {
      return result.error.code === 'invalid'
        ? { ok: false, message: result.error.message, field: 'reason' }
        : UNAVAILABLE;
    }
    revalidatePath(`/app/agency/${organizationId}/collection/request`);
    return {
      ok: true,
      message: release
        ? 'Hold released. The periods the guests chose apply again.'
        : 'Hold placed. Guest files of this request are kept until you release it.',
    };
  } catch (error) {
    reportServerError('collectionReview', error, { step: 'hold failed', requestId });
    return { ok: false, message: 'The hold could not be changed. Try again in a minute.' };
  }
}
