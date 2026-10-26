/**
 * SEQUENCE: which copy of an event is newer. A calendar app keeps the copy with the highest
 * SEQUENCE (and, when equal, the latest DTSTAMP), so the number must grow whenever the source
 * changes and never shrink.
 *
 * Rule: whole seconds from `CALENDAR_SEQUENCE_EPOCH` to the moment the source last changed (its
 * `updatedAt`). When a caller cannot supply that moment, it passes the time the file is made,
 * which is never earlier than the last change, so a later change still gets a higher number. The
 * value stays under 2^31 (the largest INTEGER many calendar apps accept) until 2094.
 */
export const CALENDAR_SEQUENCE_EPOCH = Date.UTC(2026, 0, 1);

export function calendarSequence(changedAt: Date | string): number {
  const at = typeof changedAt === 'string' ? Date.parse(changedAt) : changedAt.getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((at - CALENDAR_SEQUENCE_EPOCH) / 1000));
}
