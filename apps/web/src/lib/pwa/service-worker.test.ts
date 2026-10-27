import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_PREFIX,
  MAX_STATIC_ENTRIES,
  OFFLINE_CSP,
  OFFLINE_HTML,
  OFFLINE_SCRIPT,
  OFFLINE_STYLE,
  buildRetirementScript,
  buildServiceWorkerScript,
  isServiceWorkerEnabled,
  normaliseVersion,
} from './service-worker';

/*
 * These tests run the exact script `/sw.js` serves, inside a sandbox with a fake browser around
 * it, and check the cache law: only public static files may ever be written to the device.
 */

const ORIGIN = 'https://vs.obsidianglobal.studio';

interface FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly headers: Headers;
}

function request(
  path: string,
  init: { method?: string; mode?: string; headers?: Record<string, string> } = {},
): FakeRequest {
  return {
    url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'no-cors',
    headers: new Headers(init.headers ?? {}),
  };
}

/** A same-origin network answer, as a browser reports it (Node's own Response says `default`). */
function basic(body: string, init: ResponseInit = {}, type = 'basic'): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, 'type', { value: type });
  return response;
}

class FakeCache {
  readonly entries = new Map<string, Response>();
  constructor(private readonly fetcher: (req: FakeRequest | string) => Promise<Response>) {}
  async match(req: FakeRequest) {
    return this.entries.get(req.url)?.clone();
  }
  async put(req: FakeRequest, response: Response) {
    this.entries.set(req.url, response);
  }
  async add(path: string) {
    const response = await this.fetcher(path);
    this.entries.set(`${ORIGIN}${path}`, response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(req: { url: string }) {
    return this.entries.delete(req.url);
  }
}

function load(script: string) {
  const listeners = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, FakeCache>();
  const network = vi.fn(async (_req: FakeRequest | string) => basic('network body'));
  const caches = {
    open: async (name: string) => {
      let cache = stores.get(name);
      if (!cache) {
        cache = new FakeCache(network);
        stores.set(name, cache);
      }
      return cache;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    registration: {
      navigationPreload: { enable: vi.fn(async () => undefined) },
      unregister: vi.fn(async () => true),
    },
  };
  runInNewContext(script, { self, caches, fetch: network, Response, URL, Headers, Promise });

  async function dispatchFetch(req: FakeRequest, preloadResponse?: Response) {
    let responded: Promise<Response> | undefined;
    const background: Promise<unknown>[] = [];
    listeners.get('fetch')?.({
      request: req,
      preloadResponse: Promise.resolve(preloadResponse),
      respondWith: (value: Promise<Response>) => {
        responded = value;
      },
      waitUntil: (value: Promise<unknown>) => background.push(value),
    });
    const response = responded === undefined ? undefined : await responded;
    await Promise.all(background);
    return response;
  }

  async function dispatchLifecycle(type: 'install' | 'activate') {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({
      waitUntil: (value: Promise<unknown>) => {
        pending = value;
      },
    });
    await pending;
  }

  const storedUrls = () => [...stores.values()].flatMap((cache) => [...cache.entries.keys()]);
  return { listeners, stores, network, self, dispatchFetch, dispatchLifecycle, storedUrls };
}

let sw: ReturnType<typeof load>;
beforeEach(() => {
  sw = load(buildServiceWorkerScript('build-1'));
});

describe('private traffic is never stored on the device', () => {
  const PRIVATE_PAGES = [
    '/app',
    '/app/applicant/0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b/documents',
    '/app/applicant/0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b/profile',
    '/app/mission/0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b',
    '/app/agency/0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b/clients',
    '/app/shared/0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b',
    '/invitation?token=single-use-secret',
    '/app/sharing-invitations/accept?token=single-use-secret',
    // Opened as a page: answered once from the network (never twice, never stored).
    '/api/blob/documents%2Fkey?sig=abc&exp=1',
    '/api/auth/callback/google?code=single-use',
  ];

  it.each(PRIVATE_PAGES)('fetches the page %s from the network and keeps no copy', async (path) => {
    const response = await sw.dispatchFetch(request(path, { mode: 'navigate' }));
    expect(await response?.text()).toBe('network body');
    expect(sw.network).toHaveBeenCalledTimes(1);
    expect(sw.storedUrls()).toEqual([]);
  });

  it('uses the navigation preload answer when the browser already has it, still without storing it', async () => {
    const preloaded = new Response('preloaded page');
    const response = await sw.dispatchFetch(request('/app', { mode: 'navigate' }), preloaded);
    expect(await response?.text()).toBe('preloaded page');
    expect(sw.network).not.toHaveBeenCalled();
    expect(sw.storedUrls()).toEqual([]);
  });

  const NOT_INTERCEPTED: ReadonlyArray<readonly [string, FakeRequest]> = [
    ['private API data', request('/api/workspace/search?q=passport', { mode: 'cors' })],
    [
      'a signed document link',
      request('/api/blob/documents%2Fkey?sig=abc&exp=1', { mode: 'cors' }),
    ],
    ['a profile photo', request('/api/photos/applicant/0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b')],
    ['page data for client navigation', request('/app/profile?_rsc=1x2y', { mode: 'cors' })],
    [
      'page data marked by header',
      request('/app/profile', { mode: 'cors', headers: { RSC: '1' } }),
    ],
    ['an optimised image of any source', request('/_next/image?url=%2Fapi%2Fblob%2Fk&w=640')],
    ['an account export download', request('/app/privacy/export', { mode: 'cors' })],
    ['a calendar download', request('/app/applicant/x/calendar/download', { mode: 'cors' })],
    ['a form or server action post', request('/app/profile', { method: 'POST', mode: 'cors' })],
    ['another site', request('https://auth.example.com/neondb/auth/session', { mode: 'cors' })],
    [
      'a partial (range) request',
      request('/_next/static/media/a.woff2', { headers: { Range: 'bytes=0-9' } }),
    ],
  ];

  it.each(NOT_INTERCEPTED)('leaves %s to the browser untouched', async (_label, req) => {
    expect(await sw.dispatchFetch(req)).toBeUndefined();
    expect(sw.network).not.toHaveBeenCalled();
    expect(sw.storedUrls()).toEqual([]);
  });
});

describe('public static files', () => {
  it('stores a hashed build file once and serves it from the device after that', async () => {
    sw.network.mockImplementation(async () => basic('chunk', { status: 200 }));
    const chunk = request('/_next/static/chunks/app-1a2b3c.js');
    expect(await (await sw.dispatchFetch(chunk))?.text()).toBe('chunk');
    expect(await (await sw.dispatchFetch(chunk))?.text()).toBe('chunk');
    expect(sw.network).toHaveBeenCalledTimes(1);
    expect(sw.storedUrls()).toEqual([`${ORIGIN}/_next/static/chunks/app-1a2b3c.js`]);
    expect([...sw.stores.keys()]).toEqual([`${CACHE_PREFIX}build-1`]);
  });

  it.each(['/icons/icon-512.png', '/favicon.ico', '/icon.svg?7d1f', '/apple-icon.png?3c2b'])(
    'stores the brand file %s',
    async (path) => {
      await sw.dispatchFetch(request(path));
      expect(sw.storedUrls()).toHaveLength(1);
    },
  );

  it.each([
    ['no-store', { 'Cache-Control': 'no-store' }, 200],
    ['private', { 'Cache-Control': 'private, max-age=60' }, 200],
    ['an error', {}, 404],
  ] as const)('does not store a static answer marked %s', async (_label, headers, status) => {
    sw.network.mockImplementation(async () => basic('x', { status, headers }));
    await sw.dispatchFetch(request('/_next/static/chunks/x.js'));
    expect(sw.storedUrls()).toEqual([]);
  });

  it('does not store an opaque or redirected answer', async () => {
    sw.network.mockImplementation(async () => basic('x', {}, 'opaque'));
    await sw.dispatchFetch(request('/_next/static/chunks/y.js'));
    sw.network.mockImplementation(async () => basic('x', {}, 'opaqueredirect'));
    await sw.dispatchFetch(request('/_next/static/chunks/z.js'));
    expect(sw.storedUrls()).toEqual([]);
  });

  it('never trims away the brand mark the offline screen needs', async () => {
    await sw.dispatchLifecycle('install');
    for (let index = 0; index <= MAX_STATIC_ENTRIES; index += 1) {
      await sw.dispatchFetch(request(`/_next/static/chunks/${index}.js`));
    }
    const stored = sw.storedUrls();
    expect(stored).toHaveLength(MAX_STATIC_ENTRIES);
    expect(stored).toContain(`${ORIGIN}/icons/icon-192.png`);
  });

  it(`keeps at most ${MAX_STATIC_ENTRIES} files, removing the oldest`, async () => {
    for (let index = 0; index <= MAX_STATIC_ENTRIES; index += 1) {
      await sw.dispatchFetch(request(`/_next/static/chunks/${index}.js`));
    }
    const stored = sw.storedUrls();
    expect(stored).toHaveLength(MAX_STATIC_ENTRIES);
    expect(stored).not.toContain(`${ORIGIN}/_next/static/chunks/0.js`);
  });
});

describe('offline screen', () => {
  it('replaces a failed page load with an honest offline screen that is never stored', async () => {
    sw.network.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const response = await sw.dispatchFetch(request('/app/profile', { mode: 'navigate' }));
    expect(response?.status).toBe(503);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(response?.headers.get('content-security-policy')).toBe(OFFLINE_CSP);
    const html = (await response?.text()) ?? '';
    expect(html).toContain('You Are Offline');
    expect(html).toContain('not stored on this device');
    expect(html).toContain('may not have been sent');
    expect(html).not.toMatch(/\bsaved\b/i);
    expect(sw.storedUrls()).toEqual([]);
  });

  it('allows only its own inline style and script', () => {
    const hash = (text: string) =>
      `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
    // The page holds exactly one style block and one script block, each the exported constant.
    expect(OFFLINE_HTML.split('<style').length - 1).toBe(1);
    expect(OFFLINE_HTML.split('<script').length - 1).toBe(1);
    expect(OFFLINE_HTML).toContain(`<style>${OFFLINE_STYLE}</style>`);
    expect(OFFLINE_HTML).toContain(`<script>${OFFLINE_SCRIPT}</script>`);
    expect(OFFLINE_CSP).toContain(`style-src ${hash(OFFLINE_STYLE)}`);
    expect(OFFLINE_CSP).toContain(`script-src ${hash(OFFLINE_SCRIPT)}`);
    expect(OFFLINE_CSP).toContain("default-src 'none'");
    expect(OFFLINE_HTML).not.toMatch(/https?:\/\//);
  });
});

describe('lifecycle and updates', () => {
  it('stores only the brand mark on install', async () => {
    await sw.dispatchLifecycle('install');
    expect(sw.storedUrls()).toEqual([`${ORIGIN}/icons/icon-192.png`]);
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
  });

  it("removes earlier builds' caches on activation and leaves other caches alone", async () => {
    const caches = sw.stores;
    caches.set(`${CACHE_PREFIX}build-0`, new FakeCache(sw.network));
    caches.set('someone-elses-cache', new FakeCache(sw.network));
    caches.set(`${CACHE_PREFIX}build-1`, new FakeCache(sw.network));
    await sw.dispatchLifecycle('activate');
    expect([...caches.keys()].sort()).toEqual(['someone-elses-cache', `${CACHE_PREFIX}build-1`]);
    expect(sw.self.clients.claim).toHaveBeenCalled();
    expect(sw.self.registration.navigationPreload.enable).toHaveBeenCalled();
  });

  it('starts a waiting update only when the page asks for it', () => {
    sw.listeners.get('message')?.({ data: { type: 'something-else' } });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.listeners.get('message')?.({ data: { type: 'SKIP_WAITING' } });
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('ships a different worker for each build, so devices notice a deployment', () => {
    expect(buildServiceWorkerScript('build-1')).not.toBe(buildServiceWorkerScript('build-2'));
  });

  it('never lets an odd version string reach the script unescaped', () => {
    expect(normaliseVersion('abc123_-.')).toBe('abc123_-.');
    expect(normaliseVersion("x'; self.evil();'")).toBe('unknown');
    expect(normaliseVersion(undefined)).toBe('unknown');
    expect(buildServiceWorkerScript('"; boom(); "')).toContain('const VERSION = "unknown";');
  });
});

describe('switching the worker off', () => {
  it('is on in production unless PWA_SERVICE_WORKER says off, and never outside production', () => {
    const env =
      (values: Record<string, string>) =>
      (name: string): string | undefined =>
        values[name];
    expect(isServiceWorkerEnabled(env({ NODE_ENV: 'production' }))).toBe(true);
    expect(isServiceWorkerEnabled(env({ NODE_ENV: 'production', PWA_SERVICE_WORKER: 'on' }))).toBe(
      true,
    );
    expect(
      isServiceWorkerEnabled(env({ NODE_ENV: 'production', PWA_SERVICE_WORKER: ' OFF ' })),
    ).toBe(false);
    expect(isServiceWorkerEnabled(env({ NODE_ENV: 'development' }))).toBe(false);
    expect(isServiceWorkerEnabled(env({}))).toBe(false);
  });

  it('the retirement worker clears VisaStack caches, unregisters and intercepts nothing', async () => {
    const retired = load(buildRetirementScript());
    retired.stores.set(`${CACHE_PREFIX}build-1`, new FakeCache(retired.network));
    retired.stores.set('someone-elses-cache', new FakeCache(retired.network));
    await retired.dispatchLifecycle('activate');
    expect([...retired.stores.keys()]).toEqual(['someone-elses-cache']);
    expect(retired.self.registration.unregister).toHaveBeenCalled();
    expect(retired.listeners.has('fetch')).toBe(false);
  });
});

describe('build version wiring', () => {
  it('reads the version with the literal expression Next replaces at build time', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./build-version.ts', import.meta.url), 'utf8');
    expect(source).toContain('= process.env.VISASTACK_BUILD_VERSION ??');
    const config = readFileSync(new URL('../../../next.config.mjs', import.meta.url), 'utf8');
    expect(config).toContain('env: { VISASTACK_BUILD_VERSION: buildVersion }');
  });
});
