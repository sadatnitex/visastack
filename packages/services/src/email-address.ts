/**
 * One email address check for every invitation path. Domain labels exclude
 * dots, so no two parts of the pattern can match the same characters and
 * checking is linear in the length: hostile input cannot make it slow. The
 * length cap (the standard's 254) is checked first.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
export const MAX_EMAIL_LENGTH = 254;

export function isEmailAddress(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}
