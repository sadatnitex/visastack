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

/** What the form starts with: the safe defaults, or what the person already chose. */
export interface ConsentInitial {
  readonly layers: readonly AiConnectionLayer[];
  /** 'all', 'none' or a case id. */
  readonly cases: string;
  readonly documentList: boolean;
  readonly documentText: boolean;
  readonly revealIdentifiers: boolean;
  readonly duration: AiConnectionDuration;
}

export const CONSENT_DEFAULTS: ConsentInitial = {
  layers: AI_CONNECTION_DEFAULT_LAYERS,
  cases: 'all',
  documentList: true,
  documentText: false,
  revealIdentifiers: false,
  duration: AI_CONNECTION_DEFAULT_DURATION,
};

/** The choices as query parameters, so a fresh sign-in check returns to the same screen. */
export function consentChoicesToQuery(choice: ConsentInitial): Record<string, string> {
  return {
    choice_layers: choice.layers.join(','),
    choice_cases: choice.cases,
    choice_list: choice.documentList ? '1' : '0',
    choice_text: choice.documentText ? '1' : '0',
    choice_reveal: choice.revealIdentifiers ? '1' : '0',
    choice_duration: choice.duration,
  };
}

/**
 * Reads choices back from the query. Anything unknown falls back to the safe default, so a crafted
 * link can only ever preselect what the person could have ticked themselves; they still press Allow.
 */
export function consentChoicesFromQuery(
  read: (name: string) => string | undefined,
): ConsentInitial {
  const layersRaw = read('choice_layers');
  if (layersRaw === undefined) return CONSENT_DEFAULTS;
  const layers = AI_CONNECTION_LAYERS.filter((layer) => layersRaw.split(',').includes(layer));
  const cases = read('choice_cases') ?? 'all';
  const duration = read('choice_duration');
  return {
    layers,
    cases: /^(all|none|[0-9a-f-]{36})$/i.test(cases) ? cases : 'all',
    documentList: read('choice_list') !== '0',
    documentText: read('choice_text') === '1',
    revealIdentifiers: read('choice_reveal') === '1',
    duration: (AI_CONNECTION_DURATIONS as readonly string[]).includes(duration ?? '')
      ? (duration as AiConnectionDuration)
      : AI_CONNECTION_DEFAULT_DURATION,
  };
}
