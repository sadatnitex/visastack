import type { Messages } from '../../lib/client-messages';

/** The words `AddApplicantForm` shows; the page picks them with `pickMessages(locale, ADD_APPLICANT_KEYS)`. */
export const ADD_APPLICANT_KEYS = [
  'account.add.name',
  'account.add.relationship',
  'account.add.submit',
  'account.add.submitting',
  'applicant.relationship.self',
  'applicant.relationship.familyMember',
  'applicant.relationship.minorGuardian',
  'consent.authority.confirm',
] as const;

export type AddApplicantMessages = Messages<(typeof ADD_APPLICANT_KEYS)[number]>;
