// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WP-PIC18: the alerts card in the browser. The permission question appears only after Turn On
 * is pressed, never on load; every state says plainly what is going on.
 */

const actions = vi.hoisted(() => ({
  on: vi.fn(async (_subscription: unknown) => ({ ok: true }) as { ok: boolean }),
  off: vi.fn(async (_endpoint: unknown) => ({ ok: true }) as { ok: boolean }),
  renew: vi.fn(async (_endpoint: unknown) => ({ ok: true }) as { ok: boolean }),
}));
vi.mock('./push-actions', () => ({
  turnOnPushAction: actions.on,
  turnOffPushAction: actions.off,
  renewPushAction: actions.renew,
}));

const { PushCard, RenewPushOnLoad, TurnOffPushOnSubmit } = await import('./push-card');

const KEY =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';

let container: HTMLDivElement;
let root: Root;

function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/x') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function install(options: {
  existing?: ReturnType<typeof fakeSubscription> | null;
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  worker?: boolean;
}) {
  let current = options.existing ?? null;
  const subscribe = vi.fn(async () => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/new');
    return current;
  });
  const registration = {
    pushManager: { getSubscription: vi.fn(async () => current), subscribe },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready:
        options.worker === false ? new Promise(() => undefined) : Promise.resolve(registration),
      getRegistration: async () => (options.worker === false ? undefined : registration),
    },
  });
  const requestPermission = vi.fn(async () => options.answer ?? 'granted');
  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    value: function PushManager() {},
  });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: options.permission ?? 'default', requestPermission },
  });
  return { requestPermission, subscribe, current: () => current };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
  await settle();
}

async function press() {
  await act(async () => {
    container.querySelector('button')?.click();
  });
  await settle();
}

function button(): HTMLButtonElement | null {
  return container.querySelector('button');
}

function status(): string {
  return container.querySelector('output')?.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  actions.on.mockClear();
  actions.off.mockClear();
  actions.renew.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(window, 'PushManager');
  Reflect.deleteProperty(window, 'Notification');
  Reflect.deleteProperty(navigator, 'userAgent');
});

describe('PushCard', () => {
  it('never asks for permission on load', async () => {
    const browser = install({});
    await render(<PushCard publicKey={KEY} />);
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(button()?.textContent).toBe('Turn On Notifications');
    expect(container.textContent).toContain('Phone and Desktop Alerts');
  });

  it('says plainly when this browser cannot show alerts', async () => {
    await render(<PushCard publicKey={KEY} />);
    expect(button()).toBeNull();
    expect(status()).toBe('This browser cannot show alerts from VisaStack.');
  });

  it('treats a browser whose worker never becomes ready as unable, without hanging', async () => {
    vi.useFakeTimers();
    install({ worker: false });
    await act(async () => {
      root.render(<PushCard publicKey={KEY} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });
    expect(status()).toBe('This browser cannot show alerts from VisaStack.');
  });

  it('asks iPhone Safari users to add VisaStack to the Home Screen first', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari',
    });
    install({});
    await render(<PushCard publicKey={KEY} />);
    expect(button()).toBeNull();
    expect(status()).toContain('Add VisaStack to Your Home Screen to Get Alerts');
  });

  it('turns on after the person agrees, and stores the subscription', async () => {
    const browser = install({});
    await render(<PushCard publicKey={KEY} />);
    await press();
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(actions.on).toHaveBeenCalledTimes(1);
    expect(button()?.textContent).toBe('Turn Off');
    expect(status()).toBe('Alerts are on for this device.');
  });

  it('says so when the person closes the question without choosing', async () => {
    const browser = install({ answer: 'default' });
    await render(<PushCard publicKey={KEY} />);
    await press();
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(status()).toBe('No change. You can turn alerts on at any time.');
    expect(button()?.textContent).toBe('Turn On Notifications');
  });

  it('explains how to allow alerts when the browser blocks them', async () => {
    const browser = install({ answer: 'denied' });
    await render(<PushCard publicKey={KEY} />);
    await press();
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(actions.on).not.toHaveBeenCalled();
    expect(button()).toBeNull();
    expect(status()).toContain('allow notifications');
  });

  it('undoes the browser subscription when the server refuses it', async () => {
    const browser = install({});
    actions.on.mockResolvedValueOnce({ ok: false });
    await render(<PushCard publicKey={KEY} />);
    await press();
    expect(browser.current()?.unsubscribe).toHaveBeenCalled();
    expect(status()).toBe('That did not work. Please try again.');
  });

  it('turns off: the server forgets it, then the browser does', async () => {
    const existing = fakeSubscription();
    install({ existing, permission: 'granted' });
    await render(<PushCard publicKey={KEY} />);
    expect(actions.renew).toHaveBeenCalledWith(existing.endpoint);
    expect(button()?.textContent).toBe('Turn Off');
    await press();
    expect(actions.off).toHaveBeenCalledWith(existing.endpoint);
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(button()?.textContent).toBe('Turn On Notifications');
  });

  it('shows the failure when the server could not turn alerts off', async () => {
    const existing = fakeSubscription();
    install({ existing, permission: 'granted' });
    actions.off.mockResolvedValueOnce({ ok: false });
    await render(<PushCard publicKey={KEY} />);
    await press();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(status()).toBe('That did not work. Please try again.');
  });
});

describe('PushCard and the server', () => {
  it('shows Off when the browser holds a subscription the server does not know', async () => {
    const existing = fakeSubscription();
    install({ existing, permission: 'granted' });
    actions.renew.mockResolvedValueOnce({ ok: false });
    await render(<PushCard publicKey={KEY} />);
    expect(actions.renew).toHaveBeenCalledWith(existing.endpoint);
    expect(button()?.textContent).toBe('Turn On Notifications');
  });

  it('replaces an old browser subscription, telling the server to forget the old one', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old');
    const browser = install({ existing, permission: 'granted' });
    actions.renew.mockResolvedValueOnce({ ok: false });
    await render(<PushCard publicKey={KEY} />);
    await press();
    expect(actions.off).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/old');
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    expect(button()?.textContent).toBe('Turn Off');
  });
});

describe('TurnOffPushOnSubmit', () => {
  it('sends this browser’s address with the sign-out and unsubscribes, without stopping it', async () => {
    const existing = fakeSubscription();
    install({ existing, permission: 'granted' });
    window.localStorage.setItem('visastack.push.renewedAt', String(Date.now()));
    await render(
      <form>
        <TurnOffPushOnSubmit />
      </form>,
    );
    const form = container.querySelector('form');
    expect(form ? new FormData(form).get('push_endpoint') : null).toBe(existing.endpoint);
    const event = new Event('submit', { cancelable: true });
    form?.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(window.localStorage.getItem('visastack.push.renewedAt')).toBeNull();
  });

  it('sends an empty field when this browser has no alerts', async () => {
    install({});
    await render(
      <form>
        <TurnOffPushOnSubmit />
      </form>,
    );
    const form = container.querySelector('form');
    expect(form ? new FormData(form).get('push_endpoint') : null).toBe('');
  });
});

describe('RenewPushOnLoad', () => {
  it('renews a browser with alerts on, at most twice a day', async () => {
    const existing = fakeSubscription();
    install({ existing, permission: 'granted' });
    await render(<RenewPushOnLoad />);
    expect(actions.renew).toHaveBeenCalledWith(existing.endpoint);
    actions.renew.mockClear();
    await render(<RenewPushOnLoad key="again" />);
    expect(actions.renew).not.toHaveBeenCalled();
  });

  it('does nothing for a browser without alerts', async () => {
    install({});
    await render(<RenewPushOnLoad />);
    expect(actions.renew).not.toHaveBeenCalled();
  });
});
