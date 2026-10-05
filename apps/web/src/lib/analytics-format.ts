/**
 * Presentation helpers for the admin analytics card (Commercial V1 OPS-04).
 * Pure functions, no I/O, so the wording and the arithmetic are unit-tested.
 */

/** `IN_REVIEW` -> `In review`. Labels in the event log are UPPER_SNAKE tokens. */
export function humanizeLabel(token: string): string {
  const words = token.toLowerCase().replace(/_/g, ' ').trim();
  return words.length === 0 ? words : words.charAt(0).toUpperCase() + words.slice(1);
}

/** A span of seconds as at most two units, largest first: `2 d 3 h`, `45 min`, `30 s`. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'n/a';
  const total = Math.round(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return `${minutes} min`;
  return `${total} s`;
}

/**
 * Minor currency units as an amount in that currency. The number of minor units
 * per major unit comes from the currency itself (2 for BDT and USD, 0 for JPY),
 * so an amount is never off by a factor of 100.
 */
export function formatMinorUnits(minorUnits: number, currency: string): string {
  try {
    const formatter = new Intl.NumberFormat('en', { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(minorUnits / 10 ** digits);
  } catch {
    // Not a currency code the runtime knows: show the number and the code as given.
    return `${minorUnits} ${currency} (minor units)`;
  }
}
