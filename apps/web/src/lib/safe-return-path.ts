/**
 * A same-site relative path or the app home. Never an off-site address.
 *
 * Kept free of imports on purpose: the request filter (`middleware.ts`) uses it through
 * `confirmed-landing.ts`, and anything it imports must compile for the edge runtime. Anything that
 * is not a string (a repeated address parameter arrives as a list) is refused like any other
 * unsafe value.
 */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/app';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app';
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 32) return '/app';
  }
  return value;
}
