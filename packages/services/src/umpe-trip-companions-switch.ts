import { switchOn } from '@visastack/core';

/** The switch for travelling with someone else, trip companions and their invitations (UMPE UX6). */
export const TRIP_COMPANIONS_SWITCH = 'UMPE_TRIP_COMPANIONS_ENABLED';

/**
 * Whether trip companions are on: `UMPE_TRIP_COMPANIONS_ENABLED`, off by default and on only for the
 * word "true" (the shared reading of new switches). Off, every reader answers "nothing" or "not
 * found", every writer refuses plainly, and the accept page is a not-found page.
 */
export function tripCompanionsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return switchOn(env[TRIP_COMPANIONS_SWITCH]);
}
