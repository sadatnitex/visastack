import { type Page, expect } from '@playwright/test';

/**
 * Layout guards (WAL1, ADR 0030): two checks any page can run, at the widths that broke before.
 *
 * - `expectNoSidewaysScroll`: the page never needs a sideways scroll.
 * - `expectNothingCoversControls`: every visible control can be pressed where it is drawn. Each
 *   control is brought to the middle of the screen (as a person scrolls to it) and hit-tested with
 *   `elementFromPoint` at its centre and four inner points; the check fails naming the control and
 *   whatever is painted on top of it (a fixed bar, a floating Add button, a sheet).
 *
 * The checks know nothing about a particular screen. WAL1 runs them on fixture-mounted screens and
 * public pages; a later unit (U1b) points the same `runLayoutGuards` at every signed-in route.
 */

/** Widths that matter: two common phones and a laptop. Heights are the usual screen for each. */
export const GUARD_SIZES = [
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'phone 400', width: 400, height: 860 },
  { name: 'desktop 1280', width: 1280, height: 800 },
] as const;

export type GuardSize = (typeof GUARD_SIZES)[number];

/**
 * What counts as a control. Links count when they are drawn as buttons; a plain link inside a
 * sentence is text. A summary (an open-and-close row) is tested at its centre only, because a
 * status picture may sit in its own column at the row's end by design.
 */
export const CONTROL_SELECTOR = [
  'button',
  'a.btn',
  'a[class*="btn-"]',
  'a[class*="button"]',
  'a[role="button"]',
  '[role="button"]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
].join(', ');

export interface CoverOptions {
  /** Only controls inside this element (a CSS selector) are tested. Default: the whole page. */
  readonly within?: string;
  /** Controls to leave out, as a CSS selector, each with its reason written next to the call. */
  readonly ignore?: string;
}

/** The page's sideways overflow in CSS pixels; 0 when it fits. */
export async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await sidewaysOverflow(page), 'sideways scroll in pixels').toBeLessThanOrEqual(0);
}

/**
 * Every visible control that something else paints over, as one readable line each: what the
 * control is, where it was pressed and what was hit instead. An empty list means none.
 */
export async function coveredControls(page: Page, options: CoverOptions = {}): Promise<string[]> {
  return page.evaluate(
    ({ selector, within, ignore }) => {
      const describe = (el: Element): string => {
        const id = el.id ? `#${el.id}` : '';
        const cls =
          typeof el.className === 'string' && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
            : '';
        const words = (el.getAttribute('aria-label') || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40);
        return `<${el.tagName.toLowerCase()}${id}${cls}>${words ? ` "${words}"` : ''}`;
      };
      /** A press here reaches the control: the control itself, inside it, or its own label. */
      const reaches = (control: Element, hit: Element | null): boolean => {
        if (!hit) return false;
        if (control === hit || control.contains(hit)) return true;
        const label = hit.closest('label');
        return Boolean(label && (label as HTMLLabelElement).control === control);
      };
      const scope = within ? document.querySelector(within) : document;
      if (!scope) return [`no element matches ${within}`];
      const startX = window.scrollX;
      const startY = window.scrollY;
      const covered: string[] = [];
      for (const control of scope.querySelectorAll<HTMLElement>(selector)) {
        if (ignore && control.matches(ignore)) continue;
        // Inside a closed open-and-close section only its own row is drawn.
        let hiddenInFold = false;
        for (let fold = control.closest('details:not([open])'); fold; ) {
          if (!fold.querySelector(':scope > summary')?.contains(control)) hiddenInFold = true;
          fold = fold.parentElement?.closest('details:not([open])') ?? null;
        }
        if (hiddenInFold) continue;
        const style = getComputedStyle(control);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        let rect = control.getBoundingClientRect();
        // Visually hidden (a screen-reader-only field or a styled checkbox's real input).
        if (rect.width < 4 || rect.height < 4) continue;
        // Instant: the site scrolls smoothly, and a point read mid-scroll would miss the control.
        control.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        rect = control.getBoundingClientRect();
        const centre: [number, number] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
        const points: [number, number][] =
          control.tagName === 'SUMMARY'
            ? [centre]
            : [
                centre,
                [rect.left + rect.width * 0.2, rect.top + rect.height * 0.3],
                [rect.right - rect.width * 0.2, rect.top + rect.height * 0.3],
                [rect.left + rect.width * 0.2, rect.bottom - rect.height * 0.3],
                [rect.right - rect.width * 0.2, rect.bottom - rect.height * 0.3],
              ];
        for (const [x, y] of points) {
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
          const hit = document.elementFromPoint(x, y);
          if (!reaches(control, hit)) {
            covered.push(
              `${describe(control)} at ${Math.round(x)},${Math.round(y)} is under ${hit ? describe(hit) : 'nothing'}`,
            );
            break;
          }
        }
      }
      window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
      return covered;
    },
    { selector: CONTROL_SELECTOR, within: options.within, ignore: options.ignore },
  );
}

export async function expectNothingCoversControls(
  page: Page,
  options: CoverOptions = {},
): Promise<void> {
  expect(await coveredControls(page, options), 'controls painted over by something else').toEqual(
    [],
  );
}

/**
 * Runs both guards at every guard size. `open` loads or prepares the page at the current size
 * (navigate, mount a fixture, open a section); it runs again for each size, so a layout that only
 * breaks at one width is caught there.
 */
export async function runLayoutGuards(
  page: Page,
  open: (size: GuardSize) => Promise<void>,
  options: CoverOptions & { readonly sizes?: readonly GuardSize[] } = {},
): Promise<void> {
  for (const size of options.sizes ?? GUARD_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await open(size);
    await expectNoSidewaysScroll(page);
    await expectNothingCoversControls(page, options);
  }
}
