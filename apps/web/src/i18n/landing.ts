import { defineCatalog } from '@visastack/i18n';
import { LANDING_MESSAGES, type LandingKey } from './landing-messages';

/**
 * The approved homepage's catalogue (LAND1). English is every message's `en`; Bengali is only the
 * messages marked `live` in `landing-messages.ts`. A held message (claim, authority, status or
 * example wording, waiting for sign-off) has no Bengali here, so a Bengali visitor reads English,
 * marked as English, exactly as for any other message without a Bengali value.
 */
const keys = Object.keys(LANDING_MESSAGES) as LandingKey[];

const en = Object.fromEntries(keys.map((key) => [key, LANDING_MESSAGES[key].en])) as Record<
  LandingKey,
  string
>;
const bn = Object.fromEntries(
  keys.filter((key) => LANDING_MESSAGES[key].live).map((key) => [key, LANDING_MESSAGES[key].bn]),
) as Partial<Record<LandingKey, string>>;

export const landingCatalog = defineCatalog({ en, bn });
