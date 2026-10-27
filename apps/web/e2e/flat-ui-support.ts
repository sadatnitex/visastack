import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

let bundle: Promise<string> | undefined;
function fixtureBundle(): Promise<string> {
  if (!bundle)
    bundle = (async () => {
      const require = createRequire(__filename);
      const vitePath = createRequire(require.resolve('vitest/package.json')).resolve('vite');
      const { build } = await import(vitePath);
      const fixture = (name: string) => resolve(__dirname, 'fixtures', name);
      const output = await build({
        configFile: false,
        logLevel: 'error',
        define: { 'process.env.NODE_ENV': '"production"' },
        esbuild: { jsx: 'automatic' },
        resolve: {
          alias: { 'next/link': fixture('link.tsx'), 'next/navigation': fixture('navigation.ts') },
        },
        plugins: [
          {
            name: 'test-only-server-actions',
            enforce: 'pre',
            resolveId(id: string) {
              if (id === './actions') return fixture('actions.ts');
              if (id === './section-actions') return fixture('section-actions.ts');
              return null;
            },
          },
        ],
        build: {
          write: false,
          minify: true,
          lib: { entry: fixture('flat-ui.tsx'), name: 'VisaStackFixture', formats: ['iife'] },
        },
      });
      const outputs = Array.isArray(output) ? output : [output];
      const code = outputs
        .flatMap((o: { output: { type: string; code?: string }[] }) => o.output)
        .find((o: { type: string; code?: string }) => o.type === 'chunk')?.code;
      if (!code) throw new Error('Fixture bundle missing');
      return code;
    })();
  return bundle;
}
export async function openUiFixture(
  page: Page,
  mode: 'overview' | 'profile' | 'documents' | 'case' | 'sharing' | 'agency' | 'admin' | 'shell',
  options: { readonly sidebar?: 'expanded' | 'collapsed' } = {},
): Promise<void> {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'script' ? route.abort() : route.continue(),
  );
  await page.goto('/');
  await page.addScriptTag({ content: await fixtureBundle() });
  await page.evaluate(
    ({ value, sidebar }) => {
      if (!window.__mountUiFixture) throw new Error('Actual React fixture failed to load');
      if (sidebar) window.__uiFixtureSidebar = sidebar;
      window.__mountUiFixture(value);
    },
    { value: mode, sidebar: options.sidebar },
  );
  await page.locator('.app-frame').waitFor();
  // Let fonts finish and two frames paint, so a pixel capture never races the first raster.
  await page.evaluate(() =>
    document.fonts.ready.then(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    ),
  );
}
