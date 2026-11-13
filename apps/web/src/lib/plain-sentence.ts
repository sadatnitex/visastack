import type { Locale } from '@visastack/i18n';

/**
 * A service refusal as a sentence a person can read, by the language the text is written in (the
 * caller knows it; the first character does not, since a Bangla sentence can start with a Latin
 * word). English gets a capital and a full stop. Bangla is never recased and ends with its own
 * stop, "।", unless it already ends in "।", "?" or "!".
 */
export function plainSentence(message: string, lang: Locale = 'en'): string {
  const text = message.trim();
  if (text.length === 0) return 'Something went wrong. Try again.';
  if (lang === 'bn') return /[।?!]$/.test(text) ? text : `${text}।`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}
