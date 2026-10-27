// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInstallPrompt, setInstallPrompt } from '../../lib/pwa/install-prompt';
import { InstallAppCard } from './install-app-card';
import { PwaRuntime } from './pwa-runtime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function installServiceWorker(options: { waiting?: boolean } = {}) {
  const waiting = options.waiting ? { postMessage: vi.fn(), addEventListener: vi.fn() } : null;
  const registration = Object.assign(new EventTarget(), {
    waiting,
    installing: null,
    update: vi.fn(async () => undefined),
    unregister: vi.fn(async () => true),
  });
  const container = Object.assign(new EventTarget(), {
    controller: {},
    register: vi.fn(async () => registration),
    getRegistrations: vi.fn(async () => [registration]),
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  return { container, registration, waiting };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(window, 'matchMedia');
  setInstallPrompt(null);
  vi.restoreAllMocks();
});

describe('PwaRuntime', () => {
  it('works in a browser without service workers', async () => {
    const { host, unmount } = await mount(<PwaRuntime enabled />);
    expect(host.querySelector('output')).not.toBeNull();
    expect(host.textContent).toBe('');
    await unmount();
  });

  it('says plainly when the connection drops and when it returns', async () => {
    const { host, unmount } = await mount(<PwaRuntime enabled={false} />);
    await act(async () => window.dispatchEvent(new Event('offline')));
    const output = host.querySelector('output');
    expect(output?.textContent).toContain('You are offline.');
    expect(output?.textContent).toContain('has not been saved');
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(output?.textContent).toBe('You are back online.');
    await unmount();
  });

  it('offers a waiting update and switches only when asked', async () => {
    const { container, waiting } = installServiceWorker({ waiting: true });
    const { host, unmount } = await mount(<PwaRuntime enabled />);
    await act(async () => undefined);
    expect(container.register).toHaveBeenCalled();
    const region = host.querySelector('aside[aria-label="App Update"]');
    expect(region?.textContent).toContain('A new version of VisaStack is ready.');
    expect(waiting?.postMessage).not.toHaveBeenCalled();
    const reload = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reload Now');
    await act(async () => reload?.click());
    expect(waiting?.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    await unmount();
  });

  it('lets the person put the update off', async () => {
    installServiceWorker({ waiting: true });
    const { host, unmount } = await mount(<PwaRuntime enabled />);
    await act(async () => undefined);
    const later = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Later');
    await act(async () => later?.click());
    expect(host.querySelector('aside')).toBeNull();
    await unmount();
  });

  it('removes an existing worker while the feature is switched off', async () => {
    const { container, registration } = installServiceWorker();
    const { unmount } = await mount(<PwaRuntime enabled={false} />);
    await act(async () => undefined);
    expect(container.register).not.toHaveBeenCalled();
    expect(registration.unregister).toHaveBeenCalled();
    await unmount();
  });

  it("keeps the browser's install offer for the Help page instead of showing a bar", async () => {
    const { unmount } = await mount(<PwaRuntime enabled={false} />);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    await act(async () => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallPrompt()).toBe(event);
    await act(async () => window.dispatchEvent(new Event('appinstalled')));
    expect(getInstallPrompt()).toBeNull();
    await unmount();
  });
});

describe('InstallAppCard', () => {
  function stubDisplayMode(standalone: boolean) {
    // jsdom has no matchMedia.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: standalone, media: query }) as MediaQueryList,
    });
  }

  it('gives written steps everywhere and says installing copies no records', async () => {
    stubDisplayMode(false);
    const { host, unmount } = await mount(<InstallAppCard />);
    expect(host.querySelector('h2')?.textContent).toBe('Use VisaStack on Your Phone');
    expect(host.textContent).toContain('Add to Home Screen');
    expect(host.textContent).toContain('Installing does not download your records.');
    expect(host.querySelector('button')).toBeNull();
    await unmount();
  });

  it("shows Install VisaStack when the browser offers it, and uses the browser's own dialog", async () => {
    stubDisplayMode(false);
    const prompt = vi.fn(async () => undefined);
    setInstallPrompt(
      Object.assign(new Event('beforeinstallprompt'), {
        prompt,
        userChoice: Promise.resolve({ outcome: 'accepted' as const }),
      }),
    );
    const { host, unmount } = await mount(<InstallAppCard />);
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Install VisaStack');
    await act(async () => button?.click());
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('VisaStack is installed on this device.');
    await unmount();
  });

  it('says so when already running as an installed app', async () => {
    stubDisplayMode(true);
    const { host, unmount } = await mount(<InstallAppCard />);
    expect(host.textContent).toContain('VisaStack is installed on this device.');
    expect(host.textContent).not.toContain('Add to Home Screen');
    await unmount();
  });
});
