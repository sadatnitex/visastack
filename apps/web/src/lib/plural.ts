/**
 * Counts in plain English: "1 item", "2 items", and the verb that agrees with them ("1 item
 * needs", "2 items need"). One helper, so no screen writes "1 items need a decision".
 */

/** "1 document", "3 documents"; pass the plural for a word that is not just noun + s. */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

/** The verb form that agrees with a count: agree(1, 'needs', 'need') is "needs". */
export function agree(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
