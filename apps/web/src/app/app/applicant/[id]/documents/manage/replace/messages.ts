import { agree, plural } from '../../../../../../../lib/plural';

/*
 * The words of Replace with a Newer Document (docs/uiux/ccd/VOCABULARY.md: Replace with a Newer
 * Document, Replaced). Plain, and exact about what happens to the cases.
 */

/** The confirmation line before replacing: "2 cases will be updated and will need to be confirmed again." */
export function confirmMessage(caseCount: number): string {
  if (caseCount === 0) return 'No open case uses this document, so nothing else changes.';
  return `${plural(caseCount, 'case')} will be updated and will need to be confirmed again.`;
}

/** The result line after replacing. */
export function replacedMessage(caseCount: number): string {
  const kept = 'The old document stays in your records, marked Replaced.';
  if (caseCount === 0) return `Replaced. ${kept}`;
  return `Replaced. ${plural(caseCount, 'case')} ${agree(caseCount, 'was', 'were')} updated and ${agree(caseCount, 'needs', 'need')} to be confirmed again. ${kept}`;
}
