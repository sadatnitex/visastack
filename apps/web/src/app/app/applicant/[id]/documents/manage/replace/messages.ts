import { agree, plural } from '../../../../../../../lib/plural';

/*
 * The words of Replace with a Newer Document (docs/uiux/ccd/VOCABULARY.md: Replace with a Newer
 * Document, Replaced). Plain, and exact about what happens to the cases.
 */

/**
 * The confirmation line before replacing: "2 cases will ask you to choose the document and confirm
 * again." Replacing does not move a case to the newer document: it flags the case, voids its
 * confirmation and adds a task, so the person chooses the document and confirms (the same words
 * the review under this line uses).
 */
export function confirmMessage(caseCount: number): string {
  if (caseCount === 0) return 'No open case uses this document, so nothing else changes.';
  return `${plural(caseCount, 'case')} will ask you to choose the document and confirm again.`;
}

/** The result line after replacing. */
export function replacedMessage(caseCount: number): string {
  const kept = 'The old document stays in your records, marked Replaced.';
  if (caseCount === 0) return `Replaced. ${kept}`;
  return `Replaced. ${plural(caseCount, 'case')} ${agree(caseCount, 'asks', 'ask')} you to choose the document and confirm again. ${kept}`;
}
