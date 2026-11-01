/*
 * The words of Replace With a Newer Document (docs/uiux/ccd/VOCABULARY.md: Replace With a Newer
 * Document, Replaced). Plain, and exact about what happens to the cases.
 */

function cases(count: number): string {
  return count === 1 ? '1 case' : `${count} cases`;
}

/** The confirmation line before replacing: "2 cases will be updated and will need to be confirmed again." */
export function confirmMessage(caseCount: number): string {
  if (caseCount === 0) return 'No case uses this document, so nothing else changes.';
  return caseCount === 1
    ? '1 case will be updated and will need to be confirmed again.'
    : `${cases(caseCount)} will be updated and will need to be confirmed again.`;
}

/** The result line after replacing. */
export function replacedMessage(caseCount: number): string {
  const kept = 'The old document stays in your records, marked Replaced.';
  if (caseCount === 0) return `Replaced. ${kept}`;
  const updated =
    caseCount === 1
      ? '1 case was updated and needs to be confirmed again.'
      : `${cases(caseCount)} were updated and need to be confirmed again.`;
  return `Replaced. ${updated} ${kept}`;
}
