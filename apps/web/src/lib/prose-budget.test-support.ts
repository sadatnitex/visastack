import { JSDOM } from 'jsdom';
import { type DepthLevel, depthRank, isDepthLevel, resolveAuto } from './ccd/depth';

/**
 * The 30-word rule (Owner, 5 Nov 2026: "no page should have more than 30 words while being
 * exceptionally intuitively designed"), as a function.
 *
 * VISIBLE EXPLANATORY PROSE of a screen is the words a person has to read that are not a name,
 * a label or a value. It is counted from the markup the server sends, for the view a person
 * really gets first: a phone at its default depth (Glance), as the stylesheet would show it.
 *
 * COUNTED: words inside p, li, dd, blockquote, figcaption and output elements, inside anything
 * with a `.muted` class or a class ending in -note, -hint or -meta, and any other bare run of
 * six or more words (a sentence in a div is still a sentence).
 *
 * NOT COUNTED:
 *  - headings, buttons, links, summaries, form labels, legends, fields and options
 *  - badges, pills, chips, tabs and anything whose class ends in -label, -kicker, -metric or -filter
 *  - data values: an element marked `data-value` (a file name, a kind, a date, a count). Its text
 *    must be data: at most 12 words and never ending like a sentence, or it is reported as a
 *    problem, so the mark cannot hide a sentence
 *  - navigation chrome (nav elements), screen reader only text, `hidden` and `aria-hidden` parts
 *  - what the screen hides at this depth: blocks whose `data-level` is deeper, the depth switch's
 *    sentences for the other levels, and `data-only="glance"` lines at any other depth
 *  - text inside a closed details element (its summary is a control, so it is not counted either)
 *  - on a phone, the selected-document screen while it is closed
 *
 * A rule that says "every sentence must be reachable" is kept by moving the sentence behind a
 * disclosure, never by deleting it: see docs/uiux/ccd/PARITY-LEDGER.md.
 */

/** The most words of explanatory prose one screen may show at its default phone depth. */
export const PROSE_WORD_BUDGET = 30;

export interface ProseOptions {
  /** Where the page is read. Every width reads the depth "auto" as Glance (Owner, 6 Nov 2026). */
  readonly viewport?: 'phone' | 'desktop';
  /** A level to read the page at, instead of the one on the page's depth scope. */
  readonly depth?: DepthLevel;
}

export interface ProsePassage {
  readonly text: string;
  readonly words: number;
}

export interface ProseReport {
  readonly words: number;
  readonly passages: readonly ProsePassage[];
  /** Things that look wrong in the markup itself, for example a sentence marked as data. */
  readonly problems: readonly string[];
}

const SKIPPED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'svg',
  'select',
  'option',
  'textarea',
  'input',
  'nav',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'button',
  'a',
  'summary',
  'label',
  'legend',
  'th',
]);

const PROSE_TAGS = new Set(['p', 'li', 'dd', 'blockquote', 'figcaption', 'output']);

/** A class that names a label, not a sentence (badge, pill, chip, tab, btn, ...-label, ...). */
function isLabelClass(token: string): boolean {
  return (
    /(^|-)(badge|pill|chip|btn|tab)$/.test(token) ||
    /^badge-/.test(token) ||
    /-(label|kicker|metric|filter)$/.test(token)
  );
}

/** A class that names a sentence: muted text and notes, hints and meta lines. */
function isProseClass(token: string): boolean {
  return token === 'muted' || /-(note|hint|meta)$/.test(token);
}

const classesOf = (el: Element): string[] => [...el.classList];

/** Words in a piece of text: runs of letters or digits, so a lone dot or dash counts for nothing. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function countProse(html: string, options: ProseOptions = {}): ProseReport {
  const doc = new JSDOM(html).window.document;
  const root = doc.querySelector('main') ?? doc.body;
  const phone = (options.viewport ?? 'phone') === 'phone';
  const scope = root.querySelector<HTMLElement>('[data-depth-scope]');
  const scopeDepth = scope?.getAttribute('data-depth') ?? 'auto';
  const level: DepthLevel =
    options.depth ?? (isDepthLevel(scopeDepth) ? scopeDepth : resolveAuto(phone));

  const problems: string[] = [];
  const passages: ProsePassage[] = [];

  /** True when the element is not on screen, or is not prose at all, with its whole subtree. */
  const skipped = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) return true;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
    const classes = classesOf(el);
    if (classes.includes('sr-only') || classes.some(isLabelClass)) return true;
    if (el.hasAttribute('data-value')) return true;
    const levelOf = el.getAttribute('data-level');
    if (isDepthLevel(levelOf) && depthRank(levelOf) > depthRank(level)) return true;
    const noteFor = el.getAttribute('data-for');
    if (classes.includes('depth-note') && noteFor !== null && noteFor !== level) return true;
    if (el.getAttribute('data-only') === 'glance' && level !== 'glance') return true;
    if (phone && el.getAttribute('data-sheet') === 'closed') return true;
    return false;
  };

  /** The words under an element that are on screen, whatever they sit in. */
  const textOf = (el: Element): string => {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3) text += ` ${child.textContent ?? ''}`;
      else if (child.nodeType === 1) {
        const element = child as Element;
        if (skipped(element)) continue;
        if (element.tagName.toLowerCase() === 'details' && !element.hasAttribute('open')) continue;
        text += ` ${textOf(element)}`;
      }
    }
    return text;
  };

  const add = (text: string): void => {
    const cleaned = clean(text);
    const words = wordCount(cleaned);
    if (words > 0) passages.push({ text: cleaned, words });
  };

  const walk = (el: Element): void => {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        // A bare run of words outside any sentence element: counted once it reads like a sentence.
        const text = clean(child.textContent ?? '');
        if (wordCount(text) >= 6) add(text);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (skipped(element)) continue;
      if (element.tagName.toLowerCase() === 'details' && !element.hasAttribute('open')) continue;
      const tag = element.tagName.toLowerCase();
      if (PROSE_TAGS.has(tag) || classesOf(element).some(isProseClass)) {
        add(textOf(element));
        continue;
      }
      walk(element);
    }
  };
  walk(root);
  // Marked data must be data, wherever it sits and whether or not it is on screen.
  for (const value of root.querySelectorAll('[data-value]')) {
    const text = clean(value.textContent ?? '');
    if (wordCount(text) > 12 || /[.!?]$/.test(text)) {
      problems.push(`data-value reads as a sentence: "${text}"`);
    }
  }

  // A label class (badge, pill, -label, ...) holds a label. One that reads as a sentence is prose in
  // a label's clothes, so it is reported instead of being skipped silently.
  for (const labelled of root.querySelectorAll('*')) {
    const classes = classesOf(labelled);
    if (!classes.some(isLabelClass) || classes.includes('sr-only')) continue;
    if (labelled.hasAttribute('data-value') || skipped(labelled.parentElement ?? root)) continue;
    const text = clean(labelled.textContent ?? '');
    if (wordCount(text) > 12 || (wordCount(text) >= 6 && /[.!?]$/.test(text))) {
      problems.push(`a label class holds a sentence: "${text}"`);
    }
  }

  return {
    words: passages.reduce((total, passage) => total + passage.words, 0),
    passages,
    problems,
  };
}

/** What a registered screen is held to, and the message that names the sentences when it is over. */
export function budgetProblem(
  name: string,
  report: ProseReport,
  max: number = PROSE_WORD_BUDGET,
): string | null {
  if (report.words <= max && report.problems.length === 0) return null;
  const lines = report.passages.map((passage) => `  ${passage.words}: ${passage.text}`);
  return [
    `${name} shows ${report.words} words of explanation at the phone default depth (limit ${max}).`,
    ...lines,
    ...report.problems,
  ].join('\n');
}
