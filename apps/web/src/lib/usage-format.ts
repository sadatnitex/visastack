import type { UsageMeter } from '@visastack/services';
import { mbLabel } from '@visastack/services';

/** Correctly converts an integer count of a currency's smallest unit to a display string, without assuming 2 decimal places (JPY has 0, BHD has 3). */
export function formatPrice(priceMinorUnits: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  // `maximumFractionDigits` is typed optional (it's unset when significant-digit
  // rounding is used instead), but 'currency' style always resolves it in
  // practice; 2 is the correct fallback for the common case if it's ever absent.
  const divisor = 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2);
  return formatter.format(priceMinorUnits / divisor);
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
