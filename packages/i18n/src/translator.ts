import { CATALOGS, DEFAULT_LOCALE, LOCALES, type Locale, type MessageKey } from './messages';

/** Interpolation parameters for a message (`{token}` → value). */
export type MessageParams = Readonly<Record<string, string | number>>;

export type Translator = (key: MessageKey, params?: MessageParams) => string;

/** Replace `{token}` placeholders; unknown tokens are left intact. */
function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, token: string) => {
    const value = params[token];
    return value === undefined ? whole : String(value);
  });
}

/** Narrow an arbitrary string to a supported `Locale`, defaulting otherwise. */
export function resolveLocale(input: string | undefined): Locale {
  return LOCALES.includes(input as Locale) ? (input as Locale) : DEFAULT_LOCALE;
}

/**
 * Build a translator for a locale. Missing translations fall back to the
 * canonical English message, so the UI never shows a raw key.
 */
export function createTranslator(locale: Locale): Translator {
  return (key, params) => {
    const template = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
    return interpolate(template, params);
  };
}
