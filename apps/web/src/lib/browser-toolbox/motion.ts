/**
 * The person's motion setting, read where it is used (feature detection, never a device guess).
 * A browser that cannot say counts as "motion allowed", but every toolbox item also needs its own
 * capability, so nothing here makes a feature appear by itself.
 */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}
