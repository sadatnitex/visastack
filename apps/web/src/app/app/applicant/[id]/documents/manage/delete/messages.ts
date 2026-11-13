import { agree, plural } from '../../../../../../../lib/plural';

/*
 * The words of Delete Duplicate and Restore from Recently Deleted (docs/uiux/ccd/VOCABULARY.md:
 * Delete Duplicate, Remove This New Copy, Recently Deleted, Removed in N Days, Restore). Plain,
 * and exact about what happens to the cases.
 */

const DAY_MS = 86_400_000;

/** Whole days left before removal starts, never below 0 ("Removed in 0 Days" reads as today). */
export function daysLeft(purgeAfter: Date | string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - now.getTime()) / DAY_MS));
}

/** "Removed in 30 Days" / "Removed in 1 Day" (Title Case, as the vocabulary has it). */
export function removedInLine(days: number): string {
  return days === 1 ? 'Removed in 1 Day' : `Removed in ${days} Days`;
}

/** What happens to the open cases, said before deleting. */
export function casesLine(caseCount: number): string {
  if (caseCount === 0) return 'No open case uses this copy, so nothing else changes.';
  return `${plural(caseCount, 'open case')} ${agree(caseCount, 'uses', 'use')} this copy. ${agree(caseCount, 'It', 'They')} will switch to the copy that stays and will need to be confirmed again.`;
}

/** The status line right after deleting, with Undo beside it. */
export function deletedLine(days: number): string {
  return `Moved to Recently Deleted. ${removedInLine(days)}.`;
}
