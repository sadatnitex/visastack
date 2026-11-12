#!/usr/bin/env node
/**
 * Review packet: for each of the 20 journeys, phone screenshots of the real rendered screens in
 *   (1) English, (2) English with the proposed bn-BD drafts swapped into exact-match text,
 *   (3) a right-to-left layout probe (English text, dir=rtl) that only checks mirroring and
 *       overflow. The RTL probe is NOT a translation and not an Arabic draft.
 * Needs: run-render.sh first (apps/web/.preview/l10n/html), build-register.mjs for drafts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = await import(
  path.join(ROOT, 'apps/web/node_modules/@playwright/test/index.mjs')
);
const LOC = path.join(ROOT, 'docs/localization');
const PACK = path.join(LOC, 'review-packet');
const SHOTS = path.join(PACK, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const HTML = path.join(ROOT, 'apps/web/.preview/l10n/html');
const appDir = path.join(ROOT, 'apps/web/src/app');
const css = path.join(appDir, 'globals.css');
const fonts = `@font-face{font-family:"Inter";src:url("file://${appDir}/fonts/inter-latin-wght-normal.woff2") format("woff2");font-weight:100 900;font-display:block}
@font-face{font-family:"Noto Sans Bengali";src:url("file://${appDir}/fonts/noto-sans-bengali-bengali-wght-normal.woff2") format("woff2");font-weight:100 900;font-display:block}`;
const journeys = JSON.parse(fs.readFileSync(path.join(LOC, 'data/journeys.json'), 'utf8'));

// ---- csv
function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === '\n') {
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else if (c !== '\r') f += c;
  }
  const [h, ...b] = rows;
  return b
    .filter((r) => r.length === h.length)
    .map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const reg = parseCsv(fs.readFileSync(path.join(LOC, 'VISASTACK_TRANSLATION_REGISTER.csv'), 'utf8'));
const map = {};
for (const r of reg)
  if (
    r.bn_BD_draft &&
    !/\{\w+\}|<\/?\w+>/.test(r.english) &&
    !r.automated_checks.match(/^(PLACEHOLDER|GLOSSARY|STRONGER|BANNED)/)
  ) {
    map[r.english.replace(/\s+/g, ' ').trim()] = r.bn_BD_draft;
    map[r.english.replace(/\s+/g, ' ').trim().toLowerCase()] = r.bn_BD_draft;
  }
const byEnglish = new Map(reg.map((r) => [r.english.replace(/\s+/g, ' ').trim(), r]));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const tmp = path.join(PACK, '.tmp');
fs.mkdirSync(tmp, { recursive: true });
async function shoot(slug, variant, file) {
  const raw = fs.readFileSync(path.join(HTML, `${slug}.html`), 'utf8');
  const lang = variant === 'bn' ? 'bn' : 'en';
  const doc = raw
    .replace(
      /<html([^>]*)>/,
      (_m, a) =>
        `<html${a.replace(/\s(lang|dir)="[^"]*"/g, '')} lang="${lang}"${variant === 'rtl' ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${slug}</title><link rel="stylesheet" href="file://${css}"><style>${fonts}${variant === 'bn' ? ' body{font-family:"Noto Sans Bengali","Inter",system-ui,sans-serif}' : ''}${variant === 'rtl' ? ' .skip-link{left:auto!important;inset-inline-start:-999px}' : ''}</style></head>`,
    )
    .replace('</head><head>', '');
  const tf = path.join(tmp, `${slug}.${variant}.html`);
  fs.writeFileSync(tf, doc);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(`file://${tf}`);
  let overlay = { text: 0, swapped: 0 };
  if (variant === 'bn') {
    overlay = await page.evaluate((m) => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let text = 0;
      let swapped = 0;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (!t || !/\p{L}/u.test(t) || n.parentElement?.closest('script,style')) continue;
        text++;
        const hit = m[t] ?? m[t.toLowerCase()];
        if (hit) {
          n.nodeValue = n.nodeValue.replace(t, hit);
          swapped++;
        }
      }
      return { text, swapped };
    }, map);
  }
  await page.evaluate(() => document.fonts.ready);
  const checks = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflowX = document.documentElement.scrollWidth - vw;
    let clipped = 0;
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (
        s.display === 'none' ||
        s.visibility === 'hidden' ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
      )
        continue;
      if (
        ['hidden', 'clip'].includes(s.overflowX) &&
        el.scrollWidth > el.clientWidth + 2 &&
        el.clientWidth > 0 &&
        (el.textContent || '').trim()
      )
        clipped++;
    }
    return { overflowX, clipped, height: document.documentElement.scrollHeight };
  });
  await page.screenshot({
    path: file,
    type: 'jpeg',
    quality: 55,
    clip: { x: 0, y: 0, width: 390, height: Math.min(1100, checks.height) },
  });
  await ctx.close();
  return { ...checks, ...overlay };
}

const _out = [];
const results = {};
for (const j of journeys) {
  const avail = j.slugs.filter((s) => fs.existsSync(path.join(HTML, `${s}.html`)));
  const picked = avail.slice(0, 2);
  results[j.id] = { journey: j, picked, avail, shots: [] };
  for (const slug of picked) {
    const short = slug.replace(/__/g, '_').slice(0, 60);
    for (const v of ['en', 'bn', 'rtl']) {
      const rel = `screens/${j.id}-${short}-${v}.jpg`;
      const r = await shoot(slug, v, path.join(PACK, rel));
      results[j.id].shots.push({ slug, variant: v, file: rel, ...r });
    }
  }
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });

// ---- key strings per journey (from the rendered text of its screens)
const rendered = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'apps/web/.preview/l10n/work/rendered-results.json'), 'utf8'),
).results;
const md = [];
md.push('# VisaStack localization review packet: 20 user journeys', '');
md.push(
  'Status: DRAFT FOR REVIEW. Nothing here is released text. The Bengali on the screenshots is a model draft swapped into exact-match text on real rendered screens; it has no human sign-off.',
  '',
);
md.push(
  'How to read a journey: each has phone screenshots in three forms, the automated checks that apply, the key strings with their draft Bengali, and an empty sign-off block for the human reviewer.',
  '',
);
md.push('- **English**: the real screen as the product draws it today, against made-up data.');
md.push(
  '- **bn-BD draft**: exact-match strings replaced by the register draft. Strings that contain numbers, names or links are not swapped, so these screens are mixed. The swap rate is printed under each image set.',
);
md.push(
  '- **RTL probe**: the same English screen mirrored with a right-to-left direction. It tests layout only (mirroring, overflow, clipped text). It is not a translation and not an Arabic draft; no right-to-left language is enabled or justified yet.',
  '',
);
md.push(
  'Not covered by pictures: screens that need a one-time link or stored requests (journey J16), loading and offline states, server-side validation errors after a button press, emails, PDFs and downloads. Those are listed per journey as untested.',
  '',
);
md.push('| Journey | Role | Screens shown | Source-only parts |', '|---|---|---|---|');
for (const j of journeys)
  md.push(
    `| ${j.id} | ${j.role} | ${results[j.id].picked.length} of ${j.slugs.length} | ${j.slugs.length - results[j.id].avail.length ? `${j.slugs.length - results[j.id].avail.length} screens not rendered` : 'none'} |`,
  );
md.push('');
const rows = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'apps/web/.preview/l10n/work/rows.json'), 'utf8'),
);
for (const j of journeys) {
  const R = results[j.id];
  md.push(
    `## ${j.id}. ${j.title}`,
    '',
    `- Role: ${j.role}`,
    `- States in this journey: ${j.states}`,
    `- Semantic checks to apply: ${j.checks.join('; ')}`,
  );
  if (j.note) md.push(`- Note: ${j.note}`);
  const missing = j.slugs.filter((s) => !R.avail.includes(s));
  if (missing.length) md.push(`- Not rendered (untested): ${missing.join(', ')}`);
  if (!R.picked.length) {
    md.push(
      '- No rendered screen is available for this journey. The strings below come from source files only.',
      '',
    );
    const files = j.sourceFiles ?? [];
    const hit = rows
      .filter(
        (r) =>
          files.some((f) => r.file.startsWith(f)) &&
          r.translation_unit === 'Y' &&
          r.priority !== 'NOT_FOR_TRANSLATION',
      )
      .slice(0, 14);
    md.push('| Source | English | bn-BD draft | Check |', '|---|---|---|---|');
    for (const r of hit) {
      const g = byEnglish.get(r.english);
      md.push(
        `| ${r.file.split('/').slice(-2).join('/')}:${r.line_start} | ${r.english.replace(/\|/g, '/').slice(0, 90)} | ${g?.bn_BD_draft?.replace(/\|/g, '/') ?? ''} | ${g?.automated_checks ?? ''} |`,
      );
    }
  }
  for (const slug of R.picked) {
    const shots = R.shots.filter((s) => s.slug === slug);
    md.push(
      '',
      `### Screen: ${slug}`,
      '',
      '| English | bn-BD draft | RTL probe |',
      '|---|---|---|',
    );
    md.push(
      `| ![](${shots.find((s) => s.variant === 'en').file}) | ![](${shots.find((s) => s.variant === 'bn').file}) | ![](${shots.find((s) => s.variant === 'rtl').file}) |`,
      '',
    );
    const bn = shots.find((s) => s.variant === 'bn');
    const rt = shots.find((s) => s.variant === 'rtl');
    const en = shots.find((s) => s.variant === 'en');
    md.push(
      `Measured: bn draft swapped ${bn.swapped} of ${bn.text} text runs (${bn.text ? Math.round((100 * bn.swapped) / bn.text) : 0}%). Sideways overflow in pixels: English ${en.overflowX}, bn ${bn.overflowX}, RTL ${rt.overflowX}. Clipped text blocks: English ${en.clipped}, bn ${bn.clipped}, RTL ${rt.clipped}.`,
    );
    // key strings
    const texts = [
      ...new Set(
        rendered
          .filter(
            (r) =>
              r.slug === slug &&
              r.type === 'text' &&
              ['exact', 'exact_case_changed'].includes(r.class),
          )
          .map((r) => r.text),
      ),
    ].filter((t) => t.length > 2 && t.length < 100);
    const scored = texts
      .map((t) => ({
        t,
        g: byEnglish.get(t) ?? byEnglish.get(t.toLowerCase()),
        tags: rows.find((r) => r.english === t)?.guard_tags ?? '',
      }))
      .sort((a, b) => (b.tags.length > 0) - (a.tags.length > 0))
      .slice(0, 10);
    md.push(
      '',
      '| English on screen | bn-BD draft | Guardrail tags | Automated check |',
      '|---|---|---|---|',
    );
    for (const s of scored)
      md.push(
        `| ${s.t.replace(/\|/g, '/')} | ${(s.g?.bn_BD_draft ?? '').replace(/\|/g, '/')} | ${s.tags.replace(/\|/g, ', ')} | ${s.g?.automated_checks ?? 'no draft'} |`,
      );
  }
  md.push(
    '',
    'Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):',
    '',
    '| Check | Result | Reviewer | Date |',
    '|---|---|---|---|',
    '| Meaning matches English | PENDING | | |',
    '| Natural bn-BD wording | PENDING | | |',
    '| Narrow phone fit | PENDING | | |',
    '| Screen reader names | PENDING | | |',
    '',
  );
}
fs.writeFileSync(path.join(PACK, 'REVIEW_PACKET.md'), md.join('\n'));
fs.writeFileSync(
  path.join(ROOT, 'apps/web/.preview/l10n/work/packet-stats.json'),
  JSON.stringify(
    Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        {
          picked: v.picked,
          shots: v.shots.map(({ slug, variant, overflowX, clipped, text, swapped }) => ({
            slug,
            variant,
            overflowX,
            clipped,
            text,
            swapped,
          })),
        },
      ]),
    ),
    null,
    1,
  ),
);
process.stdout.write(
  `journeys ${journeys.length} screens ${Object.values(results).reduce((n, r) => n + r.picked.length, 0)} images ${Object.values(results).reduce((n, r) => n + r.shots.length, 0)}\n`,
);
