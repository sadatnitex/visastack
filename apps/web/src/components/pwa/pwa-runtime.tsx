'use client';

import { useEffect, useRef, useState } from 'react';
import { captureInstallPrompt } from '../../lib/pwa/install-prompt';
import {
  applyUpdate,
  registerServiceWorker,
  scheduleUpdateChecks,
  unregisterAll,
} from '../../lib/pwa/runtime';
import styles from './pwa-runtime.module.css';

type Connection = 'online' | 'offline' | 'restored';

/** How long the "back online" note stays before it clears itself. */
const RESTORED_NOTE_MS = 5000;

const { dock, message, update, actions } = styles;

if (typeof window !== 'undefined') captureInstallPrompt(window);

/**
 * Installed-app support for every page (Lane D PWA): registers the service worker, keeps the
 * browser's install offer for the Help page, tells the person when the connection drops or
 * returns, and offers a newer version without ever reloading on its own.
 *
 * `enabled` is decided on the server (production, and `PWA_SERVICE_WORKER` not `off`). When it is
 * false any worker already on the device is removed, so switching the feature off is clean.
 */
export function PwaRuntime({ enabled }: { readonly enabled: boolean }) {
  const [connection, setConnection] = useState<Connection>('online');
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const restoredTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const container = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    if (!container) return;
    if (!enabled) {
      unregisterAll(container, 'caches' in window ? window.caches : undefined).catch(
        () => undefined,
      );
      return;
    }
    let stopChecks: (() => void) | undefined;
    let cancelled = false;
    registerServiceWorker(container, { onUpdateReady: (worker) => setWaiting(worker) })
      .then((registration) => {
        if (cancelled) return;
        stopChecks = scheduleUpdateChecks(registration, {
          now: () => Date.now(),
          isHidden: () => document.hidden,
          onVisible: (listener) => {
            document.addEventListener('visibilitychange', listener);
            return () => document.removeEventListener('visibilitychange', listener);
          },
          every: (run, ms) => {
            const handle = setInterval(run, ms);
            return () => clearInterval(handle);
          },
        });
      })
      // Registration can fail (private browsing, storage blocked). The site works the same without it.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopChecks?.();
    };
  }, [enabled]);

  // Another tab started the update: this page now runs under the new worker, so its notice goes.
  useEffect(() => {
    const container = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    if (!container) return;
    const onTakeover = () => setWaiting(null);
    container.addEventListener('controllerchange', onTakeover);
    return () => container.removeEventListener('controllerchange', onTakeover);
  }, []);

  useEffect(() => {
    const onOffline = () => {
      clearTimeout(restoredTimer.current);
      setConnection('offline');
    };
    const onOnline = () => {
      setConnection((previous) => (previous === 'offline' ? 'restored' : previous));
      clearTimeout(restoredTimer.current);
      restoredTimer.current = setTimeout(() => setConnection('online'), RESTORED_NOTE_MS);
    };
    if (!navigator.onLine) onOffline();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(restoredTimer.current);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const reloadNow = () => {
    const container = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    if (!waiting || !container) return;
    setUpdating(true);
    applyUpdate(container, waiting, () => window.location.reload());
  };

  return (
    <div className={dock} data-pwa-runtime="">
      {/* Always present so screen readers hear each change (a live region added later is missed). */}
      <output aria-live="polite">
        {connection === 'offline' ? (
          <span className={`notice notice-warn ${message}`}>
            You are offline. Reconnect to continue securely. Anything not yet sent has not been
            saved.
          </span>
        ) : null}
        {connection === 'restored' ? (
          <span className={`notice notice-ok ${message}`}>You are back online.</span>
        ) : null}
      </output>
      {waiting ? (
        <aside aria-label="App Update" className={`notice ${message} ${update}`}>
          <p>
            A new version of VisaStack is ready. Finish anything you are typing or uploading, then
            reload.
          </p>
          <div className={actions}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={reloadNow}
              disabled={updating}
            >
              {updating ? 'Reloading' : 'Reload Now'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setWaiting(null)}
              disabled={updating}
            >
              Later
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
