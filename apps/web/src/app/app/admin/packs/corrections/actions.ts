'use server';

import { type CorrectionDecision, reviewChecklistCorrection } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import { withSession } from '../../../../../lib/session';

/**
 * Checklist Corrections (UMPE P11): an editor's decision on one suggestion. Pack management rights
 * (`PACK_MANAGE`) are checked live for each request and handed to the service as a staff scope.
 * A decision records the decision only: no pack content is created, approved or published.
 */

export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };
const PATH = '/app/admin/packs/corrections';

const DECISIONS: readonly CorrectionDecision[] = ['IN_REVIEW', 'DISMISSED', 'ACCEPTED_FOR_DRAFT'];

function isDecision(value: string): value is CorrectionDecision {
  return (DECISIONS as readonly string[]).includes(value);
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

/** Mark In Review, Dismiss or Accept for Draft. Pack management only. */
export async function reviewCorrectionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const correctionId = text(formData, 'correctionId');
  const decision = text(formData, 'decision');
  const note = text(formData, 'note');
  if (!isDecision(decision)) return { ok: false, message: 'Choose a decision.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PACK_MANAGE',
    );
    if (!staff.ok) return DENIED;
    const decided = await reviewChecklistCorrection(db, staff.value, {
      correctionId,
      decision,
      ...(note.length > 0 ? { note } : {}),
    });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    const message =
      decision === 'ACCEPTED_FOR_DRAFT'
        ? 'Decision recorded. Write the change as a draft version in Pack Studio.'
        : decision === 'DISMISSED'
          ? 'Suggestion dismissed.'
          : 'Marked in review.';
    return { ok: true, message } satisfies ActionState;
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}
