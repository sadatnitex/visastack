/**
 * One status language (WAL1, ADR 0030): six pictures for six truths about a detail or a file.
 * This record is the only place their names and sentences are written. Screens, the Explain note
 * and the Bengali word list all read it, so a name is never spelled two ways.
 *
 * Truthful words: each sentence says only what VisaStack knows. "Backed by a Document" means a
 * file the person added holds the same value; it never means anyone checked, verified or approved
 * it. "Suggested" is not saved until the person confirms it.
 */

export const STATUS_KINDS = [
  'added',
  'backed',
  'suggested',
  'sensitive',
  'needsFix',
  'notCurrent',
] as const;

export type StatusKind = (typeof STATUS_KINDS)[number];

/** Brand colour families only (globals.css): no new hues. */
export type StatusTone = 'brand' | 'ok' | 'warn' | 'bad' | 'ink';

/**
 * How the ring is drawn, so each picture reads without colour: a thin solid ring, a thick solid
 * ring, long dashes, two rings, short dashes and dots.
 */
export type StatusRing = 'thin' | 'thick' | 'dashed' | 'double' | 'broken' | 'dotted';

export interface StatusMeaning {
  /** The name, in Title Case. It is the Explain button's accessible name. */
  readonly name: string;
  /** One plain sentence that says what it means, and nothing more than VisaStack knows. */
  readonly sentence: string;
  readonly tone: StatusTone;
  readonly ring: StatusRing;
}

export const STATUS_MEANINGS: Readonly<Record<StatusKind, StatusMeaning>> = {
  added: {
    name: 'Added',
    sentence: 'You typed this in yourself, and it is not linked to any file.',
    tone: 'brand',
    ring: 'thin',
  },
  backed: {
    name: 'Backed by a Document',
    sentence:
      'A file you uploaded shows the same value, which alone does not mean anyone has checked it.',
    tone: 'ok',
    ring: 'thick',
  },
  suggested: {
    name: 'Suggested',
    sentence: 'Read from one of your files, and not saved until you confirm it.',
    tone: 'brand',
    ring: 'dashed',
  },
  sensitive: {
    name: 'Sensitive',
    sentence: 'Hidden until you choose Show, and only you see it on this screen.',
    tone: 'warn',
    ring: 'double',
  },
  needsFix: {
    name: 'Needs Fix',
    sentence: 'Something here does not fit, and its details say what to change.',
    tone: 'bad',
    ring: 'broken',
  },
  notCurrent: {
    name: 'Not Current',
    sentence: 'This was true before and stays in your history, but it is not true now.',
    tone: 'ink',
    ring: 'dotted',
  },
};
