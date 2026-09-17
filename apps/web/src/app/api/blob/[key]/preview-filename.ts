/**
 * Split out for the same reason as `headers.ts`: Next's App Router only
 * allows recognized handler/config exports from a route file.
 */

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'text/plain': 'txt',
};

/**
 * Derives a display filename for a rendered redacted preview whose bytes no
 * longer match the original's own extension (e.g. `passport.pdf` ->
 * `passport-preview.png`), never the opaque object key (master directive
 * §10/§18/§21E), and never the stale original extension against the new
 * content type.
 */
export function previewFilename(
  original: string | undefined,
  renderedContentType: string,
): string | undefined {
  if (!original) return original;
  const extension = EXTENSION_BY_CONTENT_TYPE[renderedContentType];
  if (!extension) return original;
  const dot = original.lastIndexOf('.');
  const base = dot === -1 ? original : original.slice(0, dot);
  return `${base}-preview.${extension}`;
}
