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
  /**
   * @param {string} surfaceId lower camel surface prefix
   * @param {Record<string,string>} existingEn keys already in the catalogue
   * @param {(key: string, english: string) => string} [variantOf] meaning of an existing key, for
   *   English that means two things (a homograph); '' otherwise
   */
  constructor(surfaceId, existingEn = {}, variantOf = () => '') {
    this.surfaceId = surfaceId;
    this.keyToId = new Map();
    this.idToKey = new Map();
    const sorted = Object.entries(existingEn).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [k, v] of sorted) {
      const id = `${v}\u0000${variantOf(k, v)}`;
      this.keyToId.set(k, id);
      if (!this.idToKey.has(id)) this.idToKey.set(id, k);
    }
  }

  /**
   * @param {string} [slugSource] text the slug is made from (a plural's "other" form)
   * @param {string} [variant] which meaning of a homograph this is ('' when it has one meaning)
   */
  keyFor(rel, english, slugSource = english, variant = '') {
    const id = `${english}\u0000${variant}`;
    const known = this.idToKey.get(id);
    if (known) return known;
    const base = `${this.surfaceId}.${fileSlug(rel)}.${textSlug(slugSource)}`;
    let key = base;
    for (let n = 6; this.keyToId.has(key) && this.keyToId.get(key) !== id; n += 2)
      key = `${base}${hashOf(id, n)}`;
    this.keyToId.set(key, id);
    this.idToKey.set(id, key);
    return key;
  }
}
