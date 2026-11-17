import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { PUSH_BODY, PUSH_TITLE, buildPushWorkerSection, isWebPushSwitchOn } from './push-worker';
import { buildServiceWorkerScript } from './service-worker';

const ORIGIN = 'https://vs.obsidianglobal.studio';

function load() {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: { body: string; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const focused: string[] = [];
  const windows: { url: string; focus: () => Promise<unknown> }[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    registration: {
      showNotification: vi.fn(async (title: string, options: never) => {
        shown.push({ title, options });
      }),
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  };
  runInNewContext(buildPushWorkerSection(), { self, URL });

  async function push(data: unknown) {
    let wait: Promise<unknown> = Promise.resolve();
    listeners.get('push')?.({
      data:
        data === undefined
          ? null
          : {
              json: () => {
                if (data instanceof Error) throw data;
                return data;
              },
            },
      waitUntil: (p: Promise<unknown>) => {
        wait = p;
      },
    });
    await wait;
  }

  async function click(url: unknown) {
    let wait: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    listeners.get('notificationclick')?.({
      notification: { close, data: { url } },
      waitUntil: (p: Promise<unknown>) => {
        wait = p;
      },
    });
    await wait;
    expect(close).toHaveBeenCalled();
  }

  function addWindow(url: string) {
    windows.push({
      url,
      focus: async () => {
        focused.push(url);
      },
    });
  }

  return { push, click, shown, opened, focused, addWindow };
}

describe('service worker wiring', () => {
  it('leaves the worker byte for byte as before while Web Push is off', () => {
    const off = buildServiceWorkerScript('v1', { share: false, uploadSync: false, push: false });
    const on = buildServiceWorkerScript('v1', { share: false, uploadSync: false, push: true });
    expect(off).not.toContain("addEventListener('push'");
    expect(off).not.toContain('notificationclick');
    expect(on.startsWith(off)).toBe(true);
    expect(on.slice(off.length)).toBe(buildPushWorkerSection());
  });

  it('reads the WEB_PUSH switch when not told', () => {
    vi.stubEnv('WEB_PUSH', undefined);
    expect(buildServiceWorkerScript('v1', { share: false, uploadSync: false })).not.toContain(
      'notificationclick',
    );
    vi.stubEnv('WEB_PUSH', 'true');
    expect(buildServiceWorkerScript('v1', { share: false, uploadSync: false })).toContain(
      'notificationclick',
    );
    vi.unstubAllEnvs();
  });
});

describe('push worker', () => {
  it('shows the same words and fallback page as the server sends', async () => {
    const server = await import('@visastack/services/web-push');
    const worker = await import('./push-worker');
    expect(worker.PUSH_TITLE).toBe(server.WEB_PUSH_TITLE);
    expect(worker.PUSH_BODY).toBe(server.WEB_PUSH_BODY);
    expect(worker.PUSH_FALLBACK_PATH).toBe(server.WEB_PUSH_FALLBACK_PATH);
    expect(worker.PUSH_TAG).toBe(server.WEB_PUSH_TOPIC);
  });

  it('is carried only while WEB_PUSH is true', () => {
    expect(isWebPushSwitchOn(() => undefined)).toBe(false);
    expect(isWebPushSwitchOn(() => 'on')).toBe(false);
    expect(isWebPushSwitchOn(() => 'true')).toBe(true);
  });

  it('always shows the fixed words, whatever the message says', async () => {
    const w = load();
    await w.push({
      title: 'Alice Example',
      body: 'Passport BX123 for Germany',
      url: '/app/cases/1',
    });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]?.title).toBe(PUSH_TITLE);
    expect(w.shown[0]?.options.body).toBe(PUSH_BODY);
    expect(JSON.stringify(w.shown[0])).not.toContain('Alice');
    expect(JSON.stringify(w.shown[0])).not.toContain('BX123');
    expect(w.shown[0]?.options.data.url).toBe(`${ORIGIN}/app/cases/1`);
  });

  it('still shows the alert for an empty or unreadable message', async () => {
    const w = load();
    await w.push(undefined);
    await w.push(new Error('not json'));
    expect(w.shown.map((s) => s.options.data.url)).toEqual([
      `${ORIGIN}/app/notifications`,
      `${ORIGIN}/app/notifications`,
    ]);
  });

  it('keeps only paths on this site', async () => {
    const w = load();
    for (const url of [
      'https://evil.example/x',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      42,
    ]) {
      await w.push({ url });
    }
    expect(new Set(w.shown.map((s) => s.options.data.url))).toEqual(
      new Set([`${ORIGIN}/app/notifications`]),
    );
  });

  it('a click opens only this site, focusing a window already on that page', async () => {
    const w = load();
    await w.click(`${ORIGIN}/app/cases/1`);
    await w.click('https://evil.example/phish');
    await w.click(undefined);
    expect(w.opened).toEqual([
      `${ORIGIN}/app/cases/1`,
      `${ORIGIN}/app/notifications`,
      `${ORIGIN}/app/notifications`,
    ]);
    w.addWindow(`${ORIGIN}/app/cases/2`);
    await w.click(`${ORIGIN}/app/cases/2`);
    expect(w.focused).toEqual([`${ORIGIN}/app/cases/2`]);
    expect(w.opened).toHaveLength(3);
  });
});
