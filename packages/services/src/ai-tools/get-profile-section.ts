import { z } from 'zod';
import { AI_CONNECTION_LAYERS, aiContextObject, layerLabel } from '../access/with-ai-connection';
import { caseFailure } from './failures';
import { type AiToolDefinition, MESSAGES, READ_ONLY_ANNOTATIONS, answer, refusal } from './result';
import { profileSectionOutputSchema } from './schemas';

const inputSchema = z.object({
  section: z
    .enum(AI_CONNECTION_LAYERS)
    .describe(
      'identity (personal details), travel_documents, timelines (travel, home and work history), money, people (family and sponsors), qualifications, declarations (past refusals) or health.',
    ),
});

export const getProfileSection: AiToolDefinition<typeof inputSchema> = {
  name: 'get_profile_section',
  title: 'Get Profile Section',
  description:
    'Gives one section of the profile the person shared, with where each value came from and whether it is confirmed. Identity numbers show only their last three characters unless the person chose to share them in full.',
  inputSchema,
  outputSchema: profileSectionOutputSchema,
  annotations: READ_ONLY_ANNOTATIONS,
  async run(gateway, input) {
    const section = input.section;
    if (!gateway.scope.layers.includes(section)) {
      gateway.denied('layer_not_granted');
      return refusal(MESSAGES.notShared);
    }
    const built = await gateway.compose({
      // No case data in this answer: no case, no list, no text, only this section.
      cases: 'none',
      layers: [section],
      basics: section === 'identity',
      documentList: false,
      documentText: false,
    });
    if (!built.ok) return caseFailure(gateway, built.error);
    // The same compact form as the full context, so both read alike.
    const context = aiContextObject(built.value) as {
      readonly person: { readonly basics?: readonly unknown[] };
      readonly profile?: Readonly<Record<string, readonly unknown[]>>;
      readonly omitted: Readonly<Record<string, number>>;
    };
    // Personal details start with the basics (names, nationality, date of birth).
    const values = [
      ...(section === 'identity' ? (context.person.basics ?? []) : []),
      ...(context.profile?.[section] ?? []),
    ];
    const label = layerLabel(section);
    const summary =
      values.length === 0
        ? `Nothing is recorded in ${label} yet.`
        : `${label}: ${values.length === 1 ? 'one value' : `${values.length} values`}.`;
    return answer(summary, { section, label, values, omitted: context.omitted });
  },
};
