import { GRANT_EXTENSION_DAYS, extendedGrantEnd } from '@visastack/services';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a grant row should offer Keep Sharing for 30 More Days: it is active, has not ended and
 * has an end date, and one more extension would add the full 30 days (sharing never runs past
 * 90 days from today, so a grant already near that ceiling offers nothing). A paused, revoked, waiting or ended grant offers nothing. Pure, so the
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
  // Only when the whole 30 days are on offer, so the button never promises more than it gives.
  return (
    extendedGrantEnd(current, now).getTime() - current.getTime() === GRANT_EXTENSION_DAYS * DAY_MS
  );
}
