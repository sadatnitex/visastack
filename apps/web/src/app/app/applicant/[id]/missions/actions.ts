'use server';

import { attachPackVersion, createMission, findMatchingPublicPack } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { countryMatchTerms, purposeMatchTerms } from '../../../../../lib/case-choices';
import { withSession } from '../../../../../lib/session';
import { readCaseForm } from './case-form';
import type { ActionState } from './case-form-fields';

export type { ActionState } from './case-form-fields';

/** Plain words for the refusals a person can meet here; anything else keeps the service's words. */
const REFUSAL_WORDS: Readonly<Partial<Record<string, string>>> = {
  consent_required: 'Turn on Let VisaStack Process My Details on Home, then start the case.',
  forbidden: 'This traveller is not available to you.',
  not_found: 'This traveller is not available to you.',
};

/**
 * Create a case for an applicant, then open it at the top with its welcome note. When exactly one
 * published checklist covers the chosen country and purpose it is linked straight away, through
 * the same owner-checked attach the case page uses; otherwise the case page asks the person to
 * pick one. The service still checks ownership, consent and the title itself.
 */
export async function createMissionAction(
  prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const read = readCaseForm(formData, (prev.attempt ?? 0) + 1);
  if (!read.ok) return read.state;
  const { input } = read;

  const outcome = await withSession(async ({ db, accountId }) => {
    const created = await createMission(db, {
      actorAccountId: accountId,
      applicantId: input.applicantId,
      title: input.title,
      ...(input.country ? { destination: input.country.name } : {}),
      ...(input.purpose ? { purpose: input.purpose.label } : {}),
      ...(input.itineraryRef.length > 0 ? { itineraryRef: input.itineraryRef } : {}),
      ...(input.jurisdiction.length > 0 ? { jurisdiction: input.jurisdiction } : {}),
      ...(input.serviceCategory.length > 0 ? { serviceCategory: input.serviceCategory } : {}),
      ...(input.travelStartDate ? { travelStartDate: input.travelStartDate } : {}),
      ...(input.travelEndDate ? { travelEndDate: input.travelEndDate } : {}),
      ...(input.targetDeadline ? { targetDeadline: input.targetDeadline } : {}),
    });
    if (!created.ok) {
      const state: ActionState = {
        ok: false,
        message: REFUSAL_WORDS[created.error.code] ?? created.error.message,
        values: read.values,
        attempt: (prev.attempt ?? 0) + 1,
      };
      return { state, id: null };
    }
    if (input.country && input.purpose) {
      const match = await findMatchingPublicPack(db, {
        country: countryMatchTerms(input.country),
        purpose: purposeMatchTerms(input.purpose),
      });
      // A refused attach leaves the case without a checklist; the case page then says so.
      if (match) {
        await attachPackVersion(db, {
          actorAccountId: accountId,
          missionId: created.value.id,
          packVersionId: match.packVersionId,
        });
      }
    }
    return { state: { ok: true, message: '' } as ActionState, id: created.value.id };
  });

  if (outcome.id) {
    revalidatePath(`/app/applicant/${input.applicantId}/missions`);
    redirect(`/app/mission/${outcome.id}?welcome=1`);
  }
  return outcome.state;
}
