import { LEGACY_FIELD_SNAPSHOT } from '@visastack/core/catalogue';
import type { Td3Result } from './mrz';
import type { RegisterFieldInput } from './profile';

/**
 * Turns a passport's machine-readable lines (already parsed, with every check digit matching)
 * into suggestions for the existing profile fields (S5, ADR 0019). Pure: no database, no AI.
 * The caller stores them as a zero-cost run (`MRZ_TD3_MODEL_VERSION`) that a person still
 * approves, field by field or as "clear details", exactly like any other suggestion.
 *
 * Only existing field keys are used. A country is suggested as the code the passport prints
 * (for example `BGD`), because no country-name table exists yet; those two readings carry a
 * lower confidence so they are never accepted in bulk and the person looks at the wording.
 */

export interface MrzReading {
  readonly fieldKey: string;
  readonly value: string;
  /** 0-100, the scale `field_proposals.confidence` uses. */
  readonly confidence: number;
  readonly rationale: string;
  /** The machine-readable line the value comes from, word for word as written in the text. */
  readonly quote: string;
}

/** The fields a passport's machine-readable lines can fill. */
export const MRZ_FIELD_KEYS = [
  'family_name',
  'given_name',
  'passport_number',
  'nationality',
  'date_of_birth',
  'sex',
  'passport_expiry',
  'passport_issuing_country',
] as const;

/** The check digits matched, so the reading itself is certain. */
const CERTAIN = 100;
/** A country code rather than a name: shown for a person to look at, never accepted in bulk. */
const CODE_ONLY = 80;

const RATIONALE = "Read from the passport's machine-readable lines. The check digits matched.";
const RATIONALE_CODE =
  "Read from the passport's machine-readable lines. The country is shown as the code the passport prints.";

const SEX_WORDS: Readonly<Record<string, string>> = { M: 'Male', F: 'Female' };

/**
 * Two-digit years in the machine-readable lines are ambiguous. The reader treats a birth year up to
 * 40 as 20xx, which would put an older traveller's birth in the future; a birth date can never be
 * later than today, so it goes back a century.
 */
function birthDate(isoDate: string, now: Date): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (parsed.getTime() <= now.getTime()) return isoDate;
  return `${Number.parseInt(isoDate.slice(0, 4), 10) - 100}${isoDate.slice(4)}`;
}

/**
 * The readings for one passport. `quoted` is the pair of lines as written in the document text, so
 * each reading can cite a line that really appears there. A value the lines leave blank is skipped,
 * and so is a sex mark other than M or F: nothing is guessed.
 */
export function mrzFieldReadings(
  mrz: Td3Result,
  quoted: readonly [string, string],
  now: Date = new Date(),
): MrzReading[] {
  const [nameLine, numberLine] = quoted;
  const readings: MrzReading[] = [];
  const add = (
    fieldKey: (typeof MRZ_FIELD_KEYS)[number],
    value: string,
    quote: string,
    confidence = CERTAIN,
  ): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    readings.push({
      fieldKey,
      value: trimmed,
      confidence,
      rationale: confidence === CERTAIN ? RATIONALE : RATIONALE_CODE,
      quote,
    });
  };
  add('family_name', mrz.surname, nameLine);
  add('given_name', mrz.givenNames, nameLine);
  add('passport_number', mrz.passportNumber, numberLine);
  add('nationality', mrz.nationality, numberLine, CODE_ONLY);
  add('date_of_birth', birthDate(mrz.dateOfBirth, now), numberLine);
  const sex = SEX_WORDS[mrz.sex];
  if (sex) add('sex', sex, numberLine);
  add('passport_expiry', mrz.expiryDate, numberLine);
  add('passport_issuing_country', mrz.issuingCountry, nameLine, CODE_ONLY);
  return readings;
}

/** The registry shape of each field a passport reading can fill, taken from the live field list. */
export function mrzFieldDefinitions(): RegisterFieldInput[] {
  return MRZ_FIELD_KEYS.flatMap((key) => {
    const field = LEGACY_FIELD_SNAPSHOT.find((candidate) => candidate.key === key);
    if (!field) return [];
    return [
      {
        key: field.key,
        dataType: field.type === 'date' ? ('date' as const) : ('string' as const),
        sensitivity: field.sensitivity,
        repeating: field.group !== undefined,
        packId: field.pack,
      },
    ];
  });
}
