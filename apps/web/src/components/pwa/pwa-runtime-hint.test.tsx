// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_HINT_TEXT } from '../../lib/pwa/browser-hint';
import { PwaRuntime } from './pwa-runtime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A Chrome on a phone: touch, "Google Inc.", 412 wide, in a browser tab unless told otherwise. */
function phone(options: { layoutWidth?: number; search?: string; displayMode?: string } = {}) {
  const { layoutWidth = 412, search = '', displayMode = 'browser' } = options;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === '(pointer: coarse)' ? true : query === `(display-mode: ${displayMode})`,
    }),
  });
  Object.defineProperty(navigator, 'vendor', { configurable: true, value: 'Google Inc.' });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
  Object.defineProperty(window.screen, 'width', { configurable: true, value: 412 });
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: layoutWidth,
  });
  window.history.replaceState(null, '', `/${search}`);
}

async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<PwaRuntime enabled={false} />));
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
  Reflect.deleteProperty(navigator, 'vendor');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
  Reflect.deleteProperty(window.screen, 'width');
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the browser tip in the installed-app runtime', () => {
  it('shows nothing on an ordinary phone page', async () => {
    phone();
    const { host, unmount } = await mount();
    expect(host.querySelector('aside')).toBeNull();
    await unmount();
  });

  it('shows one line on a desktop-wide page and enlarges it to read at phone size', async () => {
    phone({ layoutWidth: 980 });
    const { host, unmount } = await mount();
    const tip = host.querySelector<HTMLElement>('aside[aria-label="Browser Tip"]');
    expect(tip?.textContent).toContain(BROWSER_HINT_TEXT);
    expect(Number(tip?.style.getPropertyValue('--hint-scale'))).toBeGreaterThan(2);
    await unmount();
  });

  it('shows for a home-screen launch that landed in a browser tab', async () => {
    phone({ search: '?source=pwa' });
    const { host, unmount } = await mount();
    expect(host.querySelector('aside[aria-label="Browser Tip"]')).not.toBeNull();
    await unmount();
  });

  it('stays away inside the installed app window', async () => {
    phone({ search: '?source=pwa', displayMode: 'standalone' });
    const { host, unmount } = await mount();
    expect(host.querySelector('aside')).toBeNull();
    await unmount();
  });

  it('is dismissed for the visit and does not come back on the next page load', async () => {
    phone({ layoutWidth: 980 });
    const first = await mount();
    const dismiss = [...first.host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Dismiss',
    );
    await act(async () => dismiss?.click());
    expect(first.host.querySelector('aside')).toBeNull();
    await first.unmount();
    const second = await mount();
    expect(second.host.querySelector('aside')).toBeNull();
    await second.unmount();
  });

  it('still works when the browser blocks storage', async () => {
    phone({ layoutWidth: 980 });
    const blocked = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      const { host, unmount } = await mount();
      expect(host.querySelector('aside[aria-label="Browser Tip"]')).not.toBeNull();
      const dismiss = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Dismiss',
      );
      await act(async () => dismiss?.click());
      expect(host.querySelector('aside')).toBeNull();
      await unmount();
    } finally {
      if (blocked) Object.defineProperty(window, 'sessionStorage', blocked);
    }
  });
});
