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
 * sentence is text. An open-and-close row (summary) counts too.
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

/** A control the cover check leaves out, always with the reason it does not apply. */
export interface CoverIgnore {
  readonly selector: string;
  readonly reason: string;
}

export interface CoverOptions {
  /** Only controls inside this element (a CSS selector) are tested. Default: the whole page. */
  readonly within?: string;
  /** Controls to leave out. Each needs a reason, written where the check is called. */
  readonly ignore?: readonly CoverIgnore[];
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
 *
 * Each control is tested where a person meets it: brought to the middle of the screen, reached
 * from above (it arrives at the bottom edge, where fixed bars sit) and reached from below (it
 * arrives at the top edge, under a sticky header), each as the browser scrolls to a focused
 * control. At each place nine points are pressed: the centre, the four corners (2 px in, and
 * inside a rounded corner's curve) and the middle of each edge (2 px in).
 */
export async function coveredControls(page: Page, options: CoverOptions = {}): Promise<string[]> {
  for (const rule of options.ignore ?? []) {
    if (!rule.reason.trim()) throw new Error(`Ignored controls need a reason: ${rule.selector}`);
  }
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
      const inside = (r: DOMRect, x: number, y: number) =>
        x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      /**
       * A press here reaches the control: the control itself, inside it, or its own label. A row
       * may also declare a companion drawn in its own column on the row (`data-row-companion`, the
       * status picture of an Expandable Section). A hit counts only inside the companion's own box
       * (never on something it lets spill out) and only while the companion stays a narrow column.
       */
      const reaches = (control: Element, hit: Element | null, x: number, y: number): boolean => {
        if (!hit) return false;
        if (control === hit || control.contains(hit)) return true;
        const label = hit.closest('label');
        if (label && (label as HTMLLabelElement).control === control) return true;
        const companion = hit.closest('[data-row-companion]');
        if (control.tagName !== 'SUMMARY' || !companion?.parentElement?.contains(control)) {
          return false;
        }
        const box = companion.getBoundingClientRect();
        return inside(box, x, y) && box.width <= control.getBoundingClientRect().width / 3;
      };
      /** The nine points of a box, kept inside rounded corners. */
      const pointsOf = (target: Element): [number, number][] => {
        const r = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        const radius = Math.min(
          Number.parseFloat(style.borderTopLeftRadius) || 0,
          r.width / 2,
          r.height / 2,
        );
        const corner = Math.min(2 + radius * 0.3, r.width / 2, r.height / 2);
        const edge = Math.min(2, r.width / 2, r.height / 2);
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        return [
          [cx, cy],
          [r.left + corner, r.top + corner],
          [r.right - corner, r.top + corner],
          [r.left + corner, r.bottom - corner],
          [r.right - corner, r.bottom - corner],
          [cx, r.top + edge],
          [cx, r.bottom - edge],
          [r.left + edge, cy],
          [r.right - edge, cy],
        ];
      };
      const scope = within ? document.querySelector(within) : document;
      if (!scope) return [`no element matches ${within}`];
      const startX = window.scrollX;
      const startY = window.scrollY;
      const go = (top: number) => window.scrollTo({ left: 0, top, behavior: 'instant' });
      const covered: string[] = [];
      for (const control of scope.querySelectorAll<HTMLElement>(selector)) {
        if (ignore.some((rule) => control.matches(rule))) continue;
        // Inside a closed open-and-close section only its own row is drawn.
        let hiddenInFold = false;
        for (let fold = control.closest('details:not([open])'); fold; ) {
          if (!fold.querySelector(':scope > summary')?.contains(control)) hiddenInFold = true;
          fold = fold.parentElement?.closest('details:not([open])') ?? null;
        }
        if (hiddenInFold) continue;
        const style = getComputedStyle(control);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        const own = control.getBoundingClientRect();
        if (own.width === 0 && own.height === 0) continue; // not drawn at all
        // A visually hidden field is pressed through its label; with no drawn label it is reported.
        let target: Element = control;
        if (own.width < 4 || own.height < 4) {
          const labels =
            'labels' in control ? [...((control as HTMLInputElement).labels ?? [])] : [];
          const drawn = labels.find((l) => {
            const r = l.getBoundingClientRect();
            return r.width >= 4 && r.height >= 4;
          });
          if (!drawn) {
            covered.push(
              `${describe(control)} is too small to press (${Math.round(own.width)} by ${Math.round(own.height)} px) and has no drawn label`,
            );
            continue;
          }
          target = drawn;
        }
        const places: [string, () => void][] = [
          [
            'in the middle',
            () => target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
          ],
          [
            'reached from above',
            () => {
              go(0);
              target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            },
          ],
          [
            'reached from below',
            () => {
              go(document.documentElement.scrollHeight);
              target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            },
          ],
        ];
        let everOnScreen = false;
        for (const [where, bring] of places) {
          bring();
          const onScreen = pointsOf(target).filter(
            ([x, y]) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight,
          );
          if (onScreen.length === 0) continue;
          everOnScreen = true;
          const miss = onScreen.find(
            ([x, y]) => !reaches(control, document.elementFromPoint(x, y), x, y),
          );
          if (miss) {
            const hit = document.elementFromPoint(miss[0], miss[1]);
            covered.push(
              `${describe(control)} ${where}, at ${Math.round(miss[0])},${Math.round(miss[1])}, is under ${hit ? describe(hit) : 'nothing'}`,
            );
            break;
          }
        }
        // A control that cannot be brought on screen cannot be pressed either.
        if (!everOnScreen) covered.push(`${describe(control)} cannot be brought on screen`);
      }
      window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
      return covered;
    },
    {
      selector: CONTROL_SELECTOR,
      within: options.within,
      ignore: (options.ignore ?? []).map((rule) => rule.selector),
    },
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
