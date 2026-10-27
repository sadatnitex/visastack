'use server';

import { recordCountryChecklistStarted } from '@visastack/services';
import { redirect } from 'next/navigation';
import { parseCountryParam } from '../../lib/country-start';
import { permissionStepHref } from '../../lib/country-start-links';
import { withSession } from '../../lib/session';

/**
 * First run's country step (Growth G2): the signed-in person confirmed a country. Records one
 * product event for the account (the country code, once per account, nothing else) and moves on
 * to the permission screen with the country carried in the address. A code that is not a country
 * we hold records nothing and moves on without one. Needs a signed-in, confirmed account like
 * every other action here, so a visitor is never recorded.
 */
export async function confirmFirstRunCountryAction(formData: FormData): Promise<void> {
  const iso2 = parseCountryParam(formData.get('country'));
  if (iso2 !== null) {
    await withSession(async ({ db, accountId }) => {
      await recordCountryChecklistStarted(db, { accountId, iso2 });
    });
  }
  redirect(permissionStepHref(iso2));
}
