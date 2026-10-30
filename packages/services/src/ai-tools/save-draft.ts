import { z } from 'zod';
import {
  type AiSuggestionToolDefinition,
  MESSAGES,
  SUGGESTION_ANNOTATIONS,
  answer,
  refusal,
  writeRefusal,
} from './result';
import { draftOutputSchema } from './schemas';

const inputSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe('A short title the person will see, for example Cover Letter for the London Trip.'),
  body: z.string().min(1).max(20_000).describe('The draft itself, as plain text.'),
  case_reference: z
    .string()
    .max(20)
    .optional()
    .describe('Optional: the case to keep it with, for example C-7K2Q9M (see list_cases).'),
});

const GUIDANCE =
  'The draft is kept for the person in VisaStack. It goes nowhere else: the person reads, copies or throws it away.';

export const saveDraft: AiSuggestionToolDefinition<typeof inputSchema> = {
  name: 'save_draft',
  kind: 'suggestion',
  title: 'Save a Draft',
  description:
    'Saves a draft for the person to read in VisaStack, such as a cover letter or a note, as a title and plain text. VisaStack keeps it for the person only: it is never posted, emailed or used for anything, and only the person can open, copy or throw it away. Add case_reference to keep it with one of the person’s cases. Works only if the person turned on Suggest Changes for this app. Use only when the person explicitly asks for this change.',
  inputSchema,
  outputSchema: draftOutputSchema,
  annotations: SUGGESTION_ANNOTATIONS,
  async run(gateway, input) {
    if (!gateway.scope.suggestChanges) {
      gateway.denied('suggestions_not_granted');
      return refusal(MESSAGES.suggestionsOff);
    }
    const saved = await gateway.writes.saveDraft({
      title: input.title,
      body: input.body,
      // An empty reference is no reference: apps often send "" for an optional field.
      ...(input.case_reference !== undefined && input.case_reference.trim() !== ''
        ? { caseReference: input.case_reference }
        : {}),
    });
    if (!saved.ok) return writeRefusal(saved.error);
    return answer(`Draft saved. ${GUIDANCE}`, {
      status: 'saved',
      title: input.title.trim(),
      case: saved.value.caseReference,
      guidance: GUIDANCE,
    });
  },
};
