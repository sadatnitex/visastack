import { JSDOM } from 'jsdom';
import { type DEPTH_LEVELS, isDepthLevel } from './depth';

/**
 * A plain list of what a rendered screen offers a person: headings, links, buttons, fields and
 * sentences, each with the name it is announced by. The parity test compares a screen's list
 * before and after Calm Core With Depths, so nothing can quietly disappear (ADR 0023).
 */
export type InventoryKind = 'heading' | 'link' | 'button' | 'field' | 'text' | 'component';

export interface InventoryEntry {
  readonly kind: InventoryKind;
  readonly name: string;
  /** Heading level, link address or field type. */
  readonly detail?: string;
}

const clean = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

function fieldName(element: Element, doc: Document): string {
  const label = element.getAttribute('aria-label');
  if (label) return clean(label);
  const id = element.getAttribute('id');
  const linked = id
    ? ([...doc.querySelectorAll('label')].find((l) => l.htmlFor === id) ?? null)
    : null;
  const wrapped = element.closest('label');
  return clean((linked ?? wrapped)?.textContent) || clean(element.getAttribute('name'));
}

export function inventory(html: string): InventoryEntry[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const main = doc.querySelector('main') ?? doc.body;
  const entries: InventoryEntry[] = [];
  for (const el of main.querySelectorAll(
    'h1,h2,h3,h4,h5,h6,a[href],button,summary,input,select,textarea,p,li',
  )) {
    const tag = el.tagName.toLowerCase();
    if (el.closest('noscript') || el.closest('.depth-switch')) continue;
    if (/^h[1-6]$/.test(tag)) {
      entries.push({ kind: 'heading', name: clean(el.textContent), detail: tag.slice(1) });
    } else if (tag === 'a') {
      entries.push({
        kind: 'link',
        name: clean(el.getAttribute('aria-label') ?? el.textContent),
        detail: el.getAttribute('href') ?? '',
      });
    } else if (tag === 'button' || tag === 'summary') {
      entries.push({
        kind: 'button',
        name: clean(el.getAttribute('aria-label') ?? el.textContent),
      });
    } else if (tag === 'p' || tag === 'li') {
      // A sentence that only wraps links, buttons or other sentences is counted through them.
      if (el.querySelector('a,button,p,li')) continue;
      const text = clean(el.textContent);
      if (text) entries.push({ kind: 'text', name: text });
    } else {
      const type = el.getAttribute('type') ?? tag;
      entries.push({ kind: 'field', name: fieldName(el, doc), detail: type });
    }
  }
  // Components a test replaced with a stand-in (`stub()` in next-mocks.test-support): their own
  // controls are not in the markup, so the stand-in itself is counted, once per occurrence.
  for (const el of main.querySelectorAll('[data-stub]')) {
    if (el.closest('noscript')) continue;
    entries.push({ kind: 'component', name: el.getAttribute('data-stub') ?? '' });
  }
  return entries;
}

export const entryKey = (entry: InventoryEntry): string =>
  `${entry.kind}|${entry.name}|${entry.detail ?? ''}`;

/** Problems with heading order: not exactly one h1, or a level skipped on the way down. */
export function headingProblems(html: string): string[] {
  const doc = new JSDOM(html).window.document;
  const levels = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
  const problems: string[] = [];
  const h1s = levels.filter((level) => level === 1).length;
  if (h1s !== 1) problems.push(`expected one h1, found ${h1s}`);
  levels.forEach((level, index) => {
    const before = levels[index - 1];
    if (before !== undefined && level > before + 1)
      problems.push(`h${before} is followed by h${level}`);
  });
  return problems;
}

/** Every data-level in a rendered screen must be one of the three level words. */
export function badLevelWords(html: string): string[] {
  const doc = new JSDOM(html).window.document;
  return [...doc.querySelectorAll('[data-level]')]
    .map((el) => el.getAttribute('data-level') ?? '')
    .filter((value) => !isDepthLevel(value));
}

/** The shallowest level at which each named element is visible, for the ledger. */
export function levelOfEach(html: string): Map<string, (typeof DEPTH_LEVELS)[number]> {
  const doc = new JSDOM(html).window.document;
  const result = new Map<string, (typeof DEPTH_LEVELS)[number]>();
  for (const el of doc.querySelectorAll('[data-level]')) {
    const level = el.getAttribute('data-level');
    if (isDepthLevel(level)) result.set(clean(el.querySelector('h2,h3')?.textContent), level);
  }
  return result;
}
