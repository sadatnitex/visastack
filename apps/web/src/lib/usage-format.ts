import { currencyDecimals, formatMoney, isIsoCurrencyCode } from '@visastack/core';
import type { UsageMeter } from '@visastack/services';
import { mbLabel } from '@visastack/services';

/**
 * An amount with the currency's own symbol where the platform has one ("$100.00", "BDT 2,500.00"),
 * for visa fees on the rules pages. Billing screens use `formatMoney` (@visastack/core), which
 * always writes the code. Never throws: an unknown or malformed code falls back to `formatMoney`
 * ("2,500.00 XYZ"), so a bad code can never break a page (S30).
 */
export function formatPrice(priceMinorUnits: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!isIsoCurrencyCode(code)) return formatMoney(priceMinorUnits, code);
  try {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
    const decimals = currencyDecimals(code);
    return formatter.format(priceMinorUnits / 10 ** decimals);
  } catch {
    return formatMoney(priceMinorUnits, code);
  }
}

export function formatMeterValue(meter: UsageMeter): string {
  const used = meter.key === 'storageBytes' ? mbLabel(meter.used) : `${meter.used}`;
  if (meter.allowed === null) return `${used} used (unlimited)`;
  const allowed = meter.key === 'storageBytes' ? mbLabel(meter.allowed) : `${meter.allowed}`;
  return `${used} of ${allowed} used`;
}

export function meterFraction(meter: UsageMeter): number {
  if (meter.allowed === null || meter.allowed <= 0) return 0;
  return Math.min(1, meter.used / meter.allowed);
}

export function meterTone(meter: UsageMeter): string {
  if (meter.allowed === null) return '';
  if (meter.used >= meter.allowed) return 'meter-full';
  if (meterFraction(meter) >= 0.85) return 'meter-warn';
  return '';
}
