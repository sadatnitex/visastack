import { z } from 'zod';
import {
  type AiSuggestionToolDefinition,
  MESSAGES,
  SUGGESTION_ANNOTATIONS,
  answer,
  refusal,
  writeRefusal,
} from './result';
import { reminderOutputSchema } from './schemas';

const inputSchema = z.object({
  case_reference: z
    .string()
    .max(20)
    .describe('The case to add it to, for example C-7K2Q9M (see list_cases).'),
  title: z
    .string()
    .min(1)
    .max(120)
    .describe('What to do, in a few words, for example Book the biometrics appointment.'),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('The day it is due, as YYYY-MM-DD, from today onward.'),
});

const GUIDANCE =
  'The reminder is on the case in VisaStack, marked as added by this app. The person can tick it off or cancel it there.';

export const addReminder: AiSuggestionToolDefinition<typeof inputSchema> = {
  name: 'add_reminder',
  kind: 'suggestion',
  title: 'Add a Reminder',
  description:
    'Adds a reminder with a due date to one of the person’s cases, as a task they see and tick off in VisaStack, marked as added by this app. Works only on a case open to this app that is not closed, and only if the person turned on Suggest Changes for this app. Use only when the person explicitly asks for this change.',
  inputSchema,
  outputSchema: reminderOutputSchema,
  annotations: SUGGESTION_ANNOTATIONS,
  async run(gateway, input) {
    if (!gateway.scope.suggestChanges) {
      gateway.denied('suggestions_not_granted');
      return refusal(MESSAGES.suggestionsOff);
    }
    const saved = await gateway.writes.addReminder({
      caseReference: input.case_reference,
      title: input.title,
      dueDate: input.due_date,
    });
    if (!saved.ok) return writeRefusal(saved.error);
    return answer(`Reminder added to ${saved.value.caseReference}. ${GUIDANCE}`, {
      status: 'added',
      case: saved.value.caseReference,
      title: input.title.trim(),
      dueDate: saved.value.dueDate,
      guidance: GUIDANCE,
    });
  },
};
