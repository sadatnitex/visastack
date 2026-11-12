import { type Catalog, catalogResolve } from './catalog';
import type { MessageParams } from './icu';
import type { Locale } from './messages';

/**
 * A message that has not been worded yet: which sentence, and the values to put in it. Code far
 * from the screen (a service, a rule in core) hands one of these up, and the screen words it in
 * the visitor's language. Numbers travel raw so the screen formats them by the language it shows.
 */
export interface MessageDescriptor<K extends string = string> {
  readonly key: K;
  readonly params?: MessageParams;
}

/** Builds a descriptor; with no values the `params` property is left off. */
export function messageDescriptor<K extends string>(
  key: K,
  params?: MessageParams,
): MessageDescriptor<K> {
  return params === undefined ? { key } : { key, params };
}

/** Words a descriptor from a catalogue in the given language (English fallback, then the key). */
export function renderDescriptor<K extends string>(
  catalog: Catalog<K>,
  locale: Locale,
  descriptor: MessageDescriptor<K>,
): string {
  return catalogResolve(catalog, locale, descriptor.key, descriptor.params).text;
}
