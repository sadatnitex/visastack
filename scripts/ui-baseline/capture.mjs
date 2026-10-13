import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Turns the pages the web tests already render into screenshots, so a change to any screen can
 * be compared before and after without signing in or touching a live service.
 *
 *   UI_BASELINE_DIR=/tmp/ui/html pnpm --filter @visastack/web exec vitest run
 *   node scripts/ui-baseline/capture.mjs /tmp/ui/html /tmp/ui/before
 *
 * Pages are shown with the real stylesheet at a desktop and a phone width. The data is the
 * made-up data in the tests. Text uses the system font, so compare two captures from the same
 * machine, never against a live site. See docs/uiux/CHANGE-SAFETY.md.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [htmlDirectory, outDirectory] = process.argv.slice(2);
if (!htmlDirectory || !outDirectory) {
  console.error('Usage: node scripts/ui-baseline/capture.mjs <html-directory> <output-directory>');
  process.exit(2);
}

const css = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8');
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
const VIEWS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

rmSync(outDirectory, { recursive: true, force: true });
mkdirSync(outDirectory, { recursive: true });
const files = readdirSync(htmlDirectory)
  .filter((name) => name.endsWith('.html'))
  .sort();

const executablePath = process.env.UI_BASELINE_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium
  .launch({ executablePath, args: ['--no-sandbox'] })
  .catch(() => chromium.launch());
const manifest = [];
for (const view of VIEWS) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  for (const name of files) {
    const body = readFileSync(join(htmlDirectory, name), 'utf8');
    await page.setContent(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}</style></head><body>${body}</body></html>`,
      { waitUntil: 'load' },
    );
    await page.evaluate(() => document.fonts.ready);
    const file = `${name.replace(/\.html$/, '')}__${view.name}.png`;
    // Retake until two shots in a row match, so a one-off rendering wobble never looks like a change.
    let shot = await page.screenshot({ fullPage: true, animations: 'disabled' });
    for (let attempt = 0; attempt < 4; attempt++) {
      const next = await page.screenshot({ fullPage: true, animations: 'disabled' });
      const steady = next.equals(shot);
      shot = next;
      if (steady) break;
      if (attempt === 3) process.stderr.write(`Unsteady rendering: ${file}\n`);
    }
    writeFileSync(join(outDirectory, file), shot);
    manifest.push(file);
  }
  await context.close();
}
await browser.close();
writeFileSync(join(outDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `Captured ${manifest.length} screenshots (${files.length} pages) in ${outDirectory}\n`,
);
