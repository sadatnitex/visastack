/**
 * How a picture is named for screen readers. A picture that stands alone and carries meaning gets
 * its plain name; a picture placed right beside its word is decoration and is hidden, so the word
 * is not read twice.
 */
export function pictureNaming(
  label: string | undefined,
): { readonly role: 'img'; readonly 'aria-label': string } | { readonly 'aria-hidden': 'true' } {
  const name = label?.trim();
  return name ? { role: 'img', 'aria-label': name } : { 'aria-hidden': 'true' };
}
