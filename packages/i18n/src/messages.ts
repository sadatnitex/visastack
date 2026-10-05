/**
 * The bilingual message catalog (Build Spec section 9; PRD section 6: English
 * and Bangla), assembled from one catalog per flow.
 *
 * English is canonical: each catalog's English keys define the `MessageKey`
 * union, and its Bangla object must have exactly those keys (`defineCatalog`
 * enforces it at compile time). A key can appear in only one catalog; loading
 * this module fails loudly on a duplicate. Messages support `{token}`
 * interpolation. Keep them UI-agnostic: any surface (web, email, docs) can use
 * them.
 */

import type { Catalog } from './catalog';
import { account } from './catalogs/account';
import { alerts } from './catalogs/alerts';
import { consent } from './catalogs/consent';
import { errors } from './catalogs/errors';
import { privacy } from './catalogs/privacy';
import { readiness } from './catalogs/readiness';
import { sharing } from './catalogs/sharing';
import { shell } from './catalogs/shell';
import { upload } from './catalogs/upload';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './locales';

export { DEFAULT_LOCALE, LOCALES, type Locale };

/** Every flow's catalog, in the order they are documented. */
export const CATALOG_LIST = [
  shell,
  errors,
  consent,
  account,
  alerts,
  privacy,
  readiness,
  upload,
  sharing,
] as const;

export type CatalogId = (typeof CATALOG_LIST)[number]['meta']['id'];

type KeysOf<C> = C extends Catalog<string, infer K> ? K : never;

/** Every message key in the product. A key that is not here is a compile error at the call site. */
export type MessageKey = KeysOf<(typeof CATALOG_LIST)[number]>;

function merge(locale: Locale): Readonly<Record<MessageKey, string>> {
  const merged: Record<string, string> = {};
  for (const catalog of CATALOG_LIST) {
    const messages: Readonly<Record<string, string>> = catalog[locale];
    for (const [key, text] of Object.entries(messages)) {
      if (key in merged) {
        throw new Error(
          `Message key "${key}" is declared twice (second time in "${catalog.meta.id}")`,
        );
      }
      merged[key] = text;
    }
  }
  return merged as Record<MessageKey, string>;
}

/** Canonical English catalog. */
export const EN = merge('en');

/** Bangla catalog. Complete by construction: every English key has a Bangla message. */
export const BN = merge('bn');

export const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  en: EN,
  bn: BN,
};

/** Whether a string read from storage still names a message (a stored key can outlive the message it named). */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(EN, key);
}

/** The catalog a key belongs to, so a screen can say which review its text needs. */
export function catalogOf(key: MessageKey): CatalogId {
  for (const catalog of CATALOG_LIST) {
    if (key in catalog.en) return catalog.meta.id;
  }
  throw new Error(`Unknown message key "${key}"`);
}
