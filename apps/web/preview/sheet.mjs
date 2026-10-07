// Contact sheets: many screenshots on one image, grouped, each with its caption, so a whole
// area of the product can be reviewed at a glance. Output goes to apps/web/.preview/sheets.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../.preview/', import.meta.url));
const shots = `${root}shots/`;
const out = `${root}sheets/`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const manifest = JSON.parse(readFileSync(`${root}manifest.json`, 'utf8'));
const groupOf = (m) => {
  if (m.persona === 'public') return 'public';
  if (m.persona === 'rahim') return 'traveller';
  if (m.persona === 'shirin' || m.persona === 'imran') return 'first-day-traveller';
  if (m.persona === 'agencyOwner' || m.persona === 'agencyMember') return 'agency';
  if (m.persona === 'agencyNew') return 'first-day-agency';
  return 'platform-admin';
};
const groups = new Map();
for (const m of manifest) groups.set(groupOf(m), [...(groups.get(groupOf(m)) ?? []), m]);

const chromePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const files = new Set(readdirSync(shots));
const SPECS = [
  { view: 'desktop', tile: 720, crop: 1000, cols: 2, perSheet: 8 },
  { view: 'phone', tile: 260, crop: 1100, cols: 6, perSheet: 18 },
];
for (const [group, items] of groups) {
  for (const spec of SPECS) {
    const present = items.filter((m) => files.has(`${m.slug}.${spec.view}.png`));
    for (let start = 0, sheet = 1; start < present.length; start += spec.perSheet, sheet++) {
      const cells = present
        .slice(start, start + spec.perSheet)
        .map(
          (m) =>
            `<figure><figcaption>${m.route === '' ? 'home' : m.route}${m.variant ? ` (${m.variant})` : ''}</figcaption><div class="frame"><img src="file://${shots}${m.slug}.${spec.view}.png"></div></figure>`,
        )
        .join('');
      const width = spec.cols * (spec.tile + 16) + 16;
      const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#e9edf3;font:12px/1.3 system-ui,sans-serif;width:${width}px;box-sizing:border-box}
.grid{display:grid;grid-template-columns:repeat(${spec.cols},${spec.tile}px);gap:16px}
figure{margin:0}figcaption{font-weight:600;margin:0 0 4px;color:#33415c;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.frame{height:${Math.round((spec.crop * spec.tile) / (spec.view === 'desktop' ? 1440 : 390))}px;overflow:hidden;border:1px solid #c5cddb;background:#fff}
img{width:${spec.tile}px;display:block}</style><div class="grid">${cells}</div>`;
      writeFileSync(`${out}sheet.tmp.html`, html);
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(`file://${out}sheet.tmp.html`);
      await page.waitForLoadState('load');
      await page.screenshot({ path: `${out}${group}-${spec.view}-${sheet}.png`, fullPage: true });
      await page.close();
    }
  }
}
rmSync(`${out}sheet.tmp.html`, { force: true });
await browser.close();
process.stdout.write(`${readdirSync(out).join('\n')}\n`);
