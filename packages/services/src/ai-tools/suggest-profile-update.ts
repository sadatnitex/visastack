import { z } from 'zod';
import { AI_CONNECTION_LAYERS } from '../access/with-ai-connection';
import {
  type AiSuggestionToolDefinition,
  MESSAGES,
  SUGGESTION_ANNOTATIONS,
  answer,
  refusal,
  writeRefusal,
} from './result';
import { suggestionOutputSchema } from './schemas';

const inputSchema = z.object({
  section: z
    .enum(AI_CONNECTION_LAYERS)
    .describe(
      'The profile section the detail is in: identity, travel_documents, timelines, money, people, qualifications, declarations or health.',
    ),
  field: z
    .string()
    .min(1)
    .max(64)
    .describe('The detail, as get_profile_section names it in "field", for example home_city.'),
  value: z.string().min(1).max(500).describe('The suggested value, as plain text.'),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe('Why you suggest it, in one or two sentences the person will read.'),
  document_reference: z
    .string()
    .max(20)
    .optional()
    .describe(
      'Optional: the document the value comes from, for example D-7K2Q9M (see list_documents).',
    ),
});

const GUIDANCE =
  'Nothing has changed yet. The person will see this suggestion in VisaStack and decide whether to accept it.';

export const suggestProfileUpdate: AiSuggestionToolDefinition<typeof inputSchema> = {
  name: 'suggest_profile_update',
  kind: 'suggestion',
  title: 'Suggest a Profile Update',
  description:
    'Suggests a new value for one detail in the person’s profile, with your reason. Nothing changes until the person looks at the suggestion in VisaStack and accepts it. Use a section and a field name from get_profile_section. Add document_reference when the value comes from one of the person’s documents. Works only if the person turned on Suggest Changes for this app. Use only when the person explicitly asks for this change.',
  inputSchema,
  outputSchema: suggestionOutputSchema,
  annotations: SUGGESTION_ANNOTATIONS,
  async run(gateway, input) {
    if (!gateway.scope.suggestChanges) {
      gateway.denied('suggestions_not_granted');
      return refusal(MESSAGES.suggestionsOff);
    }
    const saved = await gateway.writes.suggestProfileUpdate({
      section: input.section,
      field: input.field,
      value: input.value,
      reason: input.reason,
      // An empty reference is no reference: apps often send "" for an optional field.
      ...(input.document_reference !== undefined && input.document_reference.trim() !== ''
        ? { documentReference: input.document_reference }
        : {}),
    });
    if (!saved.ok) return writeRefusal(saved.error);
    // The same answer whatever the profile holds now, so a guess is never confirmed or denied.
    return answer(`Suggestion for ${saved.value.fieldLabel} saved. ${GUIDANCE}`, {
      status: 'waiting_for_approval',
      section: input.section,
      fieldLabel: saved.value.fieldLabel,
      document: saved.value.documentReference,
      guidance: GUIDANCE,
    });
  },
};
