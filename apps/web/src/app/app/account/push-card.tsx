'use client';

import { useEffect, useRef, useState } from 'react';
import { pushStatusAction, turnOffPushAction, turnOnPushAction } from './push-actions';

/**
 * Phone and desktop alerts on the Account page (WP-PIC18). Shown only while Web Push is on (the
 * server decides) and only in a browser that can receive them. The browser's own permission
 * question appears only after "Turn On Notifications" is pressed, never on page load.
 */

type State = 'checking' | 'unsupported' | 'off' | 'on' | 'blocked' | 'working' | 'failed';

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

async function currentRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

const STATUS: Partial<Record<State, string>> = {
  on: 'Alerts are on for this device.',
  blocked:
    'This browser is set to block alerts from VisaStack. You can allow them in its settings.',
  failed: 'That did not work. Please try again.',
};

export function PushCard({ publicKey }: { readonly publicKey: string }) {
  const [state, setState] = useState<State>('checking');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      if (!browserCanAlert()) return setState('unsupported');
      const registration = await currentRegistration();
      if (!registration) return mounted.current && setState('unsupported');
      if (Notification.permission === 'denied') return mounted.current && setState('blocked');
      const existing = await registration.pushManager.getSubscription().catch(() => null);
      // "On" only when the server also has this browser for this account: after a sign-out or
      // another account's use, the browser may still hold a subscription nobody sends to.
      const known = existing
        ? await pushStatusAction(existing.endpoint).catch(() => ({ ok: false }))
        : { ok: false };
      if (mounted.current) setState(known.ok ? 'on' : 'off');
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  if (state === 'checking' || state === 'unsupported') return null;

  async function turnOn() {
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const registration = await currentRegistration();
      if (!registration) {
        setState('failed');
        return;
      }
      // A fresh subscription every time: an old one may belong to an earlier account or key.
      const stale = await registration.pushManager.getSubscription();
      if (stale) await stale.unsubscribe().catch(() => undefined);
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
      const registration = await currentRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => undefined);
        await turnOffPushAction(endpoint);
      }
      setState('off');
    } catch {
      setState('failed');
    }
  }

  const status = STATUS[state];
  const isOn = state === 'on';

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
      {state === 'blocked' ? null : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={state === 'working'}
          aria-busy={state === 'working'}
          onClick={isOn ? turnOff : turnOn}
        >
          {isOn ? 'Turn Off' : 'Turn On Notifications'}
        </button>
      )}
      <output className="card-body u-mt-050" aria-live="polite">
        {status ?? ''}
      </output>
    </article>
  );
}

/**
 * Placed inside a sign-out form: when that form is sent, this browser's alerts are switched off
 * too, so the next person to use it gets none. The server forgets this sign-in's browsers as
 * well. Never delays or stops the form.
 */
export function TurnOffPushOnSubmit() {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = field.current?.form;
    if (!form) return;
    const listener = () => {
      if (!browserCanAlert()) return;
      void currentRegistration()
        .then((registration) => registration?.pushManager.getSubscription())
        .then((subscription) => subscription?.unsubscribe())
        .catch(() => undefined);
    };
    form.addEventListener('submit', listener);
    return () => form.removeEventListener('submit', listener);
  }, []);
  return <input ref={field} type="hidden" />;
}
