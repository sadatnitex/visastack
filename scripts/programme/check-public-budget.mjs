#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

/**
 * Performance budget for the public site (WP-PUB1, ADR 0029). Four checks:
 *
 * 1. First-load JavaScript per public route, gzipped, may grow at most 10 KB over the recorded
 *    baseline (`check-public-budget.baseline.mjs`, taken from a build of main before the public
 *    site upgrade). Read from the build's `app-build-manifest.json`, so it needs `next build` first.
 * 2. The scroll engine (`scene-engine.ts`) stays at or under 2 KB gzipped, comments removed.
 * 3. With `--base <url>`: the pictures each public page asks for weigh at most 150 KB together.
 * 4. With `--base <url>`: no public page loads anything from another origin (scripts, styles,
 *    pictures, fonts, frames).
 *
 * Usage: node scripts/programme/check-public-budget.mjs [--next apps/web/.next] [--base URL]
 *        [--write-baseline]   (records the current build as the baseline; only from main)
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-public-budget.baseline.mjs',
);
export const ENGINE_FILE = join(ROOT, 'apps/web/src/components/public-site/scene-engine.ts');

export const LIMITS = Object.freeze({
  routeDeltaBytes: 10 * 1024,
  engineBytes: 2 * 1024,
  imageBytesPerPage: 150 * 1024,
});

/** The public pages the budget covers. Pages that later units add are checked once they exist. */
export const PUBLIC_ROUTES = Object.freeze([
  '/',
  '/how-it-works',
  '/trust',
  '/countries',
  '/for-agencies',
  '/privacy',
  '/terms',
  '/status',
]);

/** The manifest entries that make up a route's first load: every layout above it, then its page. */
export function entriesFor(route) {
  const parts = route === '/' ? [] : route.slice(1).split('/');
  const entries = ['/layout'];
  for (let i = 1; i <= parts.length; i++) entries.push(`/${parts.slice(0, i).join('/')}/layout`);
  entries.push(route === '/' ? '/page' : `${route}/page`);
  return entries;
}

/** The chunk files a route loads first, each once, or null when the build has no such page. */
export function chunksFor(manifest, route) {
  const pages = manifest?.pages ?? {};
  const entries = entriesFor(route);
  if (!pages[entries.at(-1)]) return null;
  return [...new Set(entries.flatMap((entry) => pages[entry] ?? []))].filter((file) =>
    file.endsWith('.js'),
  );
}

export function gzipBytes(content) {
  return gzipSync(content, { level: 9 }).length;
}

/** Gzipped first-load JavaScript per public route that the build holds. */
export function measureRoutes(nextDir, routes = PUBLIC_ROUTES) {
  const manifest = JSON.parse(readFileSync(join(nextDir, 'app-build-manifest.json'), 'utf8'));
  const sizes = {};
  for (const route of routes) {
    const chunks = chunksFor(manifest, route);
    if (chunks === null) continue;
    sizes[route] = chunks.reduce(
      (sum, file) => sum + gzipBytes(readFileSync(join(nextDir, file))),
      0,
    );
  }
  return sizes;
}

/** Routes whose first load grew past the limit, or that the baseline holds and the build lost. */
export function routeProblems(current, baseline, limit = LIMITS.routeDeltaBytes) {
  const problems = [];
  for (const route of Object.keys(baseline)) {
    if (!(route in current)) problems.push(`${route}: missing from the build`);
  }
  for (const [route, now] of Object.entries(current)) {
    const before = baseline[route];
    // A page new since the baseline counts against the home page's first load.
    const reference = before ?? baseline['/'];
    if (reference === undefined) problems.push(`${route}: no baseline to compare with`);
    else if (now - reference > limit)
      problems.push(
        `${route}: first-load JavaScript grew ${now - reference} bytes gzipped (limit ${limit})`,
      );
  }
  return problems;
}

/** The scroll engine as it ships: types and comments removed, then gzipped. */
export function engineBytes(source = readFileSync(ENGINE_FILE, 'utf8')) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  });
  return gzipBytes(outputText);
}

/** Every address a page asks the browser to load: scripts, styles, pictures, fonts, frames. */
export function loadedAddresses(html) {
  const found = [];
  const tag = /<(script|link|img|source|iframe|video|audio|embed|object)\b([^>]*)>/gi;
  for (const [, name, attrs] of html.matchAll(tag)) {
    const lower = name.toLowerCase();
    if (
      lower === 'link' &&
      !/\brel="(?:stylesheet|preload|modulepreload|icon|apple-touch-icon|manifest|prefetch)"/i.test(
        attrs,
      )
    )
      continue;
    for (const [, key, value] of attrs.matchAll(/\b(src|href|srcset|data|poster)="([^"]*)"/gi)) {
      const list =
        key.toLowerCase() === 'srcset'
          ? value.split(',').map((part) => part.trim().split(/\s+/)[0])
          : [value];
      for (const address of list) if (address) found.push({ tag: lower, address });
    }
  }
  return found;
}

/** Addresses on another origin than the page's own. */
export function foreignAddresses(html, base) {
  const own = new URL(base).origin;
  return loadedAddresses(html)
    .map(({ address }) => address)
    .filter((address) => {
      if (/^(?:data|blob):/i.test(address)) return true;
      try {
        return new URL(address, base).origin !== own;
      } catch {
        return true;
      }
    });
}

/** The picture addresses a page shows. */
export function pictureAddresses(html) {
  return [
    ...new Set(
      loadedAddresses(html)
        .filter(({ tag }) => tag === 'img' || tag === 'source')
        .map(({ address }) => address),
    ),
  ];
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer()).length;
}

export async function checkPages(base, routes = PUBLIC_ROUTES, read = fetch) {
  const problems = [];
  const report = {};
  for (const route of routes) {
    const response = await read(new URL(route, base));
    if (response.status === 404) continue;
    if (!response.ok) {
      problems.push(`${route}: HTTP ${response.status}`);
      continue;
    }
    const html = await response.text();
    for (const address of foreignAddresses(html, base))
      problems.push(`${route}: loads from another origin: ${address.slice(0, 80)}`);
    let images = 0;
    for (const address of pictureAddresses(html)) {
      const local = join(ROOT, 'apps/web/public', new URL(address, base).pathname);
      images += existsSync(local) ? statSync(local).size : await fetchBytes(new URL(address, base));
    }
    report[route] = images;
    if (images > LIMITS.imageBytesPerPage)
      problems.push(`${route}: pictures weigh ${images} bytes (limit ${LIMITS.imageBytesPerPage})`);
  }
  return { problems, report };
}

/** The baseline file's text: a module, so it can sit beside this script. */
export function baselineModule(sizes) {
  const lines = Object.entries(sizes).map(([route, bytes]) => `  '${route}': ${bytes},`);
  return [
    '/**',
    ' * Gzipped first-load JavaScript per public route, from a build of main before the public site',
    ' * upgrade. Written by `check-public-budget.mjs --write-baseline`.',
    ' */',
    'export default {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

/** One line of the report. */
function say(line) {
  process.stdout.write(`${line}\n`);
}

function argument(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const nextDir = resolve(argument('--next') ?? join(ROOT, 'apps/web/.next'));
  const base = argument('--base');
  const problems = [];
  const engine = engineBytes();
  if (engine > LIMITS.engineBytes)
    problems.push(`scroll engine: ${engine} bytes gzipped (limit ${LIMITS.engineBytes})`);
  say(`scroll engine: ${engine} bytes gzipped`);
  if (existsSync(join(nextDir, 'app-build-manifest.json'))) {
    const current = measureRoutes(nextDir);
    if (process.argv.includes('--write-baseline')) {
      writeFileSync(BASELINE_FILE, baselineModule(current));
      say(`baseline written: ${JSON.stringify(current)}`);
    } else {
      const { default: baseline } = await import(pathToFileURL(BASELINE_FILE).href);
      for (const [route, bytes] of Object.entries(current))
        say(`${route}: ${bytes} bytes gzipped (baseline ${baseline[route] ?? 'none'})`);
      problems.push(...routeProblems(current, baseline));
    }
  } else problems.push(`no build at ${nextDir}: run the web build first`);
  if (base) {
    const pages = await checkPages(base);
    for (const [route, bytes] of Object.entries(pages.report))
      say(`${route}: pictures ${bytes} bytes`);
    problems.push(...pages.problems);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else say('Public site budget passed');
}
