import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, vi } from 'vitest';

/** Variable-keyed read: the type rules forbid dot access on process.env and the linter forbids a literal key. */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Optional page capture for visual baselines. Does nothing unless UI_BASELINE_DIR is set, and
 * then only copies the markup the existing tests already render to a file; it never changes
 * what a test renders or asserts. See docs/uiux/CHANGE-SAFETY.md for how the files are used.
 */
vi.mock('react-dom/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/server')>();
  const directory = readEnv('UI_BASELINE_DIR');
  if (!directory) return actual;
  mkdirSync(directory, { recursive: true });
  let counter = 0;
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 90);
  const renderToStaticMarkup: typeof actual.renderToStaticMarkup = (element, options) => {
    const markup = actual.renderToStaticMarkup(element, options);
    // Whole pages only: a heading, a main region or a substantial body. Small fragments are not screens.
    const { currentTestName, testPath } = expect.getState();
    // The form fixtures are single controls, not screens.
    const isScreen = markup.includes('<h1') || markup.includes('<main') || markup.length > 2500;
    if (isScreen && !(testPath ?? '').includes('a11y-forms')) {
      const file = `${slug((testPath ?? 'unknown').split('/src/').pop() ?? 'unknown')}__${slug(currentTestName ?? 'unnamed')}__${String(++counter).padStart(3, '0')}.html`;
      writeFileSync(join(directory, file), markup);
    }
    return markup;
  };
  return { ...actual, default: actual, renderToStaticMarkup };
});
