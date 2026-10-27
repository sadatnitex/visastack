import 'server-only';
import { triggerNotificationWorker } from './jobs';
import type { InvitationEmailOutcome } from './success-lines';

/**
 * Send the email about one record (an invitation just created) while the person waits, so the
 * screen can say truthfully whether it went out. Only that record's messages are sent, never
 * whatever else is oldest, and the wait is bounded: anything not sent stays queued and is retried.
 * Call it after the record's transaction has committed.
 */
export async function sendEmailNow(
  resourceId: string,
): Promise<Exclude<InvitationEmailOutcome, 'none'>> {
  const result = await triggerNotificationWorker({ resourceId, limit: 3, timeBudgetMs: 8_000 });
  if (result.sent > 0) return 'sent';
  // Refused for good (nothing will retry it) versus still waiting for another try.
  if (result.failed > 0 && result.retrying === 0) return 'failed';
  return 'pending';
}
