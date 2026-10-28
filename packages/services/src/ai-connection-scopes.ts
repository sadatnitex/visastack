import type { DocumentGroupKey, LayerKey } from '@visastack/core/catalogue';
import type { Selection, SelectionDepth } from './selected-output';

/**
 * What a person lets their own AI app read (ADR 0021 section 5), in one vocabulary shared by the
 * consent screen, the stored connection and the context composer. The stored connection is the
 * authority: the OAuth scopes in a token only describe it, and a change made in VisaStack takes
 * effect on the next call.
 */

/** The record sections a person can choose, in the order the consent screen lists them. */
export const AI_CONNECTION_LAYERS = [
  'identity',
  'travel_documents',
  'timelines',
  'money',
  'people',
  'qualifications',
  'declarations',
  'health',
] as const satisfies readonly LayerKey[];
export type AiConnectionLayer = (typeof AI_CONNECTION_LAYERS)[number];

/** Sections that are on unless the person turns them off. Everything else starts off. */
export const AI_CONNECTION_DEFAULT_LAYERS: readonly AiConnectionLayer[] = [
  'identity',
  'travel_documents',
];

/** Sections shown with a warning, because what they hold is sensitive. */
export const AI_CONNECTION_WARNING_LAYERS: readonly AiConnectionLayer[] = [
  'declarations',
  'health',
];

/**
 * Which document groups' read text a granted section allows, when the person also turns on
 * "Text Read From My Documents". Photos and biometrics never; a group outside every chosen
 * section never. The composer still refuses any document type the platform protects.
 */
export const AI_DOCUMENT_TEXT_GROUPS: Readonly<
  Record<AiConnectionLayer, readonly DocumentGroupKey[]>
> = {
  identity: ['identity_civil'],
  travel_documents: ['travel_immigration', 'application_receipts'],
  timelines: ['employment_business', 'accommodation_host'],
  money: ['financial'],
  people: ['family_relationship'],
  qualifications: ['education_qualifications'],
  declarations: ['legal_clearances'],
  health: ['medical'],
};

/** How long a connection lasts. `null` is "until I turn it off". */
export const AI_CONNECTION_DURATIONS = ['1h', '24h', '7d', '30d', 'until_off'] as const;
export type AiConnectionDuration = (typeof AI_CONNECTION_DURATIONS)[number];
export const AI_CONNECTION_DEFAULT_DURATION: AiConnectionDuration = '30d';

const DURATION_MS: Record<Exclude<AiConnectionDuration, 'until_off'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** When a connection made now ends, or `null` for "until I turn it off". */
export function aiConnectionExpiry(duration: AiConnectionDuration, now: Date): Date | null {
  return duration === 'until_off' ? null : new Date(now.getTime() + DURATION_MS[duration]);
}

export type AiCaseMode = 'NONE' | 'ONE' | 'ALL_CURRENT';

/** Everything the person chose on the consent screen. */
export interface AiConnectionChoices {
  readonly layers: readonly AiConnectionLayer[];
  readonly caseMode: AiCaseMode;
  /** Required when `caseMode` is `ONE`. */
  readonly missionId?: string;
  readonly documentList: boolean;
  readonly documentText: boolean;
  readonly revealIdentifiers: boolean;
  readonly duration: AiConnectionDuration;
}

const DOCUMENT_LIST_SCOPE = 'document_list';
const DOCUMENT_TEXT_SCOPE = 'document_text';

/** The stored form of the choices: one string per granted thing, nothing else. */
export function scopesFromChoices(choices: AiConnectionChoices): string[] {
  const layers = AI_CONNECTION_LAYERS.filter((layer) => choices.layers.includes(layer));
  return [
    ...layers,
    ...(choices.documentList ? [DOCUMENT_LIST_SCOPE] : []),
    ...(choices.documentText && layers.length > 0 ? [DOCUMENT_TEXT_SCOPE] : []),
  ];
}

/** The OAuth scope names a token describes itself with (informative only). */
export function oauthScopeNames(scopes: readonly string[]): string[] {
  return scopes.map((scope) => `visastack.${scope}`);
}

/** Every OAuth scope this server can describe, for discovery metadata. */
export const AI_OAUTH_SCOPES_SUPPORTED: readonly string[] = [
  ...oauthScopeNames([...AI_CONNECTION_LAYERS, DOCUMENT_LIST_SCOPE, DOCUMENT_TEXT_SCOPE]),
  'offline_access',
];

/** The parts of a stored connection the composer needs. */
export interface StoredAiChoices {
  readonly scopes: readonly string[];
  readonly caseMode: AiCaseMode;
  readonly missionId: string | null;
  readonly revealIdentifiers: boolean;
  readonly depth: string;
}

function isLayer(value: string): value is AiConnectionLayer {
  return (AI_CONNECTION_LAYERS as readonly string[]).includes(value);
}

function isDepth(value: string): value is SelectionDepth {
  return value === 'brief' || value === 'standard' || value === 'full';
}

/**
 * The composer's Selection for a stored connection. Unknown strings are ignored, never widened
 * into access. A one-case connection whose case was deleted covers no case.
 */
export function selectionFromStoredChoices(stored: StoredAiChoices): Selection {
  const layers = stored.scopes.filter(isLayer);
  const documentText = stored.scopes.includes(DOCUMENT_TEXT_SCOPE)
    ? [...new Set(layers.flatMap((layer) => AI_DOCUMENT_TEXT_GROUPS[layer]))]
    : [];
  return {
    layers,
    cases:
      stored.caseMode === 'ALL_CURRENT'
        ? { kind: 'all' }
        : stored.caseMode === 'ONE' && stored.missionId
          ? { kind: 'one', missionId: stored.missionId }
          : { kind: 'none' },
    documentList: stored.scopes.includes(DOCUMENT_LIST_SCOPE),
    documentText,
    revealIdentifiers: stored.revealIdentifiers,
    depth: isDepth(stored.depth) ? stored.depth : 'standard',
  };
}
