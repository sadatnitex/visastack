// Programme X WP-A0 baseline tool. Read-only: writes only to the path given. Usage is in docs/upgrades/programme/A0-AUDIT.md.
const { chromium } = require('playwright');
const [outDir, ...pairs] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const pair of pairs) {
    const [name, url] = pair.split('=');
    for (const [w, h] of [
      [1440, 900],
      [1024, 900],
      [768, 900],
      [390, 844],
      [360, 640],
    ]) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.goto(url, { waitUntil: 'networkidle' });
      await p.screenshot({
        path: `${outDir}/${name}-${w}.jpg`,
        fullPage: true,
        type: 'jpeg',
        quality: 62,
      });
      await p.close();
    }
  }
  await b.close();
})();
