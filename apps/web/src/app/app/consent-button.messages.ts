import type { Messages } from '../../lib/client-messages';

/** The words `ConsentButton` shows; the page picks them with `pickMessages(locale, CONSENT_BUTTON_KEYS)`. */
export const CONSENT_BUTTON_KEYS = [
  'consent.action.grant',
  'consent.action.revoke',
  'consent.saving',
] as const;

export type ConsentButtonMessages = Messages<(typeof CONSENT_BUTTON_KEYS)[number]>;
