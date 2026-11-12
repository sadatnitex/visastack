const BENGALI = /[ঀ-৿]/;

/**
 * A service refusal as a sentence a person can read: English gets a capital and a full stop,
 * Bangla (already worded for the person) ends with its own stop, "।", and is never recased.
 */
export function plainSentence(message: string): string {
  const text = message.trim();
  if (text.length === 0) return 'Something went wrong. Try again.';
  if (BENGALI.test(text)) return /[।.!?]$/.test(text) ? text : `${text}।`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}
