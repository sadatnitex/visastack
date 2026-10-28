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
export function consentChoicesToQuery(
  choice: Omit<ConsentInitial, 'duration'> & { readonly duration: string },
): Record<string, string> {
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

/**
 * The case choice the screen can actually show. A crafted or stale case id that is not one of the
 * record's listed cases falls back to all current cases, so a radio is always selected. When the
 * person came from a case (`openedFromCase`) and has not chosen yet, that one case is the default
 * (ADR 0021 section 5: "one case if opened from a case, else all current").
 */
export function settleConsentCases(
  initial: ConsentInitial,
  caseIds: readonly string[],
  openedFromCase?: string,
): ConsentInitial {
  if (initial === CONSENT_DEFAULTS && openedFromCase && caseIds.includes(openedFromCase)) {
    return { ...initial, cases: openedFromCase };
  }
  if (initial.cases !== 'all' && initial.cases !== 'none' && !caseIds.includes(initial.cases)) {
    return { ...initial, cases: 'all' };
  }
  return initial;
}

/** On Change Access, "How Long" can also leave the end where it is. */
export const AI_KEEP_END = 'keep';
export type AiChangeDuration = AiConnectionDuration | typeof AI_KEEP_END;

export function isAiChangeDuration(value: string | undefined): value is AiChangeDuration {
  return (
    value === AI_KEEP_END || (AI_CONNECTION_DURATIONS as readonly string[]).includes(value ?? '')
  );
}

const CASE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The choices a consent or Change Access form sent, checked and in the stored vocabulary. */
export interface ParsedAiAccessChoices<D extends string> {
  readonly layers: AiConnectionLayer[];
  /** 'all', 'none' or a case id, as the form sent it (to show the same choice again). */
  readonly cases: string;
  readonly caseMode: 'NONE' | 'ONE' | 'ALL_CURRENT';
  readonly missionId?: string;
  readonly documentList: boolean;
  readonly documentText: boolean;
  readonly revealIdentifiers: boolean;
  readonly duration: D;
}

export type AiAccessChoicesParse<D extends string> =
  | { readonly ok: true; readonly value: ParsedAiAccessChoices<D> }
  | { readonly ok: false; readonly message: string; readonly field: 'cases' | 'duration' };

function formText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value.length <= 2048 ? value : undefined;
}

/**
 * Reads the AI access choices out of a submitted form: one parser for the consent screen and
 * Change Access, so the two can never read the same fields differently. Unknown parts are
 * dropped, a case must be a case id (the server still checks it is on the record), and How Long
 * must be one of the offered durations ("keep" only where Change Access offers it).
 */
export function parseAiAccessChoices(
  formData: FormData,
  options: { readonly allowKeep: true },
): AiAccessChoicesParse<AiChangeDuration>;
export function parseAiAccessChoices(
  formData: FormData,
  options?: { readonly allowKeep?: false },
): AiAccessChoicesParse<AiConnectionDuration>;
export function parseAiAccessChoices(
  formData: FormData,
  options: { readonly allowKeep?: boolean } = {},
): AiAccessChoicesParse<string> {
  const layers = AI_CONNECTION_LAYERS.filter((layer) => formData.getAll('layer').includes(layer));
  const cases = formText(formData, 'cases') || 'all';
  const caseMode = cases === 'none' ? 'NONE' : cases === 'all' ? 'ALL_CURRENT' : 'ONE';
  if (caseMode === 'ONE' && !CASE_ID_RE.test(cases)) {
    return { ok: false, message: 'Choose a case, all current cases or none.', field: 'cases' };
  }
  const duration =
    formText(formData, 'duration') ||
    (options.allowKeep ? AI_KEEP_END : AI_CONNECTION_DEFAULT_DURATION);
  const offered = options.allowKeep
    ? isAiChangeDuration(duration)
    : (AI_CONNECTION_DURATIONS as readonly string[]).includes(duration);
  if (!offered) {
    return { ok: false, message: 'Choose how long the app may read.', field: 'duration' };
  }
  return {
    ok: true,
    value: {
      layers,
      cases,
      caseMode,
      ...(caseMode === 'ONE' ? { missionId: cases } : {}),
      documentList: formData.get('document_list') === 'on',
      documentText: formData.get('document_text') === 'on',
      revealIdentifiers: formData.get('reveal_identifiers') === 'on',
      duration,
    },
  };
}
