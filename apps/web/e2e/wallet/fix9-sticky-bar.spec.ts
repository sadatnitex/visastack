import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

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
