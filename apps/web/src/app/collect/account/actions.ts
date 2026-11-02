'use server';

import {
  accountPrincipal,
  requireAccess,
  submitCollectionResponse,
  withdrawCollectionResponse,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withSession } from '../../../lib/session';
import { establishStepUpProof } from '../../../lib/step-up';
import { collectSwitchOn } from '../load';
import { heldCollectionLink } from './link';
import { answerHref, choiceFieldName } from './terms';

/**
 * Answering an agency request from your own record (UMPE P7). Every action re-reads the link the
 * browser holds and the person's own access, live; nothing on the page is trusted. Submitting is a
 * sharing decision, so it asks for a recent sign-in, like every other share (a fresh sign-in passes
 * at once).
 */

export interface ResponseActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
}

const OUT_OF_DATE: ResponseActionState = {
  ok: false,
  message: 'This page is out of date. Open the request again from your message and check it.',
};

const CLOSED: ResponseActionState = {
  ok: false,
  message: 'This request link is not open any more. Open it again from the message you received.',
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Each issued item's chosen copies, from the form's `choice:<item id>` fields. */
function selectionsFrom(formData: FormData, itemIds: readonly string[]): Record<string, string[]> {
  const selections: Record<string, string[]> = {};
  for (const itemId of itemIds) {
    const chosen = formData
      .getAll(choiceFieldName(itemId))
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (chosen.length > 0) selections[itemId] = chosen;
  }
  return selections;
}

export async function submitResponseAction(
  _prev: ResponseActionState,
  formData: FormData,
): Promise<ResponseActionState> {
  if (!collectSwitchOn()) return CLOSED;
  const personId = text(formData, 'personId');
  const itemIds = formData
    .getAll('itemId')
    .filter((value): value is string => typeof value === 'string');
  if (formData.get('consent') !== 'on') {
    return {
      ok: false,
      message: 'Tick the box to agree to share what you chose.',
      field: 'consent',
    };
  }
  const link = await heldCollectionLink();
  const linkId = text(formData, 'linkId');
  // The answer goes only to the request this page was opened for: the service refuses it when the
  // session now opens another request's link (another tab), never quietly answering that one.
  if (!link || linkId.length === 0) return OUT_OF_DATE;

  const outcome = await withSession(async ({ db, accountId }) => {
    const selections = selectionsFrom(formData, itemIds);
    const stepUp = await establishStepUpProof(
      { accountId, action: 'SHARE', resourceId: personId },
      // Back to the same page with exactly what was ticked, never the first proposal again.
      answerHref(personId, Object.values(selections).flat()),
    );
    if (stepUp.kind === 'reauth_required') return { next: stepUp.reauthUrl } as const;
    if (stepUp.kind !== 'proof') {
      return {
        state: { ok: false, message: 'Sharing is not available right now. Try again later.' },
      } as const;
    }
    const person = await requireAccess(
      db,
      accountPrincipal(accountId),
      'SHARE',
      { applicantId: personId },
      { purpose: 'collection_response', stepUp: stepUp.proof },
    );
    if (!person.ok) {
      return {
        state: { ok: false, message: 'Choose one of your own people.', field: 'personId' },
      } as const;
    }
    const submitted = await submitCollectionResponse(db, link.proof, person.value, {
      selections,
      // The wording version this page showed; a newer one is refused, never assumed.
      consentVersion: text(formData, 'consentVersion'),
      linkId,
      revisionId: text(formData, 'revisionId'),
    });
    if (!submitted.ok) {
      return {
        state:
          submitted.error.code === 'not_found'
            ? CLOSED
            : { ok: false, message: submitted.error.message },
      } as const;
    }
    return { next: '/collect/account/answers?sent=1' } as const;
  });
  if ('next' in outcome) redirect(outcome.next);
  return outcome.state;
}

export async function withdrawResponseAction(
  _prev: ResponseActionState,
  formData: FormData,
): Promise<ResponseActionState> {
  // Taking access away always works, whatever the switch says.
  const personId = text(formData, 'personId');
  const responseId = text(formData, 'responseId');
  const result = await withSession(async ({ db, accountId }) => {
    const person = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId: personId },
      { purpose: 'collection_response' },
    );
    if (!person.ok) return false;
    const withdrawn = await withdrawCollectionResponse(db, person.value, responseId);
    return withdrawn.ok;
  });
  if (!result) {
    return { ok: false, message: 'This answer was already withdrawn or is not available.' };
  }
  revalidatePath('/collect/account/answers');
  redirect('/collect/account/answers?withdrawn=1');
}
