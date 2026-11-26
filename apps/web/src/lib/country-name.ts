/**
 * A country's name in the visitor's language. Bengali comes from the platform's own region names
 * (the same standard data the browser uses), keyed by the two-letter code, so it never depends on
 * the English spelling. English is the catalogue's name, unchanged. Anything the platform cannot
 * name stays English and says so.
 */
const names = new Map<string, Intl.DisplayNames>();

export function localizedCountryName(
  iso2: string,
  english: string,
  locale: string,
): { readonly text: string; readonly lang?: 'en' } {
  if (locale !== 'bn') return { text: english };
  let display = names.get('bn');
  if (!display) {
    display = new Intl.DisplayNames(['bn-BD'], { type: 'region' });
    names.set('bn', display);
  }
  try {
    const name = display.of(iso2.toUpperCase());
    // The platform returns the code itself when it has no name; that is not a name.
    if (name && name !== iso2.toUpperCase()) return { text: name };
  } catch {}
  return { text: english, lang: 'en' };
}
