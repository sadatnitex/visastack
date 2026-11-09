import { NECESSITY_LABELS } from '@visastack/core';
import type { LiftAction } from '../../../../components/ui-lift/types';
import { COVERED_STATUS, REQUIREMENT_STATUS, type StatusWord } from '../../../../lib/status-words';
import { type RequirementDetailRow, requirementLabel } from './case-model';

/** What a checklist row and its panel both say about one item, worked out once. */

/** The chip: the specific word for the item's outcome. A line another option covers says so. */
export function itemStatus(r: RequirementDetailRow): StatusWord {
  return r.state === 'ATTENTION' && r.coveredByAlternative
    ? COVERED_STATUS
    : REQUIREMENT_STATUS[r.state];
}

/** The quiet tag after the name ("Mandatory"), or undefined when the item states none. */
export function itemNecessity(r: RequirementDetailRow): string | undefined {
  return r.coveredByAlternative
    ? 'met by an alternative'
    : r.necessity
      ? NECESSITY_LABELS[r.necessity]
      : r.optional
        ? 'optional'
        : undefined;
}

/**
 * The one thing to do about the item: add it (a file on the Documents page, an answer on the
 * profile), or settle the two values on the profile. Items that need nothing have none.
 */
export function itemAction(r: RequirementDetailRow, applicantId: string): LiftAction | undefined {
  if (r.state === 'CONFLICTING') {
    return { label: 'Resolve on Profile', href: `/app/applicant/${applicantId}/profile` };
  }
  if (r.state !== 'CRITICAL_GAP' && r.state !== 'EXPIRING_STALE') return undefined;
  return {
    label: 'Add',
    href:
      r.kind === 'FIELD'
        ? `/app/applicant/${applicantId}/profile`
        : `/app/applicant/${applicantId}/documents/add`,
  };
}

/** The other items any one of which would meet the same requirement (UMPE P1), by name. */
export function itemAlternatives(
  r: RequirementDetailRow,
  rows: readonly RequirementDetailRow[],
): string[] {
  if (!r.groupKey || r.state === 'NOT_APPLICABLE') return [];
  return rows
    .filter(
      (o) =>
        o.groupKey === r.groupKey &&
        o.packRequirementId !== r.packRequirementId &&
        o.state !== 'NOT_APPLICABLE',
    )
    .map(requirementLabel);
}
