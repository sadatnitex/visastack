// Browser-safe copies of the consent vocabulary (the services package is server code). A test
// pins them to the services constants, so the two can never drift apart.
export const AI_CONNECTION_LAYERS = [
  'identity',
  'travel_documents',
  'timelines',
  'money',
  'people',
  'qualifications',
  'declarations',
  'health',
] as const;
export type AiConnectionLayer = (typeof AI_CONNECTION_LAYERS)[number];
export const AI_CONNECTION_DEFAULT_LAYERS: readonly AiConnectionLayer[] = [
  'identity',
  'travel_documents',
];
export const AI_CONNECTION_WARNING_LAYERS: readonly AiConnectionLayer[] = [
  'declarations',
  'health',
];
export const AI_CONNECTION_DURATIONS = ['1h', '24h', '7d', '30d', 'until_off'] as const;
export type AiConnectionDuration = (typeof AI_CONNECTION_DURATIONS)[number];
export const AI_CONNECTION_DEFAULT_DURATION: AiConnectionDuration = '30d';
