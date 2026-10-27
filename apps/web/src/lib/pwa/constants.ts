/**
 * Service-worker values shared by the worker builder, the page runtime and the browser tests.
 * No Node or browser imports here: the page bundle and the Playwright specs both load this file.
 */

/** Every cache the worker creates starts with this, so a newer worker or the page can remove them. */
export const CACHE_PREFIX = 'visastack-static-';

/**
 * Content-hashed build output (scripts, styles, fonts). A changed file gets a new name, so a
 * stored copy can never go stale.
 */
export const STATIC_PREFIXES = ['/_next/static/'] as const;

/** Public brand files in `public/icons/` and the app icons Next serves from `src/app/`. */
export const PUBLIC_STATIC_PREFIXES = ['/icons/'] as const;
export const PUBLIC_STATIC_PATHS = ['/favicon.ico', '/icon.svg', '/apple-icon.png'] as const;

/** The cache law as a predicate: the only URLs the worker may ever store on a device. */
export function isPublicStaticUrl(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;
  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return true;
  if (PUBLIC_STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return true;
  return (PUBLIC_STATIC_PATHS as readonly string[]).includes(url.pathname);
}
