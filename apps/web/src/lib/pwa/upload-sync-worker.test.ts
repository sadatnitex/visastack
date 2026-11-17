import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildServiceWorkerScript, isBackgroundUploadSyncEnabled } from './service-worker';
import { UPLOAD_RESUME_MESSAGE, UPLOAD_SYNC_TAG } from './upload-sync';

/*
 * WP-PIC17: the exact `/sw.js` script, run in a sandbox, receiving a background sync. The worker
 * only tells this site's open pages to carry on: it stores nothing, fetches nothing, and with the
 * switch off it has no sync listener at all.
 */

const ORIGIN = 'https://vs.obsidianglobal.studio';

interface Page {
  readonly url: string;
  readonly postMessage: ReturnType<typeof vi.fn>;
}

function load(script: string, pages: Page[]) {
  const listeners = new Map<string, (event: unknown) => void>();
  const opened: string[] = [];
  const caches = {
    open: vi.fn(async (name: string) => {
      opened.push(name);
      return { put: vi.fn(), match: vi.fn(), add: vi.fn(), keys: async () => [] };
    }),
    keys: async () => [],
    delete: vi.fn(async () => true),
  };
  const network = vi.fn(async () => new Response(''));
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => pages),
    },
    registration: { unregister: vi.fn(async () => true) },
  };
  runInNewContext(script, { self, caches, fetch: network, Response, URL, Headers, Promise });

  async function dispatchSync(tag: string) {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get('sync')?.({
      tag,
      waitUntil: (value: Promise<unknown>) => {
        pending = value;
      },
    });
    await pending;
  }
  return { listeners, dispatchSync, caches, opened, network, self };
}

const page = (url: string): Page => ({ url, postMessage: vi.fn() });

describe('the worker with the switch off', () => {
  it('has no sync listener and does not mention the sync at all', () => {
    const script = buildServiceWorkerScript('v1', { share: false, uploadSync: false });
    expect(script).not.toContain(UPLOAD_SYNC_TAG);
    expect(script).not.toContain(UPLOAD_RESUME_MESSAGE);
    expect(load(script, []).listeners.has('sync')).toBe(false);
  });

  it('is the default unless the switch and the worker are both on', () => {
    expect(isBackgroundUploadSyncEnabled(() => undefined)).toBe(false);
    const prodOn = (name: string) =>
      ({ NODE_ENV: 'production', BACKGROUND_UPLOAD_SYNC: 'on' })[name];
    expect(isBackgroundUploadSyncEnabled(prodOn)).toBe(true);
    expect(
      isBackgroundUploadSyncEnabled((name) =>
        name === 'BACKGROUND_UPLOAD_SYNC' ? 'on' : undefined,
      ),
    ).toBe(false);
    expect(
      isBackgroundUploadSyncEnabled(
        (name) =>
          ({ NODE_ENV: 'production', BACKGROUND_UPLOAD_SYNC: 'on', PWA_SERVICE_WORKER: 'off' })[
            name
          ],
      ),
    ).toBe(false);
  });
});

describe('the worker with the switch on', () => {
  it('wakes only this site s open pages, and stores or fetches nothing', async () => {
    const mine = page(`${ORIGIN}/app/applicant/a1/documents/add`);
    const other = page('https://evil.example/x');
    const sw = load(buildServiceWorkerScript('v1', { share: false, uploadSync: true }), [
      mine,
      other,
    ]);
    await sw.dispatchSync(UPLOAD_SYNC_TAG);
    expect(sw.self.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    expect(mine.postMessage).toHaveBeenCalledWith({ type: UPLOAD_RESUME_MESSAGE });
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(sw.opened).toEqual([]);
    expect(sw.network).not.toHaveBeenCalled();
  });

  it('ignores any other sync tag', async () => {
    const mine = page(`${ORIGIN}/app/incoming`);
    const sw = load(buildServiceWorkerScript('v1', { share: false, uploadSync: true }), [mine]);
    await sw.dispatchSync('something-else');
    expect(mine.postMessage).not.toHaveBeenCalled();
  });

  it('with no page open, resolves and does nothing', async () => {
    const sw = load(buildServiceWorkerScript('v1', { share: false, uploadSync: true }), []);
    await expect(sw.dispatchSync(UPLOAD_SYNC_TAG)).resolves.toBeUndefined();
    expect(sw.network).not.toHaveBeenCalled();
  });
});
