/**
 * A label reduced to lower-case letters and digits separated by single spaces, so two ways of
 * writing the same name ("Côte d'Ivoire", "cote-d-ivoire"; "family_or_friends_visit", "Family or
 * Friends Visit") compare equal. Used to match a case's country and purpose to a checklist.
 */
export function packMatchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
