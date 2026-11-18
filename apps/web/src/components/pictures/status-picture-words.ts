import { FIELD_STATUS_WORDS } from '../../lib/field-state-words';

/**
 * One status language (WAL1, ADR 0030): a picture for each of the six states a saved value can be
 * in. The NAMES are not written here: they come from `FIELD_STATUS_WORDS` (lib/field-state-words.ts),
 * the one map History, the profile pages and Application Memory read (docs/uiux/ccd/VOCABULARY.md),
 * so a state has one name everywhere. This file adds only the picture and the one sentence the
 * Explain note shows. Screens pass the stored status code they already hold.
 *
 * Truthful words: each sentence says only what VisaStack knows about how the state is set.
 * Backed by a Document means a file holds the same value, never that anyone checked it; Suggested
 * is not confirmed; Confirmed was confirmed by a person, not checked against a file.
 */

/** The stored status codes that have a picture, in the order a key shows them. */
export const STATUS_KINDS = [
  'DECLARED',
  'EXTRACTED_PENDING',
  'APPLICANT_CONFIRMED',
  'DOCUMENT_SUPPORTED',
  'CONFLICTED',
  'STALE',
] as const;

export type StatusKind = (typeof STATUS_KINDS)[number];

/** Brand colour families only (globals.css): no new hues. */
export type StatusTone = 'brand' | 'ok' | 'bad' | 'ink';

/**
 * How the ring is drawn, so each picture reads without colour: a thin solid ring, long dashes,
 * two rings, a thick solid ring, short dashes and dots.
 */
export type StatusRing = 'thin' | 'dashed' | 'double' | 'thick' | 'broken' | 'dotted';

export interface StatusMeaning {
  /** The name, from FIELD_STATUS_WORDS. It is the Explain button's accessible name. */
  readonly name: string;
  /** One plain sentence that says what it means, and nothing more than VisaStack knows. */
  readonly sentence: string;
  readonly tone: StatusTone;
  readonly ring: StatusRing;
}

/** The one name for a code, from the shared map; a missing name is a programming error. */
function nameOf(code: StatusKind): string {
  const name = FIELD_STATUS_WORDS[code];
  if (!name) throw new Error(`No field status word for ${code}`);
  return name;
}

const PICTURES: Readonly<Record<StatusKind, Omit<StatusMeaning, 'name'>>> = {
  // The default state of any saved value (a typed entry, a form answer, an edit by someone with access).
  DECLARED: {
    sentence: 'Saved in this record with no confirmation and no file behind it yet.',
    tone: 'brand',
    ring: 'thin',
  },
  EXTRACTED_PENDING: {
    sentence: 'Offered by reading one of your files or by a connected app, and not confirmed yet.',
    tone: 'brand',
    ring: 'dashed',
  },
  // Set when a person saves or accepts a value without a file behind it.
  APPLICANT_CONFIRMED: {
    sentence: 'Confirmed by a person with access to this record, but not checked against a file.',
    tone: 'brand',
    ring: 'double',
  },
  DOCUMENT_SUPPORTED: {
    sentence:
      'A file in this record shows the same value, which alone does not mean anyone has checked it.',
    tone: 'ok',
    ring: 'thick',
  },
  // Set when a file or a suggestion disagrees with the value already saved.
  CONFLICTED: {
    sentence: 'A file or a suggestion disagrees with the saved value, and the details show both.',
    tone: 'bad',
    ring: 'broken',
  },
  // Set when the person marks the value as no longer current.
  STALE: {
    sentence: 'Marked as no longer current, so it is not used as the value for today.',
    tone: 'ink',
    ring: 'dotted',
  },
};

export const STATUS_MEANINGS: Readonly<Record<StatusKind, StatusMeaning>> = Object.fromEntries(
  STATUS_KINDS.map((code) => [code, { name: nameOf(code), ...PICTURES[code] }]),
) as Record<StatusKind, StatusMeaning>;

/** Whether a stored status code has a picture (screens hold plain strings). */
export function isStatusKind(code: string | null | undefined): code is StatusKind {
  return (STATUS_KINDS as readonly string[]).includes(code ?? '');
}
