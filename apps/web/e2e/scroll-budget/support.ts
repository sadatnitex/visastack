import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * The scroll budget guard (docs/upgrades/programme/SCROLL-BUDGET-PLAN.md sections 1 and 5).
 *
 * `renderFixture` mounts real product components, with a worst-case data set, on a clean page that
 * carries the real stylesheet; `expectWithinBudget` measures how tall the page is at the phone
 * (390 by 844) or desktop (1280 by 800) size and checks it against a number of screens, and
 * `expectFixedPanel` checks a log keeps its fixed scrolling box.
 *
 * Modes: in "report" mode the checks print what they measured and pass; in "enforce" mode they
 * fail when a budget is broken. WP-SB0 landed everything in report mode, each package switched its
 * own spec file, and WP-SB10 made enforce the default for every file. For a local run,
 * SCROLL_BUDGET_MODE=report prints every check that does not name its own mode without failing.
 */

export type BudgetMode = 'report' | 'enforce';
export type BudgetViewport = 'phone' | 'desktop';

/**
 * The enforcement switch (owned by WP-SB10): every check enforces unless it names its own mode.
 * A page check left in report mode is a known exception, recorded with its height in
 * docs/uiux/SCROLL-BUDGET.md section 2, and carries a `ceiling` so it cannot grow unnoticed.
 */
export const DEFAULT_MODE: BudgetMode = 'enforce';

export const VIEWPORTS: Readonly<Record<BudgetViewport, { width: number; height: number }>> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

/** The fixed log box from the plan: 26rem on a desktop, 22rem on a phone (16px root size). */
export const PANEL_MAX_PX: Readonly<Record<BudgetViewport, number>> = {
  phone: 22 * 16,
  desktop: 26 * 16,
};

/** Variable-keyed env read (avoids the index-signature lint and type rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/** A mode passed to a check wins; then SCROLL_BUDGET_MODE; then the default. */
function modeFor(requested: BudgetMode | undefined): BudgetMode {
  if (requested) return requested;
  const fromEnv = readEnv('SCROLL_BUDGET_MODE');
  return fromEnv === 'enforce' || fromEnv === 'report' ? fromEnv : DEFAULT_MODE;
}

const FIXTURE_DIRS = [__dirname, resolve(__dirname, '..', 'fixtures')];

/** `<name>.fixture.tsx`, in this folder (a package's own) or in e2e/fixtures (shared). */
function fixturePath(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) throw new Error(`Bad fixture name: ${name}`);
  for (const dir of FIXTURE_DIRS) {
    const candidate = resolve(dir, `${name}.fixture.tsx`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No fixture named ${name} in e2e/scroll-budget or e2e/fixtures`);
}

const MOUNT = 'virtual:scroll-budget-mount';
const bundles = new Map<string, Promise<string>>();

/** Bundles one fixture module (its default export is a component) with the real product code. */
function fixtureBundle(name: string): Promise<string> {
  const cached = bundles.get(name);
  if (cached) return cached;
  const entry = fixturePath(name);
  const shared = (file: string) => resolve(__dirname, '..', 'fixtures', file);
  const built = (async () => {
    const require = createRequire(__filename);
    const vitePath = createRequire(require.resolve('vitest/package.json')).resolve('vite');
    const { build } = await import(vitePath);
    const output = await build({
      configFile: false,
      logLevel: 'error',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' },
      resolve: {
        alias: { 'next/link': shared('link.tsx'), 'next/navigation': shared('navigation.ts') },
      },
      plugins: [
        {
          name: 'scroll-budget-mount',
          enforce: 'pre',
          resolveId(id: string) {
            // The library entry arrives resolved against the working folder, so match the end.
            return id === MOUNT || id.endsWith(`/${MOUNT}`) ? `\0${MOUNT}` : null;
          },
          load(id: string) {
            if (id !== `\0${MOUNT}`) return null;
            return [
              `import { createElement } from 'react';`,
              `import { createRoot } from 'react-dom/client';`,
              `import Fixture from ${JSON.stringify(entry)};`,
              'window.__mountScrollFixture = (props) => {',
              `  const main = document.createElement('main');`,
              `  main.className = 'scroll-fixture';`,
              `  main.id = 'main';`,
              '  document.body.replaceChildren(main);',
              '  createRoot(main).render(createElement(Fixture, props));',
              '};',
            ].join('\n');
          },
        },
      ],
      build: {
        write: false,
        minify: true,
        lib: { entry: MOUNT, name: 'VisaStackScrollFixture', formats: ['iife'] },
      },
    });
    const outputs = Array.isArray(output) ? output : [output];
    const code = outputs
      .flatMap((o: { output: { type: string; code?: string }[] }) => o.output)
      .find((o: { type: string; code?: string }) => o.type === 'chunk')?.code;
    if (!code) throw new Error(`Fixture bundle missing for ${name}`);
    return code;
  })();
  // Never cache a failure: the next caller retries instead of inheriting it.
  built.catch(() => bundles.delete(name));
  bundles.set(name, built);
  return built;
}

declare global {
  interface Window {
    __mountScrollFixture?: (props: unknown) => void;
  }
}

/** Two painted frames after fonts are ready, so a measurement never races the first layout. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.fonts.ready.then(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    ),
  );
}

/**
 * Opens the site's front page for its stylesheet (its own scripts are blocked), then replaces the
 * whole body with the named fixture, rendered with `props`. Props must be plain data.
 */
export async function renderFixture(page: Page, name: string, props: unknown = {}): Promise<void> {
  const code = await fixtureBundle(name);
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'script' ? route.abort() : route.continue(),
  );
  await page.goto('/');
  await page.addScriptTag({ content: code });
  await page.evaluate((value) => {
    if (!window.__mountScrollFixture) throw new Error('Scroll budget fixture failed to load');
    window.__mountScrollFixture(value);
  }, props);
  await page.locator('main.scroll-fixture > *').first().waitFor();
  await settle(page);
}

export interface BudgetMeasure {
  readonly viewport: BudgetViewport;
  readonly height: number;
  readonly screens: number;
  readonly budget: number;
  readonly sideways: number;
}

function record(kind: string, line: string, mode: BudgetMode): void {
  test.info().annotations.push({ type: `scroll-budget:${kind}`, description: `${line} [${mode}]` });
  process.stdout.write(`[scroll-budget] ${line} [${mode}]\n`);
}

/**
 * Sets the viewport, then measures the page: its full height against `screens` screens, and any
 * sideways scroll (there must be none). Returns what it measured, in every mode.
 */
export async function expectWithinBudget(
  page: Page,
  options: {
    readonly screens: number;
    readonly viewport: BudgetViewport;
    readonly mode?: BudgetMode;
    /** For a reported exception: the page still fails, in every mode, above this many screens. */
    readonly ceiling?: number;
  },
): Promise<BudgetMeasure> {
  const mode = modeFor(options.mode);
  const size = VIEWPORTS[options.viewport];
  await page.setViewportSize(size);
  await settle(page);
  const { height, sideways } = await page.evaluate(() => {
    const root = document.documentElement;
    return { height: root.scrollHeight, sideways: root.scrollWidth - root.clientWidth };
  });
  const limit = options.screens * size.height;
  const measure: BudgetMeasure = {
    viewport: options.viewport,
    height,
    screens: Math.round((height / size.height) * 100) / 100,
    budget: options.screens,
    sideways,
  };
  record(
    'page',
    `${options.viewport} ${size.width}x${size.height}: ${height}px = ${measure.screens} screens (budget ${options.screens}, ${limit}px); sideways ${sideways}px`,
    mode,
  );
  if (options.ceiling !== undefined) {
    const ceiling = options.ceiling * size.height;
    expect(height, `page height at ${options.viewport} (exception ceiling)`).toBeLessThanOrEqual(
      ceiling,
    );
  }
  if (mode === 'enforce') {
    expect(height, `page height at ${options.viewport}`).toBeLessThanOrEqual(limit);
    expect(sideways, `sideways scroll at ${options.viewport}`).toBeLessThanOrEqual(0);
  }
  return measure;
}

/**
 * Checks a log or queue keeps its fixed box at the current viewport: no taller than the plan's
 * panel height, scrolling inside, reachable by keyboard and named.
 */
export async function expectFixedPanel(
  panel: Locator,
  options: { readonly viewport: BudgetViewport; readonly mode?: BudgetMode },
): Promise<{ height: number; scrolls: boolean }> {
  const mode = modeFor(options.mode);
  await panel.page().setViewportSize(VIEWPORTS[options.viewport]);
  await settle(panel.page());
  const facts = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      overflowY: style.overflowY,
      scrolls: element.scrollHeight > element.clientHeight,
      tabIndex: element.getAttribute('tabindex'),
      name: element.getAttribute('aria-label') ?? '',
    };
  });
  const max = PANEL_MAX_PX[options.viewport];
  record(
    'panel',
    `${options.viewport}: panel ${Math.round(facts.height)}px (max ${max}px), overflow-y ${facts.overflowY}, scrolls ${facts.scrolls}, named "${facts.name}"`,
    mode,
  );
  if (mode === 'enforce') {
    expect(facts.height, 'panel height').toBeLessThanOrEqual(max + 0.5);
    expect(['auto', 'scroll'], 'panel scrolls inside').toContain(facts.overflowY);
    expect(facts.tabIndex, 'panel takes keyboard focus').toBe('0');
    expect(facts.name.length, 'panel has a name').toBeGreaterThan(0);
  }
  return { height: facts.height, scrolls: facts.scrolls };
}
