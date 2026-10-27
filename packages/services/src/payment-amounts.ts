import { MAX_MINOR_UNITS } from './invoice-ledger';

/**
 * Exact money text for payment gateways (Small Commercial V1 S11, ADR 0020). A gateway speaks
 * decimal text ("1250.50"); VisaStack keeps whole minor units (125050). Both directions work on
 * the digits themselves, never through floating point, so no amount is ever rounded, nudged by a
 * binary fraction or read from an exponent form.
 *
 * Every currency VisaStack bills online today (BDT) has two decimal places.
 */

const DECIMAL_TEXT = /^([0-9]{1,12})(?:\.([0-9]{1,8}))?$/;

/**
 * Whole minor units from a decimal amount text, or null when the text is not a plain, non-negative
 * decimal with at most two significant decimal places ("100", "100.5", "100.50" and "100.5000" are
 * accepted; "100.505", "1e3", "-5", ".5", "1,000.00", "" and anything above what the amount
 * columns hold are not). Extra trailing zeros are accepted because gateways pad them.
 */
export function parseDecimalToMinorUnits(text: string): number | null {
  const match = text.trim().match(DECIMAL_TEXT);
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  const minorDigits = fraction.slice(0, 2).padEnd(2, '0');
  if (/[1-9]/.test(fraction.slice(2))) return null;
  const value = Number(whole) * 100 + Number(minorDigits);
  if (!Number.isSafeInteger(value) || value > MAX_MINOR_UNITS) return null;
  return value;
}

/** Decimal amount text ("1250.50") from whole minor units; throws on anything that is not a non-negative whole number. */
export function formatMinorUnits(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new Error('an amount must be a non-negative whole number of minor units');
  }
  const whole = Math.floor(minorUnits / 100);
  const fraction = String(minorUnits % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}
