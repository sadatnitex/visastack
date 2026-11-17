'use client';

import { useEffect, useState } from 'react';
import {
  type ResumableQueue,
  type UploadConnection,
  browserSyncWindow,
  connectUploadResume,
  uploadConnectionFor,
} from './upload-sync';

/**
 * WP-PIC17: the one way a page that adds files gets background sync. The connection is decided
 * once, in the browser (undefined on the server, with the switch off, or without Background Sync);
 * pass it to the import queue, then hand the queue to `useUploadResume`.
 */
export function useUploadConnection(switchOn: boolean): UploadConnection | undefined {
  const [connection] = useState(() => uploadConnectionFor(switchOn, browserSyncWindow()));
  return connection;
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
