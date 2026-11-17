import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_PREFIX,
  buildRetirementScript,
  buildServiceWorkerScript,
  isShareTargetOn,
} from './service-worker';
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
  readonly referrer?: string;
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
    Uint8Array,
    Array,
    crypto: globalThis.crypto,
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

  async function dispatchMessage(data: unknown, source: { url: string } | null) {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get('message')?.({
      data,
      source,
      waitUntil: (value: Promise<unknown>) => {
        pending = value;
      },
    });
    await pending;
  }

  return {
    stores,
    network,
    clock,
    clients,
    self,
    dispatchFetch,
    dispatchLifecycle,
    dispatchMessage,
  };
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

function clear(mode: string, token = ''): FakeRequest {
  const headers = new Headers();
  if (token) headers.set('x-visastack-share-token', token);
  return { url: `${ORIGIN}/share-target/clear`, method: 'POST', mode, headers };
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
  sw = load(buildServiceWorkerScript('build-1', { share: true }));
  sw.clients.set(PAGE, { url: `${ORIGIN}${INCOMING_PATH}` });
  sw.clients.set(ELSEWHERE, { url: `${ORIGIN}/app/applicant/a1` });
});

async function list(key = KEY, clientId = PAGE) {
  const request = get('/share-target/list');
  if (key) request.headers.set('x-visastack-share-key', key);
  const response = await sw.dispatchFetch(request, clientId);
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

  it('turns away a post whose referrer is another site, even with no Origin', async () => {
    const request = { ...share([photo('planted.jpg')]), referrer: 'https://evil.example/page' };
    const response = await sw.dispatchFetch(request);
    expect(response?.headers.get('location')).toBe(`${ORIGIN}${INCOMING_PATH}?missed=1`);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('accepts a referrer from VisaStack itself', async () => {
    const request = { ...share([photo('a.jpg')]), referrer: `${ORIGIN}/app` };
    await sw.dispatchFetch(request);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
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

  it('keeps nothing and says which files it takes when nothing usable was shared', async () => {
    const response = await sw.dispatchFetch(share([photo('page.svg', 100, 'image/svg+xml')]));
    expect(response?.headers.get('location')).toBe(`${ORIGIN}${INCOMING_PATH}?none=1`);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('replaces a share an account already opened', async () => {
    await sw.dispatchFetch(share([photo('old.jpg')]));
    await list();
    await sw.dispatchFetch(share([photo('new.jpg')]));
    const { body } = await list();
    expect(body.files.map((f: { name: string }) => f.name)).toEqual(['new.jpg']);
  });

  it('a share with no Origin never pushes aside one still waiting to be opened', async () => {
    await sw.dispatchFetch(share([photo('mine.jpg')]));
    const planted = share([photo('planted.jpg')]);
    const response = await sw.dispatchFetch(planted);
    expect(response?.headers.get('location')).toBe(`${ORIGIN}${INCOMING_PATH}?missed=1`);
    expect(planted.formData).not.toHaveBeenCalled();
    const { body } = await list();
    expect(body.files.map((f: { name: string }) => f.name)).toEqual(['mine.jpg']);
  });

  it('a share from a VisaStack page may replace one still waiting', async () => {
    await sw.dispatchFetch(share([photo('old.jpg')]));
    await sw.dispatchFetch(share([photo('new.jpg')], ORIGIN));
    const { body } = await list();
    expect(body.files.map((f: { name: string }) => f.name)).toEqual(['new.jpg']);
  });

  it('a share with no Origin replaces a waiting one once its time is up', async () => {
    await sw.dispatchFetch(share([photo('old.jpg')]));
    sw.clock.now += SHARE_MAX_AGE_MS + 1;
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

  it('serves the picture by this share token only, from the device', async () => {
    const { token } = (await list(KEY)).body;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const mine = await sw.dispatchFetch(get(`/share-target/file/0?t=${token}`, 'no-cors'), PAGE);
    expect(mine?.status).toBe(200);
    expect(mine?.headers.get('content-type')).toBe('image/jpeg');
    expect(mine?.headers.get('cache-control')).toBe('no-store');
    expect(mine?.headers.get('x-content-type-options')).toBe('nosniff');
    const guessed = await sw.dispatchFetch(
      get(`/share-target/file/0?t=${'0'.repeat(32)}`, 'no-cors'),
      PAGE,
    );
    expect(guessed?.status).toBe(404);
    // The account key is not a picture address, even for its owner.
    const byKey = await sw.dispatchFetch(get(`/share-target/file/0?t=${KEY}`, 'no-cors'), PAGE);
    expect(byKey?.status).toBe(404);
    const elsewhere = await sw.dispatchFetch(
      get(`/share-target/file/0?t=${token}`, 'no-cors'),
      ELSEWHERE,
    );
    expect(elsewhere?.status).toBe(404);
    expect(sw.network).not.toHaveBeenCalled();
  });

  it('does not serve a file before the page has opened the inbox for an account', async () => {
    const early = await sw.dispatchFetch(get('/share-target/file/0?t=', 'no-cors'), PAGE);
    expect(early?.status).toBe(404);
  });

  it('never answers a file address opened as a page: that goes to the network', async () => {
    const { token } = (await list(KEY)).body;
    await sw.dispatchFetch(get(`/share-target/file/0?t=${token}`, 'navigate'), PAGE);
    expect(sw.network).toHaveBeenCalledTimes(1);
  });

  it("a different account's key empties the inbox and reads nothing", async () => {
    const first = (await list(KEY)).body;
    expect(first.files).toHaveLength(1);
    const other = (await list(OTHER)).body;
    expect(other.files).toEqual([]);
    expect(other.token).toBe('');
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
    expect((await list(KEY)).body.files).toEqual([]);
    const late = await sw.dispatchFetch(
      get(`/share-target/file/0?t=${first.token}`, 'no-cors'),
      PAGE,
    );
    expect(late?.status).toBe(404);
  });

  it('never needs the account key in an address', async () => {
    const leaky = get(`/share-target/list?k=${KEY}`);
    expect((await sw.dispatchFetch(leaky, PAGE))?.status).toBe(404);
  });

  it('empties the inbox when the page asks for its own share (after hand-off or Cancel)', async () => {
    const { body } = await list();
    const response = await sw.dispatchFetch(clear('cors', body.token), PAGE);
    expect(response?.status).toBe(200);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('a page left open from an earlier share never empties a newer one', async () => {
    const first = (await list()).body.token;
    await sw.dispatchFetch(share([photo('newer.jpg')], ORIGIN));
    const second = (await list()).body;
    expect(second.token).not.toBe(first);
    expect((await sw.dispatchFetch(clear('cors', first), PAGE))?.status).toBe(409);
    expect((await sw.dispatchFetch(clear('cors'), PAGE))?.status).toBe(409);
    expect((await list()).body.files.map((f: { name: string }) => f.name)).toEqual(['newer.jpg']);
  });

  it('lets no other page, and no form from anywhere, empty the inbox', async () => {
    const { token } = (await list()).body;
    expect((await sw.dispatchFetch(clear('cors', token), ELSEWHERE))?.status).toBe(404);
    expect((await sw.dispatchFetch(clear('cors', token), ''))?.status).toBe(404);
    // A form posted as a page is not answered by the worker at all: the browser sends it to the
    // server, which has no such route.
    expect(await sw.dispatchFetch(clear('navigate', token), PAGE)).toBeUndefined();
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
  });

  it('two tabs opening the inbox at once share one token, so pictures work in both', async () => {
    const [a, b] = await Promise.all([list(), list()]);
    expect(a.body.token).toMatch(/^[0-9a-f]{32}$/);
    expect(b.body.token).toBe(a.body.token);
    const picture = await sw.dispatchFetch(get(`/share-target/file/0?t=${a.body.token}`), PAGE);
    expect(picture?.status).toBe(200);
  });

  it('signing out on a VisaStack page empties the inbox, whatever share it holds', async () => {
    await sw.dispatchMessage({ type: 'CLEAR_SHARE_INBOX' }, { url: `${ORIGIN}/app` });
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it.each([
    ['another site', { url: 'https://evil.example/' }],
    ['no page at all', null],
  ])('ignores a sign-out clear from %s', async (_label, source) => {
    await sw.dispatchMessage({ type: 'CLEAR_SHARE_INBOX' }, source);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
  });

  it('forgets the files once their time is up', async () => {
    sw.clock.now += SHARE_MAX_AGE_MS + 1;
    expect((await list(KEY)).body.files).toEqual([]);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it.each([
    ['opening any VisaStack page', () => get('/app', 'navigate')],
    ['loading a picture or script', () => get('/_next/static/chunks/app.js', 'no-cors')],
    ['a request from another page', () => get('/api/health/ready')],
  ])(
    'forgets expired files on %s, with no list call (after sign-out too)',
    async (_label, make) => {
      sw.clock.now += SHARE_MAX_AGE_MS + 1;
      await sw.dispatchFetch(make(), ELSEWHERE);
      expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
    },
  );

  it('keeps files still within their time on other requests', async () => {
    sw.clock.now += SHARE_MAX_AGE_MS - 1;
    await sw.dispatchFetch(get('/app', 'navigate'), ELSEWHERE);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
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

describe('a share being written', () => {
  it('a list or any other request arriving mid-write never removes it', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = share([photo('slow.jpg')]);
    const form = await (request.formData as () => Promise<FormData>)();
    request.formData = vi.fn(async () => {
      await gate;
      return form;
    });
    const posting = sw.dispatchFetch(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await sw.dispatchFetch(get('/app', 'navigate'), ELSEWHERE);
    const listing = list();
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    expect((await posting)?.headers.get('location')).toBe(`${ORIGIN}${INCOMING_PATH}`);
    const { body } = await listing;
    expect(body.files.map((f: { name: string }) => f.name)).toEqual(['slow.jpg']);
  });
});

describe('what a cut-off write leaves behind', () => {
  const META = `${ORIGIN}/share-target/meta`;
  const FILE = `${ORIGIN}/share-target/file/0`;

  function leftOver(meta: object | null, fileAt: number) {
    const cache = new StringCache();
    if (meta) cache.entries.set(META, Response.json(meta));
    cache.entries.set(
      FILE,
      new Response('x', { headers: { 'X-VisaStack-Shared-At': String(fileAt) } }),
    );
    sw.stores.set(SHARE_INBOX_CACHE, cache);
  }

  async function anyRequest() {
    await sw.dispatchFetch(get('/app', 'navigate'), ELSEWHERE);
  }

  it('removes a write that stopped after its mark, once a minute has passed', async () => {
    leftOver({ at: sw.clock.now, writing: true }, sw.clock.now);
    await anyRequest();
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
    sw.clock.now += 61 * 1000;
    await anyRequest();
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('removes files with no record once they are older than 15 minutes', async () => {
    leftOver(null, sw.clock.now);
    await anyRequest();
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
    sw.clock.now += SHARE_MAX_AGE_MS + 1;
    await anyRequest();
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('a share still being written cannot be read yet', async () => {
    leftOver({ at: sw.clock.now, writing: true }, sw.clock.now);
    expect((await list()).body.files).toEqual([]);
    expect(sw.stores.has(SHARE_INBOX_CACHE)).toBe(true);
  });
});

describe('while sharing is switched off', () => {
  it('a share post is left to the server and nothing is kept', async () => {
    const off = load(buildServiceWorkerScript('build-1', { share: false }));
    // Not answered by the worker: the browser sends it to the server fallback, which keeps nothing.
    expect(await off.dispatchFetch(share([photo('a.jpg')]))).toBeUndefined();
    expect(off.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('files left from before the switch went off are removed when the worker starts', async () => {
    const off = load(buildServiceWorkerScript('build-1', { share: false }));
    off.stores.set(SHARE_INBOX_CACHE, new StringCache());
    await off.dispatchLifecycle('activate');
    expect(off.stores.has(SHARE_INBOX_CACHE)).toBe(false);
  });

  it('the worker script changes with the switch, so devices pick the change up', () => {
    expect(buildServiceWorkerScript('build-1', { share: true })).not.toBe(
      buildServiceWorkerScript('build-1', { share: false }),
    );
  });

  it('is on only with the owner switch and the service worker both on', () => {
    const env = (values: Record<string, string>) => (name: string) => values[name];
    expect(isShareTargetOn(env({ NODE_ENV: 'production', WEB_SHARE_TARGET: 'on' }))).toBe(true);
    expect(isShareTargetOn(env({ NODE_ENV: 'production' }))).toBe(false);
    expect(
      isShareTargetOn(
        env({ NODE_ENV: 'production', WEB_SHARE_TARGET: 'on', PWA_SERVICE_WORKER: 'off' }),
      ),
    ).toBe(false);
    expect(isShareTargetOn(env({ NODE_ENV: 'test', WEB_SHARE_TARGET: 'on' }))).toBe(false);
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
