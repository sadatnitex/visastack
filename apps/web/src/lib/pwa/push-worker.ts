import { switchOn } from '@visastack/core';

/**
 * The service worker's part of phone and desktop alerts (WP-PIC18), as source text the worker
 * builder adds only while Web Push is switched on. While it is off the worker is byte for byte
 * what it was before.
 *
 * - The words shown are fixed here (the same as the server's, a test keeps them equal), never
 *   taken from the message: even a message that somehow
 *   carried a name could not show it.
 * - The only thing read from the message is the page to open, and only a path on this site is
 *   kept; anything else opens the notices page.
 * - A click focuses a VisaStack window already open on that page, or opens one. Never another
 *   site.
 */

export const PUSH_TITLE = 'VisaStack';
export const PUSH_BODY = 'Something in VisaStack needs you';
export const PUSH_FALLBACK_PATH = '/app/notifications';
export const PUSH_ICON = '/icons/icon-192.png';
export const PUSH_TAG = 'visastack-notice';

/** Whether the worker carries the alert handlers: the same switch the server reads. */
export function isWebPushSwitchOn(read: (name: string) => string | undefined): boolean {
  return switchOn(read('WEB_PUSH'));
}

export function buildPushWorkerSection(): string {
  return `
// --- Phone and desktop alerts (WP-PIC18) ---
const PUSH_TITLE = ${JSON.stringify(PUSH_TITLE)};
const PUSH_BODY = ${JSON.stringify(PUSH_BODY)};
const PUSH_FALLBACK_PATH = ${JSON.stringify(PUSH_FALLBACK_PATH)};
const PUSH_ICON = ${JSON.stringify(PUSH_ICON)};
const PUSH_TAG = ${JSON.stringify(PUSH_TAG)};

// A path on this site, or the notices page.
function pushTarget(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\\\')) {
    return new URL(PUSH_FALLBACK_PATH, self.location.origin).href;
  }
  try {
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) return new URL(PUSH_FALLBACK_PATH, self.location.origin).href;
    return url.href;
  } catch {
    return new URL(PUSH_FALLBACK_PATH, self.location.origin).href;
  }
}

self.addEventListener('push', (event) => {
  let path = null;
  try {
    const data = event.data ? event.data.json() : null;
    path = data && typeof data.url === 'string' ? data.url : null;
  } catch {
    path = null;
  }
  event.waitUntil(
    self.registration.showNotification(PUSH_TITLE, {
      body: PUSH_BODY,
      icon: PUSH_ICON,
      tag: PUSH_TAG,
      data: { url: pushTarget(path) },
    }),
  );
});

// The path part of an address on this site, or null.
function ownPath(href) {
  try {
    const url = new URL(href, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const target = pushTarget(data && typeof data.url === 'string' ? ownPath(data.url) : null);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
`;
}
