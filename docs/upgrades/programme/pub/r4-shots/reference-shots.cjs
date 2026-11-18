// Photographs the approved reference's Countries page at 1440x900 and 390x844 (reduced motion, so
// the typing demo rests on its finished picture). Usage:
//   node reference-shots.cjs <saved reference html> <output folder>
// Needs Playwright (require('playwright') from the repository's web app) and Chromium.
const { chromium } = require('playwright');

const [reference, out] = process.argv.slice(2);
if (!reference || !out)
  throw new Error('Usage: node reference-shots.cjs <reference.html> <out dir>');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [width, height, tag] of [
    [1440, 900, 'd'],
    [390, 844, 'm'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(`file://${reference}`);
    await page.evaluate(() => {
      document.querySelector('[data-go="countries"]')?.click();
      // Let the frame grow to its content, so one picture holds the whole page.
      document
        .getElementById('zf')
        ?.setAttribute('style', 'height:auto;max-height:none;overflow:visible');
    });
    await page.waitForTimeout(600);
    await page.locator('#zf').screenshot({ path: `${out}/reference-${tag}.png` });
    await context.close();
  }
  await browser.close();
})();
