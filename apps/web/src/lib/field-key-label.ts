/** "passport_issue_date" reads as "Passport Issue Date" when no plain name is registered. */
export function humanizeFieldKey(key: string): string {
  return key
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
