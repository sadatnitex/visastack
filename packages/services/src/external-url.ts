/**
 * Author-supplied links (a pack requirement's source, a route's official
 * channel and reporting page) are rendered as `<a href>` on pages the public
 * and applicants read, so the scheme is checked before one is stored and
 * again before one is rendered (directive Part 9 section 6: sanitize pack
 * content). Only absolute http(s) URLs qualify: a `javascript:`, `data:` or
 * `file:` link, or a bare "see the website", is not a link anyone should be
 * handed.
 *
 * The render-side check is deliberate even though writes are validated: it
 * also covers rows stored before the write check existed and any value
 * edited directly in the database.
 */

/** True for an absolute `http:` or `https:` URL. Surrounding whitespace is ignored. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The trimmed URL if it is safe to render as a link, otherwise `null`, which
 * every call site already treats as "no link on file".
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' && isHttpUrl(trimmed) ? trimmed : null;
}
