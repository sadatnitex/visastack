const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "4 Nov 2026 at 14:05 UTC": one fixed zone and fixed month names, so the same moment reads the
 * same words in the app, in an email and in a test, whatever the machine's language data says.
 * Lives here, not in the services package, because browser-side lists use it too.
 */
export function formatUtcMoment(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const month = MONTHS[at.getUTCMonth()] ?? '';
  return `${at.getUTCDate()} ${month} ${at.getUTCFullYear()} at ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`;
}
