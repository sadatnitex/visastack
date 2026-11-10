/**
 * Every typed word has to be somewhere in the text, in any order, ignoring capital letters
 * ("japan tourist" finds "Tourist visa for Japan").
 */
export function matchesSearch(text: string, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = text.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}
