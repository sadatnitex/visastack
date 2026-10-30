/**
 * Money as people read and type it (S30). Amounts are kept as whole minor units (2500.00 BDT is
 * 250000); this module turns them into text and back for one currency at a time.
 *
 * - The number of decimal places comes from the currency itself (2 for BDT, 0 for JPY, 3 for BHD),
 *   from the platform's own currency data.
 * - Everything works on the digits as text, never through floating point, so no amount is ever
 *   rounded or nudged by a binary fraction.
 * - Formatting never throws: a currency code that is not a real ISO 4217 code is written after the
 *   amount with two places ("2,500.00 XYZ"), so a bad code can never break a page or a document.
 *
 * Pure and framework-free: safe to import in the browser.
 */

/** Three capital letters, the shape of an ISO 4217 code. */
const CODE_SHAPE = /^[A-Z]{3}$/;

let knownCodes: ReadonlySet<string> | null = null;

function supportedCodes(): ReadonlySet<string> {
  if (knownCodes) return knownCodes;
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    knownCodes = new Set(intl.supportedValuesOf ? intl.supportedValuesOf('currency') : []);
  } catch {
    knownCodes = new Set();
  }
  return knownCodes;
}

/** A currency code as stored: trimmed and in capitals. */
export function normalizeCurrencyCode(currency: string): string {
  return currency.trim().toUpperCase();
}

/**
 * Whether `currency` is a real ISO 4217 currency code ("BDT", "USD"), after trimming and
 * capitalising. Shape alone is not enough: "XYZ" has the shape and is not a currency.
 */
export function isIsoCurrencyCode(currency: string): boolean {
  const code = normalizeCurrencyCode(currency);
  if (!CODE_SHAPE.test(code)) return false;
  const known = supportedCodes();
  // A runtime without the currency list still accepts the shape rather than refusing everything.
  return known.size === 0 ? true : known.has(code);
}

/**
 * How many decimal places a currency has (2 for BDT, 0 for JPY, 3 for BHD). An unknown or
 * malformed code is treated as two places, the common case.
 */
export function currencyDecimals(currency: string): number {
  const code = normalizeCurrencyCode(currency);
  if (!CODE_SHAPE.test(code)) return 2;
  try {
    const digits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === 'number' && digits >= 0 && digits <= 3 ? digits : 2;
  } catch {
    return 2;
  }
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface MoneyNumberOptions {
  /** Thousands separators ("2,500.00"). On by default; off gives text a form field reads back ("2500.00"). */
  readonly grouping?: boolean;
}

/**
 * The amount alone, with the currency's own number of places: "2,500.00" (or "2500.00" with
 * `grouping: false`). A negative amount starts with a minus sign. Never throws; an amount that is
 * not a whole number reads "0.00".
 */
export function formatMoneyNumber(
  minorUnits: number,
  currency: string,
  options: MoneyNumberOptions = {},
): string {
  return numberText(minorUnits, currencyDecimals(currency), options.grouping !== false);
}

function numberText(minorUnits: number, decimals: number, grouping: boolean): string {
  const value = Number.isSafeInteger(minorUnits) ? minorUnits : 0;
  const digits = String(Math.abs(value)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : '';
  return `${value < 0 ? '-' : ''}${grouping ? groupThousands(whole) : whole}${fraction}`;
}

/**
 * An amount for a screen, a sentence or a document: "BDT 2,500.00", "JPY 1,250", "BHD 1.234".
 * The code and the number are joined by a no-break space, so a line never ends between them.
 * Never throws. A code that is not a real currency is written after the amount, with two places,
 * so it cannot be mistaken for a checked one: "2,500.00 XYZ".
 */
export function formatMoney(minorUnits: number, currency: string): string {
  const code = normalizeCurrencyCode(currency);
  if (!isIsoCurrencyCode(code)) {
    const shown = code.length > 0 && code.length <= 8 ? code : 'unknown currency';
    return `${numberText(minorUnits, 2, true)}\u00a0${shown}`;
  }
  return `${code}\u00a0${formatMoneyNumber(minorUnits, code)}`;
}

/** Plain digits, optionally grouped in threes with commas, then optional decimals. */
const TYPED_AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

/**
 * Whole minor units from an amount a person typed in the currency's own form: "2,500.00",
 * "2500", "2,500". Null for anything else: signs, exponents, misplaced commas ("25,00"), more
 * decimal places than the currency has (trailing zeros are fine), an empty field, or more than
 * `max` (by default the largest safe whole number). Exact: the digits are joined as text, never
 * multiplied as floating point.
 */
export function parseMoney(
  text: string,
  currency: string,
  max: number = Number.MAX_SAFE_INTEGER,
): number | null {
  return parseWithDecimals(text, currencyDecimals(currency), max);
}

/** The most decimal places any currency has (BHD, JOD, KWD, OMR, TND). */
export const MAX_CURRENCY_DECIMALS = 3;

/**
 * Whether typed text could be an amount above zero in some currency: digits, separators in the
 * right places, at most three decimal places. A cheap check a form can make before any work; the
 * exact check against the stored currency's own decimal places stays in the service (S30).
 */
export function looksLikeMoney(text: string): boolean {
  const value = parseWithDecimals(text, MAX_CURRENCY_DECIMALS, Number.MAX_SAFE_INTEGER);
  return value !== null && value > 0;
}

function parseWithDecimals(text: string, decimals: number, max: number): number | null {
  const match = text.trim().match(TYPED_AMOUNT);
  if (!match) return null;
  const whole = (match[1] ?? '').replace(/,/g, '');
  const fraction = match[2] ?? '';
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) return null;
  if (whole.length > 15) return null;
  const value = Number(`${whole}${fraction.slice(0, decimals).padEnd(decimals, '0')}`);
  if (!Number.isSafeInteger(value) || value > max) return null;
  return value;
}
