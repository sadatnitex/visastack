import { resolveCaseCountry } from '../case-choices';
import { flagSrc } from '../flag-policy';
import { progressRingPercent, progressRingWords } from '../readiness-words';

/**
 * What a shareable progress card says (WP-PIC15, owner decision D5 of 17 Nov 2026: counts only).
 *
 * Built from the counts alone. The place is shown only as the country's own name from our list,
 * found from the saved destination; the saved text itself is never drawn, so anything a person
 * typed there cannot reach the picture. No traveller name, document name, case title, date or
 * reference code is ever an input, so none can be an output.
 */
export interface ProgressCardModel {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
  /** "8 of 12 items ready": the same words as every progress ring. */
  readonly countLine: string;
  /** A short heading above the count. */
  readonly kicker: string;
  /** The country's own name and its lower-case code, or null when the place names no country. */
  readonly place: {
    readonly name: string;
    readonly iso2: string;
    readonly hasFlag: boolean;
  } | null;
  readonly brand: string;
  /** Readiness is completeness, never a decision. */
  readonly note: string;
}

export const PROGRESS_CARD_KICKER = 'Case Progress';
export const PROGRESS_CARD_FINISHED_KICKER = 'Finished Case';
export const PROGRESS_CARD_BRAND = 'VisaStack';
export const PROGRESS_CARD_NOTE = 'Counts what is gathered, not a visa decision.';

export interface ProgressCardInput {
  readonly satisfiedRequired: number;
  readonly requiredCount: number;
  readonly destination: string | null;
  readonly finished: boolean;
}

/** A whole count that is never negative and never above the total. */
function wholeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function progressCardModel(input: ProgressCardInput): ProgressCardModel {
  const total = wholeCount(input.requiredCount);
  const done = Math.min(wholeCount(input.satisfiedRequired), total);
  const country = resolveCaseCountry(input.destination ?? '');
  const iso2 = country?.iso2.toLowerCase() ?? null;
  return {
    done,
    total,
    percent: progressRingPercent(done, total),
    countLine: progressRingWords(done, total),
    kicker: input.finished ? PROGRESS_CARD_FINISHED_KICKER : PROGRESS_CARD_KICKER,
    place: country && iso2 ? { name: country.name, iso2, hasFlag: flagSrc(iso2) !== null } : null,
    brand: PROGRESS_CARD_BRAND,
    note: PROGRESS_CARD_NOTE,
  };
}

/** Every word the card draws, in order, for tests and for the picture's text alternative. */
export function progressCardWords(model: ProgressCardModel): readonly string[] {
  return [
    model.kicker,
    ...(model.place ? [model.place.name] : []),
    model.countLine,
    `${model.percent}%`,
    model.brand,
    model.note,
  ];
}
