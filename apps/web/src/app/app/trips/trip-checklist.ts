import { type Db, attachPackVersion } from '@visastack/services';
import { checklistToLink } from '../../../lib/case-checklist-match';
import {
  caseCountryOptions,
  casePurposeGroups,
  countryMatchTerms,
  purposeMatchTerms,
} from '../../../lib/case-choices';
import { reportServerError } from '../../../lib/server-error';

/**
 * UMPE P5: link the one published checklist that certainly covers a traveller's NEW case on a
 * group trip, the same way Start a Trip does. The trip stores the destination and purpose by their
 * plain names, so they are looked up again here. Best effort: a refusal or failure leaves the case
 * without a checklist, and the case page then asks the person to pick one. Never a server action.
 */
export async function linkTripChecklist(
  db: Db,
  accountId: string,
  missionId: string,
  destinationName: string,
  purposeLabel: string,
): Promise<void> {
  const country = caseCountryOptions().find((c) => c.name === destinationName);
  const purpose = casePurposeGroups()
    .flatMap((group) => group.options)
    .find((option) => option.label === purposeLabel);
  if (!country || !purpose) return;
  try {
    const match = await checklistToLink(db, {
      accountId,
      missionId,
      country: countryMatchTerms(country),
      purpose: purposeMatchTerms(purpose),
    });
    if (!match) return;
    const attached = await attachPackVersion(db, {
      actorAccountId: accountId,
      missionId,
      packVersionId: match.packVersionId,
    });
    if (!attached.ok) {
      reportServerError('groupTripChecklist', new Error(attached.error.code), {
        step: 'checklist link refused',
      });
    }
  } catch (error) {
    reportServerError('groupTripChecklist', error, { step: 'checklist link' });
  }
}
