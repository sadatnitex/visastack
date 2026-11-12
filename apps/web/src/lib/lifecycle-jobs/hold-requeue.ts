import 'server-only';
import { requeueUncoveredParkedJobs } from '@visastack/services';
import { reportServerError } from '../server-error';
import { connectJobPool } from './purge';

/*
 * The daily backstop for deletion jobs parked by a legal hold that no longer stands (owner decision
 * D2). Called from the erasure job route before the erasure worker runs, so a job put back in the
 * queue is worked in the same run. The scope comes from that route (only job routes may make one).
 */

type ErasureScope = Parameters<typeof requeueUncoveredParkedJobs>[1];
type SweepDb = Parameters<typeof requeueUncoveredParkedJobs>[0];
type SweepResult = Awaited<ReturnType<typeof requeueUncoveredParkedJobs>>;

const NOTHING: SweepResult = { requeued: 0, failed: 0 };

/** Re-queue parked jobs no hold covers. Never throws: a failure is reported. */
export async function runHeldJobRequeue(
  scope: ErasureScope,
  options: {
    readonly sweep?: typeof requeueUncoveredParkedJobs;
    readonly connect?: () => { readonly db: SweepDb; readonly end: () => Promise<void> } | null;
  } = {},
): Promise<SweepResult> {
  const connection = (options.connect ?? (() => connectJobPool<SweepDb>('runHeldJobRequeue')))();
  if (!connection) {
    console.error('[runHeldJobRequeue] database not configured');
    return NOTHING;
  }
  try {
    const result = await (options.sweep ?? requeueUncoveredParkedJobs)(connection.db, scope);
    if (result.failed > 0) {
      reportServerError('runHeldJobRequeue', new Error('some parked jobs could not be re-queued'), {
        step: 'sweep pass',
        failed: String(result.failed),
      });
    }
    return result;
  } catch (error) {
    reportServerError('runHeldJobRequeue', error, { step: 'sweep pass failed' });
    return NOTHING;
  } finally {
    await connection.end();
  }
}
