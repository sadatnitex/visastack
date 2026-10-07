// Screenshots every page the render step wrote, at phone and desktop width, and checks each for
// sideways overflow, clipped text and accessibility problems (including colour contrast).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../.preview/', import.meta.url));
const htmlDir = `${root}html/`;
const shotDir = `${root}shots/`;
rmSync(shotDir, { recursive: true, force: true });
mkdirSync(shotDir, { recursive: true });

const appDir = fileURLToPath(new URL('../src/app/', import.meta.url));
const css = `${appDir}globals.css`;
const fonts = `
@font-face{font-family:"Inter";src:url("file://${appDir}fonts/inter-latin-wght-normal.woff2") format("woff2");font-weight:100 900;font-display:block}
@font-face{font-family:"Noto Sans Bengali";src:url("file://${appDir}fonts/noto-sans-bengali-bengali-wght-normal.woff2") format("woff2");font-weight:100 900;font-display:block}`;

const manifest = JSON.parse(readFileSync(`${root}manifest.json`, 'utf8'));
const files = readdirSync(htmlDir).filter((f) => f.endsWith('.html'));
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];
// A second look in the dark scheme and at tablet width for the pages people use most.
const EXTRA = new Set(['rahim__app', 'agencyOwner__app_agency__orgId_', 'rahim__app_mission__id_']);

const chromePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});

const results = [];
for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const raw = readFileSync(`${htmlDir}${file}`, 'utf8');
  const doc = raw.replace(
    /<html([^>]*)>/,
    `<html$1><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${slug}</title><link rel="stylesheet" href="file://${css}"><style>${fonts}</style></head>`,
  );
  const withHead = doc.replace(/<\/head><body/, '</head><body').replace('</head><head>', '');
  writeFileSync(`${root}page.${slug}.tmp.html`, withHead);
  const variants = VIEWPORTS.map((v) => ({ ...v, scheme: 'light' }));
  if (EXTRA.has(slug.split('__').slice(0, 2).join('__').replace(/__$/, ''))) {
    variants.push({ name: 'phone-dark', width: 390, height: 844, scheme: 'dark' });
    variants.push({ name: 'desktop-dark', width: 1440, height: 900, scheme: 'dark' });
    variants.push({ name: 'tablet', width: 768, height: 1024, scheme: 'light' });
  }
  for (const v of variants) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      colorScheme: v.scheme,
    });
    const page = await ctx.newPage();
    await page.goto(`file://${root}page.${slug}.tmp.html`);
    await page.evaluate(() => document.fonts.ready);
    const checks = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const overflowX = document.documentElement.scrollWidth - vw;
      const describe = (el) =>
        `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} "${(el.textContent || '').trim().slice(0, 40)}"`;
      const wide = [];
      const clipped = [];
      for (const el of document.querySelectorAll('body *')) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (
          el.closest('.sr-only') ||
          el.closest('thead') ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
        )
          continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const fixed = style.position === 'fixed';
        if (!fixed && r.right > vw + 1 && !el.closest('.subnav') && wide.length < 5)
          wide.push(describe(el));
        const hides = ['hidden', 'clip'].includes(style.overflowX);
        if (
          hides &&
          el.scrollWidth > el.clientWidth + 1 &&
          !el.closest('.subnav') &&
          clipped.length < 5
        )
          clipped.push(describe(el));
      }
      const plain = [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => {
          if (
            el.tagName === 'INPUT' &&
            ['hidden', 'checkbox', 'radio', 'file', 'color', 'submit', 'button'].includes(el.type)
          )
            return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !el.classList.contains('input');
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}[name=${el.getAttribute('name') ?? ''}]`);
      const empty = [...document.querySelectorAll('h1,h2,h3')].filter(
        (h) => !(h.textContent || '').trim(),
      ).length;
      const h1 = document.querySelectorAll('h1').length;
      return {
        overflowX,
        wide,
        clipped,
        plain,
        empty,
        h1,
        height: document.documentElement.scrollHeight,
      };
    });
    let axe = [];
    if (v.name === 'phone' || v.name === 'desktop' || v.name.endsWith('dark')) {
      const res = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      axe = res.violations
        .filter((x) => x.impact === 'critical' || x.impact === 'serious' || x.impact === 'moderate')
        .map((x) => `${x.id} (${x.impact}, ${x.nodes.length})`);
    }
    await page.screenshot({
      path: `${shotDir}${slug}.${v.name}.png`,
      fullPage: true,
      clip: undefined,
    });
    results.push({ slug, viewport: v.name, ...checks, axe });
    await ctx.close();
  }
  rmSync(`${root}page.${slug}.tmp.html`);
}
await browser.close();

const lines = ['# Preview report', '', `${files.length} pages, ${results.length} screenshots.`, ''];
const problems = results.filter(
  (r) =>
    r.overflowX > 1 ||
    r.wide.length ||
    r.clipped.length ||
    r.plain.length ||
    r.axe.length ||
    r.h1 !== 1,
);
lines.push(`Pages with something to look at: ${problems.length}`, '');
for (const r of problems) {
  const notes = [];
  if (r.overflowX > 1) notes.push(`sideways overflow ${r.overflowX}px`);
  if (r.wide.length) notes.push(`past the edge: ${r.wide.join('; ')}`);
  if (r.clipped.length) notes.push(`clipped text: ${r.clipped.join('; ')}`);
  if (r.plain.length) notes.push(`field without the shared style: ${r.plain.join(', ')}`);
  if (r.axe.length) notes.push(`accessibility: ${r.axe.join(', ')}`);
  if (r.h1 !== 1) notes.push(`${r.h1} top headings`);
  lines.push(`- ${r.slug} (${r.viewport}): ${notes.join(' | ')}`);
}
writeFileSync(`${root}report.md`, `${lines.join('\n')}\n`);
writeFileSync(`${root}report.json`, JSON.stringify({ manifest, results }, null, 2));
process.stdout.write(`${lines.join('\n')}\n`);
