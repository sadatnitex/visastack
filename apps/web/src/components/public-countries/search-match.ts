/** One country the hero search can offer: its code, its English name and its flag file (or null). */
export interface SearchEntry {
  readonly c: string;
  readonly n: string;
  readonly f: string | null;
}

/** The most results the hero search lists. */
export const SEARCH_LIMIT = 3;

/** The most letters of a search the page and the box accept. */
export const SEARCH_MAX = 60;

/** The word the hero search types by itself. */
export const DEMO_WORD = 'Singapore';

/** Letters without accents, lower case: "Côte" and "cote" read the same. */
export function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** A search text cleaned for matching: trimmed, one space between words, no accents, lower case. */
export function normaliseQuery(text: string): string {
  return foldAccents(text).trim().replace(/\s+/g, ' ');
}

/** Spaces, apostrophes, brackets, dots, commas and hyphens all end a word ("Côte d'Ivoire", "Timor-Leste"). */
const WORD_BREAK = /[\s'\u2019()[\].,-]+/;

/**
 * Countries whose name starts with the text come first, then those with a word that starts with
 * it, then those that hold it anywhere. Accents are ignored on both sides. Names keep the list's
 * own order inside each group. Fewer than two letters match nothing, so a single key press never
 * fills the list.
 */
export function matchCountries(
  index: readonly SearchEntry[],
  text: string,
  limit: number = SEARCH_LIMIT,
): readonly SearchEntry[] {
  const q = normaliseQuery(text);
  if (q.length < 2) return [];
  const starts: SearchEntry[] = [];
  const words: SearchEntry[] = [];
  const holds: SearchEntry[] = [];
  for (const entry of index) {
    const name = foldAccents(entry.n);
    if (name.startsWith(q)) starts.push(entry);
    else if (name.split(WORD_BREAK).some((word) => word.startsWith(q))) words.push(entry);
    else if (name.includes(q)) holds.push(entry);
  }
  return [...starts, ...words, ...holds].slice(0, Math.max(0, limit));
}

/** What the status line under the search says, before it is put into words. */
export type SearchStatus =
  | { readonly kind: 'quiet' }
  | { readonly kind: 'short' }
  | { readonly kind: 'none' }
  | { readonly kind: 'found'; readonly count: number }
  | { readonly kind: 'first'; readonly count: number; readonly limit: number };

export function searchStatus(
  count: number,
  text: string,
  limit: number = SEARCH_LIMIT,
): SearchStatus {
  const length = normaliseQuery(text).length;
  if (length === 0) return { kind: 'quiet' };
  if (length < 2) return { kind: 'short' };
  if (count === 0) return { kind: 'none' };
  return count > limit ? { kind: 'first', count, limit } : { kind: 'found', count };
}
