/**
 * Reading and writing the paging parts of a page address (Scroll Budget programme, WP-SB0).
 *
 * Two shapes are used across the product:
 * - `?show=<n>` for a plain list that grows by a fixed step ("Show More"): the page reads the
 *   first n rows from the server, so n is always clamped and rounded to the step.
 * - `?before=<cursor>` (and `after`) for logs and long histories ("Show Older Entries"): the
 *   cursor is opaque here and only shape-checked; the service decodes it, checks it belongs to
 *   the same view and falls back to the first page when it does not.
 *
 * Nothing here trusts the address: every reader returns a safe default for missing, repeated,
 * oversized or malformed values, so a hand-edited link can never error the page.
 */

/** What Next.js passes as `searchParams` once awaited. */
export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

/** The traveller and staff list steps from the scroll budget (10 rows, then 25 for teams). */
export const TRAVELLER_LIST_STEP = 10;
export const TEAM_LIST_STEP = 25;
/**
 * No list grows past this through `show`: it matches the largest page a service read returns
 * (PAGE_LIMIT_MAX in packages/services/src/paging.ts), so Show More never offers rows the server
 * would not send. Longer reads use a cursor instead.
 */
export const SHOW_MAX = 100;

const MAX_CURSOR_LENGTH = 512;
const CURSOR_SHAPE = /^[A-Za-z0-9_-]+$/;

/** The first value of a parameter: repeated parameters (`?show=1&show=2`) keep the first. */
export function firstParam(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return value[0];
}

/**
 * How many rows to show, from `?show=`. Missing or malformed values give one step; anything
 * else rounds up to a whole number of steps, between one step and `max`.
 */
export function parseShow(
  value: string | readonly string[] | undefined,
  { step, max = SHOW_MAX }: { readonly step: number; readonly max?: number },
): number {
  const size = Math.max(1, Math.floor(step));
  const ceiling = Math.max(size, Math.floor(max / size) * size);
  const raw = firstParam(value);
  if (raw === undefined || !/^\d{1,6}$/.test(raw)) return size;
  const wanted = Number.parseInt(raw, 10);
  if (wanted <= size) return size;
  return Math.min(ceiling, Math.ceil(wanted / size) * size);
}

/** The `show` value for the next Show More, or null when the list is already at its ceiling. */
export function nextShow(
  shown: number,
  { step, max = SHOW_MAX }: { readonly step: number; readonly max?: number },
): number | null {
  const size = Math.max(1, Math.floor(step));
  const ceiling = Math.max(size, Math.floor(max / size) * size);
  const next = Math.min(ceiling, shown + size);
  return next > shown ? next : null;
}

/** A cursor from `?before=` or `?after=`, if it has the shape a cursor can have; else undefined. */
export function parseCursor(value: string | readonly string[] | undefined): string | undefined {
  const raw = firstParam(value);
  if (raw === undefined || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return undefined;
  return CURSOR_SHAPE.test(raw) ? raw : undefined;
}

/**
 * The same page address with some parameters changed: `null` or `undefined` removes one, every
 * other parameter is kept as it was (filters, tabs). `hash` names the element to land on, so focus
 * and scrolling come back next to the rows that were just added.
 */
export function pagingHref(
  pathname: string,
  current: SearchParamsRecord | URLSearchParams | undefined,
  changes: Readonly<Record<string, string | number | null | undefined>>,
  hash?: string,
): string {
  // A leading // or /\ would make browsers leave the site, and browsers drop tabs and line breaks
  // before reading an address, so no whitespace, control character or backslash is allowed.
  const control = [...pathname].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (control || !/^\/(?!\/)[^\s\\]*$/.test(pathname)) {
    throw new Error('A paging link must stay on this site');
  }
  const params = new URLSearchParams();
  if (current instanceof URLSearchParams) {
    for (const [key, value] of current) params.append(key, value);
  } else if (current) {
    for (const [key, value] of Object.entries(current)) {
      if (value === undefined) continue;
      for (const one of typeof value === 'string' ? [value] : value) params.append(key, one);
    }
  }
  for (const [key, value] of Object.entries(changes)) {
    params.delete(key);
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  const anchor = hash ? `#${encodeURIComponent(hash)}` : '';
  return `${pathname}${query ? `?${query}` : ''}${anchor}`;
}
