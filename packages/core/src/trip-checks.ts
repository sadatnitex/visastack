/**
 * Trip date checks: what the dates of a case say about the rest of the file.
 *
 * Pure and country-free on purpose. It only compares facts the person already holds (the case's
 * own dates, the passport expiry, a travel insurance policy) and says in plain words whether they
 * line up. It never states what a particular country requires: the six-month passport figure is a
 * common ask worth a look, worded as a prompt to check the destination's own rule. A rule with a
 * source for a country belongs in that country's pack, not here.
 *
 * Every date is compared as a calendar day in UTC, so a trip that ends on the day a passport
 * expires, or a stored time of day, never moves a result by one day.
 */

export type TripCheckLevel = 'problem' | 'check' | 'unknown' | 'ok';

export type TripCheckKey =
  | 'trip_dates'
  | 'trip_start_passed'
  | 'target_date'
  | 'passport_validity'
  | 'insurance_cover';

export interface TripCheck {
  readonly key: TripCheckKey;
  readonly level: TripCheckLevel;
  readonly title: string;
  readonly detail: string;
}

export interface TripInsurancePolicy {
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
}

export interface TripCheckInput {
  readonly now: Date;
  readonly travelStart: Date | null;
  readonly travelEnd: Date | null;
  /** The date the person wants the case finished by. */
  readonly targetDeadline: Date | null;
  /** The passport expiry on the profile, or null when none is recorded. */
  readonly passportExpiry: Date | null;
  /** One entry per travel insurance record on the profile; empty when there is none. */
  readonly insurancePolicies: readonly TripInsurancePolicy[];
}

/** Once a case is handed in, closed or cancelled, the dates can no longer be acted on. */
export const TRIP_CHECKS_FINISHED_STATES: readonly string[] = ['SUBMITTED', 'CLOSED', 'CANCELLED'];

/** Whether the trip date checks are worth showing for a case in this state. */
export function tripChecksApply(state: string): boolean {
  return !TRIP_CHECKS_FINISHED_STATES.includes(state);
}

/** Months of passport validity after a trip that many destinations ask for. A prompt, not a rule. */
export const PASSPORT_COMMON_MONTHS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day of a moment in UTC, as a number of days. */
function utcDay(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS,
  );
}

function addMonthsUtcDay(date: Date, months: number): number {
  const shifted = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()),
  );
  // 31 August plus six months is 28 February, not 3 March.
  if (shifted.getUTCDate() !== date.getUTCDate()) shifted.setUTCDate(0);
  return utcDay(shifted);
}

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function say(date: Date): string {
  return FORMAT.format(date);
}

const LEVEL_ORDER: Readonly<Record<TripCheckLevel, number>> = {
  problem: 0,
  check: 1,
  unknown: 2,
  ok: 3,
};

function datesCheck(input: TripCheckInput): TripCheck | null {
  const { travelStart, travelEnd } = input;
  if (travelStart && travelEnd && utcDay(travelEnd) < utcDay(travelStart)) {
    return {
      key: 'trip_dates',
      level: 'problem',
      title: 'Your trip ends before it starts',
      detail: `The trip is set to start on ${say(travelStart)} and end on ${say(travelEnd)}. Correct the dates under Edit Case Details.`,
    };
  }
  return null;
}

function startPassedCheck(input: TripCheckInput): TripCheck | null {
  const { travelStart, now } = input;
  if (travelStart && utcDay(travelStart) < utcDay(now)) {
    return {
      key: 'trip_start_passed',
      level: 'check',
      title: 'Your trip start date has passed',
      detail: `The trip was set to start on ${say(travelStart)}. Update the dates under Edit Case Details if your plans have changed.`,
    };
  }
  return null;
}

function targetCheck(input: TripCheckInput): TripCheck | null {
  const { travelStart, targetDeadline } = input;
  if (travelStart && targetDeadline && utcDay(targetDeadline) > utcDay(travelStart)) {
    return {
      key: 'target_date',
      level: 'check',
      title: 'Your target date is after your trip starts',
      detail: `You want this case finished by ${say(targetDeadline)}, but the trip starts on ${say(travelStart)}. Visa decisions can take weeks, so allow time before you travel.`,
    };
  }
  return null;
}

function passportCheck(input: TripCheckInput): TripCheck | null {
  const { travelStart, travelEnd, passportExpiry, now } = input;
  const basis = travelEnd ?? travelStart;
  if (!basis) return null;
  const verb = travelEnd ? 'ends' : 'starts';
  const when = `your trip ${verb}`;
  if (!passportExpiry) {
    return {
      key: 'passport_validity',
      level: 'unknown',
      title: 'Add your passport expiry date',
      detail: `Add it to your profile and we can check it against the day ${when}.`,
    };
  }
  const expiry = utcDay(passportExpiry);
  if (expiry < utcDay(now)) {
    return {
      key: 'passport_validity',
      level: 'problem',
      title: 'Your passport has expired',
      detail: `It expired on ${say(passportExpiry)}. Renew it before you apply.`,
    };
  }
  if (expiry < utcDay(basis)) {
    return {
      key: 'passport_validity',
      level: 'problem',
      title: `Your passport expires before your trip ${verb}`,
      detail: `It expires on ${say(passportExpiry)}, before ${say(basis)}. Renew it before you apply.`,
    };
  }
  if (expiry < addMonthsUtcDay(basis, PASSPORT_COMMON_MONTHS)) {
    const days = expiry - utcDay(basis);
    return {
      key: 'passport_validity',
      level: 'check',
      title: `Your passport has less than six months left after your trip ${verb}`,
      detail: `It expires on ${say(passportExpiry)}, ${days} ${days === 1 ? 'day' : 'days'} after ${when}. Many countries ask for at least six months, so check the rule for your destination.`,
    };
  }
  return {
    key: 'passport_validity',
    level: 'ok',
    title: `Your passport is valid for at least six months after your trip ${verb}`,
    detail: `It expires on ${say(passportExpiry)}. Some countries ask for more, so still check your destination's rule.`,
  };
}

function insuranceCheck(input: TripCheckInput): TripCheck | null {
  const { travelStart, travelEnd, insurancePolicies } = input;
  if (!travelStart || !travelEnd || insurancePolicies.length === 0) return null;
  const dated = insurancePolicies.filter(
    (policy): policy is { validFrom: Date; validUntil: Date } =>
      policy.validFrom !== null && policy.validUntil !== null,
  );
  if (dated.length === 0) {
    return {
      key: 'insurance_cover',
      level: 'unknown',
      title: 'Add the dates of your travel insurance',
      detail: 'Add when the policy starts and ends, and we can check it covers your whole trip.',
    };
  }
  const start = utcDay(travelStart);
  const end = utcDay(travelEnd);
  const covering = dated.find(
    (policy) => utcDay(policy.validFrom) <= start && utcDay(policy.validUntil) >= end,
  );
  if (covering) {
    return {
      key: 'insurance_cover',
      level: 'ok',
      title: 'Your travel insurance covers your whole trip',
      detail: `The policy runs from ${say(covering.validFrom)} to ${say(covering.validUntil)}.`,
    };
  }
  const nearest = [...dated].sort(
    (a, b) => Math.abs(utcDay(a.validUntil) - end) - Math.abs(utcDay(b.validUntil) - end),
  )[0];
  return {
    key: 'insurance_cover',
    level: 'check',
    title: 'Your travel insurance does not cover your whole trip',
    detail: nearest
      ? `The closest policy runs from ${say(nearest.validFrom)} to ${say(nearest.validUntil)}. Your trip is ${say(travelStart)} to ${say(travelEnd)}. We check each policy on its own, so one policy should cover every day.`
      : 'No policy covers every day of the trip.',
  };
}

/**
 * The checks that apply to a case, most urgent first. Nothing is returned for a case with no travel
 * dates and nothing else to compare: the screen then asks for the dates instead.
 */
export function evaluateTripChecks(input: TripCheckInput): readonly TripCheck[] {
  const checks = [
    datesCheck(input),
    startPassedCheck(input),
    targetCheck(input),
    passportCheck(input),
    insuranceCheck(input),
  ].filter((check): check is TripCheck => check !== null);
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => LEVEL_ORDER[a.check.level] - LEVEL_ORDER[b.check.level] || a.index - b.index)
    .map(({ check }) => check);
}

/** How many checks need the person to do something: a problem or a look. */
export function tripChecksNeedingAction(checks: readonly TripCheck[]): number {
  return checks.filter((check) => check.level === 'problem' || check.level === 'check').length;
}
