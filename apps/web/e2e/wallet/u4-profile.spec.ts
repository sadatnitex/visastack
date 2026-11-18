import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { renderFixture } from '../scroll-budget/support';
import {
  expectNoSidewaysScroll,
  expectNothingCoversControls,
  runLayoutGuards,
} from '../support/layout-guards';

/**
 * WAL4 (owner decision 17 Nov 2026, option B): My Profile's Passport Page Card and value rows,
 * the real editor on the real stylesheet. Layout guards at 390, 400 and 1280 px, the protected
 * mask, a tap that opens the detail's own row, 44 px targets, reduced motion, accessibility, and
 * the server markup with script switched off. Made-up values only.
 */

const FIXTURE = 'wal4-profile';
const STAND_IN = { standInServerActions: true } as const;
const card = (page: Page) => page.locator('.passport-page-card');
const line = (page: Page, key: string) => card(page).locator(`[data-detail="${key}"]`);

async function open(page: Page, props: Record<string, unknown> = {}): Promise<void> {
  await renderFixture(page, FIXTURE, props, STAND_IN);
}

/**
 * The editor as a server renders it (renderToString of the real component tree), bundled with
 * Vite in Node. Server actions become stand-ins that change nothing, the link and navigation
 * modules are the fixtures' own, and the translator is the English one, as in renderFixture.
 */
async function serverMarkup(props: Record<string, unknown>): Promise<string> {
  const fixtures = resolve(__dirname, '..', 'fixtures');
  const entry = resolve(fixtures, `${FIXTURE}.fixture.tsx`);
  const languageParts = resolve(__dirname, '..', '..', 'src', 'lib', 'language-parts.ts');
  const require = createRequire(__filename);
  const vitePath = createRequire(require.resolve('vitest/package.json')).resolve('vite');
  const { build } = await import(vitePath);
  const virtual = 'virtual:wal4-server-markup';
  const output = await build({
    configFile: false,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    esbuild: { jsx: 'automatic' },
    ssr: { noExternal: true },
    resolve: {
      alias: {
        'next/link': resolve(fixtures, 'link.tsx'),
        'next/navigation': resolve(fixtures, 'navigation.ts'),
      },
    },
    plugins: [
      {
        name: 'wal4-stand-in-actions',
        enforce: 'pre',
        load(id: string) {
          const file = id.split('?')[0] ?? id;
          if (file.includes('node_modules') || !file.includes('/src/') || !/\.tsx?$/.test(file)) {
            return null;
          }
          const source = readFileSync(file, 'utf8');
          if (!/^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use server['"]/.test(source)) return null;
          const names = [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(
            (match) => match[1],
          );
          return [...new Set(names)]
            .map((n) => `export async function ${n}() { return { ok: false, message: '' }; }`)
            .join('\n');
        },
      },
      {
        name: 'wal4-english-translator',
        enforce: 'pre',
        resolveId: (id: string) => (/(^|\/)lib\/i18n-server$/.test(id) ? '\0wal4-i18n' : null),
        load: (id: string) =>
          id === '\0wal4-i18n'
            ? [
                `import { partsTranslator } from ${JSON.stringify(languageParts)};`,
                `export const getServerT = (catalog) => partsTranslator(catalog, 'en', 'en');`,
                `export const getT = async (catalog) => partsTranslator(catalog, 'en', 'en');`,
                `export const primeLocale = async () => 'en';`,
                `export const getPageLanguage = () => 'en';`,
              ].join('\n')
            : null,
      },
      {
        name: 'wal4-server-markup',
        resolveId: (id: string) =>
          id === virtual || id.endsWith(`/${virtual}`) ? `\0${virtual}` : null,
        load: (id: string) =>
          id === `\0${virtual}`
            ? [
                `import { createElement } from 'react';`,
                `import { renderToString } from 'react-dom/server';`,
                `import Fixture from ${JSON.stringify(entry)};`,
                'export const markup = (props) => renderToString(createElement(Fixture, props));',
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
  if (!code) throw new Error('WAL4 server bundle missing');
  const dir = mkdtempSync(join(tmpdir(), 'wal4-ssr-'));
  try {
    const file = join(dir, 'markup.mjs');
    writeFileSync(file, code);
    const loaded = (await import(pathToFileURL(file).href)) as {
      markup: (p: Record<string, unknown>) => string;
    };
    return loaded.markup(props);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe('WAL4 layout guards', () => {
  for (const values of ['full', 'empty', 'locked'] as const) {
    test(`${values} profile: no sideways scroll, nothing covers a control`, async ({ page }) => {
      await runLayoutGuards(page, async () => {
        await open(page, { values });
      });
    });
  }

  test('Essentials First with the card: no sideways scroll, nothing covers a control', async ({
    page,
  }) => {
    await runLayoutGuards(page, async () => {
      await open(page, { values: 'empty', essentials: true });
    });
  });

  test('a passport row opened from the card: no sideways scroll, nothing covers a control', async ({
    page,
  }) => {
    await runLayoutGuards(page, async () => {
      await open(page, { values: 'full' });
      await line(page, 'passport_number').locator('a.passport-page-value').click();
      await expect(page.locator('#profile-row-passport_number > details')).toHaveAttribute(
        'open',
        '',
      );
    });
  });
});

test.describe('WAL4 Passport Page Card', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('prints the profile values, masks the protected ones until Show', async ({ page }) => {
    await open(page);
    await expect(line(page, 'given_name')).toContainText('EXAMPLE');
    await expect(card(page)).toContainText('This does not verify identity.');
    expect(await card(page).innerHTML()).not.toContain('X1234567');
    const show = line(page, 'passport_number').getByRole('button', {
      name: 'Show Passport Number',
    });
    await show.click();
    await expect(line(page, 'passport_number')).toContainText('X1234567');
    await expect(
      line(page, 'passport_number').getByRole('button', { name: 'Hide Passport Number' }),
    ).toBeVisible();
    // The status button names its detail, so a run of Tab stops is never a list of bare states.
    await expect(
      line(page, 'passport_number').getByRole('button', {
        name: 'Passport Number: Backed by a Document',
      }),
    ).toBeVisible();
    // The page's own markup (the test page also carries the fixture's script, whose code holds the word).
    expect((await page.locator('main').innerHTML()).toLowerCase()).not.toContain('[protected');
  });

  test('a saved value that could not be opened shows words, never the stand-in', async ({
    page,
  }) => {
    await open(page, { values: 'locked' });
    await expect(line(page, 'date_of_birth')).toContainText('Protected detail');
    await expect(line(page, 'passport_number')).toContainText('Could not read this detail');
    await expect(line(page, 'passport_number').getByRole('button', { name: /Show/ })).toHaveCount(
      0,
    );
  });

  test('a tap on a value opens its own row in its own area, with the box focused', async ({
    page,
  }) => {
    await open(page);
    await line(page, 'passport_expiry').locator('a.passport-page-value').click();
    await expect(page.locator('#profile-panel-travel_documents')).toBeVisible();
    await expect(page.locator('#profile-row-passport_expiry > details')).toHaveAttribute(
      'open',
      '',
    );
    await expect(page.locator('#f-passport_expiry')).toBeFocused();
    const row = page.locator('#profile-row-passport_expiry');
    await expect(row.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(row.getByText('Add the Date This Became True')).toBeVisible();
  });

  test('Not Added Yet with Add for an empty detail; Add opens it', async ({ page }) => {
    await open(page, { values: 'empty' });
    await expect(line(page, 'passport_number')).toContainText('Not Added Yet');
    await line(page, 'passport_number').getByRole('link', { name: 'Add Passport Number' }).click();
    await expect(page.locator('#f-passport_number')).toBeFocused();
  });

  test('every control on the card and every value row is a 44 px target', async ({ page }) => {
    await open(page);
    // Every control on screen (the rows of the area not chosen are hidden with their panel).
    const controls = page
      .locator(
        '.passport-page-card a, .passport-page-card button, .profile-value-row > details > summary',
      )
      .filter({ visible: true });
    const count = await controls.count();
    expect(count).toBeGreaterThan(20);
    for (let i = 0; i < count; i += 1) {
      const box = await controls.nth(i).boundingBox();
      expect(box?.height ?? 0, await controls.nth(i).innerText()).toBeGreaterThanOrEqual(44);
    }
  });

  test('reduced motion: nothing on the card or the rows moves', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.locator('#profile-row-email > details > summary').click();
    await line(page, 'passport_number').getByRole('button', { name: /Show/ }).click();
    const moving = await page.evaluate(
      () =>
        [...document.querySelectorAll('.passport-page-card *, .profile-value-row *')].filter(
          (el) => {
            const style = getComputedStyle(el);
            const seconds = (value: string) =>
              Math.max(...value.split(',').map((part) => Number.parseFloat(part) || 0));
            return seconds(style.transitionDuration) > 0 || seconds(style.animationDuration) > 0;
          },
        ).length,
    );
    expect(moving).toBe(0);
  });

  for (const values of ['full', 'empty', 'locked'] as const) {
    test(`accessibility: ${values} profile has no axe violations`, async ({ page }) => {
      await open(page, { values });
      const results = await new AxeBuilder({ page }).include('#profile-editor').analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    });
  }
});

test('WAL4 works with script switched off, from the server markup', async ({ page, browser }) => {
  const markup = await serverMarkup({ values: 'full' });
  expect(markup).not.toContain('X1234567</');
  await page.goto('/');
  const origin = new URL(page.url()).origin;
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
    await still.route(`${origin}/__wal4-without-script`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    );
    await still.goto(`${origin}/__wal4-without-script`);
    // Script is switched off for this page, so nothing in the markup runs (React adds its own small
    // form script to server markup; it never runs here).
    expect(
      await still.evaluate(() =>
        [...document.querySelectorAll('script')].every((s) => !s.textContent?.includes('X1234567')),
      ),
    ).toBe(true);
    await expect(line(still, 'given_name')).toContainText('EXAMPLE');
    expect(await card(still).innerHTML()).not.toContain('X1234567');
    // The line links to the detail's row, which the browser opens on a tap without any script.
    await expect(line(still, 'given_name').locator('a.passport-page-value')).toHaveAttribute(
      'href',
      '#profile-row-given_name',
    );
    const summary = still.locator('#profile-row-given_name > details > summary');
    await summary.click();
    await expect(still.locator('#f-given_name')).toBeVisible();
    await expectNoSidewaysScroll(still);
    await expectNothingCoversControls(still);
  } finally {
    await context.close();
  }
});
