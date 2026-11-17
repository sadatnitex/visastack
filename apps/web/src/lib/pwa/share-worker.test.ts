import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_PREFIX, buildRetirementScript, buildServiceWorkerScript } from './service-worker';
import {
  INCOMING_PATH,
  SHARE_INBOX_CACHE,
  SHARE_MAX_AGE_MS,
  SHARE_MAX_FILES,
  SHARE_MAX_FILE_BYTES,
} from './share-target';

/*
 * WP-PIC11: the exact `/sw.js` script, run in a sandbox, receiving files shared from another app.
 * A shared file stays on the device (never sent to the network), only the incoming page with the
 * right account key can read it, and it is gone after hand-off, cancel, another account, or 15
 * minutes. Every file here is made up.
 */

const ORIGIN = 'https://vs.obsidianglobal.studio';

interface FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly headers: Headers;
  formData?: () => Promise<FormData>;
}

class StringCache {
  readonly entries = new Map<string, Response>();
  async match(key: string | { url: string }) {
    return this.entries.get(typeof key === 'string' ? key : key.url)?.clone();
  }
  async put(key: string | { url: string }, response: Response) {
    this.entries.set(typeof key === 'string' ? key : key.url, response);
  }
  async add() {}
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(key: { url: string }) {
    return this.entries.delete(key.url);
  }
}

function photo(name: string, size = 2048, type = 'image/jpeg'): File {
  return new File([new Uint8Array(size)], name, { type });
}

function load(script: string) {
  const listeners = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, StringCache>();
  const network = vi.fn(async (_req: unknown) => new Response('network body'));
  const clock = { now: Date.UTC(2026, 10, 17, 9, 0, 0) };
  const clients = new Map<string, { url: string }>();
  const caches = {
    open: async (name: string) => {
      let cache = stores.get(name);
      if (!cache) {
        cache = new StringCache();
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
    clients: {
      claim: vi.fn(async () => undefined),
      get: async (id: string) => clients.get(id),
    },
    registration: {
      navigationPreload: { enable: vi.fn(async () => undefined) },
      unregister: vi.fn(async () => true),
    },
  };
  const FakeDate = { now: () => clock.now };
  runInNewContext(script, {
    self,
    caches,
    fetch: network,
    Response,
    URL,
    Headers,
    Promise,
    Date: FakeDate,
  });

  async function dispatchFetch(req: FakeRequest, clientId = '') {
    let responded: Promise<Response> | undefined;
    const background: Promise<unknown>[] = [];
    listeners.get('fetch')?.({
      request: req,
      clientId,
      preloadResponse: Promise.resolve(undefined),
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

  return { stores, network, clock, clients, self, dispatchFetch, dispatchLifecycle };
}

function share(files: File[], origin: string | null = null): FakeRequest {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  return {
    url: `${ORIGIN}/share-target`,
    method: 'POST',
    mode: 'navigate',
    headers,
    formData: vi.fn(async () => form),
  };
}

function get(path: string, mode = 'cors'): FakeRequest {
  return { url: `${ORIGIN}${path}`, method: 'GET', mode, headers: new Headers() };
}

const KEY = 'owner-key-a';
const OTHER = 'owner-key-b';
const PAGE = 'client-incoming';
const ELSEWHERE = 'client-elsewhere';

let sw: ReturnType<typeof load>;
beforeEach(() => {
  sw = load(buildServiceWorkerScript('build-1'));
  sw.clients.set(PAGE, { url: `${ORIGIN}${INCOMING_PATH}` });
  sw.clients.set(ELSEWHERE, { url: `${ORIGIN}/app/applicant/a1` });
});

async function list(key = KEY, clientId = PAGE) {
  const response = await sw.dispatchFetch(get(`/share-target/list?k=${key}`), clientId);
  return { status: response?.status, body: await response?.json().catch(() => null) };
}

describe('receiving a share', () => {
  it('keeps the files on the device and sends the person to the incoming page', async () => {
    const response = await sw.dispatchFetch(
      share([photo('passport.jpg'), photo('bank.png', 900, 'image/png')]),
    );
    expect(response?.status).toBe(303);
    expect(response?.headers.get('location')).toBe(`${ORIGIN}${INCOMING_PATH}`);
    expect(sw.network).not.toHaveBeenCalled();
    expect([...sw.stores.keys()]).toEqual([SHARE_INBOX_CACHE]);
    const { body } = await list();
    expect(body.files).toEqual([
      { n: 0, name: 'passport.jpg', type: 'image/jpeg', size: 2048 },
      { n: 1, name: 'bank.png', type: 'image/png', size: 900 },
    ]);
    expect(body.dropped).toBe(0);
  });

  it('accepts a post from a VisaStack page itself', async () => {
    const response = await sw.dispatchFetch(share([photo('a.jpg')], ORIGIN));
    expect(response?.headers.get('location')).toBe(`${ORIGIN}${INCOMING_PATH}`);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
  });

  it.each([
    ['another site', 'https://evil.example'],
    ['a page hiding where it came from', 'null'],
  ])('turns away a post from %s and keeps nothing', async (_label, origin) => {
    const request = share([photo('planted.jpg')], origin);
    const response = await sw.dispatchFetch(request);
    expect(response?.status).toBe(303);
    expect(response?.headers.get('location')).toBe(`${ORIGIN}${INCOMING_PATH}?missed=1`);
    expect(request.formData).not.toHaveBeenCalled();
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
    expect(sw.network).not.toHaveBeenCalled();
  });

  it('keeps only photos and PDFs within the limits, and counts the rest', async () => {
    const many = Array.from({ length: SHARE_MAX_FILES + 2 }, (_, i) => photo(`p${i}.jpg`));
    await sw.dispatchFetch(
      share([
        photo('page.svg', 100, 'image/svg+xml'),
        photo('huge.jpg', SHARE_MAX_FILE_BYTES + 1),
        photo('empty.jpg', 0),
        photo('doc.pdf', 500, 'application/pdf'),
        ...many,
      ]),
    );
    const { body } = await list();
    expect(body.files).toHaveLength(SHARE_MAX_FILES);
    expect(body.files[0]).toMatchObject({ name: 'doc.pdf', type: 'application/pdf' });
    expect(body.dropped).toBe(3 + 3);
  });

  it('keeps nothing and says so when nothing usable was shared', async () => {
    const response = await sw.dispatchFetch(share([photo('page.svg', 100, 'image/svg+xml')]));
    expect(response?.headers.get('location')).toBe(`${ORIGIN}${INCOMING_PATH}?missed=1`);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('replaces whatever an earlier share left waiting', async () => {
    await sw.dispatchFetch(share([photo('old.jpg')]));
    await sw.dispatchFetch(share([photo('new.jpg')]));
    const { body } = await list();
    expect(body.files.map((f: { name: string }) => f.name)).toEqual(['new.jpg']);
  });

  it('never stores a page or touches the static cache', async () => {
    await sw.dispatchFetch(share([photo('a.jpg')]));
    expect([...sw.stores.keys()].some((name) => name.startsWith(CACHE_PREFIX))).toBe(false);
  });
});

describe('reading the inbox', () => {
  beforeEach(async () => {
    await sw.dispatchFetch(share([photo('passport.jpg')]));
  });

  it('answers only the incoming page, and only with a key', async () => {
    expect((await list(KEY, ELSEWHERE)).status).toBe(404);
    expect((await list(KEY, '')).status).toBe(404);
    expect((await list('', PAGE)).status).toBe(404);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
  });

  it('serves the picture to its owner only, from the device', async () => {
    await list(KEY);
    const mine = await sw.dispatchFetch(get(`/share-target/file/0?k=${KEY}`, 'no-cors'), PAGE);
    expect(mine?.status).toBe(200);
    expect(mine?.headers.get('content-type')).toBe('image/jpeg');
    expect(mine?.headers.get('cache-control')).toBe('no-store');
    expect(mine?.headers.get('x-content-type-options')).toBe('nosniff');
    const theirs = await sw.dispatchFetch(get(`/share-target/file/0?k=${OTHER}`, 'no-cors'), PAGE);
    expect(theirs?.status).toBe(404);
    const elsewhere = await sw.dispatchFetch(
      get(`/share-target/file/0?k=${KEY}`, 'no-cors'),
      ELSEWHERE,
    );
    expect(elsewhere?.status).toBe(404);
    expect(sw.network).not.toHaveBeenCalled();
  });

  it('does not serve a file before the page has opened the inbox for an account', async () => {
    const early = await sw.dispatchFetch(get(`/share-target/file/0?k=${KEY}`, 'no-cors'), PAGE);
    expect(early?.status).toBe(404);
  });

  it('never answers a file address opened as a page: that goes to the network', async () => {
    await list(KEY);
    await sw.dispatchFetch(get(`/share-target/file/0?k=${KEY}`, 'navigate'), PAGE);
    expect(sw.network).toHaveBeenCalledTimes(1);
  });

  it('empties the inbox when a different account opens it', async () => {
    expect((await list(KEY)).body.files).toHaveLength(1);
    expect((await list(OTHER)).body.files).toEqual([]);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
    expect((await list(KEY)).body.files).toEqual([]);
  });

  it('empties the inbox when the page asks (after hand-off or Cancel)', async () => {
    const response = await sw.dispatchFetch({
      url: `${ORIGIN}/share-target/clear`,
      method: 'POST',
      mode: 'cors',
      headers: new Headers(),
    });
    expect(response?.status).toBe(200);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('forgets the files once their time is up', async () => {
    sw.clock.now += SHARE_MAX_AGE_MS + 1;
    expect((await list(KEY)).body.files).toEqual([]);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('forgets expired files when the worker starts again', async () => {
    sw.clock.now += SHARE_MAX_AGE_MS + 1;
    await sw.dispatchLifecycle('activate');
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('keeps files still within their time when the worker starts again', async () => {
    await sw.dispatchLifecycle('activate');
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
  });
});

describe('switching the worker off', () => {
  it('the retirement worker removes waiting shared files too', async () => {
    const retired = load(buildRetirementScript());
    retired.stores.set(SHARE_INBOX_CACHE, new StringCache());
    retired.stores.set('someone-elses-cache', new StringCache());
    await retired.dispatchLifecycle('activate');
    expect([...retired.stores.keys()]).toEqual(['someone-elses-cache']);
  });
});
