import type { RequirementResultState } from '@visastack/services';

/**
 * The seven requirement outcomes shown to a person as five plain headings on the case page, like
 * folders in a drive: what needs them, what needs a check, what is optional, what is on file, and
 * what does not apply (a fifth fold that is hidden when empty).
 * Presentation only: the outcomes themselves, and how readiness is worked out, are unchanged.
 * Every outcome belongs to exactly one heading. A line another option already covers is an
 * optional outcome that is shown under On File (see `buildChecklistGroups`).
 */
export const REQUIREMENT_GROUPS: readonly {
  readonly heading: string;
  readonly states: readonly RequirementResultState[];
}[] = [
  { heading: 'Needs You', states: ['CRITICAL_GAP', 'CONFLICTING', 'EXPIRING_STALE'] },
  { heading: 'Needs a Check', states: ['UNVERIFIED'] },
  { heading: 'Optional', states: ['ATTENTION'] },
  { heading: 'On File', states: ['SATISFIED'] },
  { heading: 'Does Not Apply', states: ['NOT_APPLICABLE'] },
];

/** The heading a line covered by another option moves to: it is met, so it is on file. */
export const COVERED_HEADING = 'On File';
