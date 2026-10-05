import { CATALOGS, type Locale, type MessageKey } from '@visastack/i18n';

/**
 * The messages a client component needs, chosen on the server and handed over as
 * a prop. A browser bundle never contains a catalog (a traveller on a slow
 * connection downloads only the words on the screen they open), and a component
 * can only read a key its page really passed: the prop's type names them.
 *
 * Declare the keys next to the component in a plain module (not the
 * `'use client'` file, whose exports a server page cannot read):
 *
 *   export const DELETION_KEYS = ['privacy.deletion.cancel', ...] as const;
 *   export type DeletionMessages = Messages<(typeof DELETION_KEYS)[number]>;
 */
export type Messages<K extends MessageKey> = Readonly<Record<K, string>>;

/** Picks `keys` from the catalog for `locale`, un-interpolated; the client fills `{tokens}` with `fill`. */
export function pickMessages<const K extends readonly MessageKey[]>(
  locale: Locale,
  keys: K,
): Messages<K[number]> {
  const picked: Record<string, string> = {};
  for (const key of keys) picked[key] = CATALOGS[locale][key];
  return picked as Messages<K[number]>;
}
