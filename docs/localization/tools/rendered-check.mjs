#!/usr/bin/env node
/**
 * Compares the words on rendered screens (apps/web/.preview/l10n/html, written by run-render.sh)
 * with the source census. Every visible text node and accessible attribute is looked up in the
 * census: exact text, a template with placeholders, a known fragment, or made-up seed data from
 * the preview world. Anything left is a real gap in the census (or data we failed to recognise)
 * and is listed for review.
 *
 * Usage: node docs/localization/tools/rendered-check.mjs [census.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  removeBlocks,
  removeComments,
  splitOnTags,
  stripMarkers,
  titleOf,
} from './text-markers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORK = path.join(ROOT, 'apps/web/.preview/l10n/work');
const census = JSON.parse(
  fs.readFileSync(process.argv[2] ?? path.join(WORK, 'census.json'), 'utf8'),
);
const HTML_DIR = path.join(ROOT, 'apps/web/.preview/l10n/html');
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'apps/web/.preview/l10n/manifest.json'), 'utf8'),
);

const ENT = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#x27': "'",
  '#39': "'",
  '#x2F': '/',
  mdash: '-',
  ndash: '-',
  hellip: '...',
};
const decode = (s) =>
  s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, g) => {
    if (ENT[g] !== undefined) return ENT[g];
    if (g.startsWith('#x')) return String.fromCodePoint(Number.parseInt(g.slice(2), 16));
    if (g.startsWith('#')) return String.fromCodePoint(Number.parseInt(g.slice(1), 10));
    return m;
  });
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const LETTER = /\p{L}/u;

// ---- index the census
const exact = new Map(); // normalised text -> [ids]
const exactCi = new Map(); // lower-cased text -> [ids]: the product title-cases terms when drawing them
const templates = [];
const fragments = []; // [literal, id] for known fragments >= 5 chars
const addExact = (t, id) => {
  const k = norm(t);
  if (!exact.has(k)) exact.set(k, []);
  exact.get(k).push(id);
  const lk = k.toLowerCase();
  if (!exactCi.has(lk)) exactCi.set(lk, []);
  exactCi.get(lk).push(id);
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function toRegex(t) {
  // Placeholders -> lazy wildcard; markup in composed units -> optional.
  const parts = t
    .split(/(\{\w+\}|<\/?[\w.]+\/?>)/)
    .map((p) => (/^\{\w+\}$/.test(p) ? '.*?' : /^<\/?[\w.]+\/?>$/.test(p) ? '\\s*' : esc(p)));
  return new RegExp(`^${parts.join('')}$`, 'u');
}
for (const r of census.rows) {
  if (r.evidence.startsWith('EXCLUDED')) continue;
  addExact(r.english, r.id);
  if (/\{\w+\}|<\/?[\w.]+\/?>/.test(r.english) || r.icu_flags.includes('PLURAL_PAREN_S')) {
    const t = r.english.replace(/\(s\)/g, '(?:s|es)?');
    const literalLetters = (
      stripMarkers(r.english)
        .replace(/\{\w+\}/g, '')
        .match(/\p{L}/gu) || []
    ).length;
    if (literalLetters < 2) continue; // a template with no real words would match anything
    try {
      templates.push([toRegex(t), r.id]);
    } catch {
      /* skip malformed */
    }
  }
  const lits = splitOnTags(r.english)
    .flatMap((x) => x.split(/\{\w+\}/))
    .map(norm)
    .filter((x) => x.length >= 4 && LETTER.test(x));
  for (const l of lits) fragments.push([l, r.id]);
}
fragments.sort((a, b) => b[0].length - a[0].length);

// ---- seed data from the preview world: names, org names, emails, notes written into the fake database
const world = fs.readFileSync(path.join(ROOT, 'apps/web/preview/world.ts'), 'utf8');
const seed = new Set();
for (const m of world.matchAll(/(['"`])((?:\\.|(?!\1).)+)\1/g)) {
  const v = m[2].trim();
  if (v.length > 2 && LETTER.test(v)) seed.add(v.toLowerCase());
}
// Catalogue data stored in the database from packages (countries, document types) is in census via core.

const regionNames = new Set();
{
  const dn = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const n = dn.of(String.fromCharCode(a, b));
      if (n) regionNames.add(n.toLowerCase());
    }
}
const zoneCities = new Set(
  Intl.supportedValuesOf('timeZone').map((z) =>
    z.split('/').pop().replace(/_/g, ' ').toLowerCase(),
  ),
);
const isDataLike = (t) => {
  if (regionNames.has(t.toLowerCase())) return 'intl_region_name';
  if (zoneCities.has(t.toLowerCase())) return 'time_zone_city';
  if (/^[A-Z]{3} [\d,.]+$/.test(t) || /^[\d,.]+ [A-Z]{3}$/.test(t)) return 'money';
  if (/^[A-Z]{1,2}-[A-Z0-9]{5,8}$/.test(t)) return 'generated_reference';
  if (!LETTER.test(t)) return 'no_letters';
  if (/^[\d\s.,:/\-+%$৳()]+$/.test(t)) return 'number';
  if (
    /^\d{1,2}\s\w{3,9}\s\d{4}/.test(t) ||
    /^\w{3,9}\s\d{1,2},?\s\d{4}/.test(t) ||
    /\d{4}-\d{2}-\d{2}/.test(t)
  )
    return 'date';
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t)) return 'email';
  if (/^[A-Z]{2,3}$/.test(t)) return 'code';
  const low = t.toLowerCase();
  for (const s of seed)
    if (low === s || low.includes(s) || (s.length > 8 && s.includes(low) && low.length > 4))
      return 'seed_data';
  if (/^[A-Z0-9]{5,}$/.test(t) || /^[0-9a-f]{8}-[0-9a-f]{4}/.test(t)) return 'identifier';
  return null;
};

function extract(rawHtml) {
  // Scan, do not pattern-match: end tags may carry spaces and a regex cannot be trusted to find them.
  let html = removeBlocks(rawHtml, 'script');
  html = removeBlocks(html, 'style');
  html = removeComments(html);
  html = removeBlocks(html, 'svg', (block) => {
    const t = titleOf(block);
    return t ? ` <svgtitle>${t}</svgtitle> ` : ' ';
  });
  const out = [];
  const tagRe = /<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;
  let last = 0;
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    const text = html.slice(last, m.index);
    last = tagRe.lastIndex;
    if (text.trim()) out.push({ type: 'text', value: norm(decode(text)) });
    const attrs = m[2];
    for (const a of attrs.matchAll(
      /\s(aria-label|aria-description|aria-roledescription|aria-valuetext|title|alt|placeholder)=("([^"]*)"|'([^']*)')/g,
    )) {
      const v = norm(decode(a[3] ?? a[4] ?? ''));
      if (v) out.push({ type: `attr:${a[1]}`, value: v });
    }
    if (/^input$/i.test(m[1]) && /type="(submit|button|reset)"/.test(attrs)) {
      const v = attrs.match(/\svalue="([^"]*)"/);
      if (v) out.push({ type: 'attr:value', value: norm(decode(v[1])) });
    }
    if (/^option$/i.test(m[1])) {
      /* its text follows as a text node */
    }
  }
  return out;
}

const results = [];
const perScreen = [];
const totals = {
  nodes: 0,
  exact: 0,
  exact_case_changed: 0,
  template: 0,
  fragment: 0,
  data: 0,
  unmatched: 0,
};
const unmatchedAgg = new Map();
for (const f of fs
  .readdirSync(HTML_DIR)
  .filter((x) => x.endsWith('.html'))
  .sort()) {
  const slug = f.replace(/\.html$/, '');
  const meta = manifest.find((m) => m.slug === slug) ?? {};
  const nodes = extract(fs.readFileSync(path.join(HTML_DIR, f), 'utf8'));
  const s = {
    slug,
    route: meta.route,
    persona: meta.persona,
    variant: meta.variant,
    locale: meta.locale,
    nodes: 0,
    exact: 0,
    exact_case_changed: 0,
    template: 0,
    fragment: 0,
    data: 0,
    unmatched: 0,
  };
  const seen = new Set();
  for (const n of nodes) {
    const key = `${n.type}|${n.value}`;
    if (seen.has(key)) continue; // count each distinct string once per screen
    seen.add(key);
    if (!LETTER.test(n.value)) continue;
    s.nodes++;
    let cls = null;
    let ids = [];
    if (exact.has(n.value)) {
      cls = 'exact';
      ids = exact.get(n.value);
    } else if (exactCi.has(n.value.toLowerCase())) {
      cls = 'exact_case_changed';
      ids = exactCi.get(n.value.toLowerCase());
    } else {
      const t = templates.find(([re]) => re.test(n.value));
      if (t) {
        cls = 'template';
        ids = [t[1]];
      }
    }
    if (!cls) {
      const d = isDataLike(n.value);
      if (d) cls = 'data';
    }
    if (!cls) {
      const fr = fragments.find(([lit]) => n.value.includes(lit));
      if (fr) {
        cls = 'fragment';
        ids = [fr[1]];
      }
      // a text node built only from known pieces and data (every word covered)
    }
    if (!cls) cls = 'unmatched';
    s[cls]++;
    results.push({
      slug,
      route: meta.route ?? '',
      persona: meta.persona ?? '',
      variant: meta.variant ?? '',
      locale: meta.locale ?? '',
      type: n.type,
      text: n.value,
      class: cls,
      source_ids: ids.slice(0, 3).join(' '),
    });
    if (cls === 'unmatched') unmatchedAgg.set(n.value, (unmatchedAgg.get(n.value) ?? 0) + 1);
  }
  for (const k of [
    'nodes',
    'exact',
    'exact_case_changed',
    'template',
    'fragment',
    'data',
    'unmatched',
  ])
    totals[k] += s[k];
  perScreen.push(s);
}

fs.writeFileSync(
  path.join(WORK, 'rendered-results.json'),
  JSON.stringify({ totals, perScreen, results }, null, 0),
);
const explained = totals.exact + totals.exact_case_changed + totals.template;
const share = (n) => +((100 * n) / totals.nodes).toFixed(1);
process.stdout.write(
  `${JSON.stringify(
    {
      screens: perScreen.length,
      totals,
      exactOrTemplatePct: share(explained),
      explainedWithFragmentPct: share(explained + totals.fragment),
      dataPct: share(totals.data),
      unmatchedPct: share(totals.unmatched),
    },
    null,
    2,
  )}\n`,
);
const top = [...unmatchedAgg.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 60);
process.stdout.write('--- most common unmatched\n');
for (const [t, c] of top) process.stdout.write(`${c} | ${t.slice(0, 150)}\n`);
