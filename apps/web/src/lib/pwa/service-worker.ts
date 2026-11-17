import { createHash } from 'node:crypto';
import {
  CACHE_PREFIX,
  PUBLIC_STATIC_PATHS,
  PUBLIC_STATIC_PREFIXES,
  STATIC_PREFIXES,
} from './constants';
import {
  INCOMING_PATH,
  SHARE_ACCEPT,
  SHARE_CLEAR_PATH,
  SHARE_FILES_FIELD,
  SHARE_FILE_PREFIX,
  SHARE_INBOX_CACHE,
  SHARE_KEY_HEADER,
  SHARE_LIST_PATH,
  SHARE_MAX_AGE_MS,
  SHARE_MAX_FILES,
  SHARE_MAX_FILE_BYTES,
  SHARE_TARGET_PATH,
  isShareTargetSwitchOn,
} from './share-target';

export { CACHE_PREFIX, PUBLIC_STATIC_PATHS, PUBLIC_STATIC_PREFIXES, STATIC_PREFIXES };

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
 * One exception, by owner decision (17 Nov 2026, picture-first Phase 2, unit P2d), and only while
 * the owner's share switch is on: files the person shares to VisaStack from another app. The phone
 * posts them to `/share-target`; the worker answers that one post itself and keeps the files in its
 * own inbox on this device, not in the static cache, for at most 15 minutes, so they are never sent
 * anywhere before the person signs in and confirms on `/app/incoming`. Still no page is stored.
 * See `share-target.ts`.
 *
 * The offline screen is built into the worker itself, so showing it never needs a stored page.
 * The script is plain JavaScript in a string so the file served to browsers is exactly the text
 * the tests run (`service-worker.test.ts` executes it in a sandbox).
 */

/** Most entries the static cache holds before the oldest are removed. */
export const MAX_STATIC_ENTRIES = 200;

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

/** The offline screen's only stylesheet; its hash is the only style the screen's policy allows. */
export const OFFLINE_STYLE = [
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

/** The offline screen's only script; its hash is the only script the screen's policy allows. */
export const OFFLINE_SCRIPT = [
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

/**
 * Builds the worker served while the service worker is switched on. `share` says whether it takes
 * files shared from another app (default: the owner's switch, read where `/sw.js` is served). The
 * script differs with it, so switching sharing off reaches devices as an ordinary worker update.
 */
export function buildServiceWorkerScript(
  version: string,
  options: { readonly share?: boolean } = {},
): string {
  const SHARE_ON = options.share ?? isShareTargetOn((name) => process.env[name]);
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
    SHARE_TARGET_PATH,
    SHARE_FILE_PREFIX,
    SHARE_LIST_PATH,
    SHARE_CLEAR_PATH,
    SHARE_FILES_FIELD,
    SHARE_INBOX_CACHE,
    SHARE_KEY_HEADER,
    SHARE_ACCEPT,
    SHARE_MAX_FILES,
    SHARE_MAX_FILE_BYTES,
    SHARE_MAX_AGE_MS,
    INCOMING_PATH,
    SHARE_ON,
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
  // Every same-origin page load is answered here (never stored), including /api/ links opened as a
  // page, so the navigation preload request the browser already sent is the one used. Leaving a
  // navigation to the browser would discard that preload and send the request a second time,
  // which a single-use link (sign-in callback, one-time download) must never see.
  if (request.mode === 'navigate') return 'navigate';
  if (request.headers.has('rsc') || url.searchParams.has('_rsc')) return 'network';
  if (request.headers.has('range')) return 'network';
  return isPublicStatic(url) ? 'static' : 'network';
}

function mayStore(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  return !cacheControl.includes('no-store') && !cacheControl.includes('private');
}

// Oldest first, never the files stored on install (the offline screen needs the brand mark).
async function trim(cache) {
  const all = await cache.keys();
  const removable = all.filter((key) => !PRECACHE_PATHS.includes(new URL(key.url).pathname));
  const excess = all.length - MAX_STATIC_ENTRIES;
  for (let index = 0; index < excess; index += 1) await cache.delete(removable[index]);
}

// The answer goes to the page straight away; storing it happens in the background.
async function fromStaticCache(event) {
  const cache = await caches.open(STATIC_CACHE);
  const stored = await cache.match(event.request);
  if (stored) return stored;
  const response = await fetch(event.request);
  if (mayStore(response)) {
    const copy = response.clone();
    event.waitUntil(cache.put(event.request, copy).then(() => trim(cache)));
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

/*
 * Files shared from another app (WP-PIC11). The phone posts them to SHARE_TARGET_PATH; this worker
 * answers that post itself, so the files stay on the device. They wait in SHARE_INBOX_CACHE (never
 * a page, never a VisaStack record) until the signed-in person adds them or cancels, at most
 * SHARE_MAX_AGE_MS. The inbox belongs to the first account that opens it on INCOMING_PATH: a
 * different account asking empties it, and a page with no account key can read nothing.
 */
const SHARE_META = self.location.origin + SHARE_TARGET_PATH + '/meta';

function shareKind(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  // While sharing is switched off the share post is left to the server, which keeps nothing.
  if (request.method === 'POST' && url.pathname === SHARE_TARGET_PATH) return SHARE_ON ? 'receive' : null;
  if (request.mode === 'navigate') return null;
  if (request.method === 'POST' && url.pathname === SHARE_CLEAR_PATH) return 'clear';
  if (request.method !== 'GET') return null;
  if (url.pathname === SHARE_LIST_PATH) return 'list';
  if (url.pathname.startsWith(SHARE_FILE_PREFIX)) return 'file';
  return null;
}

async function hasInbox() {
  return (await caches.keys()).includes(SHARE_INBOX_CACHE);
}

async function clearInbox() {
  await caches.delete(SHARE_INBOX_CACHE);
}

// The inbox's record, or null when nothing is waiting. An expired or unreadable inbox is emptied.
async function readInbox() {
  if (!(await hasInbox())) return null;
  const cache = await caches.open(SHARE_INBOX_CACHE);
  const stored = await cache.match(SHARE_META);
  let meta = null;
  try {
    meta = stored ? await stored.json() : null;
  } catch {
    meta = null;
  }
  if (!meta || typeof meta.at !== 'number' || Date.now() - meta.at > SHARE_MAX_AGE_MS || Date.now() < meta.at) {
    await clearInbox();
    return null;
  }
  return { cache, meta };
}

// Empties the inbox once its time is up, whatever request woke the worker, so files never outlive
// SHARE_MAX_AGE_MS just because nobody opened the incoming page again (for example after signing
// out). Only a complete record past its time is removed, never a share still being written.
async function sweepInbox() {
  try {
    if (!(await hasInbox())) return;
    if (!SHARE_ON) {
      await clearInbox();
      return;
    }
    const stored = await (await caches.open(SHARE_INBOX_CACHE)).match(SHARE_META);
    if (!stored) return;
    const meta = await stored.json().catch(() => null);
    if (meta && typeof meta.at === 'number' && Date.now() - meta.at <= SHARE_MAX_AGE_MS && Date.now() >= meta.at) return;
    if (meta && typeof meta.at === 'number') await clearInbox();
  } catch {
    // A failed sweep is retried on the next request; the inbox is still read with its time checked.
  }
}

// Each time the browser starts this worker.
sweepInbox();

function noStore(body, status, type) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function notFound() {
  return noStore('Not found', 404, 'text/plain; charset=utf-8');
}

// A share comes from the phone itself (no Origin, no referrer) or from a VisaStack page. A post from
// another site, or from a page hiding where it came from (Origin "null"), is turned away with
// nothing kept. Chromium shows the worker the Origin of a form post (checked 17 Nov 2026); the
// referrer check covers a browser that does not, unless the other site also hides its referrer.
function fromThisDeviceOrSite(request) {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== self.location.origin) return false;
  const referrer = typeof request.referrer === 'string' ? request.referrer : '';
  if (/^https?:/i.test(referrer) && new URL(referrer).origin !== self.location.origin) return false;
  return true;
}

// A share with no Origin cannot prove it came from the phone rather than a planted form, so it may
// not push aside a share still waiting for its owner to open it; one from a VisaStack page may.
async function mayReplaceWaiting(request) {
  if (request.headers.get('origin') === self.location.origin) return true;
  const inbox = await readInbox();
  return !inbox || inbox.meta.owner !== null;
}

async function receiveShare(event) {
  const accepted = fromThisDeviceOrSite(event.request) && (await mayReplaceWaiting(event.request));
  let kept = 0;
  let offered = 0;
  if (accepted) {
    try {
      const form = await event.request.formData();
      const shared = form.getAll(SHARE_FILES_FIELD).filter((value) => value && typeof value === 'object');
      // A new share replaces anything an account already opened, or anything past its time.
      await clearInbox();
      const cache = await caches.open(SHARE_INBOX_CACHE);
      const files = [];
      for (const file of shared) {
        const type = String(file.type || '').toLowerCase();
        if (files.length >= SHARE_MAX_FILES) continue;
        if (!SHARE_ACCEPT.includes(type) || !(file.size > 0) || file.size > SHARE_MAX_FILE_BYTES) continue;
        const n = files.length;
        await cache.put(self.location.origin + SHARE_FILE_PREFIX + n, noStore(file, 200, type));
        files.push({ n, name: String(file.name || 'Shared file').slice(0, 200), type, size: file.size });
      }
      kept = files.length;
      offered = shared.length;
      const meta = { at: Date.now(), owner: null, files, dropped: shared.length - files.length };
      await cache.put(SHARE_META, noStore(JSON.stringify(meta), 200, 'application/json'));
      if (kept === 0) await clearInbox();
    } catch {
      await clearInbox();
      kept = 0;
      offered = 0;
    }
  }
  // Kept: the files wait. Offered but none usable: say which files VisaStack takes. Otherwise the
  // share did not come through at all.
  const outcome = kept > 0 ? '' : offered > 0 ? '?none=1' : '?missed=1';
  const target = self.location.origin + INCOMING_PATH + outcome;
  return Response.redirect(target, 303);
}

// Only INCOMING_PATH, open in this browser, may read the inbox.
async function fromIncomingPage(event) {
  if (!event.clientId || !self.clients.get) return false;
  const client = await self.clients.get(event.clientId);
  return !!client && new URL(client.url).pathname === INCOMING_PATH;
}

async function answerShare(event, kind) {
  if (kind === 'receive') return receiveShare(event);
  if (kind === 'clear') {
    if (!(await fromIncomingPage(event))) return notFound();
    await clearInbox();
    return noStore('{}', 200, 'application/json');
  }
  if (!(await fromIncomingPage(event))) return notFound();
  const empty = () => noStore(JSON.stringify({ files: [], dropped: 0, at: 0, token: '' }), 200, 'application/json');
  const inbox = await readInbox();
  if (kind === 'list') {
    // The account key comes in a header, never in the address.
    const key = event.request.headers.get(SHARE_KEY_HEADER) || '';
    if (!key) return notFound();
    if (!inbox) return empty();
    const { cache, meta } = inbox;
    if (meta.owner === null) {
      meta.owner = key;
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      meta.token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      await cache.put(SHARE_META, noStore(JSON.stringify(meta), 200, 'application/json'));
    } else if (meta.owner !== key) {
      // Another account on this device: the waiting files were not shared by it, so they go.
      await clearInbox();
      return empty();
    }
    return noStore(JSON.stringify({ files: meta.files, dropped: meta.dropped, at: meta.at, token: meta.token }), 200, 'application/json');
  }
  if (!inbox) return notFound();
  const { cache, meta } = inbox;
  // Pictures carry this share's random token, made when its owner first opened it.
  const token = new URL(event.request.url).searchParams.get('t') || '';
  if (meta.owner === null || typeof meta.token !== 'string' || !token || token !== meta.token) return notFound();
  const n = new URL(event.request.url).pathname.slice(SHARE_FILE_PREFIX.length);
  if (!/^[0-9]{1,2}$/.test(n)) return notFound();
  const stored = await cache.match(self.location.origin + SHARE_FILE_PREFIX + n);
  return stored || notFound();
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
      // Reading the inbox empties it when its time is up; with sharing switched off it simply goes.
      if (SHARE_ON) await readInbox();
      else await clearInbox();
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
  const share = shareKind(event.request);
  // Any request is a chance to drop an inbox past its time. A share post decides for itself.
  if (share !== 'receive') event.waitUntil(sweepInbox());
  if (share) {
    event.respondWith(answerShare(event, share));
    return;
  }
  const kind = classify(event.request);
  if (kind === 'static') event.respondWith(fromStaticCache(event));
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
const SHARE_INBOX_CACHE = ${JSON.stringify(SHARE_INBOX_CACHE)};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
      // Files shared from another app and still waiting go too.
      if (names.includes(SHARE_INBOX_CACHE)) await caches.delete(SHARE_INBOX_CACHE);
      await self.registration.unregister();
    })(),
  );
});
`;
}

/**
 * Whether this deployment serves the worker: production builds only (the dev server rebuilds
 * files constantly), and on unless `PWA_SERVICE_WORKER=off` retires it. The layout and `/sw.js`
 * both ask this, so pages and the worker script always agree.
 */
export function isServiceWorkerEnabled(read: (name: string) => string | undefined): boolean {
  if (read('NODE_ENV') !== 'production') return false;
  return read('PWA_SERVICE_WORKER')?.trim().toLowerCase() !== 'off';
}

/**
 * Whether files shared from another app are taken: the owner's switch (`WEB_SHARE_TARGET=on`) and
 * the service worker that keeps them on the device must both be on. The manifest, `/sw.js` and the
 * shared files page all ask this one question, so they always agree.
 */
export function isShareTargetOn(read: (name: string) => string | undefined): boolean {
  return isServiceWorkerEnabled(read) && isShareTargetSwitchOn(read);
}
