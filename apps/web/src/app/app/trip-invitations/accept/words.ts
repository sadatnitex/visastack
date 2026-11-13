import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';

/**
 * The words of the trip invitation screens that more than one file says. One refusal for every bad
 * invitation (missing, malformed, expired, used, declined, removed, or meant for another address)
 * and one for every kind of "too many tries", so nothing on the page or in an action's answer says
 * which case it was, or whether an address has an account.
 */

/*
 * The refusals the service also gives, by the service's own key, so the screen and the service say
 * the same words in every language (the English below is the service's, byte for byte).
 */
export const INVITATION_UNAVAILABLE_KEY =
  'umpe_trip_companion_case.this_invitation_is_not_available' satisfies ServiceMessageKey;
export const INVITATION_BUSY_KEY =
  'umpe_trip_companions.too_many_tries_in_a_short' satisfies ServiceMessageKey;
export const SHARE_LEVEL_PROBLEM_KEY =
  'umpe_trip_companions.choose_how_much_you_want_to' satisfies ServiceMessageKey;

export const INVITATION_UNAVAILABLE = serviceMessages.en[INVITATION_UNAVAILABLE_KEY];
export const INVITATION_BUSY = serviceMessages.en[INVITATION_BUSY_KEY];
export const SHARE_LEVEL_PROBLEM = serviceMessages.en[SHARE_LEVEL_PROBLEM_KEY];
export const CONSENT_FIRST = 'Turn on the consent above to join this trip.';
