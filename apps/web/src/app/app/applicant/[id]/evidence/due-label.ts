import { WAITING_ON_TRAVELLER_REQUEST_STATUSES, daysUntilDueDay } from '@visastack/services';
import type { Tone } from '../../../../../components/ui';
import { plural } from '../../../../../lib/plural';

/** Statuses still waiting on the traveller: a first request, and one sent back for a fix. */
export const AWAITING_SUBMISSION: ReadonlySet<string> = new Set(
  WAITING_ON_TRAVELLER_REQUEST_STATUSES,
);

/**
 * The deadline as a status: overdue is serious, due within a week is a warning, later is calm.
 * A due date is a calendar day, and the traveller's own time zone decides when it ends (owner
 * decision 26 Oct 2026, ADR 0015 amendment): the same rule as Home and the agency's Do Next list.
 * UTC only when no time zone is known.
 */
export function dueLabel(
  dueDate: string | Date,
  status: string,
  timezone: string | null | undefined,
  now: Date = new Date(),
): { readonly label: string; readonly tone: Tone } | null {
  if (!AWAITING_SUBMISSION.has(status)) return null;
  const days = daysUntilDueDay(new Date(dueDate), now, timezone || 'UTC');
  if (days < 0) return { label: `Overdue by ${plural(-days, 'day')}`, tone: 'danger' };
  if (days === 0) return { label: 'Due Today', tone: 'warning' };
  if (days <= 7) return { label: `Due in ${plural(days, 'day')}`, tone: 'warning' };
  return { label: `Due in ${plural(days, 'day')}`, tone: 'neutral' };
}
