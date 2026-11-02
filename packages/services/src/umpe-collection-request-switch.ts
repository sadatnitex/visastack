import { switchOn } from '@visastack/core';

/** The switch for agency document requests sent before any traveller record (UMPE P6). */
export const AGENCY_COLLECTION_REQUESTS_SWITCH = 'AGENCY_COLLECTION_REQUESTS';

/**
 * Whether agency document requests are on: `AGENCY_COLLECTION_REQUESTS`, off by default and on only
 * for the word "true" (the shared reading of new switches). Off, the agency pages and the public
 * `/collect` page answer not found and every service refuses.
 */
export function agencyCollectionRequestsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return switchOn(env[AGENCY_COLLECTION_REQUESTS_SWITCH]);
}
