/**
 * Response-header construction for the signed blob-serving route.
 *
 * Kept out of `route.ts`: Next.js's App Router validates that a route file
 * exports only recognized handler/config names, so a plain helper function
 * cannot live there. Splitting it out also makes the security-relevant
 * headers (nosniff, CSP, no-store) unit-testable without standing up
 * storage/DB.
 */

/**
 * Build a safe `Content-Disposition` value from an untrusted display filename
 * (master directive §10/§18/§21E: the approved filename, never the opaque
 * object key). Strips control characters and quotes to keep the classic
 * `filename="..."` form unambiguous, and always adds the RFC 5987
 * `filename*=UTF-8''...` form so non-ASCII/legal names round-trip correctly
 * in modern browsers.
 */
function contentDisposition(kind: 'inline' | 'attachment', filename: string | undefined): string {
  if (!filename) return kind;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars from an untrusted header value.
  const cleaned = filename.replace(/[\x00-\x1f\x7f"\\]/g, '').slice(0, 255);
  const encoded = encodeURIComponent(filename).slice(0, 512);
  return `${kind}; filename="${cleaned || 'document'}"; filename*=UTF-8''${encoded}`;
}

/** The full header set for a served object (master directive §7 "PR 3"). */
export function blobResponseHeaders(input: {
  readonly contentType: string;
  readonly dispositionKind: 'inline' | 'attachment';
  readonly filename: string | undefined;
}): Record<string, string> {
  return {
    'Content-Type': input.contentType,
    'Content-Disposition': contentDisposition(input.dispositionKind, input.filename),
    'Cache-Control': 'private, no-store',
    // Defense in depth alongside the scanner's declared-content-type gate
    // (packages/adapters/src/scanner.ts): never let a browser MIME-sniff
    // stored bytes into an executable type regardless of what Content-Type
    // ended up being served.
    'X-Content-Type-Options': 'nosniff',
    // A second, independent layer alongside nosniff: even if a stored file
    // were ever rendered as markup by a browser quirk, this response
    // permits no script/style/frame/plugin/form execution in that context
    // at all.
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}
