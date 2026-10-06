import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { afterAll } from 'vitest';

/**
 * Runs the axe accessibility rules over the markup a real component or page produces
 * (rendered with simulated data, in whatever state is being checked), inside a DOM that
 * needs no browser. This catches the structural failures (a control with no name, a bad
 * ARIA attribute, a heading that skips a level, a duplicate landmark) on the real
 * markup of the real screens, in the ordinary test run.
 *
 * What it cannot do, and so does not claim: colour contrast and anything that depends on
 * layout need a rendered page (the browser checks in `e2e/ux-public.spec.ts` cover the
 * stylesheet), and no automated scan replaces a person using a keyboard and a screen
 * reader. Directive Part 9 section 5: "Do not report AA compliance solely from
 * automated scanner."
 */

/** The standards the product targets: WCAG 2.2 AA, plus axe's well-established best practices. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Rules that need layout (a real browser), which this DOM does not have. */
const NEEDS_LAYOUT = ['color-contrast', 'color-contrast-enhanced', 'scrollable-region-focusable'];

/** Rules about a whole page, which do not apply to the part of a page one component renders. */
const WHOLE_PAGE = ['page-has-heading-one', 'landmark-one-main', 'region'];

/** Attributes whose value is the id of another element, which must exist in the page. */
const POINTS_AT_ANOTHER_ELEMENT = [
  'aria-describedby',
  'aria-labelledby',
  'aria-controls',
  'aria-owns',
  'aria-activedescendant',
  'aria-details',
  'aria-errormessage',
  'for',
];

interface AxeNode {
  readonly html: string;
  readonly failureSummary?: string;
}
interface AxeViolation {
  readonly id: string;
  readonly help: string;
  readonly impact?: string | null;
  readonly nodes: readonly AxeNode[];
}

export interface AxeOptions {
  /** More rules to switch off, each with the reason it does not apply here. */
  readonly skip?: readonly string[];
  /** Check page-level rules too (use when the markup is a whole page, not one component). */
  readonly wholePage?: boolean;
  /** The page's language, for a component shown in Bangla. */
  readonly lang?: string;
}

/** A short, readable name for an element, for a message about it. */
function nameOf(element: Element): string {
  const name = element.getAttribute('name');
  const id = element.getAttribute('id');
  return `<${element.tagName.toLowerCase()}${name ? ` name="${name}"` : ''}${id ? ` id="${id}"` : ''}>`;
}

/**
 * The mistakes axe reports only loosely: an attribute that points at an element that is
 * not there (a field marked as described by an error message that was never rendered, so
 * nothing is read out), one id used twice (a label or message then binds to the wrong
 * element), and a same-page link whose target is missing.
 */
function brokenReferences(document: Document): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const element of document.querySelectorAll('[id]')) {
    if (seen.has(element.id) && !reported.has(element.id)) {
      reported.add(element.id);
      problems.push(`duplicate-id: the id "${element.id}" is used by more than one element`);
    }
    seen.add(element.id);
  }
  // A link to a place on the same page (a skip link, a table of contents) needs that place to exist.
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    const target = (link.getAttribute('href') ?? '').slice(1);
    if (target !== '' && !seen.has(target) && document.getElementsByName(target).length === 0) {
      problems.push(`dangling-link: the link to "#${target}" goes to nothing in the page`);
    }
  }
  for (const attribute of POINTS_AT_ANOTHER_ELEMENT) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      for (const target of (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
        if (!seen.has(target)) {
          problems.push(
            `dangling-reference: ${attribute}="${target}" on ${nameOf(element)} points at nothing in the page`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * What a whole page must have. axe reports a missing main landmark or heading only as
 * "needs review", which a test would never notice, so these are checked here directly.
 */
function wholePageProblems(document: Document): string[] {
  const problems: string[] = [];
  const mains = document.querySelectorAll('main, [role="main"]').length;
  if (mains !== 1) {
    problems.push(`landmark-one-main: the page has ${mains} main landmarks, it needs exactly one`);
  }
  const headings = document.querySelectorAll('h1').length;
  if (headings !== 1) {
    problems.push(
      `page-has-heading-one: the page has ${headings} level-one headings, it needs exactly one`,
    );
  }
  return problems;
}

/** The page every scan runs in: made once per test file, because loading axe into a DOM is the slow part. */
let shared: { window: JSDOM['window']; run: AxeRunner } | undefined;

type AxeRunner = (
  context: Document,
  options: unknown,
) => Promise<{ violations: readonly AxeViolation[] }>;

function sharedPage() {
  if (shared) return shared;
  const { window } = new JSDOM(
    '<!doctype html><html><head><title>Page under test</title></head><body></body></html>',
    {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    },
  );
  window.eval(axe.source);
  shared = { window, run: (window as unknown as { axe: { run: AxeRunner } }).axe.run };
  return shared;
}

afterAll(() => {
  shared?.window.close();
  shared = undefined;
});

/**
 * The accessibility problems found in `html`, one readable line per problem; an empty
 * list means none were found by the rules that can run here.
 */
export async function axeViolations(html: string, options: AxeOptions = {}): Promise<string[]> {
  const { window, run } = sharedPage();
  const { document } = window;
  document.documentElement.setAttribute('lang', options.lang ?? 'en');
  document.body.innerHTML = options.wholePage ? html : `<main>${html}</main>`;
  const disabled = [
    ...NEEDS_LAYOUT,
    ...(options.wholePage ? [] : WHOLE_PAGE),
    ...(options.skip ?? []),
  ];
  const rules = Object.fromEntries(disabled.map((id) => [id, { enabled: false }]));
  const results = await run.call(window, document, {
    runOnly: { type: 'tag', values: TAGS },
    rules,
    resultTypes: ['violations'],
  });
  const fromAxe = results.violations.map(
    (v) =>
      `${v.id} (${v.impact ?? 'n/a'}): ${v.help} -> ${v.nodes
        .slice(0, 3)
        .map((n) => n.html.replace(/\s+/g, ' ').slice(0, 140))
        .join(' | ')}`,
  );
  return [
    ...fromAxe,
    ...brokenReferences(document),
    ...(options.wholePage ? wholePageProblems(document) : []),
  ];
}
