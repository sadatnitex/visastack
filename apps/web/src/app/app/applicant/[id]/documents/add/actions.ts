'use server';

import { hasConsent, setConsent } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { isRecordId } from '../../../../../../lib/record-id';
import { withSession } from '../../../../../../lib/session';

const CHANGE_FAILED: ReadingActionState = {
  ok: false,
  message: 'We could not change this just now. Try again in a minute.',
};

export interface ReadingActionState {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * The person's own switch for automatic reading on Add Documents. It sets the two consents the
 * reading job checks together (Let AI Read Details from My Documents, Let AI Read Text from My
 * Scans), for the signed-in account only, through the same consent service as the Privacy page, so
 * every change is recorded there. It never touches the platform switch: that one is not a person's
 * to turn on or off.
 */
export async function setReadingAction(
  _previous: ReadingActionState,
  formData: FormData,
): Promise<ReadingActionState> {
  const choice = formData.get('choice');
  if (choice !== 'on' && choice !== 'off') return { ok: false, message: 'Choose On or Off.' };
  const granted = choice === 'on';
  const applicantId = String(formData.get('applicantId') ?? '');
  let result: ReadingActionState;
  try {
    result = await withSession(async ({ db, accountId }) => {
      for (const type of ['AI_EXTRACTION', 'AI_OCR'] as const) {
        // A consent already as asked is left alone, so the record shows only real changes.
        if ((await hasConsent(db, accountId, type)) === granted) continue;
        const set = await setConsent(db, { actorAccountId: accountId, accountId, type, granted });
        if (!set.ok) return CHANGE_FAILED;
      }
      return {
        ok: true,
        message: granted ? 'Automatic reading is on for you.' : 'Automatic reading is off for you.',
      } satisfies ReadingActionState;
    });
  } catch (error) {
    // A sign-in redirect raised inside the session passes through; anything else is a plain line.
    unstable_rethrow(error);
    result = CHANGE_FAILED;
  }
  // The page shows the truth after either outcome: a change that stopped halfway is shown as it is.
  if (isRecordId(applicantId)) revalidatePath(`/app/applicant/${applicantId}/documents/add`);
  revalidatePath('/app/privacy');
  return result;
}
