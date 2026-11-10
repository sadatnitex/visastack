import { extendedGrantEnd } from '@visastack/services';

/**
 * Whether a grant row should offer Keep Sharing for 30 More Days: it is active, has not ended and
 * has an end date, and one more extension would actually move that date (sharing never runs past
 * 90 days from today). A paused, revoked, waiting or ended grant offers nothing. Pure, so the
 * page and its tests read the same rule the service enforces.
 */
export function canOfferExtension(
  grant: {
    readonly status: string;
    readonly expiryAt: Date | string | null;
  },
  now: Date = new Date(),
): boolean {
  if (grant.status !== 'ACTIVE' || grant.expiryAt === null) return false;
  const current = new Date(grant.expiryAt);
  if (Number.isNaN(current.getTime()) || current.getTime() <= now.getTime()) return false;
  return extendedGrantEnd(current, now).getTime() > current.getTime();
}
