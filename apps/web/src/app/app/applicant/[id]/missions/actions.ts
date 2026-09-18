'use server';

import { createMission } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Create a mission for an applicant, then redirect into its workspace. */
export async function createMissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const destination = String(formData.get('destination') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim();
  const itineraryRef = String(formData.get('itineraryRef') ?? '').trim();
  if (title.length === 0) return { ok: false, message: 'Give the mission a title.' };

  const outcome = await withSession(async ({ db, accountId }) => {
    const created = await createMission(db, {
      actorAccountId: accountId,
      applicantId,
      title,
      ...(destination.length > 0 ? { destination } : {}),
      ...(purpose.length > 0 ? { purpose } : {}),
      ...(itineraryRef.length > 0 ? { itineraryRef } : {}),
    });
    if (!created.ok) {
      return { state: { ok: false, message: created.error.message } as ActionState, id: null };
    }
    return { state: { ok: true, message: '' } as ActionState, id: created.value.id };
  });

  if (outcome.id) {
    revalidatePath(`/app/applicant/${applicantId}/missions`);
    redirect(`/app/mission/${outcome.id}`);
  }
  return outcome.state;
}
