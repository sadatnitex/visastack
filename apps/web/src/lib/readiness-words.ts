/**
 * The words for a file's checklist count, in one place so the ring, the success lines and the
 * tests all say it the same way. A count of what is on file, never a decision: nothing here says
 * approved, cleared, accepted or guaranteed (readiness is not approval). Pure and safe to import
 * from browser and server code alike.
 */

/** "6 of 9 items ready" (and "1 of 1 item ready"). */
export function progressRingWords(done: number, total: number): string {
  return `${done} of ${total} ${total === 1 ? 'item' : 'items'} ready`;
}

/** Whole percent, never above 100 and never negative. */
export function progressRingPercent(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  if (done >= total) return 100;
  // Rounding must never make a nearly-finished ring look finished, or a barely-started one look empty.
  return Math.max(1, Math.min(99, Math.round((done / total) * 100)));
}

/**
 * A closing sentence for a success line, " 3 of 9 items ready.", or nothing when there is no
 * checklist to count against (a number is never made up).
 */
export function readyNote(
  readiness: { readonly requiredCount: number; readonly satisfiedRequired: number } | null,
): string {
  if (!readiness || readiness.requiredCount <= 0) return '';
  const done = Math.min(readiness.satisfiedRequired, readiness.requiredCount);
  return ` ${progressRingWords(done, readiness.requiredCount)}.`;
}
