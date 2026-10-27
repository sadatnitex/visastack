import { createHash } from 'node:crypto';

/**
 * The VisaStack service worker, generated per build by `app/sw.js/route.ts`.
 *
 * Cache law (owner instruction, Lane D section 8): the worker may keep only public, immutable
 * files on a device. Pages are fetched from the network every time and never stored, because a
 * signed-in page can show passport details, money evidence or case notes. Everything that is
 * not a public static file (API calls, page data, document previews, signed download links,
 * other origins, anything but GET) is not even intercepted: the browser handles it exactly as it
 * would without a worker.
 *
 * The offline screen is built into the worker itself, so showing it never needs a stored page.
 * The script is plain JavaScript in a string so the file served to browsers is exactly the text
 * the tests run (`service-worker.test.ts` executes it in a sandbox).
 */

/** Every cache this worker creates starts with this, so a newer worker can find and remove them. */
export const CACHE_PREFIX = 'visastack-static-';

/** Most entries the static cache holds before the oldest are removed. */
export const MAX_STATIC_ENTRIES = 200;

/**
 * Content-hashed build output (scripts, styles, fonts). A changed file gets a new name, so a
 * stored copy can never go stale.
 */
export const STATIC_PREFIXES = ['/_next/static/'] as const;

/** Public brand files in `public/icons/` and the app icons Next serves from `src/app/`. */
export const PUBLIC_STATIC_PREFIXES = ['/icons/'] as const;
export const PUBLIC_STATIC_PATHS = ['/favicon.ico', '/icon.svg', '/apple-icon.png'] as const;

/** Stored on install so the offline screen can show the brand mark. */
export const PRECACHE_PATHS = ['/icons/icon-192.png'] as const;

const VERSION_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

/** A version safe to embed in a cache name; anything unexpected becomes `unknown`. */
export function normaliseVersion(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  return VERSION_PATTERN.test(value) ? value : 'unknown';
}

function sha256(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

const OFFLINE_STYLE = [
  ':root{color-scheme:light}',
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;',
  'padding:24px 16px;background:#f7f9fe;color:#13243d;',
  'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
  'line-height:1.55}',
  'main{width:100%;max-width:28rem;background:#fff;border:1px solid #cad4e2;border-radius:16px;padding:28px 24px}',
  'img{display:block;width:48px;height:48px;border-radius:12px;margin-bottom:16px}',
  'h1{font-size:1.5rem;line-height:1.25;margin:0 0 12px}',
  'p{margin:0 0 12px;color:#516174}',
  'button{margin-top:8px;min-height:44px;padding:10px 20px;border:0;border-radius:980px;',
  'background:#1d4c98;color:#fff;font:inherit;font-weight:600;cursor:pointer}',
  'button:hover{background:#143b7a}',
  'button:focus-visible{outline:3px solid #13243d;outline-offset:3px}',
].join('');

const OFFLINE_SCRIPT = [
  "document.getElementById('retry').addEventListener('click',function(){location.reload();});",
  "window.addEventListener('online',function(){location.reload();});",
].join('');

/**
 * The offline screen. It says plainly what is and is not on the device, never claims that
 * anything was saved, and reloads by itself when the connection returns.
 */
export const OFFLINE_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="theme-color" content="#f7f9fe">',
  '<title>You Are Offline | VisaStack</title>',
  `<style>${OFFLINE_STYLE}</style></head><body>`,
  '<main aria-labelledby="offline-title">',
  '<img src="/icons/icon-192.png" alt="" width="48" height="48">',
  '<h1 id="offline-title">You Are Offline</h1>',
  '<p>VisaStack cannot be reached right now. Check your connection, then try again.</p>',
  '<p>Your VisaStack records are not stored on this device, so they stay protected if it is lost. ',
  'Reconnect to continue securely.</p>',
  '<p>Anything you were typing or uploading may not have been sent. Check it once you are back online.</p>',
  '<button type="button" id="retry">Try Again</button>',
  `</main><script>${OFFLINE_SCRIPT}</script></body></html>`,
].join('');

/** Only the inline style and script above may run on the offline screen; nothing else may load. */
export const OFFLINE_CSP = [
  "default-src 'none'",
  "img-src 'self'",
  `style-src ${sha256(OFFLINE_STYLE)}`,
  `script-src ${sha256(OFFLINE_SCRIPT)}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Builds the worker served while the service worker is switched on. */
export function buildServiceWorkerScript(version: string): string {
  const constants = {
    VERSION: normaliseVersion(version),
    CACHE_PREFIX,
    MAX_STATIC_ENTRIES,
    STATIC_PREFIXES,
    PUBLIC_STATIC_PREFIXES,
    PUBLIC_STATIC_PATHS,
    PRECACHE_PATHS,
    OFFLINE_HTML,
    OFFLINE_CSP,
  };
  const declarations = Object.entries(constants)
    .map(([name, value]) => `const ${name} = ${JSON.stringify(value)};`)
    .join('\n');

  return `/* VisaStack service worker. Public static files only; pages and private data are never stored. */
'use strict';
${declarations}
const STATIC_CACHE = CACHE_PREFIX + VERSION;

function isPublicStatic(url) {
  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return true;
  if (PUBLIC_STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return true;
  return PUBLIC_STATIC_PATHS.includes(url.pathname);
}

/*
 * 'static': a public, immutable file, served from the device cache when present.
 * 'navigate': a page, always fetched from the network; the offline screen only when that fails.
 * 'network': everything else, not intercepted at all.
 */
function classify(request) {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return 'network';
  if (request.headers.has('rsc') || url.searchParams.has('_rsc')) return 'network';
  if (request.mode === 'navigate') return url.pathname.startsWith('/api/') ? 'network' : 'navigate';
  if (request.headers.has('range')) return 'network';
  return isPublicStatic(url) ? 'static' : 'network';
}

function mayStore(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  return !cacheControl.includes('no-store') && !cacheControl.includes('private');
}

async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_STATIC_ENTRIES;
  for (let index = 0; index < excess; index += 1) await cache.delete(keys[index]);
}

async function fromStaticCache(request) {
  const cache = await caches.open(STATIC_CACHE);
  const stored = await cache.match(request);
  if (stored) return stored;
  const response = await fetch(request);
  if (mayStore(response)) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    statusText: 'Offline',
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': OFFLINE_CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function fromNetwork(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    return offlineResponse();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.all(PRECACHE_PATHS.map((path) => cache.add(path).catch(() => undefined))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

// A waiting update starts only when the person chooses Reload Now, never in the middle of their work.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const kind = classify(event.request);
  if (kind === 'static') event.respondWith(fromStaticCache(event.request));
  else if (kind === 'navigate') event.respondWith(fromNetwork(event));
});
`;
}

/**
 * Served instead while the service worker is switched off (`PWA_SERVICE_WORKER=off`). A device
 * that already has the worker picks this up on its next update check, removes VisaStack's caches
 * and unregisters itself, so switching off is a clean exit rather than a stranded worker.
 */
export function buildRetirementScript(): string {
  return `/* VisaStack service worker retirement: remove stored files and unregister. */
'use strict';
const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
      await self.registration.unregister();
    })(),
  );
});
`;
}

/** Whether this deployment serves the worker. On by default; `PWA_SERVICE_WORKER=off` retires it. */
export function isServiceWorkerEnabled(read: (name: string) => string | undefined): boolean {
  return read('PWA_SERVICE_WORKER')?.trim().toLowerCase() !== 'off';
}
