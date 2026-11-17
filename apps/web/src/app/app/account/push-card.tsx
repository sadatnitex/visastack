'use client';

import { useEffect, useRef, useState } from 'react';
import { PUSH_ENDPOINT_FIELD } from '../../../lib/web-push-fields';
import { renewPushAction, turnOffPushAction, turnOnPushAction } from './push-actions';

/**
 * Phone and desktop alerts on the Account page (WP-PIC18). Shown only while Web Push is on (the
 * server decides). The browser's own permission question appears only after "Turn On
 * Notifications" is pressed, never on page load.
 */

type State =
  | 'checking'
  | 'unsupported'
  | 'install'
  | 'off'
  | 'on'
  | 'blocked'
  | 'dismissed'
  | 'working'
  | 'failed';

/** How long to wait for this site's service worker before treating the browser as unable. */
const WORKER_WAIT_MS = 5000;

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function browserCanAlert(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iPhone or iPad Safari outside the Home Screen app, where alerts need the app added first. */
function needsHomeScreen(): boolean {
  if (typeof window === 'undefined') return false;
  const apple =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!apple) return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

/** This site's active service worker, or null when none is ready in time. */
async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!browserCanAlert()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), WORKER_WAIT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await readyRegistration();
  return (await registration?.pushManager.getSubscription().catch(() => null)) ?? null;
}

/** At most twice a day. */
const RENEW_EVERY_MS = 12 * 60 * 60 * 1000;
const RENEW_KEY = 'visastack.push.renewedAt';

const STATUS: Partial<Record<State, string>> = {
  unsupported: 'This browser cannot show alerts from VisaStack.',
  install:
    'Add VisaStack to Your Home Screen to Get Alerts. Then open it from there and turn them on.',
  on: 'Alerts are on for this device.',
  blocked:
    'This browser is set to block alerts from VisaStack. To allow them, open this site’s settings in your browser and allow notifications.',
  dismissed: 'No change. You can turn alerts on at any time.',
  failed: 'That did not work. Please try again.',
};

export function PushCard({ publicKey }: { readonly publicKey: string }) {
  const [state, setState] = useState<State>('checking');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const settle = (next: State) => {
      if (mounted.current) setState(next);
    };
    (async () => {
      if (needsHomeScreen()) return settle('install');
      if (!browserCanAlert()) return settle('unsupported');
      const registration = await readyRegistration();
      if (!registration) return settle('unsupported');
      if (Notification.permission === 'denied') return settle('blocked');
      const existing = await registration.pushManager.getSubscription().catch(() => null);
      // "On" only when the server also has this browser for this account (and it is renewed and
      // tied to this sign-in by the same call): after a sign-out or another account's use, the
      // browser may still hold a subscription nobody sends to.
      const known = existing
        ? await renewPushAction(existing.endpoint).catch(() => ({ ok: false }))
        : { ok: false };
      settle(known.ok ? 'on' : 'off');
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  if (state === 'checking') return null;

  async function turnOn() {
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'dismissed');
        return;
      }
      const registration = await readyRegistration();
      if (!registration) {
        setState('failed');
        return;
      }
      // A fresh subscription every time: an old one may belong to an earlier account or key, and
      // the server is told to forget it.
      const stale = await registration.pushManager.getSubscription();
      if (stale) {
        await turnOffPushAction(stale.endpoint).catch(() => undefined);
        await stale.unsubscribe().catch(() => undefined);
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      const result = await turnOnPushAction(subscription.toJSON());
      if (!result.ok) {
        await subscription.unsubscribe().catch(() => undefined);
        setState('failed');
        return;
      }
      setState('on');
    } catch {
      setState('failed');
    }
  }

  async function turnOff() {
    setState('working');
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        const result = await turnOffPushAction(subscription.endpoint);
        if (!result.ok) {
          setState('failed');
          return;
        }
        await subscription.unsubscribe().catch(() => undefined);
      }
      setState('off');
    } catch {
      setState('failed');
    }
  }

  const status = STATUS[state];
  const isOn = state === 'on';
  const canAct =
    state === 'off' ||
    state === 'on' ||
    state === 'dismissed' ||
    state === 'failed' ||
    state === 'working';

  return (
    <article className="card" aria-labelledby="push-card-title">
      <p className="card-kicker">Notifications</p>
      <h2 className="card-title" id="push-card-title">
        Phone and Desktop Alerts
      </h2>
      <p className="card-body u-mb-125">
        Get a short alert on this device when something in VisaStack needs you. Alerts never show
        names or documents; you see the details after you sign in.
      </p>
      {canAct ? (
        <button
          type="button"
          className="btn btn-secondary"
          aria-disabled={state === 'working' || undefined}
          aria-busy={state === 'working'}
          onClick={state === 'working' ? undefined : isOn ? turnOff : turnOn}
        >
          {isOn ? 'Turn Off' : 'Turn On Notifications'}
        </button>
      ) : null}
      <output className="card-body u-mt-050" aria-live="polite">
        {status ?? ''}
      </output>
    </article>
  );
}

/**
 * Placed inside every sign-out form: it carries this browser's push address (so the server
 * forgets this browser even when another sign-in turned its alerts on), and when the form is
 * sent the browser unsubscribes itself too. Never delays or stops the form; with no alerts on
 * the field stays empty.
 */
export function TurnOffPushOnSubmit() {
  const field = useRef<HTMLInputElement>(null);
  const [endpoint, setEndpoint] = useState('');
  useEffect(() => {
    let live = true;
    if (browserCanAlert()) {
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.pushManager.getSubscription())
        .then((subscription) => {
          if (live && subscription) setEndpoint(subscription.endpoint);
        })
        .catch(() => undefined);
    }
    const form = field.current?.form;
    if (!form) return;
    const listener = () => {
      try {
        window.localStorage.removeItem(RENEW_KEY);
      } catch {
        // Nothing stored.
      }
      if (!browserCanAlert()) return;
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.pushManager.getSubscription())
        .then((subscription) => subscription?.unsubscribe())
        .catch(() => undefined);
    };
    form.addEventListener('submit', listener);
    return () => {
      live = false;
      form.removeEventListener('submit', listener);
    };
  }, []);
  return <input ref={field} type="hidden" name={PUSH_ENDPOINT_FIELD} value={endpoint} />;
}

/**
 * Loaded on signed-in pages while Web Push is on: when this browser has alerts on, the server is
 * told it was seen signed in (at most twice a day), which keeps its alerts going and ties them to
 * this sign-in. Renders nothing and asks the browser for nothing.
 */
export function RenewPushOnLoad() {
  useEffect(() => {
    if (!browserCanAlert()) return;
    let last = 0;
    try {
      last = Number(window.localStorage.getItem(RENEW_KEY) ?? 0) || 0;
    } catch {
      last = 0;
    }
    if (Date.now() - last < RENEW_EVERY_MS) return;
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then(async (subscription) => {
        if (!subscription) return;
        const result = await renewPushAction(subscription.endpoint);
        if (!result.ok) return;
        try {
          window.localStorage.setItem(RENEW_KEY, String(Date.now()));
        } catch {
          // Renewed again on the next page.
        }
      })
      .catch(() => undefined);
  }, []);
  return null;
}
