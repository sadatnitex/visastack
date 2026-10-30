/**
 * The one reading of an on/off setting (S29, audit S6): on only for the word "true", ignoring
 * spaces around it and letter case. Every launch switch reads its value through this, so
 * " true" in a hosting dashboard means the same everywhere and nothing else switches anything on.
 *
 * Pure and framework-free: safe to import in the browser.
 */
export function switchOn(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}
