import { type Result, err, ok } from '@visastack/core';

/**
 * Deterministic passport MRZ (TD3) parser (Build Spec §6 — deterministic
 * parsing before any AI). Pure and dependency-free: two 44-character lines in,
 * validated fields out. Check digits are verified so a misread is rejected
 * rather than silently trusted.
 */

export interface Td3Result {
  readonly documentType: string;
  readonly issuingCountry: string;
  readonly surname: string;
  readonly givenNames: string;
  readonly passportNumber: string;
  readonly nationality: string;
  /** ISO date (YYYY-MM-DD). */
  readonly dateOfBirth: string;
  readonly sex: string;
  /** ISO date (YYYY-MM-DD). */
  readonly expiryDate: string;
  readonly personalNumber: string;
  /** True when every check digit (incl. the composite) validates. */
  readonly checksValid: boolean;
}

export type MrzError =
  | { readonly code: 'bad_format'; readonly message: string }
  | { readonly code: 'check_failed'; readonly message: string };

const WEIGHTS = [7, 3, 1] as const;

/** MRZ character value: 0–9 → digit, A–Z → 10–35, filler '<' → 0. */
function charValue(ch: string): number {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
  return 0; // '<'
}

/** Compute the ICAO 7-3-1 weighted check digit for a field. */
export function checkDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const weight = WEIGHTS[i % 3];
    if (weight === undefined) continue;
    sum += charValue(field.charAt(i)) * weight;
  }
  return sum % 10;
}

function digitAt(line: string, index: number): number {
  const ch = line.charAt(index);
  return ch === '<' ? -1 : Number.parseInt(ch, 10);
}

/** Expand a filler-padded name field ("SMITH<<JOHN<<") into parts. */
function parseNames(field: string): { surname: string; givenNames: string } {
  const [surnameRaw = '', givenRaw = ''] = field.split('<<');
  const clean = (s: string) => s.replace(/</g, ' ').trim();
  return { surname: clean(surnameRaw), givenNames: clean(givenRaw) };
}

/** YYMMDD → ISO date. `pivot` splits the 2-digit year across centuries. */
function toIsoDate(yymmdd: string, pivot: number): string {
  const yy = Number.parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const century = yy <= pivot ? 2000 : 1900;
  return `${century + yy}-${mm}-${dd}`;
}

/**
 * Parse a TD3 MRZ (2×44). Whitespace between/around lines is tolerated; a
 * single 88-char string is also accepted.
 */
export function parseTd3(input: string | readonly [string, string]): Result<Td3Result, MrzError> {
  let l1: string;
  let l2: string;
  if (typeof input === 'string') {
    const lines = input
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (lines.length === 2) {
      [l1, l2] = [lines[0] ?? '', lines[1] ?? ''];
    } else {
      const joined = input.replace(/\s+/g, '');
      if (joined.length !== 88) {
        return err({ code: 'bad_format', message: 'TD3 requires two 44-character lines' });
      }
      l1 = joined.slice(0, 44);
      l2 = joined.slice(44);
    }
  } else {
    [l1, l2] = [input[0].trim(), input[1].trim()];
  }
  if (l1.length !== 44 || l2.length !== 44) {
    return err({ code: 'bad_format', message: 'each MRZ line must be 44 characters' });
  }

  const documentType = l1.slice(0, 2).replace(/</g, '').trim();
  const issuingCountry = l1.slice(2, 5).replace(/</g, '');
  const { surname, givenNames } = parseNames(l1.slice(5, 44));

  const passportNumber = l2.slice(0, 9).replace(/</g, '');
  const passportCheck = digitAt(l2, 9);
  const nationality = l2.slice(10, 13).replace(/</g, '');
  const dob = l2.slice(13, 19);
  const dobCheck = digitAt(l2, 19);
  const sex = l2.slice(20, 21).replace(/</g, '');
  const expiry = l2.slice(21, 27);
  const expiryCheck = digitAt(l2, 27);
  const personalNumber = l2.slice(28, 42).replace(/</g, '');
  const personalCheck = digitAt(l2, 42);
  const compositeCheck = digitAt(l2, 43);

  for (const [value, pivot] of [
    [dob, 40],
    [expiry, 80],
  ] as const) {
    if (!/^\d{6}$/.test(value))
      return err({ code: 'bad_format', message: 'MRZ dates must contain six digits' });
    const iso = toIsoDate(value, pivot);
    const date = new Date(`${iso}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso)
      return err({ code: 'bad_format', message: 'MRZ contains an invalid calendar date' });
  }

  const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
  const checksValid =
    checkDigit(l2.slice(0, 9)) === passportCheck &&
    checkDigit(dob) === dobCheck &&
    checkDigit(expiry) === expiryCheck &&
    // Personal-number check is '<' (→ -1 here) when the field is all filler.
    (personalCheck === -1 ? true : checkDigit(l2.slice(28, 42)) === personalCheck) &&
    checkDigit(composite) === compositeCheck;

  if (!checksValid) {
    return err({ code: 'check_failed', message: 'one or more MRZ check digits did not validate' });
  }

  return ok({
    documentType,
    issuingCountry,
    surname,
    givenNames,
    passportNumber,
    nationality,
    dateOfBirth: toIsoDate(dob, 40),
    sex,
    expiryDate: toIsoDate(expiry, 80),
    personalNumber,
    checksValid,
  });
}
