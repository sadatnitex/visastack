import { toTitleCase } from './title-case';

/**
 * Turns a stored code such as `IN_PROGRESS` or `bank_statement` into words a person
 * would use ("In Progress", "Bank Statement"). For a code with no hand-written label;
 * where a label table exists, use the table.
 */
export function humanizeCode(code: string): string {
  // A code names a thing (a state, a document kind), so it reads as a Title Case term.
  return toTitleCase(code.replace(/[_-]+/g, ' ').trim().toLowerCase().replace(/\s+/g, ' '));
}
