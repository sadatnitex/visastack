/**
 * Keeps the screen awake while a photo check is open (Screen Wake Lock). Silent when the browser
 * has no wake lock or refuses it: it never throws and never blocks the page. The lock is released
 * on close and whenever the page is hidden, and asked for again when the page comes back.
 */

interface SentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<SentinelLike>;
}

const pageHidden = (): boolean => document.visibilityState === 'hidden';

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as { wakeLock?: WakeLockLike }).wakeLock;
  return api && typeof api.request === 'function' ? api : null;
}

export function wakeLockSupported(): boolean {
  return wakeLockApi() !== null;
}

/** Starts holding the screen awake; call the returned function to let go. Safe to call anywhere. */
export function holdScreenAwake(): () => void {
  const api = wakeLockApi();
  if (!api || typeof document === 'undefined') return () => undefined;
  let open = true;
  let sentinel: SentinelLike | null = null;
  let asking = false;

  const ask = async () => {
    if (!open || asking || sentinel || pageHidden()) return;
    asking = true;
    try {
      const got = await api.request('screen');
      if (!open || pageHidden()) {
        await got.release().catch(() => undefined);
      } else {
        sentinel = got;
        got.addEventListener?.('release', () => {
          if (sentinel === got) sentinel = null;
        });
      }
    } catch {
      // Refused (low battery, no permission): the photo check works the same without it.
    } finally {
      asking = false;
    }
  };

  const drop = () => {
    const held = sentinel;
    sentinel = null;
    held?.release().catch(() => undefined);
  };

  const onVisibility = () => {
    if (pageHidden()) drop();
    else void ask();
  };

  document.addEventListener('visibilitychange', onVisibility);
  void ask();

  return () => {
    open = false;
    document.removeEventListener('visibilitychange', onVisibility);
    drop();
  };
}
