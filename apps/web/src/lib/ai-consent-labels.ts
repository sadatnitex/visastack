import type { AiConnectionDuration, AiConnectionLayer } from './ai-consent-choices';

/** What each choice on the AI app consent screen is called (ADR 0021 section 5). */
export const AI_LAYER_LABELS: Readonly<Record<AiConnectionLayer, string>> = {
  identity: 'Personal Details',
  travel_documents: 'Passports and Travel Documents',
  timelines: 'Travel, Home and Work History',
  money: 'Money',
  people: 'Family and Sponsors',
  qualifications: 'Education and Qualifications',
  declarations: 'Past Refusals and Declarations',
  health: 'Health',
};

/** One plain sentence under each choice. */
export const AI_LAYER_NOTES: Readonly<Record<AiConnectionLayer, string>> = {
  identity:
    'Name, date of birth, nationality and contact details. Numbers show only their last three characters.',
  travel_documents: 'Passport and visa details and their dates.',
  timelines: 'Past trips, where you lived and where you worked.',
  money: 'Income, savings and who pays for the trip.',
  people: 'Family members, sponsors and the people you visit.',
  qualifications: 'Schools, degrees and certificates.',
  declarations:
    'Sensitive: past visa refusals and legal declarations. Allow only if the app needs them.',
  health: 'Sensitive: health details. Allow only if the app needs them.',
};

export const AI_DURATION_LABELS: Readonly<Record<AiConnectionDuration, string>> = {
  '1h': '1 Hour',
  '24h': '24 Hours',
  '7d': '7 Days',
  '30d': '30 Days',
  until_off: 'Until I Turn It Off',
};
