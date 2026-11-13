import type { Catalog } from '@visastack/i18n';
import { expect } from 'vitest';

/**
 * Measures which Bengali messages a test file really renders, so a Bengali value cannot go live
 * without a test that shows it. Use it from a test file as:
 *
 *   vi.mock('@visastack/i18n', async (original) =>
 *     (await import('../bn-coverage.test-support')).trackBengali(await original()));
 *
 * and finish the file with `expectEveryLiveMessageRendered(catalog)`. Only lookups made for a
 * Bengali reader that resolve to a Bengali value are recorded.
 */
const rendered = new Set<string>();

type Resolve = (
  catalog: Catalog<string>,
  locale: 'en' | 'bn',
  key: string,
  params?: Record<string, unknown>,
) => { text: string; lang: 'en' | 'bn' };

export function trackBengali<T extends { catalogResolve: unknown }>(original: T): T {
  const resolve = original.catalogResolve as Resolve;
  const catalogResolve: Resolve = (catalog, locale, key, params) => {
    const out = resolve(catalog, locale, key, params);
    if (locale === 'bn' && out.lang === 'bn') rendered.add(key);
    return out;
  };
  return {
    ...original,
    catalogResolve,
    catalogTranslator:
      (catalog: Catalog<string>, locale: 'en' | 'bn') =>
      (key: string, params?: Record<string, unknown>) =>
        catalogResolve(catalog, locale, key, params).text,
  };
}

/** Every Bengali message the catalogue holds must have been rendered under Bengali by this file. */
export function expectEveryLiveMessageRendered(catalog: Catalog<string>, prefix = ''): void {
  const live = Object.keys(catalog.bn).filter((key) => key.startsWith(prefix));
  expect(live.length, 'the catalogue has no Bengali to measure').toBeGreaterThan(0);
  expect(
    live.filter((key) => !rendered.has(key)),
    'live Bengali messages no test rendered',
  ).toEqual([]);
}

/**
 * The Bengali text under `root` that no element marks as Bengali (`lang="bn"`), in page order.
 * While a page itself is still marked English, every Bengali part must say its own language; a
 * test compares this list with the parts known to be passed as plain strings, so the gap can only
 * get shorter. Needs a DOM (the jsdom environment).
 */
export function bengaliWithoutLanguageMark(root: ParentNode | string): string[] {
  let host: ParentNode;
  if (typeof root === 'string') {
    const parsed = document.createElement('div');
    parsed.innerHTML = root;
    host = parsed;
  } else host = root;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const loose: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node.nodeValue ?? '').trim();
    if (/[\u0980-\u09FF]/.test(value) && !node.parentElement?.closest('[lang="bn"]'))
      loose.push(value);
  }
  return loose;
}
