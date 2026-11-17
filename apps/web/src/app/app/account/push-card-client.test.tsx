// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WP-PIC18: the alerts card in the browser. The permission question appears only after Turn On
 * is pressed, never on load; the card hides itself where alerts cannot work.
 */

const actions = vi.hoisted(() => ({
  on: vi.fn(async (_subscription: unknown) => ({ ok: true }) as { ok: boolean }),
  off: vi.fn(async (_endpoint: unknown) => ({ ok: true })),
}));
vi.mock('./push-actions', () => ({
  turnOnPushAction: actions.on,
  turnOffPushAction: actions.off,
}));

const { PushCard, TurnOffPushOnSubmit } = await import('./push-card');

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
  registration?: boolean;
}) {
  let current = options.existing ?? null;
  const subscribe = vi.fn(async () => {
    current = fakeSubscription();
    return current;
  });
  const registration = {
    pushManager: { getSubscription: vi.fn(async () => current), subscribe },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => (options.registration === false ? undefined : registration),
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

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(): HTMLButtonElement | null {
  return container.querySelector('button');
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  actions.on.mockClear();
  actions.off.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
  Reflect.deleteProperty(window, 'PushManager');
  Reflect.deleteProperty(window, 'Notification');
});

describe('PushCard', () => {
  it('never asks for permission on load', async () => {
    const browser = install({});
    await render(
      <PushCard publicKey="BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4" />,
    );
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(button()?.textContent).toBe('Turn On Notifications');
    expect(container.textContent).toContain('Phone and Desktop Alerts');
  });

  it('hides itself where the browser cannot alert', async () => {
    await render(<PushCard publicKey="k" />);
    expect(container.innerHTML).toBe('');
    install({ registration: false });
    await render(<PushCard publicKey="k2" />);
    expect(container.innerHTML).toBe('');
  });

  it('turns on after the person agrees, and stores the subscription', async () => {
    const browser = install({});
    await render(
      <PushCard publicKey="BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4" />,
    );
    await act(async () => {
      button()?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(actions.on).toHaveBeenCalledTimes(1);
    expect(button()?.textContent).toBe('Turn Off');
    expect(container.textContent).toContain('Alerts are on for this device.');
  });

  it('does not subscribe when the person says no', async () => {
    const browser = install({ answer: 'denied' });
    await render(<PushCard publicKey="k" />);
    await act(async () => {
      button()?.click();
    });
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(actions.on).not.toHaveBeenCalled();
    expect(button()).toBeNull();
  });

  it('undoes the browser subscription when the server refuses it', async () => {
    const browser = install({});
    actions.on.mockResolvedValueOnce({ ok: false });
    await render(
      <PushCard publicKey="BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4" />,
    );
    await act(async () => {
      button()?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(browser.current()?.unsubscribe).toHaveBeenCalled();
    expect(container.textContent).toContain('That did not work');
  });

  it('turns off: the browser forgets it and so does the server', async () => {
    const existing = fakeSubscription();
    install({ existing, permission: 'granted' });
    await render(<PushCard publicKey="k" />);
    expect(button()?.textContent).toBe('Turn Off');
    await act(async () => {
      button()?.click();
    });
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(actions.off).toHaveBeenCalledWith(existing.endpoint);
    expect(button()?.textContent).toBe('Turn On Notifications');
  });
});

describe('TurnOffPushOnSubmit', () => {
  it('unsubscribes this browser when the sign-out form is sent, without stopping it', async () => {
    const existing = fakeSubscription();
    install({ existing, permission: 'granted' });
    await render(
      <form>
        <TurnOffPushOnSubmit />
      </form>,
    );
    const form = container.querySelector('form');
    const event = new Event('submit', { cancelable: true });
    form?.dispatchEvent(event);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(event.defaultPrevented).toBe(false);
    expect(existing.unsubscribe).toHaveBeenCalled();
  });
});
