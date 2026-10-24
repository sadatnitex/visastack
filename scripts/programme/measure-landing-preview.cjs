// Programme X WP-A0 baseline tool. Read-only: writes only to the path given. Usage is in docs/upgrades/programme/A0-AUDIT.md.
const { chromium } = require('playwright');
const file = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [w, h] of [
    [1440, 900],
    [1024, 900],
    [768, 900],
    [390, 844],
    [360, 640],
  ]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto(`file://${file}`);
    const r = await p.evaluate((w) => {
      const wide = [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > w + 1)
        .map((e) => `${e.className}:${Math.round(e.getBoundingClientRect().right)}`)
        .slice(0, 6);
      const box = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return getComputedStyle(e).display === 'none'
          ? 'hidden'
          : [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
      };
      const hit = (a, b) =>
        a &&
        b &&
        a !== 'hidden' &&
        b !== 'hidden' &&
        a[0] < b[2] &&
        b[0] < a[2] &&
        a[1] < b[3] &&
        b[1] < a[3];
      const texts = ['.phonename', '.phonepanel', '.tinycap', '.fileline'].flatMap((s) =>
        [...document.querySelectorAll(`.phone ${s}`)].map((e) => {
          // The phone hides overflowing content, so only the part inside its frame can be covered.
          const r = e.getBoundingClientRect();
          const f = document.querySelector('.phone').getBoundingClientRect();
          return [
            s,
            [
              Math.max(r.left, f.left),
              Math.max(r.top, f.top),
              Math.min(r.right, f.right),
              Math.min(r.bottom, f.bottom),
            ],
          ];
        }),
      );
      const floats = ['.fc1', '.fc2', '.fc3', '.fc4'].map((s) => [s, box(s)]);
      const covered = floats.flatMap(([f, fb]) =>
        texts.filter(([, tb]) => hit(fb, tb)).map(([t]) => `${f}>${t}`),
      );
      return {
        scrollW: document.documentElement.scrollWidth,
        wide,
        fineprint: box('.fineprint'),
        phone: box('.phone'),
        floats,
        covered: [...new Set(covered)],
        fineOverlap: [
          ...floats.filter(([, fb]) => hit(fb, box('.fineprint'))).map(([f]) => f),
          ...(hit(box('.phone'), box('.fineprint')) ? ['phone'] : []),
        ],
        menuShown: box('.pv-menu summary'),
        links: box('.links'),
        menu: box('.mobile-menu'),
      };
    }, w);
    process.stdout.write(`${w} ${JSON.stringify(r)}\n`);
    await p.close();
  }
  await b.close();
})();
