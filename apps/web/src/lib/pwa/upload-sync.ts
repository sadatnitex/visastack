/**
 * Background sync for waiting uploads (WP-PIC17, picture-first Q6).
 *
 * When the connection drops while files are being added, the files still waiting in the page's own
 * import queue are sent again once the connection returns. Where the browser offers Background Sync
 * (Chromium, Android), the page asks the service worker for a one-off sync; the browser fires it
 * when the device is really back online, and the worker only tells the open VisaStack pages to
 * carry on. The browser's own online event does the same while the page is open.
 *
 * Nothing is stored for this: no file, no name, no person. The files stay in the page's memory and
 * go through the existing upload route with its every check (signed-in session, type, size, safety
 * scan), with the upload id and person they were chosen with. A page that was closed has let its
 * files go, exactly as before; its saved list shows them as not confirmed when it is opened again.
 *
 * Off by default. The owner turns it on with `BACKGROUND_UPLOAD_SYNC=on`. Off, or in a browser
 * without Background Sync (Safari, Firefox), nothing here runs and the queue behaves as before.
 */

/** The one-off sync the page registers. One tag: the browser keeps a single pending sync for it. */
export const UPLOAD_SYNC_TAG = 'visastack-upload-resume';

/** What the worker posts to its own pages when the sync fires. Carries nothing else. */
export const UPLOAD_RESUME_MESSAGE = 'VISASTACK_UPLOAD_RESUME';

/** The owner's switch. Anything but `on` (trimmed, any case) is off. */
export function isBackgroundUploadSyncOn(read: (name: string) => string | undefined): boolean {
  return read('BACKGROUND_UPLOAD_SYNC')?.trim().toLowerCase() === 'on';
}

/** The window parts this needs, so tests can pass a plain object. */
export interface SyncWindow {
  readonly navigator: {
    readonly onLine?: boolean;
    readonly serviceWorker?: {
      getRegistration(): Promise<unknown>;
      addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
      removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    };
  };
  readonly location: { readonly origin: string };
  readonly SyncManager?: unknown;
  /** The browser's ServiceWorker class: a wake must come from one. */
  readonly ServiceWorker?: unknown;
  addEventListener(type: 'online', listener: () => void): void;
  removeEventListener(type: 'online', listener: () => void): void;
}

/** True when this browser can wake a page with a one-off Background Sync. */
export function supportsBackgroundSync(win: SyncWindow | undefined): boolean {
  return !!win?.navigator.serviceWorker && typeof win.SyncManager === 'function';
}

/** What the import queue reads to know whether the device has a connection. */
export interface UploadConnection {
  readonly isOnline: () => boolean;
}

/**
 * The connection the queue is given, or undefined (switch off, no window, or no Background Sync),
 * in which case the queue keeps its earlier behaviour exactly.
 */
export function uploadConnectionFor(
  switchOn: boolean,
  win: SyncWindow | undefined,
): UploadConnection | undefined {
  if (!switchOn || !win || !supportsBackgroundSync(win)) return undefined;
  return { isOnline: () => win.navigator.onLine !== false };
}

interface SyncRegistration {
  readonly sync?: { register(tag: string): Promise<void> };
}

/**
 * Asks the browser for one sync when the connection returns. Resolves false when there is no
 * worker or the browser refuses; the online event still resumes an open page.
 */
export async function requestUploadResume(win: SyncWindow): Promise<boolean> {
  try {
    const registration = (await win.navigator.serviceWorker?.getRegistration()) as
      | SyncRegistration
      | undefined;
    if (!registration?.sync || typeof registration.sync.register !== 'function') return false;
    await registration.sync.register(UPLOAD_SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

/**
 * Only a service worker of this site, saying exactly the resume message, counts: the origin must be
 * this site's and the sender a ServiceWorker (not a window or a frame posting into the page).
 */
export function isUploadResumeMessage(
  event: MessageEvent,
  origin: string,
  workerClass: unknown,
): boolean {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) return false;
  if ((data as { readonly type?: unknown }).type !== UPLOAD_RESUME_MESSAGE) return false;
  if (event.origin !== origin) return false;
  if (typeof workerClass !== 'function' || event.source === null) return false;
  return event.source instanceof (workerClass as new () => object);
}

/**
 * Calls `onResume` when the worker says the connection is back, or the browser fires online.
 * Returns the function that stops listening.
 */
export function listenForUploadResume(win: SyncWindow, onResume: () => void): () => void {
  const container = win.navigator.serviceWorker;
  const origin = win.location.origin;
  const onMessage = (event: MessageEvent) => {
    if (isUploadResumeMessage(event, origin, win.ServiceWorker)) onResume();
  };
  const onOnline = () => onResume();
  container?.addEventListener('message', onMessage);
  win.addEventListener('online', onOnline);
  return () => {
    container?.removeEventListener('message', onMessage);
    win.removeEventListener('online', onOnline);
  };
}

/** The queue parts the page wiring needs. */
export interface ResumableQueue {
  readonly subscribe: (listener: () => void) => () => void;
  readonly waitingForConnection: boolean;
  resumeAfterConnection(): void | Promise<void>;
}

/**
 * Wires one queue to the wake signals: each time the queue starts waiting for the connection a
 * sync is requested, and every wake resumes it. Returns the function that undoes it.
 */
export function connectUploadResume(win: SyncWindow, queue: ResumableQueue): () => void {
  let waiting = queue.waitingForConnection;
  if (waiting) void requestUploadResume(win);
  const unsubscribe = queue.subscribe(() => {
    const now = queue.waitingForConnection;
    if (now && !waiting) void requestUploadResume(win);
    waiting = now;
  });
  const stopListening = listenForUploadResume(win, () => {
    void queue.resumeAfterConnection();
  });
  return () => {
    unsubscribe();
    stopListening();
  };
}

/** The browser window, typed for this file, or undefined on the server. */
export function browserSyncWindow(): SyncWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as SyncWindow);
}
