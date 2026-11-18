import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';

/**
 * FIX9: the pinned action bar of a form (Create Case, Preview, Start Trip) must stay above the
 * phone navigation bar. The page is the real stylesheet over the real class names, with a tall
 * form so the bar has to stick; no server is needed.
 */

const STYLESHEET = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

const PAGE = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
<div class="app-frame">
  <nav class="app-shell-nav" aria-label="Main">
    <div class="app-bar">
      <div class="app-shell-links">
        <a href="#a">Home</a><a href="#b">Cases</a><a href="#c">Documents</a><a href="#d">Profile</a>
      </div>
      <button type="button" class="app-more-toggle" aria-expanded="false">More</button>
    </div>
  </nav>
  <main class="app-main">
    <form>
      <div style="height:2400px">A long form</div>
      <fieldset class="sticky-action-bar">
        <legend class="sr-only">Create Case</legend>
        <div class="sticky-action-bar-actions"><button type="button" class="btn btn-primary" id="go">Create Case</button></div>
      </fieldset>
    </form>
  </main>
</div>
</body></html>`;

async function open(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.setContent(PAGE);
  await page.addStyleTag({ content: STYLESHEET });
}

/** What is drawn at the middle of the button when the page is at its top (the bar arrives stuck). */
async function whatIsAtTheButton(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const button = document.getElementById('go') as HTMLElement;
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      reached: hit === button,
      hit: hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : 'nothing',
      bottomGap: window.innerHeight - box.bottom,
      navTop: (document.querySelector('.app-shell-nav') as HTMLElement).getBoundingClientRect().top,
      buttonBottom: box.bottom,
    };
  });
}

for (const width of [390, 400]) {
  test(`at ${width}px the pinned action bar button is above the phone navigation bar`, async ({
    page,
  }) => {
    await open(page, width);
    const seen = await whatIsAtTheButton(page);
    expect(seen.hit, 'what a press on the button reaches').toBe('button.btn btn-primary');
    expect(seen.reached).toBe(true);
    expect(seen.buttonBottom).toBeLessThanOrEqual(seen.navTop);
  });
}

test('on a wide screen the bar still sticks to the bottom edge (no navigation bar there)', async ({
  page,
}) => {
  await open(page, 1280);
  const seen = await whatIsAtTheButton(page);
  expect(seen.reached).toBe(true);
  expect(seen.bottomGap).toBeLessThan(24);
});

/**
 * The same proof on the real screens that pin the bar: the sign-in consent screen (no navigation
 * bar), Start a Case and the calendar page's bar (both inside the app shell), at 390 and 1280 px.
 * Each button of the bar must be reached by a press, with the page at its top and at its bottom.
 */
const SCREENS = [
  { screen: 'consent', shell: false },
  { screen: 'create-case', shell: true },
  { screen: 'calendar', shell: true },
] as const;

for (const { screen, shell } of SCREENS) {
  for (const [width, height] of [
    [390, 844],
    [1280, 800],
  ] as const) {
    test(`${screen} at ${width}px: every button of the pinned bar is reached, top and bottom of the page`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await renderFixture(page, 'fix9-bars', { screen, shell }, { standInServerActions: true });
      const bar = page.locator('.sticky-action-bar');
      await expect(bar).toHaveCount(1);
      const buttons = bar.locator('button');
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);
      for (const at of ['top', 'bottom'] as const) {
        await page.evaluate((where) => {
          window.scrollTo({
            top: where === 'top' ? 0 : document.documentElement.scrollHeight,
            behavior: 'instant',
          });
        }, at);
        for (let index = 0; index < count; index++) {
          const reached = await buttons.nth(index).evaluate((button) => {
            const box = button.getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return hit !== null && (hit === button || button.contains(hit));
          });
          expect(reached, `button ${index + 1} of ${count} with the page at its ${at}`).toBe(true);
        }
      }
      if (shell && width < 1024) {
        const gap = await page.evaluate(() => {
          const nav = document.querySelector('.app-shell-nav') as HTMLElement;
          const barBox = (
            document.querySelector('.sticky-action-bar') as HTMLElement
          ).getBoundingClientRect();
          return nav.getBoundingClientRect().top - barBox.bottom;
        });
        expect(gap, 'the bar ends above the navigation bar').toBeGreaterThanOrEqual(0);
      }
    });
  }
}

/**
 * One tab stop per picker: the real field takes the focus, the drawn label does not, Enter or
 * Space on the field is the browser's own way to open it, and the field's name is the label's words.
 */
test('each hidden file picker has one tab stop and is named by its drawn label', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await renderFixture(page, 'fix9-pickers', {}, { standInServerActions: true });
  const inputs = page.locator('input[type="file"]');
  const total = await inputs.count();
  expect(total).toBe(3);
  for (let index = 0; index < total; index++) {
    const input = inputs.nth(index);
    const info = await input.evaluate((el) => {
      const field = el as HTMLInputElement;
      const label = field.labels?.[0] as HTMLLabelElement | undefined;
      const box = label?.getBoundingClientRect();
      return {
        labels: field.labels?.length ?? 0,
        labelText: label?.textContent?.trim() ?? '',
        labelHeight: box?.height ?? 0,
        labelWidth: box?.width ?? 0,
        labelTabindex: label?.getAttribute('tabindex'),
        inputHidden: field.getAttribute('aria-hidden'),
        inputTabindex: field.tabIndex,
        ariaLabel: field.getAttribute('aria-label'),
      };
    });
    expect(info.labels, 'one drawn label').toBe(1);
    expect(info.labelText.length).toBeGreaterThan(0);
    expect(info.labelHeight).toBeGreaterThanOrEqual(44);
    expect(info.labelWidth).toBeGreaterThanOrEqual(44);
    expect(info.labelTabindex, 'the label takes no focus').toBeNull();
    expect(info.inputHidden).toBeNull();
    expect(info.inputTabindex).toBe(0);
    expect(info.ariaLabel, 'the name is the drawn label').toBeNull();
    await expect(page.getByLabel(info.labelText, { exact: true })).toHaveCount(1);
  }
  // Tab visits each picker once, in order, and nothing else of the three.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const visited: string[] = [];
  for (let press = 0; press < 12 && visited.length < total; press++) {
    await page.keyboard.press('Tab');
    const now = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      return el?.type === 'file' ? (el.labels?.[0]?.textContent?.trim() ?? '') : '';
    });
    if (now) visited.push(now);
  }
  expect(visited.length).toBe(total);
  expect(new Set(visited).size).toBe(total);
  // Enter on the focused field opens the browser's file chooser.
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  expect(await chooser).toBeTruthy();
});
