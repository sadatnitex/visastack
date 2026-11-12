/**
 * Message syntax: `{token}` interpolation plus a small ICU plural subset:
 * `{count, plural, one {# item} other {# items}}`. `#` is the number, formatted
 * for the locale. Exact matches (`=0 {...}`) win over plural categories.
 * Unknown tokens are left intact. No dependency beyond `Intl`.
 */

export type MessageParams = Readonly<Record<string, string | number>>;

/** Index of the `}` that closes the `{` at `open`, or -1 when unbalanced. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse `one {...} other {...}` into selector/body pairs. */
function parseBranches(source: string): Map<string, string> | null {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i] ?? '')) i += 1;
    if (i >= source.length) break;
    const open = source.indexOf('{', i);
    if (open === -1) return null;
    const selector = source.slice(i, open).trim();
    const close = closingBrace(source, open);
    if (selector === '' || close === -1) return null;
    branches.set(selector, source.slice(open + 1, close));
    i = close + 1;
  }
  return branches.has('other') ? branches : null;
}

export function formatMessage(
  template: string,
  params: MessageParams | undefined,
  localeTag: string,
): string {
  if (!params && !template.includes('{')) return template;
  let out = '';
  let i = 0;
  while (i < template.length) {
    const char = template[i] as string;
    if (char !== '{') {
      out += char;
      i += 1;
      continue;
    }
    const close = closingBrace(template, i);
    if (close === -1) {
      out += template.slice(i);
      break;
    }
    const inner = template.slice(i + 1, close);
    const whole = template.slice(i, close + 1);
    const plural = inner.match(/^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/);
    if (plural) {
      const value = params?.[plural[1] as string];
      const branches = parseBranches(plural[2] as string);
      if (typeof value === 'number' && branches) {
        const body =
          branches.get(`=${value}`) ??
          branches.get(new Intl.PluralRules(localeTag).select(value)) ??
          (branches.get('other') as string);
        const number = new Intl.NumberFormat(localeTag).format(value);
        out += formatMessage(body, params, localeTag).replaceAll('#', number);
      } else {
        out += whole;
      }
    } else if (/^\w+$/.test(inner)) {
      const value = params?.[inner];
      out += value === undefined ? whole : String(value);
    } else {
      out += whole;
    }
    i = close + 1;
  }
  return out;
}
