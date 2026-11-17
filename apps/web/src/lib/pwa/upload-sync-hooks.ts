'use client';

import { useEffect, useState } from 'react';
import {
  type ResumableQueue,
  type UploadConnection,
  browserSyncWindow,
  connectUploadResume,
  uploadConnectionFor,
} from './upload-sync';

/** What a page passes to its import queue for background sync: both together, or nothing. */
export interface UploadSync {
  readonly options:
    | {
        readonly connection: UploadConnection;
        readonly confirmResume: () => Promise<boolean | null>;
      }
    | Record<never, never>;
  readonly connection: UploadConnection | undefined;
}

/**
 * WP-PIC17: the one way a page that adds files gets background sync. Decided once, in the browser:
 * nothing on the server, with the switch off, or without Background Sync. The connection never
 * comes without the account check, so no page can turn on resuming and forget the check. Spread
 * `options` into the import queue's options, then hand the queue to `useUploadResume`.
 */
export function useUploadSync(
  switchOn: boolean,
  confirmResume: () => Promise<boolean | null>,
): UploadSync {
  const [sync] = useState<UploadSync>(() => {
    const connection = uploadConnectionFor(switchOn, browserSyncWindow());
    return connection
      ? { options: { connection, confirmResume }, connection }
      : { options: {}, connection: undefined };
  });
  return sync;
}

/** Resumes the queue on a background sync wake or the online event, while the page is open. */
export function useUploadResume(
  connection: UploadConnection | undefined,
  queue: ResumableQueue,
): void {
  useEffect(() => {
    const win = browserSyncWindow();
    if (!connection || !win) return;
    return connectUploadResume(win, queue);
  }, [connection, queue]);
}
