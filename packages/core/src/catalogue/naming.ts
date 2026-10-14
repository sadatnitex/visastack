/**
 * Naming rules for the catalogue, shared by the data and its guard tests.
 *
 * Owner rule (2026-10-14): terms and stand-alone labels use Title Case ("Passport Number", "Date of
 * Birth"); small connecting words stay lowercase inside a label; sentences follow standard
 * practice and are not labels.
 */

/** Connecting words that stay lowercase inside a label (never as the first word). */
export const LABEL_CONNECTING_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'if',
  'from',
  'in',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'vs',
  'with',
]);

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const DOCUMENT_KEY_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const PURPOSE_KEY_PATTERN = FIELD_KEY_PATTERN;

export const MAX_KEY_LENGTH = 64;

export function isFieldKey(value: string): boolean {
  return value.length <= MAX_KEY_LENGTH && FIELD_KEY_PATTERN.test(value);
}

export function isDocumentKey(value: string): boolean {
  return value.length <= MAX_KEY_LENGTH && DOCUMENT_KEY_PATTERN.test(value);
}

export function isPurposeKey(value: string): boolean {
  return value.length <= MAX_KEY_LENGTH && PURPOSE_KEY_PATTERN.test(value);
}

/**
 * True when every word of a label is in Title Case. Allowed: a word that starts with an upper-case
 * letter or a digit, a connecting word that is not first, an all-capitals acronym, and words that
 * start with punctuation such as "(" or a quote followed by an allowed word.
 */
export function isTitleCaseLabel(label: string): boolean {
  if (label.trim() !== label || label.length === 0 || /\s{2,}/.test(label)) return false;
  const words = label.split(' ');
  return words.every((rawWord, index) => {
    const word = rawWord.replace(/^[("'\[]+/, '').replace(/[)"'\],.:;]+$/, '');
    if (word.length === 0) return false;
    if (index > 0 && LABEL_CONNECTING_WORDS.has(word)) return true;
    // Hyphenated and slash-joined parts each follow the same rule.
    return word.split(/[-/]/).every((part) => /^[A-Z0-9]/.test(part));
  });
}
