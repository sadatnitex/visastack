/**
 * How a flow's messages are declared. A catalog is one flow's English text and
 * its Bangla text side by side, and the type of `defineCatalog` refuses a Bangla
 * object that is missing a key or has an extra one. There is no "partial"
 * Bangla: a gap is a build error, not a silent fall back to English in front of
 * a traveller.
 *
 * Each catalog also states what kind of professional review its Bangla needs
 * before public launch (directive Part 9 section 4: "if professional
 * legal/privacy translation review is required, mark it explicitly"). The
 * status of those reviews is in `review.ts`.
 */

/** The kinds of professional scrutiny a catalog's Bangla can need beyond ordinary proofreading. */
export type ReviewArea = 'CONSENT' | 'PRIVACY' | 'LEGAL' | 'SECURITY';

export interface CatalogMeta<Id extends string = string> {
  /** Stable name, also the unit of review sign-off. */
  readonly id: Id;
  /** What a professional reviewer must check. Empty means ordinary copy: a native-speaker proofread is advised but nothing legal turns on the wording. */
  readonly review: readonly ReviewArea[];
}

export interface Catalog<Id extends string = string, Key extends string = string> {
  readonly meta: CatalogMeta<Id>;
  readonly en: Readonly<Record<Key, string>>;
  readonly bn: Readonly<Record<Key, string>>;
}

/**
 * Declare one flow's messages. `bn` must have exactly the keys of `en`.
 *
 * Plural pairs use the suffixes `.one` and `.other` on the same base key
 * (`x.applicants.one`, `x.applicants.other`); `translator.ts` picks between them.
 */
export function defineCatalog<
  const Id extends string,
  const En extends Readonly<Record<string, string>>,
>(
  meta: CatalogMeta<Id>,
  en: En,
  bn: { readonly [K in keyof En]: string },
): Catalog<Id, keyof En & string> {
  return { meta, en, bn } as Catalog<Id, keyof En & string>;
}

/** Every `{token}` a message uses, in order of first appearance. */
export function tokensOf(message: string): string[] {
  const found: string[] = [];
  for (const match of message.matchAll(/\{(\w+)\}/g)) {
    const token = match[1];
    if (token !== undefined && !found.includes(token)) found.push(token);
  }
  return found;
}
