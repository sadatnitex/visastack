import type { RequirementResultState } from '@visastack/services';

/**
 * The seven requirement outcomes shown to a person as three plain headings on the case page.
 * Presentation only: the outcomes themselves, and how readiness is worked out, are unchanged.
 * Every outcome belongs to exactly one heading.
 */
export const REQUIREMENT_GROUPS: readonly {
  readonly heading: string;
  readonly states: readonly RequirementResultState[];
}[] = [
  { heading: 'Needs You', states: ['CRITICAL_GAP', 'CONFLICTING', 'EXPIRING_STALE'] },
  { heading: 'Needs a Check', states: ['UNVERIFIED'] },
  { heading: 'Done', states: ['SATISFIED', 'ATTENTION', 'NOT_APPLICABLE'] },
];
