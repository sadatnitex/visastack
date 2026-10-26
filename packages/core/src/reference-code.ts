/**
 * Visible reference codes (ADR 0018, owner decision 26 Oct 2026).
 *
 * A short code people can read aloud, type and quote, for example
 * `C-7K2Q9M`: a type letter, a hyphen, then 5 random characters and 1 check
 * character from Crockford's base32 alphabet (no I, L, O or U, so nothing is
 * mistaken for 1 or 0 and no ordinary word is spelled by accident). Internal
 * ids never change; a code is a second, human name for a record, stored once
 * in the `reference_codes` registry and never reused.
 *
 * This module is the one place the format lives. The database backfill in
 * migration 0091 computes the same check character in SQL, and a migration
 * test runs every backfilled code through `parseReferenceCode`, so the two
 * can never drift apart.
 *
 * Pure and framework-free: safe to import in the browser.
 */

/** The record types that carry a visible code. A new type is a new letter here and in the database enum. */
export const REFERENCE_KINDS = ['P', 'C', 'D', 'R'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** What each type letter names, for code and audit metadata (never shown as a label). */
export const REFERENCE_KIND_RECORD: Readonly<Record<ReferenceKind, string>> = {
  P: 'person',
  C: 'case',
  D: 'document',
  R: 'evidence_request',
};

/** Crockford base32: digits, then letters without I, L, O and U. Index = value. */
export const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Random characters in a new code today (the check character comes after them). */
export const REFERENCE_PAYLOAD_LENGTH = 5;

/**
 * The longest payload the format accepts. Codes are generated with
 * `REFERENCE_PAYLOAD_LENGTH`; when one type passes 10% of its space, new codes
 * move to 6 random characters without any change to stored codes, the parser
 * or the database check.
 */
export const REFERENCE_MAX_PAYLOAD_LENGTH = 7;

/** A stored code (no prefix): 6 to 8 characters from the alphabet. Mirrors the database CHECK. */
export const REFERENCE_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{6,8}$/;

const VALUE = new Map<string, number>([...REFERENCE_ALPHABET].map((c, i) => [c, i] as const));

/**
 * Multiplication by 2 (the polynomial x) in GF(32) with the irreducible
 * polynomial x^5 + x^2 + 1 (binary 100101).
 */
function times2(s: number): number {
  const shifted = s << 1;
  return shifted & 0b100000 ? shifted ^ 0b100101 : shifted;
}

/**
 * The Damm state after reading `values`, starting from the type letter. The
 * step `s' = 2s XOR d` is a totally anti-symmetric quasigroup over GF(32), so
 * every single wrong character and every swap of two neighbouring characters
 * changes the final state; seeding with the type letter makes a code typed
 * under the wrong type fail too.
 */
function dammState(kind: ReferenceKind, values: readonly number[]): number {
  let state = VALUE.get(kind) ?? 0;
  for (const value of values) state = times2(state) ^ value;
  return state;
}

/** The check character for a payload under one type. */
export function referenceCheckCharacter(kind: ReferenceKind, payload: string): string {
  const values = [...payload].map((c) => {
    const value = VALUE.get(c);
    if (value === undefined) throw new Error('reference payload outside the alphabet');
    return value;
  });
  return REFERENCE_ALPHABET[times2(dammState(kind, values))] as string;
}

/** Whether a stored code (no prefix) is well formed and its check character is right for this type. */
export function isValidReferenceCode(kind: ReferenceKind, code: string): boolean {
  if (!REFERENCE_CODE_PATTERN.test(code)) return false;
  return (
    dammState(
      kind,
      [...code].map((c) => VALUE.get(c) ?? 0),
    ) === 0
  );
}

/** `C-7K2Q9M`: the type letter, a hyphen and the stored code. */
export function formatReferenceCode(kind: ReferenceKind, code: string): string {
  return `${kind}-${code}`;
}

/** The result of reading a code someone typed or pasted. */
export type ParsedReferenceCode =
  | { readonly ok: true; readonly kind: ReferenceKind; readonly code: string }
  | { readonly ok: false; readonly reason: 'malformed' | 'check_failed' | 'wrong_kind' };

/**
 * Reads a code someone typed: case does not matter, spaces and hyphens are
 * ignored, O reads as 0 and I or L as 1 (U is never part of a code).
 *
 * When the text starts with a type letter followed by a valid code length
 * (`C-7K2Q9M`, `c 7k2q 9m`, `C7K2Q9M`), the letter decides the type and
 * nothing else is tried, so a wrong letter fails the check instead of
 * landing on some other record. Otherwise (`7K2Q9M`) the check character
 * decides, because a code is valid under at most one type. When `expected`
 * is given, a valid code of another type is refused as `wrong_kind`.
 *
 * `check_failed` means the characters are all possible but one looks wrong
 * (a typo): say so in plain words rather than "not found".
 */
export function parseReferenceCode(input: string, expected?: ReferenceKind): ParsedReferenceCode {
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length === 0 || cleaned.length > REFERENCE_MAX_PAYLOAD_LENGTH + 2) {
    return { ok: false, reason: 'malformed' };
  }
  if (!/^[0-9A-HJKMNP-TV-Z]+$/.test(cleaned)) return { ok: false, reason: 'malformed' };

  const letter = cleaned[0] as ReferenceKind;
  const rest = cleaned.slice(1);
  if (
    (REFERENCE_KINDS as readonly string[]).includes(letter) &&
    REFERENCE_CODE_PATTERN.test(rest)
  ) {
    return isValidReferenceCode(letter, rest)
      ? finish(letter, rest, expected)
      : { ok: false, reason: 'check_failed' };
  }
  if (!REFERENCE_CODE_PATTERN.test(cleaned)) return { ok: false, reason: 'malformed' };
  const kind = REFERENCE_KINDS.find((k) => isValidReferenceCode(k, cleaned));
  return kind ? finish(kind, cleaned, expected) : { ok: false, reason: 'check_failed' };
}

function finish(
  kind: ReferenceKind,
  code: string,
  expected: ReferenceKind | undefined,
): ParsedReferenceCode {
  if (expected !== undefined && expected !== kind) return { ok: false, reason: 'wrong_kind' };
  return { ok: true, kind, code };
}

/**
 * Words a code must never spell (English and romanised Bangla), checked after
 * reading digits as the letters they resemble. Only words the alphabet can
 * actually form are listed (it has no I, L, O or U, though 1 and 0 can look
 * like I and O).
 */
const DENYLIST = [
  'ASS',
  'SEX',
  'SHIT',
  'DICK',
  'COCK',
  'PORN',
  'NAZI',
  'FAG',
  'KKK',
  'PISS',
  'TIT',
  'BOOB',
  'PENIS',
  'HORNY',
  'RAPE',
  'DIE',
  'DEAD',
  'KYS',
  'WTF',
  'XXX',
  'MAGI',
  'CHOD',
  'HARAMI',
  'KHANKI',
  'BESHYA',
  'MARA',
] as const;

const LEET: Readonly<Record<string, string>> = {
  '0': 'O',
  '1': 'I',
  '3': 'E',
  '4': 'A',
  '5': 'S',
  '7': 'T',
  '8': 'B',
};

/**
 * Whether a full code (payload and check character) may be handed out: no
 * denylisted word, not one character repeated, and not starting `00` (kept
 * for documentation and test fixtures, so a printed example never matches a
 * real record).
 */
export function isIssuableReferenceCode(code: string): boolean {
  if (code.startsWith('00')) return false;
  if (/^(.)\1*$/.test(code)) return false;
  const read = [...code].map((c) => LEET[c] ?? c).join('');
  return !DENYLIST.some((word) => read.includes(word));
}

/** A source of random bytes; the default is the platform's cryptographic generator. */
export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandom: RandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

/**
 * A new code for one type (no prefix): `payloadLength` random characters
 * plus the check character, never one `isIssuableReferenceCode` refuses.
 * Uniqueness is the registry's job (it retries on a collision).
 */
export function generateReferenceCode(
  kind: ReferenceKind,
  options: { readonly payloadLength?: number; readonly random?: RandomBytes } = {},
): string {
  const length = options.payloadLength ?? REFERENCE_PAYLOAD_LENGTH;
  if (length < REFERENCE_PAYLOAD_LENGTH || length > REFERENCE_MAX_PAYLOAD_LENGTH) {
    throw new Error('reference payload length out of range');
  }
  const random = options.random ?? cryptoRandom;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    // 32 divides 256, so the low five bits of a random byte are uniform.
    const payload = [...random(length)]
      .map((byte) => REFERENCE_ALPHABET[byte & 31] as string)
      .join('');
    const code = payload + referenceCheckCharacter(kind, payload);
    if (isIssuableReferenceCode(code)) return code;
  }
  throw new Error('reference code generator could not find an issuable code');
}
