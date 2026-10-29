import { dayCount } from '@visastack/core';
import { billingStatusLabel } from './labels';

/**
 * Plain words for one billing status history row on the admin organization page. Stored values
 * are data, not labels: statuses are shown by their names, and the reasons VisaStack stores for
 * its own changes ("system: ...") are turned into sentences. A reason a person typed is shown as
 * they wrote it.
 */

const OVERDUE_REASON = /^system: overdue (\d{1,4}) days \(([^()]{1,80})\)$/;

/** The reason for a status change, in plain words. */
export function billingHistoryReason(reason: string): string {
  if (!reason.startsWith('system:')) return reason;
  const overdue = reason.match(OVERDUE_REASON);
  if (overdue) {
    return `Invoice ${overdue[2]} unpaid ${dayCount(Number(overdue[1]))} after its due date`;
  }
  if (reason === 'system: paid') return 'Paid in full';
  if (reason === 'system: no overdue invoices') return 'No unpaid invoices';
  return 'Changed automatically by VisaStack';
}

/** "Opened as Active", "Grace Period to Suspended". */
export function billingHistoryMove(fromStatus: string | null, toStatus: string): string {
  return fromStatus === null
    ? `Opened as ${billingStatusLabel(toStatus)}`
    : `${billingStatusLabel(fromStatus)} to ${billingStatusLabel(toStatus)}`;
}
