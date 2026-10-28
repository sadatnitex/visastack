/**
 * Headers for a private answer that no browser, proxy or shared cache may keep: a person's calendar
 * file or feed. Shared so every such route says it the same way.
 */
export const PRIVATE_NO_STORE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
});
