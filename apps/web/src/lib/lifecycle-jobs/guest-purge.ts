import 'server-only';
import { type GuestPurgeResult, purgeGuestCollectionData } from '@visastack/services';
import { reportServerError } from '../server-error';
import { createStorage } from '../storage';
import { connectJobPool } from './purge';

/*
 * The retention end of guest answers to agency document requests (UMPE P9): called from the daily
 * erasure job route, which makes the scope (only job routes may make one). Removes the bytes and
 * rows of every guest whose chosen period ended after the request closed (never under a legal
 * hold), and desk sessions that can never be used again.
 */

type GuestPurgeScope = Parameters<typeof purgeGuestCollectionData>[2];
type PurgeDb = Parameters<typeof purgeGuestCollectionData>[0];

const NOTHING: GuestPurgeResult = {
  guestsPurged: 0,
  filesPurged: 0,
  submissionsPurged: 0,
  held: 0,
  sessionsPurged: 0,
  failed: 0,
};

/** Run one guest retention pass. Never throws: a failure is reported with counts only. */
export async function runGuestRetentionPurge(
  scope: GuestPurgeScope,
  options: {
    readonly purge?: typeof purgeGuestCollectionData;
    readonly connect?: () => { readonly db: PurgeDb; readonly end: () => Promise<void> } | null;
  } = {},
): Promise<GuestPurgeResult> {
  const connection = (options.connect ?? connectPooled)();
  if (!connection) {
    console.error('[runGuestRetentionPurge] database not configured');
    return NOTHING;
  }
  try {
    const result = await (options.purge ?? purgeGuestCollectionData)(
      connection.db,
      createStorage(connection.db),
      scope,
    );
    if (result.failed > 0) {
      reportServerError('runGuestRetentionPurge', new Error('some guest removals failed'), {
        step: 'purge pass',
        failed: String(result.failed),
      });
    }
    return result;
  } catch (error) {
    reportServerError('runGuestRetentionPurge', error, { step: 'purge pass failed' });
    return NOTHING;
  } finally {
    await connection.end();
  }
}

function connectPooled(): { readonly db: PurgeDb; readonly end: () => Promise<void> } | null {
  return connectJobPool<PurgeDb>('runGuestRetentionPurge');
}
