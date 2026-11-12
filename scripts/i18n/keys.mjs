/**
 * Message keys: `<surface>.<fileSlug>.<textSlug>`, each part lower camel case.
 * Identical English within one surface always shares one key (including keys already in the
 * catalogue). A slug already taken by different English gets a short hash of the English, so
 * the result depends only on the catalogue and the sorted inputs, never on run order.
 */
import { createHash } from 'node:crypto';
import { camel } from './rules.mjs';

const MAX_WORDS = 6;
const MAX_SLUG = 48;

export const hashOf = (s, n = 6) => createHash('sha1').update(s).digest('hex').slice(0, n);

/** apps/web/src/app/(app)/documents/[id]/page.tsx -> documentsIdPage */
export function fileSlug(rel) {
  const inner = rel
    .replace(/^apps\/web\/src\//, '')
    .replace(/\.tsx?$/, '')
    .replace(/^(app|components|lib)\//, '');
  const segs = inner
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s) && !/^@/.test(s))
    .map((s) => s.replace(/^\[+\.{0,3}|\]+$/g, ''));
  return camel(segs.join(' ')) || 'root';
}

/** First words of the English, with placeholders reduced to their names. */
export function textSlug(english) {
  const plain = english.replace(/\{(\w+)\}/g, ' $1 ').replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  const words = plain.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS).join(' ');
  const slug = camel(words).slice(0, MAX_SLUG);
  return slug || 'text';
}

export class KeyAllocator {
  /** @param {string} surfaceId lower camel surface prefix @param {Record<string,string>} existingEn */
  constructor(surfaceId, existingEn = {}) {
    this.surfaceId = surfaceId;
    this.keyToEn = new Map(Object.entries(existingEn));
    this.enToKey = new Map();
    for (const [k, v] of [...this.keyToEn].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      if (!this.enToKey.has(v)) this.enToKey.set(v, k);
    this.added = new Map();
  }

  /** @param {string} [slugSource] text the slug is made from (a plural's "other" form) */
  keyFor(rel, english, slugSource = english) {
    const known = this.enToKey.get(english);
    if (known) return known;
    const base = `${this.surfaceId}.${fileSlug(rel)}.${textSlug(slugSource)}`;
    let key = base;
    for (let n = 6; this.keyToEn.has(key) && this.keyToEn.get(key) !== english; n += 2)
      key = `${base}${hashOf(english, n)}`;
    this.keyToEn.set(key, english);
    this.enToKey.set(english, key);
    this.added.set(key, english);
    return key;
  }
}
