import { DOCUMENT_GROUP_KEYS, type DocumentGroupKey } from '@visastack/core/catalogue';
import { z } from 'zod';
import type { AiConnectionLayer } from '../access/with-ai-connection';
import { caseFailure } from './failures';
import { type AiToolDefinition, MESSAGES, READ_ONLY_ANNOTATIONS, answer, refusal } from './result';
import { documentListOutputSchema } from './schemas';

/** Groups listed only with the record section that carries the same subject. */
const GROUP_NEEDS_LAYER: Partial<Record<DocumentGroupKey, AiConnectionLayer>> = {
  medical: 'health',
  legal_clearances: 'declarations',
};

const inputSchema = z.object({
  group: z
    .enum(DOCUMENT_GROUP_KEYS)
    .optional()
    .describe('Only documents of this group, for example travel_immigration or financial.'),
});

export const listDocuments: AiToolDefinition<typeof inputSchema> = {
  name: 'list_documents',
  title: 'List Shared Documents',
  description:
    'Lists the documents the person shared with this app: kind, group, dates, expiry, status and reference. It never includes what the documents say; use get_document_text for that, if the person shared it.',
  inputSchema,
  outputSchema: documentListOutputSchema,
  annotations: READ_ONLY_ANNOTATIONS,
  async run(gateway, input) {
    if (!gateway.scope.documentList) {
      gateway.denied('document_list_not_granted');
      return refusal(MESSAGES.notShared);
    }
    // Medical papers and police or court papers are listed only with the section they belong
    // to, decided from what was shared alone, so the answer is the same whatever the record holds.
    const gating = input.group ? GROUP_NEEDS_LAYER[input.group] : undefined;
    if (gating && !gateway.scope.layers.includes(gating)) {
      gateway.denied('document_not_shared');
      return refusal(MESSAGES.notShared);
    }
    const built = await gateway.compose({
      // No case data and no values in this answer: the counts then speak of documents alone.
      cases: 'none',
      basics: false,
      fieldKeys: [],
      documentList: true,
      documentText: false,
      ...(input.group ? { documentScope: { groups: [input.group] } } : {}),
    });
    if (!built.ok) return caseFailure(gateway, built.error);
    const output = built.value;
    const summary =
      output.documents.length === 0
        ? 'No shared documents.'
        : `${output.documents.length === 1 ? 'One shared document' : `${output.documents.length} shared documents`}.`;
    return answer(summary, { documents: [...output.documents], omitted: output.omitted });
  },
};
