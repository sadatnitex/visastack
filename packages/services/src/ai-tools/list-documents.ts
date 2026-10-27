import { DOCUMENT_GROUP_KEYS } from '@visastack/core/catalogue';
import { z } from 'zod';
import { caseFailure } from './failures';
import { type AiToolDefinition, MESSAGES, READ_ONLY_ANNOTATIONS, answer, refusal } from './result';
import { documentListOutputSchema } from './schemas';

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
    const built = await gateway.compose({
      documentList: true,
      documentText: false,
      // No profile values: the counts of what was left out then speak of documents alone.
      fieldKeys: [],
      ...(input.group ? { documentScope: { groups: [input.group] } } : {}),
    });
    if (!built.ok) return caseFailure(gateway, built.error);
    const output = built.value;
    // A group outside what was shared is a refusal, not an empty list.
    if (input.group && output.documents.length === 0 && output.omitted.not_granted > 0) {
      gateway.denied('document_not_shared');
      return refusal(MESSAGES.notShared);
    }
    const summary =
      output.documents.length === 0
        ? 'No shared documents.'
        : `${output.documents.length === 1 ? 'One shared document' : `${output.documents.length} shared documents`}.`;
    return answer(summary, { documents: [...output.documents], omitted: output.omitted });
  },
};
