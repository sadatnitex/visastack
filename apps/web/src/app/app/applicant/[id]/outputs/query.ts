import { fieldPolicyOf } from '@visastack/core/catalogue';
import {
  DOCUMENT_GROUP_KEYS,
  type DocumentGroupKey,
  LAYER_KEYS,
  type LayerKey,
} from '@visastack/core/catalogue';
import {
  OUTPUT_TEMPLATES,
  type OutputChoice,
  type OutputFormat,
  type OutputTemplateId,
  SELECTION_DEPTHS,
  defaultChoice,
  isOutputTemplateId,
} from '@visastack/services';

/**
 * What the outputs page and its download read from an address or a form: the template, the case,
 * the parts the person ticked and their own words. Every value is checked against a fixed list
 * here, so nothing typed into an address reaches the server as anything but a known choice. The
 * server then applies its own rules to the choice again, so a choice can only ask for less.
 */

type Source =
  | { readonly getAll: (name: string) => readonly unknown[] }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface OutputRequest {
  readonly template: OutputTemplateId;
  readonly choice: OutputChoice;
  /** The person pressed Preview. Before that, the starting choice for the template is used. */
  readonly previewed: boolean;
  /** The fingerprint of the preview a download was made from. */
  readonly fingerprint: string | null;
  readonly format: OutputFormat;
  readonly error: 'changed' | 'failed' | 'nothing' | null;
}

const MAX_VALUES = 400;
const MAX_FIELD_KEY = 80;
const MAX_QUESTION = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT = /^[0-9a-f]{32}$/;

function values(source: Source, name: string): string[] {
  const raw: readonly unknown[] =
    'getAll' in source && typeof source.getAll === 'function'
      ? source.getAll(name)
      : ((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]))(
          (source as Readonly<Record<string, unknown>>)[name],
        );
  return raw.slice(0, MAX_VALUES).filter((value): value is string => typeof value === 'string');
}

function one(source: Source, name: string): string | null {
  return values(source, name)[0] ?? null;
}

const FORMATS: readonly OutputFormat[] = ['txt', 'csv', 'json'];

export function parseOutputRequest(source: Source): OutputRequest {
  const requested = one(source, 'output');
  const template: OutputTemplateId = isOutputTemplateId(requested) ? requested : 'agency_brief';
  const offers = OUTPUT_TEMPLATES[template];
  const caseId = one(source, 'case');
  const missionId = caseId !== null && UUID.test(caseId) ? caseId : null;
  const previewed = one(source, 'preview') === '1';
  const start = defaultChoice(template, missionId);

  const layers: LayerKey[] = previewed
    ? LAYER_KEYS.filter((layer) => values(source, 'layer').includes(layer))
    : [...start.layers];
  const groups: DocumentGroupKey[] = previewed
    ? DOCUMENT_GROUP_KEYS.filter((group) => values(source, 'text').includes(group))
    : [];
  const depthRaw = one(source, 'depth');
  const depth = SELECTION_DEPTHS.find((candidate) => candidate === depthRaw) ?? start.depth;
  const picked = one(source, 'picked') === '1';
  const fieldKeys = picked
    ? [
        ...new Set(
          values(source, 'field').filter(
            (key) => key.length <= MAX_FIELD_KEY && fieldPolicyOf(key) !== undefined,
          ),
        ),
      ]
    : null;
  const question = Array.from((one(source, 'q') ?? '').trim())
    .slice(0, MAX_QUESTION)
    .join('');
  const fingerprintRaw = one(source, 'fp');
  const formatRaw = one(source, 'format');
  const format =
    FORMATS.find((candidate) => candidate === formatRaw && offers.formats.includes(candidate)) ??
    (offers.formats[0] as OutputFormat);
  const errorRaw = one(source, 'error');
  const error =
    errorRaw === 'changed' || errorRaw === 'failed' || errorRaw === 'nothing' ? errorRaw : null;

  return {
    template,
    previewed,
    fingerprint:
      fingerprintRaw !== null && FINGERPRINT.test(fingerprintRaw) ? fingerprintRaw : null,
    format,
    error,
    choice: {
      missionId,
      layers,
      documentList: previewed ? one(source, 'docs') === '1' : start.documentList,
      documentText: groups,
      revealIdentifiers: previewed && one(source, 'numbers') === '1',
      depth,
      fieldKeys,
      question,
    },
  };
}

/** The parts of a request as address parameters, to come back to the same choice. */
export function requestParams(request: OutputRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set('output', request.template);
  const { choice } = request;
  if (choice.missionId) params.set('case', choice.missionId);
  params.set('preview', '1');
  for (const layer of choice.layers) params.append('layer', layer);
  if (choice.documentList) params.set('docs', '1');
  for (const group of choice.documentText) params.append('text', group);
  if (choice.revealIdentifiers) params.set('numbers', '1');
  params.set('depth', choice.depth);
  if (choice.fieldKeys) {
    params.set('picked', '1');
    for (const key of choice.fieldKeys) params.append('field', key);
  }
  if (choice.question) params.set('q', choice.question);
  return params;
}

/** The same choice as hidden form fields, for the download. */
export function requestFields(request: OutputRequest): readonly (readonly [string, string])[] {
  return [...requestParams(request).entries()];
}
