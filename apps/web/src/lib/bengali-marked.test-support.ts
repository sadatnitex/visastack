import { JSDOM } from 'jsdom';

const BENGALI = /[ঀ-৿]/;

/**
 * Language of parts (WCAG 3.1.2), read from rendered markup of a page that is in English: every
 * run of Bengali text, and every Bengali attribute value, must sit under lang="bn". `marked`
 * counts the elements that carry it, `unmarked` lists the Bengali that a screen reader would
 * pronounce as English.
 */
export function bengaliMarking(html: string): { marked: number; unmarked: string[] } {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  const unmarked: string[] = [];
  const walker = doc.createTreeWalker(doc.body, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? '').trim();
    if (BENGALI.test(text) && n.parentElement?.closest('[lang]')?.getAttribute('lang') !== 'bn')
      unmarked.push(text);
  }
  for (const el of doc.body.querySelectorAll('[aria-label],[title],[placeholder],[alt]'))
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = el.getAttribute(a) ?? '';
      if (BENGALI.test(value) && el.closest('[lang]')?.getAttribute('lang') !== 'bn')
        unmarked.push(`${a}: ${value}`);
    }
  return { marked: doc.body.querySelectorAll('[lang="bn"]').length, unmarked };
}
