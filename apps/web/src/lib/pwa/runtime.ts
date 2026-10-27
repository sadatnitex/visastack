/**
 * Browser side of the service worker (`/sw.js`): register it, notice when a newer VisaStack is
 * ready, and switch to it only when the person asks. Kept free of React so it is testable with
 * plain fakes; `components/pwa/pwa-runtime.tsx` wires it to the page.
 *
 * Update rule (Lane D section 10): pages always come from the network, so a new deployment's
 * pages arrive on the next navigation anyway. What can lag is the worker itself and a page left
 * open for hours. A waiting worker is never forced in: the person sees an update notice and
 * chooses Reload Now, so nothing they are typing or uploading is cut off.
 */

import { CACHE_PREFIX } from './constants';

export const SERVICE_WORKER_URL = '/sw.js';

/** How often an open page asks whether a newer worker exists. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface UpdateHandlers {
  /** A newer worker is installed and waiting for the person's go-ahead. */
  readonly onUpdateReady: (waiting: ServiceWorker) => void;
}

/**
 * Registers the worker and reports a waiting update. The first install on a device is not an
 * update (there is no older worker controlling the page), so it never raises the notice.
 */
export async function registerServiceWorker(
  container: ServiceWorkerContainer,
  handlers: UpdateHandlers,
): Promise<ServiceWorkerRegistration> {
  const registration = await container.register(SERVICE_WORKER_URL, {
    scope: '/',
    updateViaCache: 'none',
  });

  const watch = (worker: ServiceWorker) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) handlers.onUpdateReady(worker);
    });
  };

  if (registration.waiting && container.controller) handlers.onUpdateReady(registration.waiting);
  if (registration.installing) watch(registration.installing);
  registration.addEventListener('updatefound', () => {
    if (registration.installing) watch(registration.installing);
  });
  return registration;
}

/**
 * Starts the waiting worker and reloads once it has taken over. Called only from the person's
 * own Reload Now click. If another tab already started it, there is nothing left to wait for.
 */
export function applyUpdate(
  container: ServiceWorkerContainer,
  waiting: ServiceWorker,
  reload: () => void,
): void {
  if (waiting.state === 'activating' || waiting.state === 'activated') {
    reload();
    return;
  }
  let reloaded = false;
  container.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Removes every VisaStack worker and its stored files on this device (used while the worker is
 * switched off). The files are deleted here too, because unregistering first means the retirement
 * worker may never get to run.
 */
export async function unregisterAll(
  container: ServiceWorkerContainer,
  storage: Pick<CacheStorage, 'keys' | 'delete'> | undefined,
): Promise<void> {
  const registrations = await container.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (!storage) return;
  const names = await storage.keys();
  await Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => storage.delete(name)),
  );
}

/**
 * Checks for a newer worker when the page becomes visible again and while it stays open, at most
 * once per interval. Returns a stop function.
 */
export function scheduleUpdateChecks(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
  options: {
    readonly now: () => number;
    readonly isHidden: () => boolean;
    readonly onVisible: (listener: () => void) => () => void;
    readonly every: (run: () => void, ms: number) => () => void;
  },
): () => void {
  let lastCheck = options.now();
  const check = () => {
    if (options.isHidden()) return;
    if (options.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
    lastCheck = options.now();
    // A failed check (offline, server busy) is retried at the next opportunity.
    registration.update().catch(() => undefined);
  };
  const stopVisible = options.onVisible(check);
  const stopTimer = options.every(check, UPDATE_CHECK_INTERVAL_MS);
  return () => {
    stopVisible();
    stopTimer();
  };
}

/** Whether VisaStack is running as an installed app rather than in a browser tab. */
export function isStandalone(win: Pick<Window, 'matchMedia' | 'navigator'>): boolean {
  if (win.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS home-screen apps report this instead of the display-mode media query.
  return (win.navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
}
