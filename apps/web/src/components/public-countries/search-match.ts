/** One country the hero search can offer: its code, its English name and its flag file (or null). */
export interface SearchEntry {
  readonly c: string;
  readonly n: string;
  readonly f: string | null;
}

/** The most results the hero search lists. */
export const SEARCH_LIMIT = 3;

/** The word the hero search types by itself. */
export const DEMO_WORD = 'Singapore';

/** A search text cleaned for matching: trimmed, one space between words, lower case. */
export function normaliseQuery(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Countries whose name starts with the text come first, then those with a word that starts with
 * it, then those that hold it anywhere. Names keep the list's own order inside each group. Fewer
 * than two letters match nothing, so a single key press never fills the list.
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
    const name = entry.n.toLowerCase();
    if (name.startsWith(q)) starts.push(entry);
    else if (name.split(/[\s-]+/).some((word) => word.startsWith(q))) words.push(entry);
    else if (name.includes(q)) holds.push(entry);
  }
  return [...starts, ...words, ...holds].slice(0, Math.max(0, limit));
}

/** The plain-words count a screen reader hears after each change of the search text. */
export function resultCountWords(count: number, text: string): string {
  if (normaliseQuery(text).length < 2) return '';
  if (count === 0) return 'No country matches.';
  return count === 1 ? '1 country found.' : `${count} countries found.`;
}
