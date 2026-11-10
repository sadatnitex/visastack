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

export function nextStepFor(missing: readonly MissingRequirement[] | undefined): string | null {
  const first = (missing ?? []).find((item) => !item.optional);
  if (!first) return null;
  return `${VERB[first.reason]} ${nextStepName(first)}`;
}
