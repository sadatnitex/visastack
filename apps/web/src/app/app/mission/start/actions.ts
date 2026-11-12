'use server';

import { type Db, accountPrincipal, openOrStartTripCase, requireAccess } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { attachChecklistFor, checklistToLink } from '../../../../lib/case-checklist-match';
import {
  type CaseCountryOption,
  type CasePurposeOption,
  casePurpose,
  countryMatchTerms,
  destinationRefusal,
  purposeMatchTerms,
  resolveCaseCountry,
} from '../../../../lib/case-choices';
import { reportServerError } from '../../../../lib/server-error';
import { refusalText } from '../../../../lib/service-error-message';
import { withSession } from '../../../../lib/session';

/** UMPE P4 (R13): one case per traveller from "Where are you going? Why? Who's travelling?". */

export interface TripStartState extends FormResult {
  /** The cases opened or started, one per traveller, when more than one traveller was chosen. */
  readonly cases?: readonly {
    readonly missionId: string;
    readonly name: string;
    readonly existing: boolean;
  }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRAVELLERS = 12;

/**
 * Link the one published checklist that certainly covers this case, the same way the case start
 * form does. Best effort: the case already exists, so a refusal or failure leaves it without a
 * checklist and the case page then asks the person to pick one.
 */
async function linkChecklistIfOneFits(
  db: Db,
  accountId: string,
  missionId: string,
  country: CaseCountryOption,
  purpose: CasePurposeOption,
): Promise<void> {
  try {
    const match = await checklistToLink(db, {
      accountId,
      missionId,
      country: countryMatchTerms(country),
      purpose: purposeMatchTerms(purpose),
    });
    if (!match) return;
    const attached = await attachChecklistFor(db, accountId, missionId, match.packVersionId);
    if (!attached.ok) {
      reportServerError('startTripAction', new Error(attached.error.code), {
        step: 'checklist link refused',
      });
    }
  } catch (error) {
    reportServerError('startTripAction', error, { step: 'checklist link' });
  }
}

export async function startTripAction(
  _prev: TripStartState,
  formData: FormData,
): Promise<TripStartState> {
  const typedDestination = String(formData.get('destination') ?? '');
  const country = resolveCaseCountry(typedDestination);
  if (!country) {
    return { ok: false, message: destinationRefusal(typedDestination), field: 'destination' };
  }
  const purpose = casePurpose(String(formData.get('purpose') ?? ''));
  if (!purpose) return { ok: false, message: 'Choose why you are travelling.', field: 'purpose' };
  const travellers = [
    ...new Set(
      formData
        .getAll('traveller')
        .map((v) => String(v))
        .filter((v) => UUID.test(v)),
    ),
  ].slice(0, MAX_TRAVELLERS);
  if (travellers.length === 0) {
    return { ok: false, message: 'Choose who is travelling.', field: 'traveller' };
  }

  let outcome: TripStartState;
  try {
    outcome = await withSession(async ({ db, accountId }) => {
      const cases: { missionId: string; name: string; existing: boolean }[] = [];
      for (const applicantId of travellers) {
        const proof = await requireAccess(
          db,
          accountPrincipal(accountId),
          'MANAGE',
          { applicantId },
          { purpose: 'owner_trip_start' },
        );
        if (!proof.ok) {
          return { ok: false, message: 'One of these travellers is not available to you.', cases };
        }
        const opened = await openOrStartTripCase(proof.value, {
          destination: country.name,
          purpose: purpose.label,
        });
        if (!opened.ok) {
          return {
            ok: false,
            message:
              opened.error.code === 'consent_required'
                ? 'Turn on Let VisaStack Process My Details on Home, then start the trip.'
                : await refusalText(opened.error),
            cases,
          };
        }
        if (!opened.value.existing) {
          await linkChecklistIfOneFits(db, accountId, opened.value.missionId, country, purpose);
        }
        cases.push({
          missionId: opened.value.missionId,
          name: proof.value.applicant.displayName,
          existing: opened.value.existing,
        });
      }
      return { ok: true, message: '', cases };
    });
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('startTripAction', error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
  const only = outcome.cases?.length === 1 ? outcome.cases[0] : undefined;
  if (outcome.ok) revalidatePath('/app');
  if (outcome.ok && only)
    redirect(`/app/mission/${only.missionId}${only.existing ? '' : '?welcome=1'}#trip-package`);
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    message: 'Each traveller has their own case. Open each one to prepare their package.',
    cases: outcome.cases ?? [],
  };
}
