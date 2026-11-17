import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  BASELINE_FILE,
  LIMITS,
  PUBLIC_ROUTES,
  checkPages,
  chunksFor,
  engineBytes,
  entriesFor,
  foreignAddresses,
  pictureAddresses,
  routeProblems,
} from './check-public-budget.mjs';

test('the limits are the ones the owner set for the public site (WP-PUB1)', () => {
  assert.deepEqual(
    { ...LIMITS },
    {
      routeDeltaBytes: 10240,
      engineBytes: 2048,
      imageBytesPerPage: 153600,
    },
  );
  for (const route of ['/', '/how-it-works', '/trust', '/countries', '/for-agencies'])
    assert.ok(PUBLIC_ROUTES.includes(route), route);
});

test('a route loads every layout above it and then its page', () => {
  assert.deepEqual(entriesFor('/'), ['/layout', '/page']);
  assert.deepEqual(entriesFor('/trust'), ['/layout', '/trust/layout', '/trust/page']);
  const manifest = {
    pages: {
      '/layout': ['static/chunks/a.js', 'static/css/a.css'],
      '/trust/page': ['static/chunks/a.js', 'static/chunks/b.js'],
    },
  };
  assert.deepEqual(chunksFor(manifest, '/trust'), ['static/chunks/a.js', 'static/chunks/b.js']);
  assert.equal(chunksFor(manifest, '/countries'), null);
});

test('a first load more than 10 KB over the baseline fails, and so does a lost page', () => {
  const baseline = { '/': 100_000, '/trust': 90_000 };
  assert.deepEqual(routeProblems({ '/': 110_240, '/trust': 90_000 }, baseline), []);
  assert.match(routeProblems({ '/': 110_241, '/trust': 90_000 }, baseline)[0], /grew 10241/);
  assert.match(routeProblems({ '/': 100_000 }, baseline)[0], /\/trust: missing/);
  // A page added after the baseline is held to the home page's figure.
  assert.deepEqual(
    routeProblems({ '/': 100_000, '/trust': 1, '/countries': 105_000 }, baseline),
    [],
  );
  assert.match(
    routeProblems({ '/': 100_000, '/trust': 1, '/countries': 111_000 }, baseline)[0],
    /\/countries: first-load/,
  );
});

test('the recorded baseline covers the public pages that exist today', async () => {
  const { default: baseline } = await import(pathToFileURL(BASELINE_FILE).href);
  for (const route of ['/', '/trust', '/privacy', '/terms', '/status'])
    assert.ok(Number.isInteger(baseline[route]) && baseline[route] > 0, route);
});

test('the scroll engine stays within 2 KB gzipped, and a heavy engine fails', () => {
  assert.ok(engineBytes() <= LIMITS.engineBytes, String(engineBytes()));
  const heavy = `export const big = ${JSON.stringify(
    Array.from({ length: 4000 }, (_, i) => `${i}-${(i * 7919) % 104729}`),
  )};`;
  assert.ok(engineBytes(heavy) > LIMITS.engineBytes);
});

test('anything from another origin is caught, own files are not', () => {
  const base = 'http://localhost:3100';
  const html = [
    '<script src="/_next/static/chunks/a.js" nonce="x"></script>',
    '<link rel="stylesheet" href="/_next/static/css/a.css">',
    '<link rel="canonical" href="https://vs.example/">',
    '<a href="https://example.com/">out</a>',
    '<img src="/flags/gb.svg" srcset="/a.png 1x, https://cdn.example.com/b.png 2x">',
    '<script src="https://cdn.example.com/x.js"></script>',
    '<link rel="stylesheet" href="//fonts.example.com/f.css">',
    '<img src="data:image/png;base64,AAAA">',
  ].join('');
  assert.deepEqual(foreignAddresses(html, base), [
    'https://cdn.example.com/b.png',
    'https://cdn.example.com/x.js',
    '//fonts.example.com/f.css',
    'data:image/png;base64,AAAA',
  ]);
  assert.deepEqual(
    pictureAddresses('<img src="/a.png"><img src="/a.png"><source srcset="/b.webp">'),
    ['/a.png', '/b.webp'],
  );
});

test('pages are read for pictures and origins, and a heavy page fails', async () => {
  const pages = {
    '/': '<img src="/pictures/passport-bd.png"><img src="/flags/gb.svg">',
    '/trust': '<script src="https://cdn.example.com/x.js"></script>',
  };
  const read = async (url) => {
    const html = pages[new URL(url).pathname];
    return html === undefined
      ? { status: 404, ok: false }
      : { status: 200, ok: true, text: async () => html };
  };
  const { problems, report } = await checkPages(
    'http://localhost:3100',
    ['/', '/trust', '/countries'],
    read,
  );
  assert.ok(report['/'] > 27_000 && report['/'] < LIMITS.imageBytesPerPage, String(report['/']));
  assert.deepEqual(problems, ['/trust: loads from another origin: https://cdn.example.com/x.js']);
  const many = {
    '/': Array.from({ length: 6 }, () => '<img src="/pictures/passport-bd.png">').join(''),
  };
  // The same picture asked for six times is one download.
  const once = await checkPages('http://localhost:3100', ['/'], async () => ({
    status: 200,
    ok: true,
    text: async () => many['/'],
  }));
  assert.deepEqual(once.problems, []);
  const heavy = Array.from(
    { length: 6 },
    (_, i) => `<img src="/pictures/passport-bd.png?v=${i}">`,
  ).join('');
  const big = await checkPages('http://localhost:3100', ['/'], async () => ({
    status: 200,
    ok: true,
    text: async () => heavy,
  }));
  assert.match(big.problems[0] ?? '', /pictures weigh/);
});
