// Programme X WP-A0 baseline tool. Read-only: writes only to the path given. Usage is in docs/upgrades/programme/A0-AUDIT.md.
const { chromium } = require('playwright');
const AxeBuilder = require(
  require.resolve('@axe-core/playwright', {
    paths: [require('node:path').join(__dirname, '../../apps/web')],
  }),
).default;
const base = process.env.BASE_URL ?? 'http://localhost:3100';
const out = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const res = {};
  // Screenshots of the current landing at five widths.
  for (const [w, h] of [
    [1440, 900],
    [1024, 900],
    [768, 900],
    [390, 844],
    [360, 640],
  ]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto(`${base}/`, { waitUntil: 'networkidle' });
    await p.screenshot({
      path: `${out}/current-live-build-${w}.jpg`,
      fullPage: true,
      type: 'jpeg',
      quality: 62,
    });
    await p.close();
  }
  // X01: above the fold at 360x640, and horizontal scroll from 320 to 1440.
  {
    const p = await b.newPage({ viewport: { width: 360, height: 640 } });
    await p.goto(`${base}/`, { waitUntil: 'networkidle' });
    const inFold = async (sel) =>
      p
        .$eval(sel, (e) => {
          const r = e.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight;
        })
        .catch(() => 'missing');
    res.x01_fold_360x640 = {
      headline: await inFold('#land-hero-title'),
      primaryAction: await inFold('.land-hero .btn-primary'),
      availability: await inFold('.land-hero .land-pill'),
    };
    const over = [];
    for (let w = 320; w <= 1440; w += 40) {
      await p.setViewportSize({ width: w, height: 800 });
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      if (sw > w + 1) over.push(`${w}:${sw}`);
    }
    res.x01_overflow_320_1440_step40 = over.length ? over : 'none';
    await p.close();
  }
  // X08: axe, same tags as e2e/ux-public.spec.ts, public pages only.
  res.x08_axe = {};
  for (const path of ['/', '/trust', '/privacy', '/terms', '/status']) {
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h } });
      const p = await ctx.newPage();
      await p.goto(base + path, { waitUntil: 'load' });
      await p.waitForTimeout(800);
      const r = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      res.x08_axe[`${path}@${w}`] = r.violations.map(
        (v) => `${v.id}(${v.impact}):${v.nodes.length}`,
      );
      await ctx.close();
    }
  }
  // X13: landing LCP, throttled lab profile, median of 3 cold loads.
  const lcps = [];
  for (let i = 0; i < 3; i += 1) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp = e.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await p.goto(`${base}/`, { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    lcps.push(Math.round(await p.evaluate(() => window.__lcp)));
    await ctx.close();
  }
  lcps.sort((a, b) => a - b);
  res.x13_landing_lcp_ms = { runs: lcps, median: lcps[1] };
  await b.close();
  process.stdout.write(`${JSON.stringify(res, null, 1)}\n`);
})();
