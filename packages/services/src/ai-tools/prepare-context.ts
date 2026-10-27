import type { LayerKey } from '@visastack/core/catalogue';
import { z } from 'zod';
import {
  type AiContextGateway,
  type AiDenialReason,
  type AiNarrowing,
  renderAiContext,
} from '../access/with-ai-connection';
import { caseFailure } from './failures';
import { type AiToolDefinition, MESSAGES, READ_ONLY_ANNOTATIONS, answer, refusal } from './result';
import { contextOutputSchema } from './schemas';

export const CONTEXT_FOCUSES = [
  'overview',
  'readiness',
  'documents',
  'expiry',
  'history',
  'money',
  'family',
] as const;
type Focus = (typeof CONTEXT_FOCUSES)[number];

/** The record sections each focus draws on. Readiness and documents come from cases and the list. */
const FOCUS_LAYERS: Readonly<Record<Focus, readonly LayerKey[]>> = {
  overview: ['identity', 'travel_documents'],
  readiness: [],
  documents: [],
  expiry: ['travel_documents'],
  history: ['timelines'],
  money: ['money'],
  family: ['people'],
};

const inputSchema = z.object({
  case_reference: z
    .string()
    .max(20)
    .optional()
    .describe('A case reference such as C-7K2Q9M. Leave out to cover every case that is shared.'),
  focus: z
    .array(z.enum(CONTEXT_FOCUSES))
    .max(CONTEXT_FOCUSES.length)
    .optional()
    .describe('What to concentrate on. Leave out for everything that is shared.'),
  depth: z
    .enum(['brief', 'standard', 'full'])
    .optional()
    .describe(
      'brief: only what the case needs; standard: everything shared; full: also suggestions nobody confirmed yet. Never more than the person allowed.',
    ),
});

/** Whether a focus has anything to draw on under what was shared. */
function focusShared(focus: Focus, gateway: AiContextGateway): boolean {
  const { scope } = gateway;
  switch (focus) {
    case 'overview':
      return true;
    case 'readiness':
      return scope.caseMode !== 'NONE';
    case 'documents':
      return scope.documentList || scope.documentText;
    case 'expiry':
      return scope.documentList || scope.caseMode !== 'NONE';
    default:
      return FOCUS_LAYERS[focus].some((layer) => scope.layers.some((granted) => granted === layer));
  }
}

function denialFor(focus: Focus): AiDenialReason {
  if (focus === 'readiness') return 'cases_not_granted';
  if (focus === 'documents' || focus === 'expiry') return 'document_list_not_granted';
  return 'layer_not_granted';
}

/** The parts of the rendered context this tool reshapes; the rest passes through unchanged. */
interface RenderedContext {
  readonly cases?: readonly unknown[];
  readonly documents?: readonly unknown[];
  readonly expiry?: readonly unknown[];
  readonly notShared?: readonly string[];
  readonly [key: string]: unknown;
}

export const prepareContext: AiToolDefinition<typeof inputSchema> = {
  name: 'prepare_context',
  title: 'Prepare Visa Context',
  description:
    'Gives a compact summary of what the person chose to share from their own VisaStack record: their cases, readiness, profile details with where each came from, documents and expiry dates. Use it first when helping with a visa application. Every value says whether it is confirmed, suggested or out of date.',
  inputSchema,
  outputSchema: contextOutputSchema,
  annotations: READ_ONLY_ANNOTATIONS,
  async run(gateway, input) {
    const focus = input.focus ? [...new Set(input.focus)] : null;
    const notShared = focus ? focus.filter((f) => !focusShared(f, gateway)) : [];
    if (focus && notShared.length === focus.length) {
      gateway.denied(denialFor(notShared[0] as Focus));
      return refusal(MESSAGES.notShared);
    }
    const wanted = focus?.filter((f) => !notShared.includes(f)) ?? null;
    const wantsDocuments = wanted === null || wanted.includes('documents');
    const wantsExpiry =
      wanted === null ||
      wanted.some((f) => f === 'expiry' || f === 'overview' || f === 'documents');
    const narrowing: AiNarrowing = {
      ...(wanted ? { layers: [...new Set(wanted.flatMap((f) => FOCUS_LAYERS[f]))] } : {}),
      ...(input.case_reference !== undefined ? { cases: { reference: input.case_reference } } : {}),
      documentList: wantsDocuments || wantsExpiry,
      documentText: wantsDocuments,
      ...(input.depth ? { depth: input.depth } : {}),
    };
    const built = await gateway.compose(narrowing);
    if (!built.ok) return caseFailure(gateway, built.error);

    const { documents, expiry, ...rest } = JSON.parse(
      renderAiContext(built.value),
    ) as RenderedContext;
    const context: RenderedContext = {
      ...rest,
      ...(wantsDocuments && documents !== undefined ? { documents } : {}),
      ...(wantsExpiry && expiry !== undefined ? { expiry } : {}),
      ...(notShared.length > 0 ? { notShared } : {}),
    };

    const caseCount = context.cases?.length ?? 0;
    const summary = [
      `VisaStack context for ${caseCount === 1 ? 'one case' : `${caseCount} cases`}.`,
      notShared.length > 0 ? `Not shared with this app: ${notShared.join(', ')}.` : '',
      'Values marked suggested_not_confirmed, out_of_date or conflicted are not settled facts.',
    ]
      .filter(Boolean)
      .join(' ');
    return answer(summary, context);
  },
};
