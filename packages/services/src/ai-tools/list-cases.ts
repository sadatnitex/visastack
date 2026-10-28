import { z } from 'zod';
import { caseFailure } from './failures';
import { type AiToolDefinition, MESSAGES, READ_ONLY_ANNOTATIONS, answer, refusal } from './result';
import { caseListOutputSchema } from './schemas';

const inputSchema = z.object({});

export const listCases: AiToolDefinition<typeof inputSchema> = {
  name: 'list_cases',
  title: 'List Shared Cases',
  description:
    'Lists the visa cases the person shared with this app: reference, title, destination, travel dates, state and how ready each one is. Use a reference with prepare_context to look at one case.',
  inputSchema,
  outputSchema: caseListOutputSchema,
  annotations: READ_ONLY_ANNOTATIONS,
  async run(gateway) {
    if (gateway.scope.caseMode === 'NONE') {
      gateway.denied('cases_not_granted');
      return refusal(MESSAGES.notShared);
    }
    // Cases only: no record sections, no documents, the shallowest depth.
    const built = await gateway.compose({
      layers: [],
      basics: false,
      fieldKeys: [],
      documentList: false,
      documentText: false,
      depth: 'brief',
    });
    if (!built.ok) return caseFailure(gateway, built.error);
    const output = built.value;
    if (gateway.scope.caseMode === 'ONE' && output.cases.length === 0) {
      return caseFailure(gateway, 'case_unavailable');
    }
    const cases = output.cases.map((c) => ({
      reference: c.referenceCode,
      title: c.title,
      destination: c.destination,
      purpose: c.purpose,
      travelStart: c.travelStart,
      travelEnd: c.travelEnd,
      targetDeadline: c.targetDeadline,
      state: c.state,
      readiness: c.readiness
        ? {
            required: c.readiness.requiredCount,
            satisfied: c.readiness.satisfiedCount,
            needsAttention: c.readiness.needsAttention.length,
            missing: c.readiness.missing.length,
          }
        : null,
    }));
    const summary =
      cases.length === 0
        ? 'No current cases are shared with this app.'
        : `${cases.length === 1 ? 'One case is' : `${cases.length} cases are`} shared with this app.`;
    return answer(summary, { cases, casesNotShown: output.casesNotShown });
  },
};
