/**
 * A number of days with its unit: "1 day", "14 days". Lives here, not in the services package,
 * because browser-side forms use it too and must not pull in server-only code.
 */
export function dayCount(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}
