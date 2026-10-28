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
 * Letters that do not come apart into a plain letter and an accent, written the way they are
 * usually spelled in plain Latin letters. Written as code points so the source stays ASCII.
 */
const ASCII_SPELLINGS: Readonly<Record<string, string>> = {
  '\u0141': 'L', // L with stroke
  '\u0142': 'l',
  '\u00d8': 'O', // O with stroke
  '\u00f8': 'o',
  '\u0110': 'D', // D with stroke
  '\u0111': 'd',
  '\u00d0': 'D', // eth
  '\u00f0': 'd',
  '\u00de': 'Th', // thorn
  '\u00fe': 'th',
  '\u00df': 'ss', // sharp s
  '\u00c6': 'AE',
  '\u00e6': 'ae',
  '\u0152': 'OE',
  '\u0153': 'oe',
  '\u0131': 'i', // dotless i
  '\u2018': "'", // curly apostrophes and quotes
  '\u2019': "'",
  '\u201a': "'",
  '\u201b': "'",
  '\u201c': "'",
  '\u201d': "'",
  '\u201e': "'",
  '\u2010': '-', // hyphens and dashes
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
  '\u00a0': ' ', // no-break space
};

/**
 * The plain-ASCII form of a name for the classic `filename="..."` parameter. Header values may
 * only carry bytes up to 0xFF, and `new Response` throws on anything above that, so a name such as
 * "Passport, Lukasz" spelled with a stroked L, or one written in Bangla, would otherwise fail the
 * whole response. Accents are dropped (an accented e is "e"), a few letters are spelled out, and anything else becomes "_" (one per
 * run). Control characters, quotes and backslashes are removed. The full name still travels in
 * `filename*`.
 */
export function asciiFileName(filename: string): string {
  const spelled = Array.from(filename.normalize('NFKD'), (ch) => ASCII_SPELLINGS[ch] ?? ch)
    .join('')
    .replace(/\p{M}+/gu, '');
  return (
    spelled
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars from an untrusted header value.
      .replace(/[\x00-\x1f\x7f"\\]/g, '')
      .replace(/[^\x20-\x7e]+/g, '_')
      .slice(0, 255)
  );
}

/**
 * RFC 5987 `filename*` value: UTF-8, percent-encoded, with the characters it does not allow
 * unescaped (' ( ) * !) escaped too. The name is shortened by whole characters first, so an
 * escape is never cut in half.
 */
function encodedFileName(filename: string): string {
  const percentEncode = (text: string) =>
    encodeURIComponent(text).replace(
      /['()*!]/g,
      (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  let chars = Array.from(filename);
  while (chars.length > 0 && percentEncode(chars.join('')).length > 512) chars = chars.slice(0, -1);
  return percentEncode(chars.join(''));
}

/**
 * Build a safe `Content-Disposition` value from an untrusted display filename
 * (master directive §10/§18/§21E: the approved filename, never the opaque
 * object key): a plain-ASCII `filename="..."` for older clients, and the
 * RFC 5987 `filename*=UTF-8''...` form so non-ASCII names (accents, Bangla)
 * round-trip correctly in modern browsers.
 */
function contentDisposition(kind: 'inline' | 'attachment', filename: string | undefined): string {
  if (!filename) return kind;
  const ascii = asciiFileName(filename);
  return `${kind}; filename="${ascii.trim() ? ascii : 'document'}"; filename*=UTF-8''${encodedFileName(filename)}`;
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
