import type { ServiceMessageKey } from '@visastack/services/i18n';

/**
 * The companion refusals that are about the email address the organiser typed (a bad address, their
 * own address, an address already on the trip, no address to send to). Told apart by key, not by
 * the words, since the words are shown in the visitor's language.
 */
const EMAIL_REFUSALS: ReadonlySet<string> = new Set<ServiceMessageKey>([
  'umpe_trip_companions.enter_a_valid_email_address_or',
  'umpe_trip_companions.that_is_your_own_email_address',
  'umpe_trip_companions.you_have_already_added_someone_with',
  'umpe_trip_companions.this_person_has_no_email_address',
]);

/** Which Add Someone Else field an `invalid` companion refusal is about. */
export function companionRefusalField(error: {
  readonly message: string;
  readonly messageKey?: string;
}): 'newPersonEmail' | 'newPersonName' {
  const aboutEmail =
    error.messageKey === undefined
      ? /email/i.test(error.message)
      : EMAIL_REFUSALS.has(error.messageKey);
  return aboutEmail ? 'newPersonEmail' : 'newPersonName';
}
