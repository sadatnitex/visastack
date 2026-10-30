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

/** Which cases a connection covers. */
export const AI_CASE_MODES = ['NONE', 'ONE', 'ALL_CURRENT'] as const;
export type AiCaseMode = (typeof AI_CASE_MODES)[number];

/**
 * The read-only tools' names: the five of ADR 0021 section 6, then `get_document_file` (S20,
 * "Original Files"). The tool list in `ai-tools/` is typed against this, and its test pins the two
 * equal. Audit records and telemetry name a tool only from this list, never from what an app sent.
 */
export const AI_READ_TOOL_NAMES = [
  'prepare_context',
  'list_cases',
  'get_profile_section',
  'list_documents',
  'get_document_text',
  'get_document_file',
] as const;

/**
 * The read tool that gives a whole file (S20): only it gets the file gateway, and it works only
 * for the documents the person ticked under "Original Files" for this connection.
 */
export const AI_FILE_TOOL_NAMES = ['get_document_file'] as const;
export type AiFileToolName = (typeof AI_FILE_TOOL_NAMES)[number];

/**
 * The three suggestion tools (S21, ADR 0021 extension): each one only leaves something for the
 * person to look at (a suggestion waiting for approval, a draft, a reminder on their own case).
 * They work only while the person has turned on "Suggest Changes" for the connection.
 */
export const AI_SUGGESTION_TOOL_NAMES = [
  'suggest_profile_update',
  'save_draft',
  'add_reminder',
] as const;
export type AiSuggestionToolName = (typeof AI_SUGGESTION_TOOL_NAMES)[number];

export const AI_TOOL_NAMES = [...AI_READ_TOOL_NAMES, ...AI_SUGGESTION_TOOL_NAMES] as const;
export type AiKnownToolName = (typeof AI_TOOL_NAMES)[number];

/** A tool name as audit records and telemetry may hold it: a known name, or `unknown`. */
export function aiAuditToolName(tool: string): AiKnownToolName | 'unknown' {
  return AI_TOOL_NAMES.find((name) => name === tool) ?? 'unknown';
}

/** Why an AI call was refused, as recorded in the audit (never shown as an id or value). */
export const AI_DENIAL_REASONS = [
  'layer_not_granted',
  'cases_not_granted',
  'case_not_shared',
  'case_unavailable',
  'document_list_not_granted',
  'document_text_not_granted',
  'document_not_shared',
  'document_protected',
  'no_text',
  'too_large',
  'failed',
  // The suggestion tools (S21).
  'suggestions_not_granted',
  'field_not_shared',
  'write_limit',
  'case_finished',
  'consent_required',
  'not_available',
  'invalid_input',
  'feature_off',
  // AI App Access (S28): the person's daily limit of requests from AI apps is used up.
  'access_limit',
  // The file tool (S20).
  'files_not_granted',
  'file_not_chosen',
  'file_not_ready',
  'safe_copy_not_ready',
  'file_too_large',
  'file_type_unsupported',
  'file_limit',
  'safe_copy_limit',
] as const;
export type AiDenialReason = (typeof AI_DENIAL_REASONS)[number];

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
  /** "Suggest Changes" (S21): off unless the person turns it on. */
  readonly suggestChanges?: boolean;
  /**
   * "Original Files" (S20): the documents the person ticked, each as a Safe Copy (the default) or
   * the Original. Absent or empty: no file. Stored only while List of My Documents is on.
   */
  readonly files?: readonly AiFileChoice[];
}

/** How a ticked document may be given to the app. */
export const AI_FILE_VARIANTS = ['SAFE_COPY', 'ORIGINAL'] as const;
export type AiFileVariant = (typeof AI_FILE_VARIANTS)[number];
export const AI_FILE_DEFAULT_VARIANT: AiFileVariant = 'SAFE_COPY';

/** One ticked document under "Original Files". */
export interface AiFileChoice {
  readonly documentId: string;
  /** Absent means a Safe Copy. */
  readonly variant?: AiFileVariant;
}

/** At most this many documents can be ticked for one connection. */
export const AI_FILE_CHOICES_MAX = 50;

/** Whether a stored or submitted variant is one of the two; anything else is not one. */
export function isAiFileVariant(value: unknown): value is AiFileVariant {
  return value === 'SAFE_COPY' || value === 'ORIGINAL';
}

const DOCUMENT_LIST_SCOPE = 'document_list';
const DOCUMENT_TEXT_SCOPE = 'document_text';
/**
 * "Suggest Changes" (S21, ADR 0021 extension), stored beside the other choices. The app may then
 * leave suggestions, drafts and reminders; nothing changes in the record until the person approves.
 */
export const AI_SUGGEST_CHANGES_SCOPE = 'suggest_changes';

/** The stored form of the choices: one string per granted thing, nothing else. */
export function scopesFromChoices(
  choices: Pick<AiConnectionChoices, 'layers' | 'documentList' | 'documentText' | 'suggestChanges'>,
): string[] {
  const layers = AI_CONNECTION_LAYERS.filter((layer) => choices.layers.includes(layer));
  return [
    ...layers,
    ...(choices.documentList ? [DOCUMENT_LIST_SCOPE] : []),
    ...(choices.documentText && layers.length > 0 ? [DOCUMENT_TEXT_SCOPE] : []),
    ...(choices.suggestChanges === true ? [AI_SUGGEST_CHANGES_SCOPE] : []),
  ];
}

/** Whether a stored connection lets the app suggest changes. Only the exact stored string counts. */
export function allowsSuggestions(scopes: readonly string[]): boolean {
  return scopes.includes(AI_SUGGEST_CHANGES_SCOPE);
}

/** The OAuth scope names a token describes itself with (informative only). */
export function oauthScopeNames(scopes: readonly string[]): string[] {
  return scopes.map((scope) => `visastack.${scope}`);
}

/** Every OAuth scope this server can describe, for discovery metadata. */
export const AI_OAUTH_SCOPES_SUPPORTED: readonly string[] = [
  ...oauthScopeNames([
    ...AI_CONNECTION_LAYERS,
    DOCUMENT_LIST_SCOPE,
    DOCUMENT_TEXT_SCOPE,
    AI_SUGGEST_CHANGES_SCOPE,
  ]),
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
