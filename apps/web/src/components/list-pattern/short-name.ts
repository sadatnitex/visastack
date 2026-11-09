/** The most words a row's name shows; a longer sentence is cut here and read in full in the panel. */
export const ROW_NAME_WORDS = 12;

/**
 * A row's name cut to at most `max` words, ending with an ellipsis when it was cut. The row marks
 * the cut name as data (`data-value`) and keeps the full sentence for screen readers and the panel,
 * so a long starter sentence never turns a list into a page of prose.
 */
export function shortName(name: string, max = ROW_NAME_WORDS): { text: string; cut: boolean } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return { text: words.join(' '), cut: false };
  return { text: `${words.slice(0, max).join(' ')}…`, cut: true };
}
