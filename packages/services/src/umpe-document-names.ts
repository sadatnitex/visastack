/**
 * UMPE P3: the file's own name, as the person's device gave it (private metadata).
 *
 * The name arrives with the upload, is cleaned here, and is kept only on the person's own upload
 * receipt. It is never written to an audit record, never shown to an agency, and is used for one
 * thing: suggesting a readable name for a file the reader could not name by its type. Pure: no
 * database, so every rule is tested on its own.
 */

import { cleanDocumentName } from './naming';

/** The longest original file name kept (characters, after cleaning). */
export const MAX_ORIGINAL_FILE_NAME_LENGTH = 180;

/** The longest readable name suggested from a file name, before the extension. */
const MAX_READABLE_NAME_LENGTH = 80;

/**
 * The file's own name made safe to keep: only the last path part (a folder path never reaches the
 * record), no control or text-direction characters, NFC, single spaces, capped. Null when nothing
 * usable is left.
 */
export function sanitizeOriginalFileName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const lastPart = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = cleanDocumentName(lastPart).trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return null;
  // Cut by code points, so a name in any script is never split inside a character.
  const capped = Array.from(cleaned).slice(0, MAX_ORIGINAL_FILE_NAME_LENGTH).join('').trim();
  return capped === '' ? null : capped;
}

/**
 * Names a camera, scanner or chat app gives on its own: they say nothing about the document, so no
 * name is suggested from them.
 */
const MEANINGLESS_NAMES: readonly RegExp[] = [
  // A generic word and nothing but numbers after it: "IMG 2041", "scan 0003", "Document".
  /^(img|image|dsc|dscn|dcim|pxl|vid|photo|pic|picture|scan|scanned|scanner|doc|document|file|untitled|new|copy|attachment|download|screenshot|screen shot|camera|mobile)[\s\d]*$/i,
  // App names with a date or time after them: "WhatsApp Image 2026 03 01 at 10 22 33".
  /^(whatsapp (image|document|video)|cam ?scanner|adobe scan|screenshot|screen shot|img|pxl|dsc)\s\d/i,
  /^[\d\s]+$/,
  /^[0-9a-f]{8}\s?[0-9a-f]{4}\s?[0-9a-f]{4}\s?[0-9a-f]{4}\s?[0-9a-f]{12}$/i,
  /^[0-9a-f\s]{16,}$/i,
];

const SMALL_WORDS: ReadonlySet<string> = new Set([
  'of',
  'and',
  'for',
  'to',
  'the',
  'in',
  'on',
  'a',
]);

function titleWord(word: string, index: number): string {
  // Short capitals (NID, TIN, BRAC) and anything with a digit stay as written.
  if (/\d/.test(word) || (/^[A-Z]{2,5}$/.test(word) && word.length <= 5)) return word;
  const lower = word.toLocaleLowerCase('en');
  if (index > 0 && SMALL_WORDS.has(lower)) return lower;
  return lower.charAt(0).toLocaleUpperCase('en') + lower.slice(1);
}

/**
 * A readable name from the file's own name ("bank_statement-march_2026.pdf" becomes "Bank
 * Statement March 2026"), or null when the name says nothing useful (IMG_2041.jpg, scan0003.pdf, a
 * random code). Never includes the extension.
 */
export function readableNameFromFileName(fileName: string | null | undefined): string | null {
  const safe = sanitizeOriginalFileName(fileName);
  if (!safe) return null;
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const plain = stem
    .replace(/[_.+~-]+/g, ' ')
    .replace(/[()[\]{}#@!$%^&=;,'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain === '') return null;
  // Matched before words joined in camel case are split, so "WhatsApp" stays one word.
  if (MEANINGLESS_NAMES.some((pattern) => pattern.test(plain))) return null;
  const spaced = plain.replace(/([a-z])([A-Z])/g, '$1 $2');
  // At least one word of three or more letters, so "a1 b2" or "x" is not a name.
  if (!/\p{L}{3,}/u.test(spaced)) return null;
  const words = spaced.split(' ').map(titleWord);
  const name = Array.from(words.join(' ')).slice(0, MAX_READABLE_NAME_LENGTH).join('').trim();
  return name === '' ? null : name;
}
