/**
 * How a count is written on a small badge: the number itself up to the cap, then the cap with a
 * plus ("99+"). One rule for the bell and the phone tabs.
 */
export function countLabel(count: number, cap: number): string {
  const whole = Math.floor(count);
  return whole > cap ? `${cap}+` : String(whole);
}
