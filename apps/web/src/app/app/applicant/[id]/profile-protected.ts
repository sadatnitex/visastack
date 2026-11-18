/**
 * ESS1: which profile details are protected on the profile page. One rule, in one place, read by
 * the server (which leaves such a value out of the page) and by the editor and the Passport Page
 * Card (which mask it until Show). No 'use client' or 'use server' here, so both sides can call it.
 *
 * Protected: a detail the catalogue marks SENSITIVE or RESTRICTED (stored encrypted since WALD2),
 * plus Date of Birth and Passport Number whatever the catalogue says, the two details a stranger
 * most often misuses.
 */

/** Always protected, whatever the catalogue says. */
export const ALWAYS_PROTECTED_KEYS: ReadonlySet<string> = new Set([
  'date_of_birth',
  'passport_number',
]);

/** Whether a detail's value is protected: masked until Show, and left out of the page. */
export function isProtectedDetail(key: string, sensitivity: string | undefined): boolean {
  return (
    ALWAYS_PROTECTED_KEYS.has(key) || (sensitivity !== undefined && sensitivity !== 'STANDARD')
  );
}
