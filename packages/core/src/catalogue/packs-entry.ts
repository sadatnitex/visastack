import { PROFILE_PACKS } from '../domain';
import { PROPOSED_PACK_KEYS } from './types';

/**
 * Every name a sharing grant may use to limit what a recipient sees: the five live profile packs plus the
 * seven new ones from the Master Profile catalogue. A small entry on purpose, so code that only checks
 * names does not pull in the whole catalogue.
 *
 * Knowing a name is not the same as showing it. A grant screen offers only the categories that hold data
 * the person can actually see, and a category with no matching fields or documents shows a recipient
 * nothing, so adding a name here widens no existing access.
 */
export const SHARING_CATEGORIES: readonly string[] = [...PROFILE_PACKS, ...PROPOSED_PACK_KEYS];

export function isSharingCategory(name: string): boolean {
  return SHARING_CATEGORIES.includes(name);
}
