import type {
  TravellerHealthSignal,
  TravellerHealthThresholds,
  TravellerSignalStatus,
} from '@visastack/services';
import type { FormResult } from '../../../../../../components/form-feedback';
import type { Tone } from '../../../../../../components/ui';

/** The four boxes of the Alert Thresholds form, by the name each is sent under. */
export const THRESHOLD_FIELDS = [
  'checkoutSuccessMinPercent',
  'confirmationMaxMinutes',
  'stuckConfirmingMax',
  'needsCheckMax',
] as const satisfies readonly (keyof TravellerHealthThresholds)[];

export type ThresholdField = (typeof THRESHOLD_FIELDS)[number];

/** The values as typed, sent back with every reply so the form never loses them. */
export type ThresholdsValues = Readonly<Record<ThresholdField, string>>;

/** What saving the alert thresholds answers. */
export interface ThresholdsState extends FormResult {
  readonly values?: ThresholdsValues;
}

/** Which box a threshold problem (the service's words) is about, so the form can point at it. */
export function thresholdProblemField(
  message: string,
  input: TravellerHealthThresholds,
): ThresholdField {
  if (message.startsWith('Checkout success')) return 'checkoutSuccessMinPercent';
  if (message.startsWith('Time to confirm')) return 'confirmationMaxMinutes';
  const fine = (n: number) => Number.isInteger(n) && n >= 0 && n <= 1000;
  return fine(input.stuckConfirmingMax) ? 'needsCheckMax' : 'stuckConfirmingMax';
}

/** The plain name of each health signal. */
export const SIGNAL_NAMES: Readonly<Record<TravellerHealthSignal['key'], string>> = {
  checkout_success: 'Checkout Success',
  confirmation_time: 'Time to Confirm',
  stuck_confirming: 'Stuck Confirming',
  needs_check: 'Needs a Check',
};

/** What each signal counts, in one line. */
export const SIGNAL_MEANINGS: Readonly<Record<TravellerHealthSignal['key'], string>> = {
  checkout_success: 'Of the traveller checkouts finished in the last day, the share that was paid.',
  confirmation_time:
    'How long a payment takes from the payment page to confirmed, for half of the payments in the last 7 days.',
  stuck_confirming: 'Payments still confirming with the payment gateway after 30 minutes.',
  needs_check: 'Traveller payments held for a check.',
};

/** Each status in words, so it never rests on colour alone. */
export const SIGNAL_STATUS_LABELS: Readonly<Record<TravellerSignalStatus, string>> = {
  ok: 'OK',
  attention: 'Needs Attention',
  no_data: 'No Data Yet',
};

export const SIGNAL_STATUS_TONES: Readonly<Record<TravellerSignalStatus, Tone>> = {
  ok: 'success',
  attention: 'warning',
  no_data: 'neutral',
};

/** "1 minute", "15 minutes". */
export function minutes(count: number): string {
  return count === 1 ? '1 minute' : `${count} minutes`;
}

/** "1 payment", "3 payments". */
export function payments(count: number): string {
  return count === 1 ? '1 payment' : `${count} payments`;
}

/** A signal's measured value with its unit, or that there is nothing to measure yet. */
export function signalValue(signal: TravellerHealthSignal): string {
  if (signal.value === null) return 'Nothing to measure yet';
  if (signal.key === 'checkout_success') return `${signal.value}%`;
  if (signal.key === 'confirmation_time') return minutes(signal.value);
  return payments(signal.value);
}

/** When a signal needs attention, against its threshold. */
export function signalThreshold(signal: TravellerHealthSignal): string {
  if (signal.key === 'checkout_success') return `Below ${signal.threshold}%`;
  if (signal.key === 'confirmation_time') return `Over ${minutes(signal.threshold)}`;
  return `More than ${payments(signal.threshold)}`;
}

/** A rate from 0 to 1 as a whole percentage, or that there is not enough to work it out. */
export function rateWords(rate: number | null): string {
  return rate === null ? 'Not enough data yet' : `${Math.round(rate * 100)}%`;
}

/** The one sentence about test payments, which are never in the other numbers. */
export function testPaymentsSentence(count: number, days: number): string {
  const counted = count === 0 ? 'none' : count === 1 ? '1 payment' : `${count} payments`;
  return `Test payments are counted apart and left out of Payments, Renewals Paid, Refunds and the rates: ${counted} in the last ${days} days. Views, Get taps and the other counts include tests.`;
}
