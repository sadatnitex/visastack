import 'server-only';
import { systemPrincipal } from '@visastack/services';
import { triggerAiReadingWorker, triggerIntakeWorker } from '../../../../lib/jobs';

/**
 * The only place outside the job route that makes the `process-ai-reading` scope (the access
 * rules allow `systemPrincipal` in this folder and nowhere else in the app). It lets the upload
 * path start an automatic reading right after intake without going through an HTTP call, while
 * the scope still comes from the job's own folder.
 */

/** One pass of the automatic AI reading worker. */
export function runAutomaticReading(
  options: { readonly limit?: number; readonly timeBudgetMs?: number } = {},
) {
  return triggerAiReadingWorker(systemPrincipal('process-ai-reading'), options);
}

/**
 * After an upload: run intake, then read what finished. A small pass that leaves room in the
 * caller's time limit; anything left over stays queued for the next upload or the daily sweep.
 * When intake runs on the isolated worker (the queue is only dispatched from here), the readings
 * wait for the daily sweep instead.
 */
export async function triggerIntakeAndReading(): Promise<void> {
  const intake = await triggerIntakeWorker();
  if (intake.queued || intake.unavailable || intake.processed === 0) return;
  await runAutomaticReading({ limit: 3, timeBudgetMs: 25_000 });
}
