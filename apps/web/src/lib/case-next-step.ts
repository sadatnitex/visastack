import type { MissingRequirement } from '@visastack/services';
import { humanizeCode } from './format-code';
import { documentKindLabel } from './item-names';
import { fieldLabel } from './master-profile';

/**
 * The one next step shown on a case's row on the Trips list: the first required item the
 * checklist still lacks, in its plain name with the verb that fits why it is missing. It reads
 * only the `missing` list that `computeReadiness` already returns, so no extra read is made, and
 * it never invents a step: with nothing required still missing it says nothing.
 */
export function nextStepName(item: Pick<MissingRequirement, 'kind' | 'key'>): string {
  return item.kind === 'FIELD'
    ? (fieldLabel(item.key) ?? humanizeCode(item.key))
    : documentKindLabel(item.key);
}

const VERB: Readonly<Record<MissingRequirement['reason'], string>> = {
  not_provided: 'Add',
  unresolved_conflict: 'Fix',
  stale_evidence: 'Update',
};

/** A group of alternatives is met by any one member, so it names them all (up to three) rather than one. */
function stepTarget(item: MissingRequirement): string {
  const members = item.alternatives ?? [];
  if (members.length < 2) return nextStepName(item);
  const names = members.slice(0, 3).map(nextStepName);
  return members.length > 3 ? `${names.slice(0, 2).join(' or ')} or Another` : names.join(' or ');
}

export function nextStepFor(missing: readonly MissingRequirement[] | undefined): string | null {
  const first = (missing ?? []).find((item) => !item.optional);
  if (!first) return null;
  return `${VERB[first.reason]} ${stepTarget(first)}`;
}
