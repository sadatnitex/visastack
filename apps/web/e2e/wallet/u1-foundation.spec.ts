import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';
import {
  GUARD_SIZES,
  coveredControls,
  expectNoSidewaysScroll,
  expectNothingCoversControls,
  runLayoutGuards,
  sidewaysOverflow,
} from '../support/layout-guards';

/**
 * WAL1 (ADR 0030): the Expandable Section and the six status pictures on the real stylesheet, and
 * the layout guards that every later Wallet screen runs. The fixture is the real component tree;
 * the public pages are the real pages.
 */

const FIXTURE = 'wal1-foundation';
const KINDS = [
  'DECLARED',
  'EXTRACTED_PENDING',
  'APPLICANT_CONFIRMED',
  'DOCUMENT_SUPPORTED',
  'CONFLICTED',
  'STALE',
] as const;

/**
 * The fixture as a server renders it: one self-contained server bundle (the fixture, React and
 * renderToString together, built with the same Vite the fixtures use), run here in Node. Spec
 * files cannot render JSX themselves, because Playwright rewrites JSX in them for its own use.
 */
async function serverMarkup(): Promise<string> {
  const entry = resolve(__dirname, '..', 'fixtures', `${FIXTURE}.fixture.tsx`);
  const require = createRequire(__filename);
  const vitePath = createRequire(require.resolve('vitest/package.json')).resolve('vite');
  const { build } = await import(vitePath);
  const virtual = 'virtual:wal1-server-markup';
  const output = await build({
    configFile: false,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    esbuild: { jsx: 'automatic' },
    ssr: { noExternal: true },
    plugins: [
      {
        name: 'wal1-server-markup',
        resolveId: (id: string) =>
          id === virtual || id.endsWith(`/${virtual}`) ? `\0${virtual}` : null,
        load: (id: string) =>
          id === `\0${virtual}`
            ? [
                `import { createElement } from 'react';`,
                `import { renderToString } from 'react-dom/server';`,
                `import Fixture from ${JSON.stringify(entry)};`,
                'export const markup = () => renderToString(createElement(Fixture, {}));',
              ].join('\n')
            : null,
      },
    ],
    build: { ssr: virtual, write: false, rollupOptions: { output: { format: 'esm' } } },
  });
  const outputs = Array.isArray(output) ? output : [output];
  const code = outputs
    .flatMap((o: { output: { type: string; code?: string }[] }) => o.output)
    .find((o: { type: string; code?: string }) => o.type === 'chunk')?.code;
  if (!code) throw new Error('WAL1 server bundle missing');
  const dir = mkdtempSync(join(tmpdir(), 'wal1-ssr-'));
  try {
    const file = join(dir, 'markup.mjs');
    writeFileSync(file, code);
    const loaded = (await import(pathToFileURL(file).href)) as { markup: () => string };
    return loaded.markup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const section = (page: Page, kind: string) => page.locator(`#section-${kind} > details`);
const row = (page: Page, kind: string) => section(page, kind).locator('> summary');

async function isOpen(page: Page, kind: string): Promise<boolean> {
  return section(page, kind).evaluate((el) => (el as HTMLDetailsElement).open);
}

test.describe('WAL1 layout guards on the fixture', () => {
  for (const open of [false, true]) {
    test(`sections ${open ? 'open' : 'closed'}: no sideways scroll, nothing covers a control`, async ({
      page,
    }) => {
      await runLayoutGuards(page, async () => {
        await renderFixture(page, FIXTURE, { open });
      });
    });
  }
});

test.describe('WAL1 layout guards on public pages', () => {
  for (const path of ['/', '/trust', '/privacy', '/terms', '/status']) {
    test(`${path}: no sideways scroll, nothing covers a control`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await runLayoutGuards(page, async () => {
        await page.goto(path);
        await page.locator('main').first().waitFor();
      });
    });
  }
});

test.describe('WAL1 Expandable Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await renderFixture(page, FIXTURE, {});
  });

  test('Enter and Space toggle a section from the keyboard', async ({ page }) => {
    await row(page, 'DECLARED').focus();
    await page.keyboard.press('Enter');
    expect(await isOpen(page, 'DECLARED')).toBe(true);
    await page.keyboard.press('Space');
    expect(await isOpen(page, 'DECLARED')).toBe(false);
    await page.keyboard.press('Space');
    expect(await isOpen(page, 'DECLARED')).toBe(true);
  });

  test('Tab meets the row first, then its status; the row says its name and status', async ({
    page,
  }) => {
    const summary = row(page, 'DOCUMENT_SUPPORTED');
    await expect(summary).toHaveAccessibleName('Backed by a Document Details');
    await expect(summary).toHaveAccessibleDescription(/Backed by a Document\./);
    await expect(summary).toHaveAccessibleDescription(/does not mean anyone has checked it/);
    await summary.focus();
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveClass(/explain-tip-trigger/);
    await expect(focused).toHaveText('Backed by a Document');
    expect(await focused.evaluate((el) => el.closest('.expandable-section')?.id)).toBe(
      'section-DOCUMENT_SUPPORTED',
    );
  });

  test('every row and every status picture is a 44 px target', async ({ page }) => {
    for (const target of await page.locator('summary, .explain-tip-trigger').all()) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('the Explain note opens on focus and tap, Escape closes it, the section never toggles', async ({
    page,
  }) => {
    const tip = page.locator('.wal1-section-DOCUMENT_SUPPORTED .explain-tip');
    const popup = tip.locator('.explain-tip-popup');
    await tip.locator('.explain-tip-trigger').focus();
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Backed by a Document');
    await expect(popup).toContainText('does not mean anyone has checked it');
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await tip.locator('.explain-tip-trigger').click();
    await expect(popup).toBeVisible();
    expect(await isOpen(page, 'DOCUMENT_SUPPORTED')).toBe(false);
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    expect(await isOpen(page, 'DOCUMENT_SUPPORTED')).toBe(false);
  });

  test('a wrapping summary moves nothing: picture, status and chevron stay put', async ({
    page,
  }) => {
    const offsets = async (kind: string) =>
      section(page, kind).evaluate((details) => {
        const card = details.parentElement as HTMLElement;
        const top = card.getBoundingClientRect().top;
        const at = (selector: string) =>
          Math.round(
            (card.querySelector(selector) as HTMLElement).getBoundingClientRect().top - top,
          );
        return {
          picture: at('.expandable-section-picture'),
          status: at('.expandable-section-status'),
          chevron: at('.expandable-section-chevron'),
          title: at('.expandable-section-title'),
        };
      });
    const short = await offsets('DECLARED');
    for (const kind of ['DOCUMENT_SUPPORTED', 'EXTRACTED_PENDING', 'CONFLICTED', 'STALE']) {
      const rowHeight = await row(page, kind).evaluate((el) => el.getBoundingClientRect().height);
      expect(rowHeight, `${kind} wraps`).toBeGreaterThan(60);
      expect(await offsets(kind), kind).toEqual(short);
    }
  });

  test('reduced motion: the chevron shows its finished position at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const chevron = section(page, 'DECLARED').locator('.expandable-section-chevron');
    expect(await chevron.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    await row(page, 'DECLARED').click();
    expect(await chevron.evaluate((el) => getComputedStyle(el).transform)).toBe(
      'matrix(0, 1, -1, 0, 0, 0)',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await chevron.evaluate((el) => getComputedStyle(el).transitionDuration)).not.toBe('0s');
  });

  test('every status picture differs in shape, not only in colour', async ({ page }) => {
    const shapes = await page
      .locator('.wal1-fixture-legend svg.status-picture')
      .evaluateAll((all) =>
        all.map((svg) =>
          [...svg.querySelectorAll('circle, path')]
            .map((shape) =>
              [
                shape.getAttribute('r'),
                shape.getAttribute('d'),
                getComputedStyle(shape).strokeDasharray,
                getComputedStyle(shape).strokeWidth,
              ].join('|'),
            )
            .join(';'),
        ),
      );
    expect(shapes).toHaveLength(KINDS.length);
    expect(new Set(shapes).size).toBe(KINDS.length);
  });
});

test('WAL1 Expandable Section works with script switched off, from the server markup', async ({
  page,
  browser,
}) => {
  // The server's own rendering of the fixture (renderToString, as a server component page sends
  // it), in a page built from the site's own stylesheets with no script at all, opened with script off.
  const markup = await serverMarkup();
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  // The site's own stylesheets, read from the real page; nothing is filtered out of any markup.
  const sheets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => l.href),
  );
  expect(sheets.length).toBeGreaterThan(0);
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...sheets.map((href) => `<link rel="stylesheet" href="${href}">`),
    `</head><body><main class="scroll-fixture" id="main">${markup}</main></body></html>`,
  ].join('');
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const still = await context.newPage();
    await still.route(`${origin}/__wal1-without-script`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    );
    await still.goto(`${origin}/__wal1-without-script`);
    expect(await still.evaluate(() => document.querySelectorAll('script').length)).toBe(0);
    await expect(section(still, 'CONFLICTED')).not.toHaveAttribute('open');
    await row(still, 'CONFLICTED').click();
    await expect(section(still, 'CONFLICTED').locator('.expandable-section-body')).toBeVisible();
    await row(still, 'CONFLICTED').focus();
    await still.keyboard.press('Enter');
    await expect(section(still, 'CONFLICTED').locator('.expandable-section-body')).toBeHidden();
    // Before any script the Explain notes stay closed and the names are still there to be read.
    await expect(still.locator('.explain-tip-popup').first()).toBeHidden();
    await expect(still.locator('.wal1-section-DOCUMENT_SUPPORTED .explain-tip-trigger')).toHaveText(
      'Backed by a Document',
    );
    await expectNoSidewaysScroll(still);
    await expectNothingCoversControls(still);
  } finally {
    await context.close();
  }
});

test.describe('WAL1 the guards themselves can fail', () => {
  test('a wide child makes a sideways scroll, and the guard says so', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent('<main><div style="width:2000px;height:10px"></div></main>');
    expect(await sidewaysOverflow(page)).toBeGreaterThan(0);
    await expect(expectNoSidewaysScroll(page)).rejects.toThrow(/sideways scroll/);
  });

  test('a bar painted over a button is named, with the button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<main>
      <button style="display:block;margin:200px 20px;width:200px;height:44px">Save</button>
      <div class="floating-add" style="position:fixed;inset:0 0 auto 0;height:100%;background:#fff"></div>
      </main>`);
    const covered = await coveredControls(page);
    expect(covered).toHaveLength(1);
    expect(covered[0]).toMatch(
      /<button> "Save" in the middle, at \d+,\d+, is under <div\.floating-add>/,
    );
  });

  test('a control inside a closed section is not tested; its row is', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<main><details><summary style="min-height:44px">Row</summary>
      <button>Hidden</button></details></main>`);
    expect(await coveredControls(page)).toEqual([]);
  });
});

test.describe('WAL1 the guard reads a row companion and an unreachable control', () => {
  test('a narrow companion on a row is allowed; one spread over the row is a cover', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const card = (width: string) => `<main><div style="position:relative">
      <span data-row-companion style="position:absolute;top:0;right:0;width:${width};height:44px;background:#fff"></span>
      <details><summary style="display:block;min-height:44px">Row</summary></details></div></main>`;
    await page.setContent(card('44px'));
    expect(await coveredControls(page)).toEqual([]);
    await page.setContent(card('100%'));
    expect(await coveredControls(page)).toEqual([
      expect.stringMatching(/<summary> "Row" in the middle, at \d+,\d+, is under <span>/),
    ]);
  });

  test('a button that can never be brought on screen is reported', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<main><div style="overflow:clip;width:100px">
      <button style="margin-left:900px;width:80px;height:44px">Lost</button></div></main>`);
    expect(await coveredControls(page)).toEqual([
      expect.stringMatching(/<button> "Lost" cannot be brought on screen/),
    ]);
  });
});

test.describe('WAL1 the guard meets controls where a person does', () => {
  test('a sticky header over a control reached from below is named', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<main>
      <header class="bar" style="position:sticky;top:0;height:90px;background:#fff;z-index:2">Top</header>
      <div style="height:1200px"></div>
      <button style="display:block;width:200px;height:44px">Send</button>
      <div style="height:1200px"></div></main>`);
    const covered = await coveredControls(page);
    expect(covered).toEqual([
      expect.stringMatching(
        /<button> "Send" reached from below, at \d+,\d+, is under <header\.bar>/,
      ),
    ]);
  });

  test('a control too small to press, with no drawn label, is reported', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<main>
      <input id="tiny" style="box-sizing:border-box;width:2px;height:2px;padding:0;border:0">
      <input id="styled" type="checkbox" style="position:absolute;width:1px;height:1px;opacity:0">
      <label for="styled" style="display:inline-block;min-height:44px;padding:12px">Styled Choice</label>
      </main>`);
    expect(await coveredControls(page)).toEqual([
      expect.stringMatching(
        /<input#tiny> is too small to press \(2 by 2 px\) and has no drawn label/,
      ),
    ]);
  });

  test('a control can be left out only with a reason', async ({ page }) => {
    await page.setContent('<main><button>One</button></main>');
    await expect(
      coveredControls(page, { ignore: [{ selector: 'button', reason: ' ' }] }),
    ).rejects.toThrow(/need a reason/);
    expect(
      await coveredControls(page, {
        ignore: [{ selector: 'button', reason: 'Self-test: the reason is required and present.' }],
      }),
    ).toEqual([]);
  });

  test('under the real stylesheet, a fixed bar over a section control is named', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await renderFixture(page, FIXTURE, { open: true });
    await page.evaluate(() => {
      const bar = document.createElement('nav');
      bar.className = 'wal1-test-bar';
      Object.assign(bar.style, {
        position: 'fixed',
        left: '0',
        right: '0',
        bottom: '0',
        height: '96px',
        background: 'var(--bg-elevated)',
        zIndex: '50',
      });
      document.body.append(bar);
    });
    const covered = await coveredControls(page, { within: '.wal1-fixture-sections' });
    expect(covered.length).toBeGreaterThan(0);
    for (const line of covered)
      expect(line).toMatch(
        /(in the middle|reached from above), at \d+,\d+, is under <nav\.wal1-test-bar>/,
      );
  });
});

test('WAL1 guard sizes are the ones the board names', () => {
  expect(GUARD_SIZES.map((size) => size.width)).toEqual([390, 400, 1280]);
});
