/**
 * The exact string React receives for a JSX text child or a JSX attribute string: entities are
 * decoded, then (for children only) line breaks and the indentation around them are collapsed the
 * way the JSX transform does it (Babel cleanJSXElementLiteralChild; SWC and TypeScript agree for
 * text without tabs or non-breaking spaces at line edges, which are refused rather than guessed).
 */

const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  shy: '\u00ad',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  middot: '\u00b7',
  bull: '\u2022',
  times: '\u00d7',
  divide: '\u00f7',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  deg: '\u00b0',
  plusmn: '\u00b1',
  sect: '\u00a7',
  para: '\u00b6',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  rarr: '\u2192',
  larr: '\u2190',
  uarr: '\u2191',
  darr: '\u2193',
  harr: '\u2194',
  check: '\u2713',
};

/** Decode HTML entities as JSX does. Returns { text } or { error } for an entity we do not know. */
export function decodeEntities(raw) {
  let error = null;
  const text = raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      if (!Number.isFinite(code) || code > 0x10ffff) {
        error = `unknown_html_entity:${whole}`;
        return whole;
      }
      return String.fromCodePoint(code);
    }
    if (Object.hasOwn(NAMED, body)) return NAMED[body];
    error = `unknown_html_entity:${whole}`;
    return whole;
  });
  return error ? { error } : { text };
}

/** Whitespace rules for a JSX text child (input already entity-decoded). */
export function cleanJsxChildText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) lastNonEmptyLine = i;
  let str = '';
  for (let i = 0; i < lines.length; i++) {
    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;
    const isLastNonEmptyLine = i === lastNonEmptyLine;
    let trimmed = lines[i].replace(/\t/g, ' ');
    if (!isFirstLine) trimmed = trimmed.replace(/^[ ]+/, '');
    if (!isLastLine) trimmed = trimmed.replace(/[ ]+$/, '');
    if (trimmed) {
      if (!isLastNonEmptyLine) trimmed += ' ';
      str += trimmed;
    }
  }
  return str;
}

/**
 * Rendered text of a raw JsxText node, or { error } when the transforms could disagree
 * (tabs, non-breaking spaces at a line edge) or an entity is unknown.
 */
export function renderedJsxText(raw) {
  if (/\t/.test(raw)) return { error: 'tab_in_jsx_text' };
  const decoded = decodeEntities(raw);
  if (decoded.error) return decoded;
  const lines = decoded.text.split(/\r\n|\n|\r/);
  if (lines.length > 1) {
    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && /^\s*\u00a0/.test(lines[i])) return { error: 'nbsp_at_line_edge' };
      if (i < lines.length - 1 && /\u00a0\s*$/.test(lines[i]))
        return { error: 'nbsp_at_line_edge' };
    }
  }
  return { text: cleanJsxChildText(decoded.text) };
}
