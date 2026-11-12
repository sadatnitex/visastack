#!/usr/bin/env node
/**
 * Proves a codemod run left the English screens byte-identical.
 *
 *   node scripts/i18n/verify-english.mjs snapshot     # before the codemod: render and keep a copy
 *   node scripts/i18n/verify-english.mjs compare      # after: render again and diff
 *
 * Rendering is docs/localization/tools/run-render.sh (every page against the made-up preview
 * world, written to apps/web/.preview/l10n/html with manifest.json beside it). `compare` checks
 * every English scenario (locale en): the same scenarios, the same outcome (ok, redirect, not
 * found, error) and the same HTML. Any difference fails with the route and the first differing
 * text. `--skip-render` compares what is already on disk (used by the tests).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIfExists } from './catalog.mjs';

const say = (line) => process.stdout.write(`${line}\n`);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const L10N = path.join(ROOT, 'apps/web/.preview/l10n');
const RENDERED = { html: path.join(L10N, 'html'), manifest: path.join(L10N, 'manifest.json') };
const BEFORE = {
  html: path.join(L10N, 'english-before/html'),
  manifest: path.join(L10N, 'english-before/manifest.json'),
};

function renderAll() {
  fs.rmSync(RENDERED.html, { recursive: true, force: true });
  const r = spawnSync('bash', [path.join(ROOT, 'docs/localization/tools/run-render.sh')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0)
    throw new Error(`render failed (exit ${r.status}):\n${`${r.stdout}${r.stderr}`.slice(-3000)}`);
}

const nullable = (text) => (text === null ? null : normaliseRandom(text));

const englishOf = (manifestPath) => {
  const list = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return new Map(list.filter((s) => (s.locale ?? 'en') === 'en').map((s) => [s.slug, s]));
};

/**
 * Values that legitimately change on every render and say nothing about the English: record ids,
 * signed form values (a base64url header "eyJ..." then a signature) and security-policy nonces.
 * The render harness already draws ids and keys from a fixed seed, so these normally match; this
 * keeps the comparison honest if a new random value appears. Deliberately narrow: only values of
 * these exact shapes, so a changed word is never hidden.
 */
export function normaliseRandom(html) {
  return html
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/(value|content)="eyJ[A-Za-z0-9_.-]{20,}"/g, '$1="<signed>"')
    .replace(/\bnonce="[A-Za-z0-9+/_=-]{8,}"/g, 'nonce="<nonce>"');
}

/** First point where two strings differ, with a little context on each side. */
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return { at: i, before: a.slice(from, i + 60), after: b.slice(from, i + 60) };
}

/**
 * Compare two renders. Returns a list of differences (empty when the English is identical).
 * @param {{ html: string, manifest: string }} before
 * @param {{ html: string, manifest: string }} after
 */
export function compareRenders(before, after) {
  const a = englishOf(before.manifest);
  const b = englishOf(after.manifest);
  const diffs = [];
  for (const [slug, s] of a) {
    const t = b.get(slug);
    if (!t) {
      diffs.push({ slug, route: s.route, problem: 'scenario missing after' });
      continue;
    }
    if (s.outcome !== t.outcome)
      diffs.push({ slug, route: s.route, problem: `outcome ${s.outcome} -> ${t.outcome}` });
    const fa = path.join(before.html, `${slug}.html`);
    const fb = path.join(after.html, `${slug}.html`);
    const ha = nullable(readIfExists(fa));
    const hb = nullable(readIfExists(fb));
    if (ha !== hb)
      diffs.push({
        slug,
        route: s.route,
        problem: ha === null || hb === null ? 'page appeared or disappeared' : 'html differs',
        ...(ha !== null && hb !== null ? firstDifference(ha, hb) : {}),
      });
  }
  for (const [slug, t] of b)
    if (!a.has(slug)) diffs.push({ slug, route: t.route, problem: 'new scenario after' });
  return diffs;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const skipRender = rest.includes('--skip-render');
  if (cmd === 'snapshot') {
    if (!skipRender) renderAll();
    fs.rmSync(path.dirname(BEFORE.html), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(BEFORE.html), { recursive: true });
    fs.cpSync(RENDERED.html, BEFORE.html, { recursive: true });
    fs.copyFileSync(RENDERED.manifest, BEFORE.manifest);
    say(`kept ${englishOf(BEFORE.manifest).size} English scenarios as the baseline`);
    return 0;
  }
  if (cmd === 'compare') {
    if (!fs.existsSync(BEFORE.manifest)) throw new Error('no baseline: run `snapshot` first');
    if (!skipRender) renderAll();
    const diffs = compareRenders(BEFORE, RENDERED);
    const n = englishOf(BEFORE.manifest).size;
    if (!diffs.length) {
      say(`English identical on all ${n} scenarios`);
      return 0;
    }
    console.error(`English changed on ${diffs.length} of ${n} scenarios:`);
    for (const d of diffs.slice(0, 50)) console.error(JSON.stringify(d));
    return 1;
  }
  throw new Error('usage: verify-english.mjs snapshot|compare [--skip-render]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
