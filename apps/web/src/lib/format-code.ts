/**
 * Turns a stored code such as `IN_PROGRESS` or `bank_statement` into words a person
 * would use ("In progress", "Bank statement"). For a code with no hand-written label;
 * where a label table exists, use the table.
 */
export function humanizeCode(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.length === 0 ? words : words.charAt(0).toUpperCase() + words.slice(1);
}
